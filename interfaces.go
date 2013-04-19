package flow

type Movable interface {
	MoveLeft() bool
	MoveRight() bool
	MoveUp() bool
	MoveDown() bool
	Direction() Direction
	Channel() Transport
	Communicate()
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
