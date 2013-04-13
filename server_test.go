package flow

import (
	"code.google.com/p/go.net/websocket"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

var once sync.Once
var serverAddr string

func startServer() {
	http.Handle("/worms", WormsHandler())
	server := httptest.NewServer(nil)
	serverAddr = server.Listener.Addr().String()
	log.Print("Test WebSocket server listening on ", serverAddr)
}

func newConfig(t *testing.T, path string) *websocket.Config {
	config, _ := websocket.NewConfig(fmt.Sprintf("ws://%s%s", serverAddr, path), "http://localhost")
	return config
}

func TestConcurrency(t *testing.T) {
	times := 10
	done := make(chan int)
	for n := 0; n < times; n++ {
		go func() {
			TestWormsServerConnect(t)
			done <- 1
		}()
	}

	for n := 0; n < times; n++ {
		select {
		case <-done:
		case <-time.After(TICK * 2 * time.Millisecond):
			t.Errorf("Timed out waiting for a reply")
			return
		}
	}
}

func TestWormsServerConnect(t *testing.T) {
	once.Do(startServer)

	client, err := net.Dial("tcp", serverAddr)
	if err != nil {
		t.Fatal("dialing", err)
	}
	conn, err := websocket.NewClient(newConfig(t, "/worms"), client)
	if err != nil {
		t.Errorf("WebSocket handshake error: %v", err)
		return
	}
	defer conn.Close()

	if err := websocket.JSON.Send(conn, Packet{Command: "HELLO"}); err != nil {
		t.Errorf("Write: %v", err)
	}

	var actual_msg Packet

	timer := time.AfterFunc(TICK*2*time.Millisecond, func() {
		t.Errorf("Timed out waiting for a reply")
	})
	if err := websocket.JSON.Receive(conn, &actual_msg); err != nil {
		t.Errorf("Read: %v", err)
	}
	timer.Stop()

	switch actual_msg.Command {
	case "MOVE", "KILL", "HELLO":
	default:
		t.Errorf("Unexpected reply", actual_msg)
	}
}

func TestWormMovability(t *testing.T) {
	w := Worm{position: Position{25, 25}}

	if d := w.Direction(); d == "" {
		t.Errorf("Expeceted direction to be initialized")
	}

	testPos := func(p Position) {
		if p != w.position {
			t.Error("Wrong position", w.position, "!=", p)
		}
	}

	originalPos := w.position

	w.MoveLeft()
	if d := w.Direction(); d != "LEFT" {
		t.Errorf("Unexpected direction", d)
	}
	testPos(Position{originalPos.X - 1, w.position.Y})

	w.MoveRight()
	if d := w.Direction(); d != "RIGHT" {
		t.Errorf("Unexpected direction", d)
	}
	testPos(Position{originalPos.X, w.position.Y})

	w.MoveUp()
	if d := w.Direction(); d != "UP" {
		t.Errorf("Unexpected direction", d)
	}
	testPos(Position{originalPos.X, originalPos.Y - 1})

	w.MoveDown()
	if d := w.Direction(); d != "DOWN" {
		t.Errorf("Unexpected direction", d)
	}
	testPos(Position{originalPos.X, originalPos.Y})
}

func TestCommunicate(t *testing.T) {
	w := NewWorm()
	w.MoveRight()

	done := make(chan int)
	go func() {
		w.Communicate()
		done <- 1
	}()

	w.C.Inbox <- Packet{Command: "MOVE", Payload: "UP"}
	<-done

	if d := w.Direction(); d != "UP" {
		t.Error("Did not obey communicated command, direction is:", d)
	}

	go func() {
		w.Communicate()
		done <- 1
	}()

	w.C.Inbox <- Packet{Command: "MOVE", Payload: "DOWN"}
	<-done

	if d := w.Direction(); d == "DOWN" {
		t.Error("Should not be able to move in opposite direction")
	}
}

func TestAttachable(t *testing.T) {
	w1 := Attachable(NewWorm())
	tail := &Block{position: Position{X: 1, Y: 2}}

	if err := w1.Attach(tail); err != nil {
		t.Error("Error attaching:", err)
	}
	if w := w1.Next(); w != tail {
		t.Error("Expected tail")
	}
	if l := len(w1.(Attachable).Positions()); l != 2 {
		t.Error("Expected 2 Positions for two attachables got", l)
	}
}