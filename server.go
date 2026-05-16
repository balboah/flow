// An experimental project for creating a multiplayer snake game.
// See the README.md for further description.
package flow

import (
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/websocket"
)

// Limits applied to inbound traffic. The per-IP and total caps are tunable
// via FLOW_MAX_CONNS_PER_IP and FLOW_MAX_CONNS so a deployer can dial them up
// or down without recompiling. Defaults err on the lenient side because
// shared NATs / classroom IPs are common.
const (
	maxNameLength       = 32              // characters; longer names are truncated
	maxCommandLogLength = 32              // bytes of message.Command surfaced in logs
	helloDeadline       = 5 * time.Second // time to send the first HELLO
	readIdleDeadline    = 90 * time.Second
)

var (
	connCountsMu sync.Mutex
	connCounts   = map[string]int{}
	connTotal    int

	perIPConnLimit = intEnv("FLOW_MAX_CONNS_PER_IP", 32)
	totalConnLimit = intEnv("FLOW_MAX_CONNS", 256)

	allowedOrigins  = parseAllowedOrigins(os.Getenv("FLOW_ALLOWED_ORIGINS"))
	allowAllOrigins = len(allowedOrigins) == 0
)

func intEnv(name string, def int) int {
	if v := os.Getenv(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func parseAllowedOrigins(raw string) []string {
	if raw == "" {
		return nil
	}
	out := []string{}
	for _, s := range strings.Split(raw, ",") {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// checkOrigin enforces the FLOW_ALLOWED_ORIGINS allowlist when set. The default
// (env var unset) permits any origin so dev / single-player local usage stays
// frictionless; production should set the env var to the public site.
func checkOrigin(config *websocket.Config, req *http.Request) error {
	got := req.Header.Get("Origin")
	if allowAllOrigins {
		return nil
	}
	if got == "" {
		return errors.New("websocket: missing Origin")
	}
	for _, allowed := range allowedOrigins {
		if got == allowed {
			return nil
		}
	}
	log.Printf("Rejected websocket connection from origin %q", got)
	return errors.New("websocket: origin not allowed")
}

// addrSlot reserves a slot for this connection's source IP. Returns a release
// func, or an error if either the per-IP or total cap is exceeded.
func addrSlot(remote string) (func(), error) {
	ip, _, err := net.SplitHostPort(remote)
	if err != nil {
		ip = remote
	}
	connCountsMu.Lock()
	defer connCountsMu.Unlock()
	if connTotal >= totalConnLimit {
		return nil, errors.New("server full")
	}
	if connCounts[ip] >= perIPConnLimit {
		return nil, errors.New("too many connections from this address")
	}
	connCounts[ip]++
	connTotal++
	return func() {
		connCountsMu.Lock()
		defer connCountsMu.Unlock()
		connCounts[ip]--
		if connCounts[ip] <= 0 {
			delete(connCounts, ip)
		}
		connTotal--
	}, nil
}

// truncate clamps s to at most n bytes, appending an ellipsis when cut.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	if n <= 1 {
		return s[:n]
	}
	return s[:n-1] + "…"
}

// sanitizeName collapses whitespace, drops control characters, and clamps the
// result to a sane length. Names flow into broadcast packets so even one
// huge string gets amplified to every viewer.
func sanitizeName(s string) string {
	s = strings.ReplaceAll(s, "\x00", "")
	s = strings.Map(func(r rune) rune {
		if r < 0x20 {
			return ' '
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	if len(s) > maxNameLength {
		s = s[:maxNameLength]
	}
	return s
}

// trySend attempts a non-blocking send. Returns true on success. The receive
// goroutine uses this for inputs the game can drop without harm (excess MOVE
// during congestion) so a slow playfield doesn't backpressure the socket.
func trySend[T any](ch chan T, v T) bool {
	select {
	case ch <- v:
		return true
	default:
		return false
	}
}

// WormsServer handles one websocket connection. It expects the first packet
// to be HELLO carrying an optional Token (for reconnect) and Name. The same
// browser session reconnects to its prior worm by token; if the token is
// unknown or empty, a new worm is created.
func WormsServer(ws *websocket.Conn) {
	defer ws.Close()
	release, err := addrSlot(ws.Request().RemoteAddr)
	if err != nil {
		log.Printf("Rejecting connection from %s: %v", ws.Request().RemoteAddr, err)
		return
	}
	defer release()

	log.Println("New Worms connection!")
	defer log.Println("Worms connection going down!")

	// TODO: Make this key dynamic once we want several playfields
	playfield := lobby.Playfield("1337")

	// Bounded handshake: the first packet must arrive within helloDeadline.
	_ = ws.SetReadDeadline(time.Now().Add(helloDeadline))
	var hello Packet
	if err := websocket.JSON.Receive(ws, &hello); err != nil {
		log.Printf("Initial recv error: %v", err)
		return
	}
	_ = ws.SetReadDeadline(time.Time{}) // back to no overall deadline

	name, token := extractHello(hello)
	// Server-managed AI tokens are never accepted from a client. Replace any
	// such claim with a fresh random token so the connection still works.
	if token == "" || isAIToken(token) {
		token = newToken()
	}
	if token == "" {
		log.Printf("Refusing connection: token generation failed")
		return
	}

	reply := make(chan AttachReply, 1)
	playfield.Attach <- AttachRequest{Token: token, Name: name, Reply: reply}
	attached := <-reply
	worm := attached.Worm

	playfield.ConnState <- ConnState{Worm: worm, Connected: true}
	defer func() { playfield.ConnState <- ConnState{Worm: worm, Connected: false} }()

	// A late RENAME-with-name may have come via HELLO; apply it. The initial
	// name is set by Attach (used for new worms only — existing worms keep
	// their stored name).
	if name != "" && attached.Worm.Name != name {
		playfield.Rename <- RenameRequest{Worm: worm, Name: name}
	}

	quit := make(chan struct{})

	// Receive from client
	go func() {
		defer ws.Close() // wake up the transmit goroutine on receive error
		var message Packet
		for {
			// Reset the idle deadline before each receive so an open socket
			// without traffic can't hold a worm slot forever.
			_ = ws.SetReadDeadline(time.Now().Add(readIdleDeadline))
			err := websocket.JSON.Receive(ws, &message)
			if err != nil {
				log.Printf("Error reading websocket message: %v", err)
				return
			}
			switch message.Command {
			case "HELLO":
				// Already handled at handshake. A re-HELLO is treated as a name update.
				if n, _ := extractHello(message); n != "" && n != worm.Name {
					trySend(playfield.Rename, RenameRequest{Worm: worm, Name: n})
				}
			case "RENAME":
				if raw, ok := message.Payload.(string); ok {
					if n := sanitizeName(raw); n != "" {
						trySend(playfield.Rename, RenameRequest{Worm: worm, Name: n})
					}
				}
			case "RESPAWN":
				trySend(playfield.Respawn, RespawnRequest{Worm: worm})
			case "MOVE":
				if d, ok := parseMoveDirection(message.Payload); ok {
					trySend(playfield.MoveCmd, DirectionRequest{Worm: worm, Direction: d})
				}
			default:
				log.Printf("Unknown command from client: %s", truncate(message.Command, maxCommandLogLength))
			}
		}
	}()

	// Transmit to client
	go func() {
		defer close(quit)
		for message := range worm.Outbox {
			if err := websocket.JSON.Send(ws, message); err != nil {
				log.Printf("Error sending packet: %v", err)
				return
			}
		}
	}()

	<-quit
	// The worm stays in the playfield indexed by token. The game loop keeps
	// ticking; if the player refreshes their browser they reconnect with the
	// same token and resync. After DisconnectTTL with no reconnect, the
	// playfield sweeps the worm.
}

// parseMoveDirection turns the client's "UP"/"DOWN"/"LEFT"/"RIGHT" string
// into a Direction. Returns ok=false for anything unrecognised so the server
// can ignore garbage without trusting the client.
func parseMoveDirection(payload interface{}) (Direction, bool) {
	s, ok := payload.(string)
	if !ok {
		return Unknown, false
	}
	switch s {
	case "UP":
		return Up, true
	case "DOWN":
		return Down, true
	case "LEFT":
		return Left, true
	case "RIGHT":
		return Right, true
	}
	return Unknown, false
}

// extractHello pulls Name and Token out of a HELLO/RENAME payload, accepting
// both the new struct shape and the legacy bare-string Name form. Names are
// sanitized/truncated here so downstream code sees only well-formed values.
func extractHello(pkt Packet) (name, token string) {
	switch p := pkt.Payload.(type) {
	case map[string]interface{}:
		if n, ok := p["Name"].(string); ok {
			name = sanitizeName(n)
		}
		if t, ok := p["Token"].(string); ok {
			token = t
		}
	case string:
		name = sanitizeName(p)
	}
	return
}

// WormsHandler returns an http.Handler that performs the websocket upgrade
// with origin enforcement. FLOW_ALLOWED_ORIGINS (comma-separated) restricts
// the allowed Origin headers; unset means any origin (intended for local dev
// only).
func WormsHandler() http.Handler {
	log.Println("New Worms handler!")
	return &websocket.Server{
		Handshake: checkOrigin,
		Handler:   WormsServer,
	}
}
