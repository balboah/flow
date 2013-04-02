package flow

import (
	"fmt"
	"log"
	"sync"
	"time"
)

const TICK = 200

type Id uint

type Lobby struct {
	Playfields map[string]*Playfield
	mu         sync.Mutex
}

var lobby Lobby = Lobby{Playfields: make(map[string]*Playfield)}

func (l Lobby) Playfield(key string) *Playfield {
	l.mu.Lock()
	p, ok := l.Playfields[key]
	if ok == false {
		p = &Playfield{
			make(map[Movable]Id),
			time.NewTicker(TICK * time.Millisecond),
			make(chan Movable),
			make(chan Movable),
			make(chan Packet, 1024),
			0}
		p.Start()
		l.Playfields[key] = p
		log.Printf("New playfield: %s", key)
	}
	l.mu.Unlock()

	return p
}

type Playfield struct {
	Movables  map[Movable]Id
	Ticker    *time.Ticker
	Join      chan Movable
	Part      chan Movable
	Broadcast chan Packet
	LastId    Id
}

type Transport struct {
	Outbox chan Packet
	Inbox  chan Packet
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
	delete(p.Movables, m)

	p.Broadcast <- Packet{"KILL", fmt.Sprintf("%d", p.Movables[m])}
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
					payload := MovePayload{Id: id, Positions: []Position{m.Position()}}
					p.Broadcast <- Packet{Command: "MOVE", Payload: payload}
				}
			case packet := <-p.Broadcast:
				for m, id := range p.Movables {
					c := m.Channel()
					select {
					case c.Outbox <- packet:
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
