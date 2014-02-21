package flow

import (
	"errors"
	"fmt"
)

const (
	Boundary = 49 // The outer boundary of a playfield
	Tail     = 10 // Starting length of the worm tail
)

type Length uint

type Direction uint

const (
	Unknown Direction = iota
	Up
	Down
	Left
	Right
)

func (d Direction) String() string {
	switch d {
	case Up:
		return "UP"
	case Down:
		return "DOWN"
	case Left:
		return "LEFT"
	case Right:
		return "RIGHT"
	}
	return ""
}

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
	direction Direction
	Outbox    chan Packet
}

func NewWorm() *Worm {
	w := &Worm{
		Block:  Block{position: Position{25, 25}},
		Outbox: make(chan Packet, 5),
	}
	w.AddTail(Tail)

	return w
}

func (w *Worm) Kill() {
	close(w.Outbox)
}

func (w *Worm) Position() Position {
	return w.position
}

func (w *Worm) Channel() chan<- Packet {
	return w.Outbox
}

// Process incoming packets
func (w *Worm) Communicate(message Packet) error {
	// Direction changes is the only thing we expect right now
	switch message.Command {
	case "MOVE":
		payload, ok := message.Payload.(string)
		if !ok {
			return errors.New("Got invalid payload for MOVE command")
		}
		switch payload {
		case "UP":
			if w.direction != Down {
				w.direction = Up
			}
		case "DOWN":
			if w.direction != Up {
				w.direction = Down
			}
		case "LEFT":
			if w.direction != Right {
				w.direction = Left
			}
		case "RIGHT":
			if w.direction != Left {
				w.direction = Right
			}
		}
	case "HELLO":
	default:
		return errors.New(fmt.Sprintf("Unknown command: %s", message.Command))
	}
	return nil
}

// Get the direction we are currently going in or set one if empty
func (w *Worm) Direction() Direction {
	if w.direction == Unknown {
		choice := make(chan Direction, 1)
		select {
		case choice <- Right:
		case choice <- Left:
		case choice <- Down:
		case choice <- Up:
		}
		w.direction = <-choice
	}
	return w.direction
}

func (w *Worm) Move(d Direction) {
	// Make our tail tag along
	if tail := w.Next(); tail != nil {
		tail.Follow(w.position)
	}

	// Then update our new position
	w.direction = d
	switch d {
	case Left:
		if w.position.X > 0 {
			w.position.X--
		}
	case Up:
		if w.position.Y > 0 {
			w.position.Y--
		}
	case Right:
		if w.position.X < Boundary {
			w.position.X++
		}
	case Down:
		if w.position.Y < Boundary {
			w.position.Y++
		}
	}
}

// Create a chain of Blocks to form the tail of the worm
func (w *Worm) AddTail(l Length) (total Length) {
	for n := 0; n < int(l); n++ {
		w.Attach(&Block{position: w.position})
	}

	return Length(len(w.Next().Positions()))
}
