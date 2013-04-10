package flow

import (
	"log"
	"math/rand"
)

const BOUNDARY = 49

type attachError struct {
	msg string
}

func (e *attachError) Error() string {
	return e.msg
}

type Worm struct {
	attached  Attachable
	position  Position
	direction string
	C         Transport
}

func NewWorm() *Worm {
	t := Transport{Outbox: make(chan Packet, 5), Inbox: make(chan Packet, 1)}
	return &Worm{position: Position{25, 25}, C: t}
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

func (w *Worm) Next() (Attachable, error) {
	var err error
	if w.attached == nil {
		err = &attachError{"Nothing attached"}
	}
	return w.attached, err
}

func (w *Worm) Attach(a Attachable) error {
	if w.attached != nil {
		return &attachError{"Already attached"}
	}
	w.attached = a

	return nil
}

func (w *Worm) Positions() []Position {
	if w.attached != nil {
		nextPos := w.attached.Positions()
		pos := make([]Position, 1, len(nextPos)+1)
		pos[0] = w.position
		return append(pos, nextPos...)
	}
	return []Position{w.position}
}