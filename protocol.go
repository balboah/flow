package flow

import (
	"fmt"
)

type Position struct {
	X int
	Y int
}

func (p Position) String() string {
	return fmt.Sprintf("X: %d Y: %d", p.X, p.Y)
}

type Packet struct {
	Command string
	Payload interface{}
}

type MovePayload struct {
	Id        Id
	Positions []Position
}

type WelcomePayload struct {
	Id   Id
	Name string
}

type FoodPayload struct {
	Id     Id
	X      int
	Y      int
	Type   FoodType
	Points int
}

type EatPayload struct {
	FoodId Id
	WormId Id
}

type ScorePayload struct {
	WormId Id
	Name   string
	Score  int
}
