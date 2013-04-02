package flow

type Movable interface {
	MoveLeft() bool
	MoveRight() bool
	MoveUp() bool
	MoveDown() bool
	Direction() string
	Position() string
	Channel() Transport
	Communicate()
	Kill()
}
