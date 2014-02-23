package flow

import (
	"fmt"
	"log"
	"sync"
	"time"
)

// How fast playfields switch packets to clients
const Tick = 200

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
		Movables:  make(map[Movable]Id),
		Ticker:    time.NewTicker(Tick * time.Millisecond),
		Join:      make(chan Movable),
		Part:      make(chan Movable),
		Broadcast: make(chan Packet, 1024),
		LastId:    0,
	}
}

func (p *Playfield) addMovable(m Movable) {
	p.LastId++
	p.Movables[m] = p.LastId
	log.Print("New movable id:", p.LastId)
	return
}

func (p *Playfield) removeMovable(m Movable) {
	log.Print("Deleting movable", m)
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
				if k, killable := m.(Killable); killable {
					k.Kill()
				} else {
					p.removeMovable(m)
				}
			case <-p.Ticker.C:
				bulkMove := make([]MovePayload, 0, len(p.Movables))
				bulkKill := make([]string, 0, len(p.Movables))
				for m, id := range p.Movables {
					if k, killable := m.(Killable); killable {
						if k.Killed() {
							p.removeMovable(m)
							bulkKill = append(bulkKill, fmt.Sprintf("%d", p.Movables[m]))
							continue
						}
					}
					m.Move(m.Direction())
					// TODO: Implement collition detection somewhere here
					bulkMove = append(
						bulkMove,
						MovePayload{Id: id, Positions: m.Positions()},
					)
				}
				p.Broadcast <- Packet{
					Command: "BULK",
					Payload: BulkPayload{
						Move: bulkMove,
						Kill: bulkKill,
					},
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
