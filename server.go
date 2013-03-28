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
	"sync"
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

type Id uint

type Lobby struct {
	Playfields map[string]*Playfield
	mu sync.Mutex
}

var lobby Lobby = Lobby{Playfields: make(map[string]*Playfield)}

type Packet struct {
	Command string
	Payload string
}

func (l Lobby) Playfield(key string) *Playfield {
	l.mu.Lock()
	p, ok := l.Playfields[key]
	if ok == false {
		p = &Playfield{make(map[Movable]Id), time.NewTicker(TICK * time.Millisecond), make(chan Movable), make(chan Movable), 0}
		p.Start()
		l.Playfields[key] = p
		log.Printf("New playfield: %s", key)
	}
	l.mu.Unlock()

	return p
}

type Playfield struct {
	Movables map[Movable]Id
	Ticker *time.Ticker
	NewMovable chan Movable
	KillMovable chan Movable
	LastId Id
}

type Transport struct {
	Outbox chan Packet
	Inbox chan Packet
}

func (p *Playfield) addMovable(m Movable) {
	log.Print("Adding movable", m)
	p.LastId++
	// Buffered channel to make smoother movement by remembering an extra keystroke
	// t = Transport{Outbox: make(chan Packet, 5), Inbox: make(chan Packet, 1), Id: p.LastId}
	// p.Movables[m] = t
	p.Movables[m] = p.LastId

	log.Print("Movable id:", p.LastId)
	return
}

func (p *Playfield) removeMovable(m Movable) {
	log.Print("Deleting movable", m)
	m.Kill()
	delete(p.Movables, m)
	p.broadcast(Packet{"KILL", fmt.Sprintf("%d", p.Movables[m])})
}

func (p *Playfield) Start() {
	log.Println("Playfield starting")
	go func() {
		for {
			select {
			case m := <-p.NewMovable:
				p.addMovable(m)
			case m := <-p.KillMovable:
				p.removeMovable(m)
			case <-p.Ticker.C:
				for m, id := range p.Movables {
					m.Communicate()
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
					p.broadcast(Packet{Command: "MOVE", Payload: fmt.Sprintf("%d,", id) + m.Position()})
				}
			}
		}
	}()
}

func (p *Playfield) broadcast(packet Packet) {
	// TODO: OK check to skip filled queues? Kill worm if it cant keep up?
	for m, _ := range p.Movables {
		m.Send(packet)
	}
}

func (p *Playfield) Stop() {
	p.Ticker.Stop()
}

type Movable interface {
	MoveLeft() bool
	MoveRight() bool
	MoveUp() bool
	MoveDown() bool
	Direction() string
	Position() string
	Communicate()
	Send(Packet)
	Kill()
}

type Worm struct {
	position Position
	direction string
	C Transport
}

func NewWorm() Worm {
	t := Transport{Outbox: make(chan Packet, 5), Inbox: make(chan Packet, 1)}
	return Worm{position: Position{25, 25}, C: t}
}

func (w *Worm) Kill() {
	close(w.C.Outbox)
}

func (w *Worm) Send(packet Packet) {
	w.C.Outbox <- packet
}

func (w *Worm) Position() string {
	return fmt.Sprintf("%d,%d", w.position.X, w.position.Y)
}

func (w *Worm) Communicate() {
	select {
		// Direction changes is the only thing we expect on the inbox right now
		case message := <- w.C.Inbox:
			switch message.Command {
			case "KILL":
				close(w.C.Outbox)
				log.Printf("I got killed :(")
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
	// TODO: Set read/write timeouts

	log.Println("New Worms connection!")
	defer ws.Close()
	defer log.Println("Worms connection going down!")

	worm := NewWorm()

	// TODO: Make this key dynamic once we want several playfields
	playfield := lobby.Playfield("1337")

	playfield.NewMovable <- &worm
	//t := playfield.addMovable(&worm)

	//defer playfield.removeMovable(&worm)

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

	<- quit
	playfield.KillMovable <- &worm
}

func WormsHandler() websocket.Handler {
	log.Println("New Worms handler!")
	return websocket.Handler(WormsServer)
}