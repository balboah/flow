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
		p = NewPlayfield(nil)
		l.Playfields[key] = p
		log.Printf("New playfield: %s", key)
	}
	l.mu.Unlock()
	return p
}

// Ticker keeps track of time
type Ticker interface {
	// The channel on which ticks are delivered
	TickC() <-chan time.Time
	// Tick delivers a tick
	Tick()
	// Stop ticking
	Stop()
}

// DefaultTicker waps a time.Ticker to implement the Ticker interface
type DefaultTicker struct {
	t *time.Ticker
	c chan time.Time
}

func NewDefaltTicker(t *time.Ticker) *DefaultTicker {
	d := DefaultTicker{t, make(chan time.Time)}
	if t != nil {
		go func() {
			for tick := range t.C {
				d.c <- tick
			}
		}()
	}

	return &d
}

func (d DefaultTicker) TickC() <-chan time.Time {
	return d.c
}

func (d DefaultTicker) Tick() {
	d.c <- time.Now()
}

func (d DefaultTicker) Stop() {
	if d.t != nil {
		d.t.Stop()
	}
	close(d.c)
}

// A playfield is responsible of communicating between clients
type Playfield struct {
	Movers map[Mover]Id
	LastId Id
	// Ticker triggers playfield updates
	ticker Ticker
	// Populates list of movers
	Join chan Mover
	// Removes frmo list of movers
	Part chan Mover
	// Returns value through run() goroutine, can be used for synchronizing
	// or to make sure the playfield is still running.
	Running chan bool
	// Used to broadcast to all movables
	Broadcaster *Broadcast
}

func NewPlayfield(speed Ticker) *Playfield {
	if speed == nil {
		speed = NewDefaltTicker(time.NewTicker(Tick * time.Millisecond))
	}
	p := &Playfield{
		Movers:      make(map[Mover]Id),
		ticker:      speed,
		Join:        make(chan Mover),
		Part:        make(chan Mover),
		Running:     make(chan bool),
		Broadcaster: NewBroadcast(),
		LastId:      0,
	}
	go p.run()
	return p
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
	delete(p.Movers, m)
}

func (p *Playfield) run() {
	log.Println("Playfield starting", &p)
	for {
		select {
		case p.Running <- true:
		case m := <-p.Join:
			p.addMover(m)
		case m := <-p.Part:
			// Killables has to be broadcasted on next iteration
			if k, ok := m.(Killable); ok && !k.Killed() {
				k.Kill()
			} else {
				p.removeMover(m)
			}
		case <-p.ticker.TickC():
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
}

func (p *Playfield) Stop() {
	p.ticker.Stop()
}
