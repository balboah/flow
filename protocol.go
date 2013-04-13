package flow

type Position struct {
	X int
	Y int
}

type Packet struct {
	Command string
	Payload interface{}
}

type MovePayload struct {
	Id        Id
	Positions []Position
}
