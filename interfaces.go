package flow

type Movable interface {
	Move(Direction)
	Direction() Direction
	Channel() chan<- Packet
	Communicate(Packet) error
	Positions() []Position
}

type Killable interface {
	Kill()
	Killed() bool
}
