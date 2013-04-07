package flow

type Movable interface {
	MoveLeft() bool
	MoveRight() bool
	MoveUp() bool
	MoveDown() bool
	Direction() string
	Positions() []Position
	Channel() Transport
	Communicate()
	Kill()
}
