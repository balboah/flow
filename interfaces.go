package flow

type Movable interface {
	Move(Direction)
	Direction() Direction
	Channel() chan<- Packet
	Communicate(Packet) error
	Kill()
}

type Attachable interface {
	// Get the attached
	Next() Attachable
	// Attach another
	Attach(Attachable)
	// Get next positions as well as our own
	Positions() []Position
	// Update position of this
	// Sets Next() to our old position
	Follow(Position)
}
