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

var lobby = &Lobby{Playfields: make(map[string]*Playfield)}

func (l *Lobby) Playfield(key string) *Playfield {
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

// RenameRequest is queued by the server layer when a client sets/changes its
// player name. The playfield goroutine applies it so all worm-state writes are
// single-threaded.
type RenameRequest struct {
	Worm *Worm
	Name string
}

// A playfield is responsible of communicating between clients
type Playfield struct {
	Movables   map[Movable]Id
	Ticker     *time.Ticker
	Join       chan Movable
	Part       chan Movable
	Broadcast  chan Packet
	Rename     chan RenameRequest
	LastId     Id
	Foods      map[Id]*Food
	LastFoodId Id
}

func NewPlayfield() *Playfield {
	return &Playfield{
		Movables:  make(map[Movable]Id),
		Ticker:    time.NewTicker(Tick * time.Millisecond),
		Join:      make(chan Movable),
		Part:      make(chan Movable),
		Broadcast: make(chan Packet, 1024),
		Rename:    make(chan RenameRequest, 16),
		LastId:    0,
		Foods:     make(map[Id]*Food),
	}
}

// occupied returns positions currently blocked (worm bodies + existing food).
func (p *Playfield) occupied() map[Position]struct{} {
	out := make(map[Position]struct{})
	for m := range p.Movables {
		for _, pos := range m.Positions() {
			out[pos] = struct{}{}
		}
	}
	for _, f := range p.Foods {
		out[f.Position] = struct{}{}
	}
	return out
}

// spawnFood adds a new food item to the field. Returns the spawned food
// so callers can broadcast it (or send privately on initial state delivery).
func (p *Playfield) spawnFood() Food {
	p.LastFoodId++
	f := randomFood(p.LastFoodId, p.occupied())
	p.Foods[f.Id] = &f
	return f
}

func foodPacket(f Food) Packet {
	return Packet{
		Command: "FOOD",
		Payload: FoodPayload{
			Id:     f.Id,
			X:      f.Position.X,
			Y:      f.Position.Y,
			Type:   f.Type,
			Points: f.Points(),
		},
	}
}

func scorePacket(id Id, w *Worm) Packet {
	return Packet{
		Command: "SCORE",
		Payload: ScorePayload{WormId: id, Name: w.Name, Score: w.Score},
	}
}

// addMovable registers a movable in the map and assigns it an id.
// The Join channel handler also calls announceJoin afterwards to send
// the welcome packet and broadcast initial state.
func (p *Playfield) addMovable(m Movable) Id {
	p.LastId++
	id := p.LastId
	p.Movables[m] = id
	log.Print("New movable id:", id)
	return id
}

// announceJoin sends a welcome packet to the new movable and broadcasts
// the field's current state. Called after addMovable from the Join handler.
func (p *Playfield) announceJoin(m Movable, id Id) {
	w, ok := m.(*Worm)
	if !ok {
		return
	}
	if w.Name == "" {
		w.Name = fmt.Sprintf("Worm-%d", id)
	}
	// Tell the new client who it is.
	w.Outbox <- Packet{Command: "WELCOME", Payload: WelcomePayload{Id: id, Name: w.Name}}
	// Seed the field with food on first join so a single player has something to chase.
	for len(p.Foods) < FoodCount {
		f := p.spawnFood()
		p.Broadcast <- foodPacket(f)
	}
	// Catch the new client up on current state.
	for _, f := range p.Foods {
		w.Outbox <- foodPacket(*f)
	}
	for other, otherId := range p.Movables {
		if ow, ok := other.(*Worm); ok {
			w.Outbox <- scorePacket(otherId, ow)
		}
	}
	// Announce the new player to everyone (including itself).
	p.Broadcast <- scorePacket(id, w)
}

func (p *Playfield) removeMovable(m Movable) {
	log.Print("Deleting movable", m)
	m.Kill()
	p.Broadcast <- Packet{Command: "KILL", Payload: fmt.Sprintf("%d", p.Movables[m])}
	delete(p.Movables, m)
}

// resolveCollisions checks each worm's head against every food.
// On a match: credit score, remove the food, broadcast EAT/SCORE/FOOD.
func (p *Playfield) resolveCollisions() {
	for m, id := range p.Movables {
		w, ok := m.(*Worm)
		if !ok {
			continue
		}
		head := w.Head()
		for fid, f := range p.Foods {
			if head != f.Position {
				continue
			}
			w.AddScore(f.Points())
			delete(p.Foods, fid)
			p.Broadcast <- Packet{Command: "EAT", Payload: EatPayload{FoodId: fid, WormId: id}}
			p.Broadcast <- scorePacket(id, w)
			nf := p.spawnFood()
			p.Broadcast <- foodPacket(nf)
			break
		}
	}
}

func (p *Playfield) Start() {
	log.Println("Playfield starting")
	go func() {
		for {
			select {
			case m := <-p.Join:
				id := p.addMovable(m)
				p.announceJoin(m, id)
			case m := <-p.Part:
				p.removeMovable(m)
			case req := <-p.Rename:
				req.Worm.Name = req.Name
				if id, ok := p.Movables[req.Worm]; ok {
					p.Broadcast <- scorePacket(id, req.Worm)
				}
			case <-p.Ticker.C:
				for m, id := range p.Movables {
					m.Move(m.Direction())
					p.Broadcast <- Packet{
						Command: "MOVE",
						Payload: MovePayload{Id: id, Positions: m.Positions()},
					}
				}
				p.resolveCollisions()
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
