package flow

import (
	"log"
	"math/rand"
)

const (
	BOUNDARY = 49 // The outer boundary of a playfield
	TAIL     = 10 // Starting length of the worm tail
)

type Length uint

// A "pixel" block on the playfield
// Attackable to other blocks forming a chain
type Block struct {
	attached Attachable
	position Position
}

// Get next block in chain
func (b *Block) Next() Attachable {
	return b.attached
}

// Attach next block
func (b *Block) Attach(a Attachable) {
	if b.attached != nil {
		b.attached.Attach(a)
	} else {
		b.attached = a
	}
}

// Get positions of all blocks in the chain
func (b *Block) Positions() []Position {
	if b.attached != nil {
		nextPos := b.attached.Positions()
		pos := make([]Position, 1, len(nextPos)+1)
		pos[0] = b.position
		return append(pos, nextPos...)
	}
	return []Position{b.position}
}

// Update the position of this and subsequent blocks
func (b *Block) Follow(p Position) {
	next := b.Next()
	if next != nil {
		next.Follow(b.position)
	}
	b.position = p
}

// The player controlled worm
type Worm struct {
	Block
	direction string
	C         Transport
}

func NewWorm() *Worm {
	t := Transport{Outbox: make(chan Packet, 5), Inbox: make(chan Packet, 1)}
	w := &Worm{Block: Block{position: Position{25, 25}}, C: t}
	w.AddTail(TAIL)

	return w
}

func (w *Worm) Kill() {
	close(w.C.Outbox)
}

func (w *Worm) Position() Position {
	return w.position
}

func (w *Worm) Channel() Transport {
	return w.C
}

// Process incoming packets
func (w *Worm) Communicate() {
	select {
	// Direction changes is the only thing we expect on the inbox right now
	case message := <-w.C.Inbox:
		switch message.Command {
		case "MOVE":
			payload, ok := message.Payload.(string)
			if !ok {
				log.Print("Got invalid payload for MOVE command")
				break
			}
			switch payload {
			case "UP":
				if w.direction != "DOWN" {
					w.direction = payload
				}
			case "DOWN":
				if w.direction != "UP" {
					w.direction = payload
				}
			case "LEFT":
				if w.direction != "RIGHT" {
					w.direction = payload
				}
			case "RIGHT":
				if w.direction != "LEFT" {
					w.direction = payload
				}
			}
		case "HELLO":
		default:
			log.Print("Unknown command:", message.Command)
		}
	default:
	}

	if tail := w.Next(); tail != nil {
		tail.Follow(w.position)
	}
}

// Get the direction we are currently going in or set one if empty
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

// Create a chain of Blocks to form the tail of the worm
func (w *Worm) AddTail(l Length) (total Length) {
	for n := 0; n < int(l); n++ {
		w.Attach(&Block{position: w.position})
	}

	return Length(len(w.Next().Positions()))
}
