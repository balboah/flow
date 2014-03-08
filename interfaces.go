package flow

type Mover interface {
	Move(Direction)
	Direction() Direction
	Communicator
	Positioner
	Channeler
}

type Communicator interface {
	Communicate(Packet) error
}

type Positioner interface {
	Positions() []Position
}

type Channeler interface {
	Channel() chan<- Packet
}

type Killable interface {
	Kill()
	Killed() bool
}
