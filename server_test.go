package flow

import (
	"testing"
	"bytes"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"log"
	"sync"
	"code.google.com/p/go.net/websocket"
)

var once sync.Once
var serverAddr string

func startServer() {
		http.Handle("/echo", EchoHandler())
		server := httptest.NewServer(nil)
		serverAddr = server.Listener.Addr().String()
		log.Print("Test WebSocket server listening on ", serverAddr)
}

func newConfig(t *testing.T, path string) *websocket.Config {
        config, _ := websocket.NewConfig(fmt.Sprintf("ws://%s%s", serverAddr, path), "http://localhost")
        return config
}

func TestEchoServer(t *testing.T) {
	once.Do(startServer)

	client, err := net.Dial("tcp", serverAddr)
	if err != nil {
			t.Fatal("dialing", err)
	}
	conn, err := websocket.NewClient(newConfig(t, "/echo"), client)
	if err != nil {
			t.Errorf("WebSocket handshake error: %v", err)
			return
	}
	defer conn.Close()

	msg := []byte("hello, world\n")
	if _, err := conn.Write(msg); err != nil {
			t.Errorf("Write: %v", err)
	}
	var actual_msg = make([]byte, 512)
	n, err := conn.Read(actual_msg)
	if err != nil {
			t.Errorf("Read: %v", err)
	}
	actual_msg = actual_msg[0:n]
	if !bytes.Equal(msg, actual_msg) {
			t.Errorf("Echo: expected %q got %q", msg, actual_msg)
	}
}