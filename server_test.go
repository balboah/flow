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
