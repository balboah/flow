package flow

import (
	"errors"
	"fmt"
)

const (
	Boundary = 49 // The outer boundary of a playfield
	WormSize = 10 // Starting length of the worm
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

// The player controlled worm
type Worm struct {
	// The positions of the points that makes up the worm
	blocks []Position

	// Which direction are we going at
	direction Direction

	// Packets to be sent to the client controlling the worm
	Outbox chan Packet
}

func NewWorm() *Worm {
	blocks := make([]Position, WormSize)
	for n := 0; n < cap(blocks); n++ {
		blocks[n] = Position{25, 25}
	}
	return &Worm{
		blocks:    blocks,
		direction: Unknown,
		Outbox:    make(chan Packet, 5),
	}
}

func (w *Worm) Positions() []Position {
	return w.blocks
}

func (w *Worm) Kill() {
	close(w.Outbox)
}

func (w *Worm) Position() Position {
	return w.blocks[0]
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
	// Then update our new position
	w.direction = d
	pos := w.blocks[0]
	switch d {
	case Left:
		if pos.X > 0 {
			pos.X--
		}
	case Up:
		if pos.Y > 0 {
			pos.Y--
		}
	case Right:
		if pos.X < Boundary {
			pos.X++
		}
	case Down:
		if pos.Y < Boundary {
			pos.Y++
		}
	}
	// Push all blocks to follow the preceding, moving the tail of the worm
	w.blocks = append([]Position{pos}, w.blocks[0:len(w.blocks)-1]...)
}
