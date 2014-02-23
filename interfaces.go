package flow

type Movable interface {
	Move(Direction)
	Direction() Direction
	Channel() chan<- Packet
	Communicate(Packet) error
	Kill()
	Positions() []Position
}
