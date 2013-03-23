/*
A websocket gaming platform.
First up is Worms, a nokia snake but with multi player possibilities.

TODO:
	- Make an interval for movement, keep going in last direction
	- Add a tail to the pixel to complete the worm, which grows whenever you eat a new point
	- Have two players for each field, if one eats the other the game is over. Highest points win
	- Create a list of games, each with available slots for players to compete
*/

package flow

import (
	"fmt"
	"log"
	"time"
	"code.google.com/p/go.net/websocket"
)

type Position struct {
	X int
	Y int
}

const Boundary = 49

/*
TODO:
	Create a playfield to put worms in
	One ticker per playfield and a new channel for each worm added for broadcasting this tick to it

package main

import (
	"fmt"
	"time"
)

func main() {
	c := time.Tick(time.Second)
	ticks := []chan time.Time{make(chan time.Time), make(chan time.Time), make(chan time.Time)}

	go func() {
		for {
			tick := <- c
			for _, t := range ticks {
				t <- tick
			}
		}
	}()

	done := make(chan int)
	go func() {
		var timestamp time.Time
		timestamp = <-ticks[0]
		fmt.Printf("Got time in go 1: %v\n", timestamp)
		done <- 1
	}()

	go func() {
		var timestamp time.Time
		timestamp = <-ticks[1]
		fmt.Printf("Got time in go 2: %v\n", timestamp)
		done <- 1
	}()

	go func() {
		var timestamp time.Time
		timestamp = <-ticks[2]
		fmt.Printf("Got time in go 3: %v\n", timestamp)
		done <- 1
	}()

	for n := 1; n <= 6; n++ {
		<-done
	}
}
*/

type command int

type Playfield struct {
	Movables map[Movable]chan command
	Ticker *time.Ticker
}

func (p *Playfield) AddMovable(m Movable) chan command {
	if len(p.Movables) == 0 {
		p.StartTicker()
		p.Movables = make(map[Movable]chan command)
	}
	c := make(chan command)
	p.Movables[m] = c

	return c
}

func (p *Playfield) RemoveMovable(m Movable) {
	delete(p.Movables, m)
	if len(p.Movables) == 0 {
		p.StopTicker()
	}
}

func (p *Playfield) StartTicker() {
	p.Ticker = time.NewTicker(100 * time.Millisecond)

	log.Println("Starting timer")
	go func() {
		for {
			<- p.Ticker.C
			for m, _ := range p.Movables {
				log.Printf("Auto move %s", m.Direction())
				// TODO: Move this switch into a method
				switch m.Direction() {
				case "UP":
					m.MoveUp()
				case "DOWN":
					m.MoveDown()
				case "LEFT":
					m.MoveLeft()
				case "RIGHT":
					m.MoveRight()
				}
				m.SendPosition()
			}
		}
	}()
}

func (p *Playfield) StopTicker() {
	p.Ticker.Stop()
}

type Movable interface {
	MoveLeft() bool
	MoveRight() bool
	MoveUp() bool
	MoveDown() bool
	SendPosition()
	Direction() string
}

type Worm struct {
	Position Position
	C chan string
	direction string
}

func (w *Worm) Direction() string {
	if w.direction == "" {
		w.direction = "UP"
		// TODO: Make this a random choice
	}
	return w.direction
}

func (w *Worm) MoveLeft() bool {
	if w.Position.X > 0 {
		w.Position.X--
		w.direction = "LEFT"
		return true
	}
	return false
}

func (w *Worm) MoveUp() bool {
	if w.Position.Y > 0 {
		w.Position.Y--
		w.direction = "UP"
		return true
	}
	return false
}

func (w *Worm) MoveRight() bool {
	if w.Position.X < Boundary {
		w.Position.X++
		w.direction = "RIGHT"
		return true
	}
	return false
}

func (w *Worm) MoveDown() bool {
	if w.Position.Y < Boundary {
		w.Position.Y++
		w.direction = "DOWN"
		return true
	}
	return false
}

func (w *Worm) SendPosition() {
	log.Printf("Sending position to channel %v", w.C)
	w.C <- fmt.Sprintf("%d,%d", w.Position.X, w.Position.Y)
}

func WormsServer(ws *websocket.Conn) {
	log.Println("New Worms connection!")
	defer ws.Close()
	defer log.Println("Worms connection going down!")

	worm := Worm{Position: Position{25, 25}, C: make(chan string)}

	var playfield Playfield

	// TODO: Have a Lobby map of playfields, accessible from multiple servers with a playfield id
	playfield.AddMovable(&worm)
	defer playfield.RemoveMovable(&worm)

	client := make(chan string)
	go func() {
		var message string
		for {
			err := websocket.Message.Receive(ws, &message)
			if err != nil {
				log.Printf("Error reading websocket message: %v", err)
				close(client)
				return
			}
			log.Printf("Got data on worms server (%d): %v", len(message), message)
			client <- message
		}
	}()

	for {
		// Select message to or from client
		// Messages sent are goroutined since it will come back in same select in worm.C
		select {
		case message, ok := <-client:
			if ok == false {
				// Unable to receive more data
				// TODO: worm.suicide()
				return
			}
			go func() {
				switch message {
				case "UP":
					worm.MoveUp()
				case "DOWN":
					worm.MoveDown()
				case "LEFT":
					worm.MoveLeft()
				case "RIGHT":
					worm.MoveRight()
				}
				worm.SendPosition()
			}()
		case message := <-worm.C:
			err := websocket.Message.Send(ws, message)
			if err != nil {
				log.Printf("Error sending position: %v", err)
				// Unable to send more data
				// TODO: worm.suicide()
				return
			}
		}
	}
}

func WormsHandler() websocket.Handler {
	log.Println("New Worms handler!")
	return websocket.Handler(WormsServer)
}

// Echo the data received on the WebSocket.
func EchoServer(ws *websocket.Conn) {
	var message string
	websocket.Message.Receive(ws, &message)
	log.Println("Got data on echo server (", len(message), "): ", message)
	websocket.Message.Send(ws, message)
}

func EchoHandler() websocket.Handler {
	return websocket.Handler(EchoServer)
}