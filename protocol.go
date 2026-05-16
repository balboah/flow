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

type HelloPayload struct {
	Name  string
	Token string
}

type WelcomePayload struct {
	Id          Id
	Name        string
	Token       string
	Dead        bool   // worm is currently in a GAMEOVER state
	DeathReason string // populated when Dead is true
	Score       int    // current score, included so the dialog can show it
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

type GameOverPayload struct {
	WormId Id
	Reason string
}
