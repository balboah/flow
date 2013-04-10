package flow

type Movable interface {
	MoveLeft() bool
	MoveRight() bool
	MoveUp() bool
	MoveDown() bool
	Direction() string
	Channel() Transport
	Communicate()
	Kill()
}

type Attachable interface {
	// Get the attached
	Next() (Attachable, error)
	// Attach another
	Attach(Attachable) error
	// Get next positions as well as our own
	Positions() []Position
}