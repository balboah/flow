// An experimental project for creating a multiplayer snake game.
// See the README.md for further description.
package flow

import (
	"log"

	"golang.org/x/net/websocket"
)

// WormsServer handles one websocket connection. It expects the first packet
// to be HELLO carrying an optional Token (for reconnect) and Name. The same
// browser session reconnects to its prior worm by token; if the token is
// unknown or empty, a new worm is created.
func WormsServer(ws *websocket.Conn) {
	log.Println("New Worms connection!")
	defer ws.Close()
	defer log.Println("Worms connection going down!")

	// TODO: Make this key dynamic once we want several playfields
	playfield := lobby.Playfield("1337")

	// Block until the client sends its HELLO so we know which worm to bind to.
	var hello Packet
	if err := websocket.JSON.Receive(ws, &hello); err != nil {
		log.Printf("Initial recv error: %v", err)
		return
	}

	name, token := extractHello(hello)
	if token == "" {
		token = newToken()
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
			err := websocket.JSON.Receive(ws, &message)
			if err != nil {
				log.Printf("Error reading websocket message: %v", err)
				return
			}
			switch message.Command {
			case "HELLO":
				// Already handled at handshake. A re-HELLO is treated as a name update.
				if n, _ := extractHello(message); n != "" && n != worm.Name {
					playfield.Rename <- RenameRequest{Worm: worm, Name: n}
				}
			case "RENAME":
				if n, ok := message.Payload.(string); ok && n != "" {
					playfield.Rename <- RenameRequest{Worm: worm, Name: n}
				}
			case "RESPAWN":
				playfield.Respawn <- RespawnRequest{Worm: worm}
			case "MOVE":
				if d, ok := parseMoveDirection(message.Payload); ok {
					playfield.MoveCmd <- DirectionRequest{Worm: worm, Direction: d}
				}
			default:
				log.Printf("Unknown command from client: %s", message.Command)
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
	// same token and resync. If they never come back, the worm will die to
	// a wall under inertia.
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
// both the new struct shape and the legacy bare-string Name form.
func extractHello(pkt Packet) (name, token string) {
	switch p := pkt.Payload.(type) {
	case map[string]interface{}:
		if n, ok := p["Name"].(string); ok {
			name = n
		}
		if t, ok := p["Token"].(string); ok {
			token = t
		}
	case string:
		name = p
	}
	return
}

func WormsHandler() websocket.Handler {
	log.Println("New Worms handler!")
	return websocket.Handler(WormsServer)
}
