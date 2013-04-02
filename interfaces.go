package flow

type Movable interface {
	MoveLeft() bool
	MoveRight() bool
	MoveUp() bool
	MoveDown() bool
	Direction() string
	Position() Position
	Channel() Transport
	Communicate()
	Kill()
}
