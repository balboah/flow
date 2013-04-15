// An experimental project for creating a multiplayer snake game.
// See the README.md for further description.
package flow

import (
	"code.google.com/p/go.net/websocket"
	"log"
)

// This is where the action starts
// A websocket server that creates new worms on a playfield
func WormsServer(ws *websocket.Conn) {
	// TODO: Set read/write timeouts

	log.Println("New Worms connection!")
	defer ws.Close()
	defer log.Println("Worms connection going down!")

	worm := NewWorm()

	// TODO: Make this key dynamic once we want several playfields
	playfield := lobby.Playfield("1337")

	playfield.Join <- worm

	quit := make(chan bool)

	// Receive from client
	go func() {
		var message Packet
		for {
			err := websocket.JSON.Receive(ws, &message)
			if err != nil {
				log.Printf("Error reading websocket message: %v", err)
				break
			}
			log.Print("Got data on worms server", message)
			worm.C.Inbox <- message
		}
		close(worm.C.Inbox)
		quit <- true
	}()

	// Transmit to client
	go func() {
		for message := range worm.C.Outbox {
			err := websocket.JSON.Send(ws, message)
			if err != nil {
				log.Printf("Error sending position: %v", err)
				break
			}
		}
		quit <- true
	}()

	<-quit
	playfield.Part <- worm
}

func WormsHandler() websocket.Handler {
	log.Println("New Worms handler!")
	return websocket.Handler(WormsServer)
}
