/*
A websocket gaming platform.

TODO:
	Snake
	- Implement random spawning points/food that snakes can eat
	- Have two players for each Playfield, if one eats the other the game is over. Highest points win
	- Add a tail to the pixel to complete the worm, which grows whenever you eat a new point
	- Create availability slots in Lobby for knowing if another player can join
*/

package flow

import (
	"fmt"
	"log"
	"time"
	"math/rand"
	"code.google.com/p/go.net/websocket"
)
const (
	BOUNDARY = 49
	TICK = 200
)

type Position struct {
	X int
	Y int
}

type Lobby map[string]*Playfield

var lobby = make(Lobby)

type Packet struct {
	Command string
	Payload string
}

func (l Lobby) Playfield(key string) *Playfield {
	p, ok := l[key]
	if ok == false {
		p = new(Playfield)
		l[key] = p
		log.Printf("New playfield: %s", key)
	}
	return p
}

type Playfield struct {
	Movables map[Movable]Transport
	Ticker *time.Ticker
	LastId uint
}

type Transport struct {
	Outbox chan Packet
	Inbox chan Packet
	Id uint
}

func (p *Playfield) AddMovable(m Movable) (t Transport) {
	log.Print("Adding movable", m)
	if len(p.Movables) == 0 {
		p.StartTicker()
		p.Movables = make(map[Movable]Transport)
		p.LastId = 0
	}
	p.LastId++
	// Buffered channel to make smoother movement by remembering an extra keystroke
	t = Transport{Outbox: make(chan Packet, 5), Inbox: make(chan Packet, 1), Id: p.LastId}
	p.Movables[m] = t

	log.Print("Movable id:", t.Id)
	return
}

func (p *Playfield) RemoveMovable(m Movable) {
	log.Print("Deleting movable", m)
	p.Broadcast(Packet{"KILL", fmt.Sprintf("%d", p.Movables[m].Id)})
	delete(p.Movables, m)
	if len(p.Movables) == 0 {
		p.StopTicker()
	}
}

func (p *Playfield) StartTicker() {
	p.Ticker = time.NewTicker(TICK * time.Millisecond)

	log.Println("Starting timer")
	go func() {
		for {
			<- p.Ticker.C
			for m, t := range p.Movables {
				m.Communicate(t)
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
				// TODO: Make the payload a struct as well
				p.Broadcast(Packet{Command: "MOVE", Payload: fmt.Sprintf("%d,", t.Id) + m.Position()})
			}
		}
	}()
}

func (p *Playfield) Broadcast(packet Packet) {
	// TODO: OK check to skip filled queues? Kill worm if it cant keep up?
	for _, t := range p.Movables {
		t.Outbox <- packet
	}
}

func (p *Playfield) StopTicker() {
	p.Ticker.Stop()
}

type Movable interface {
	MoveLeft() bool
	MoveRight() bool
	MoveUp() bool
	MoveDown() bool
	Direction() string
	Position() string
	Communicate(Transport)
}

type Worm struct {
	position Position
	direction string
}

func (w *Worm) Position() string {
	return fmt.Sprintf("%d,%d", w.position.X, w.position.Y)
}

func (w *Worm) Communicate(t Transport) {
	select {
		// Direction changes is the only thing we expect on the inbox right now
		case message := <- t.Inbox:
			switch message.Command {
			case "MOVE":
				switch message.Payload {
				case "UP", "DOWN", "LEFT", "RIGHT":
					w.direction = message.Payload
				}
			case "HELLO":
			default:
				log.Print("Unknown command:", message)
			}
		default:
	}
}

func (w *Worm) Direction() string {
	if w.direction == "" {
		switch rand.Intn(4) {
		case 0:
			w.direction = "RIGHT"
		case 1:
			w.direction = "LEFT"
		case 2:
			w.direction = "DOWN"
		case 3:
			w.direction = "UP"
		}
	}
	return w.direction
}

func (w *Worm) MoveLeft() bool {
	if w.position.X > 0 {
		w.position.X--
		w.direction = "LEFT"
		return true
	}
	return false
}

func (w *Worm) MoveUp() bool {
	if w.position.Y > 0 {
		w.position.Y--
		w.direction = "UP"
		return true
	}
	return false
}

func (w *Worm) MoveRight() bool {
	if w.position.X < BOUNDARY {
		w.position.X++
		w.direction = "RIGHT"
		return true
	}
	return false
}

func (w *Worm) MoveDown() bool {
	if w.position.Y < BOUNDARY {
		w.position.Y++
		w.direction = "DOWN"
		return true
	}
	return false
}

// This is where the action starts
func WormsServer(ws *websocket.Conn) {
	log.Println("New Worms connection!")
	defer ws.Close()
	defer log.Println("Worms connection going down!")

	worm := Worm{position: Position{25, 25}}

	// TODO: Make this key dynamic once we want several playfields
	playfield := lobby.Playfield("1337")

	t := playfield.AddMovable(&worm)
	defer playfield.RemoveMovable(&worm)

	quit := make(chan bool)

	// Receive from client
	go func() {
		var message Packet
		for {
			err := websocket.JSON.Receive(ws, &message)
			if err != nil {
				log.Printf("Error reading websocket message: %v", err)
				quit <- true
				return
			}
			log.Print("Got data on worms server", message)
			t.Inbox <- message
		}
	}()

	// Transmit to client
	go func() {
		for {
			select {
			case message := <- t.Outbox:
				err := websocket.JSON.Send(ws, message)
				if err != nil {
					log.Printf("Error sending position: %v", err)
					quit <- true
				}
			case <-quit:
				return
			}
		}
	}()

	<- quit
}

func WormsHandler() websocket.Handler {
	log.Println("New Worms handler!")
	return websocket.Handler(WormsServer)
}