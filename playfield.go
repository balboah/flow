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

// Broadcast messages to registered channels
type Broadcast struct {
	Inbox  chan Packet
	outbox []chan<- Packet
	mu     sync.RWMutex
}

func NewBroadcast() *Broadcast {
	b := &Broadcast{
		Inbox:  make(chan Packet, 1024),
		outbox: make([]chan<- Packet, 0, 2),
	}
	go func() {
		for p := range b.Inbox {
			b.send(p)
		}
	}()
	return b
}

func (b *Broadcast) Add(c chan<- Packet) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.outbox = append(b.outbox, c)
}

func (b *Broadcast) Del(c chan<- Packet) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for i, outboxc := range b.outbox {
		if c == outboxc {
			b.outbox = append(b.outbox[:i], b.outbox[i+1:]...)
		}
	}
}

func (b Broadcast) send(message Packet) {
	b.mu.RLock()
	defer b.mu.Unlock()
	for i, c := range b.outbox {
		select {
		case c <- message:
		default:
			log.Print("Could not send packet to channel number", i)
		}
	}
}

// A playfield is responsible of communicating between clients
type Playfield struct {
	Movers      map[Mover]Id
	Ticker      *time.Ticker
	Join        chan Mover
	Part        chan Mover
	Broadcaster *Broadcast
	LastId      Id
}

func NewPlayfield() *Playfield {
	return &Playfield{
		Movers:      make(map[Mover]Id),
		Ticker:      time.NewTicker(Tick * time.Millisecond),
		Join:        make(chan Mover),
		Part:        make(chan Mover),
		Broadcaster: NewBroadcast(),
		LastId:      0,
	}
}

func (p *Playfield) addMover(m Mover) {
	p.LastId++
	p.Movers[m] = p.LastId
	// Add to broadcaster in case this movable has a channel
	if c, ok := m.(Channeler); ok {
		p.Broadcaster.Add(c.Channel())
	}
	log.Print("New movable id:", p.LastId)
	return
}

func (p *Playfield) removeMover(m Mover) {
	log.Print("Deleting movable", m)
	if c, ok := m.(Channeler); ok {
		p.Broadcaster.Del(c.Channel())
	}
	if k, ok := m.(Killable); ok && !k.Killed() {
		k.Kill()
	}
	delete(p.Movers, m)
}

func (p *Playfield) Start() {
	log.Println("Playfield starting")
	go func() {
		for {
			select {
			case m := <-p.Join:
				p.addMover(m)
			case m := <-p.Part:
				p.removeMover(m)
			case <-p.Ticker.C:
				bulkMove := make([]MovePayload, 0, len(p.Movers))
				bulkKill := make([]string, 0, len(p.Movers))
				for m, id := range p.Movers {
					if k, killable := m.(Killable); killable {
						if k.Killed() {
							p.removeMover(m)
							bulkKill = append(bulkKill, fmt.Sprintf("%d", p.Movers[m]))
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
				p.Broadcaster.Inbox <- Packet{
					Command: "BULK",
					Payload: BulkPayload{
						Move: bulkMove,
						Kill: bulkKill,
					},
				}
			}
		}
	}()
}

func (p *Playfield) Stop() {
	p.Ticker.Stop()
}
