package flow

import (
	"fmt"
	"log"
	"sync"
	"time"
)

// How fast playfields switch packets to clients
const TICK = 200

type Id uint

// The lobby takes care of listing all playfields
type Lobby struct {
	Playfields map[string]*Playfield
	mu         sync.Mutex
}

var lobby Lobby = Lobby{Playfields: make(map[string]*Playfield)}

func (l Lobby) Playfield(key string) *Playfield {
	l.mu.Lock()
	p, ok := l.Playfields[key]
	if !ok {
		p = NewPlayfield()
		p.Start()
		l.Playfields[key] = p
		log.Printf("New playfield: %s", key)
	}
	l.mu.Unlock()
	return p
}

// A playfield is responsible of communicating between clients
type Playfield struct {
	Movables  map[Movable]Id
	Ticker    *time.Ticker
	Join      chan Movable
	Part      chan Movable
	Broadcast chan Packet
	LastId    Id
}

func NewPlayfield() *Playfield {
	return &Playfield{
		make(map[Movable]Id),
		time.NewTicker(TICK * time.Millisecond),
		make(chan Movable),
		make(chan Movable),
		make(chan Packet, 1024),
		0}
}

func (p *Playfield) addMovable(m Movable) {
	p.LastId++
	p.Movables[m] = p.LastId
	log.Print("New movable id:", p.LastId)
	return
}

func (p *Playfield) removeMovable(m Movable) {
	log.Print("Deleting movable", m)
	m.Kill()

	p.Broadcast <- Packet{"KILL", fmt.Sprintf("%d", p.Movables[m])}
	delete(p.Movables, m)
}

func (p *Playfield) Start() {
	log.Println("Playfield starting")
	go func() {
		for {
			select {
			case m := <-p.Join:
				p.addMovable(m)
			case m := <-p.Part:
				p.removeMovable(m)
			case <-p.Ticker.C:
				for m, id := range p.Movables {
					switch m.Direction() {
					case UP:
						m.MoveUp()
					case DOWN:
						m.MoveDown()
					case LEFT:
						m.MoveLeft()
					case RIGHT:
						m.MoveRight()
					}
					// TODO: Implement collition detection somewhere here
					// TODO: Let the Worm websocket loop handle the actual sending to client
					p.Broadcast <- Packet{
						Command: "MOVE",
						Payload: MovePayload{Id: id, Positions: m.(Attachable).Positions()}}
				}
			case packet := <-p.Broadcast:
				for m, id := range p.Movables {
					c := m.Channel()
					select {
					case c <- packet:
					default:
						log.Print("Could not send packet to movable:", id)
					}
				}
			}
		}
	}()
}

func (p *Playfield) Stop() {
	p.Ticker.Stop()
}
