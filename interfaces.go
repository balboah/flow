package flow

type Movable interface {
	Move(Direction)
	Direction() Direction
	Channel() chan<- Packet
	Kill()
	Positions() []Position
}
