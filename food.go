package flow

import "math/rand/v2"

type FoodType string

const (
	Apple  FoodType = "apple"
	Carrot FoodType = "carrot"
	// Bomb is a hazard, not a reward — eating one kills the worm.
	Bomb FoodType = "bomb"
)

// FoodCount is how many food items are kept on the field at all times.
const FoodCount = 5

// PointsPerFood maps a food type to its score reward. Bomb is zero because
// the worm dies before it could be scored.
var PointsPerFood = map[FoodType]int{
	Apple:  10,
	Carrot: 5,
	Bomb:   0,
}

type Food struct {
	Id       Id
	Position Position
	Type     FoodType
}

func (f Food) Points() int {
	return PointsPerFood[f.Type]
}

// randomFood picks a uniformly random position on the field and a weighted
// random type. avoid lists positions where food may not spawn (e.g. worm
// bodies). Distribution: 20% bomb, 40% apple, 40% carrot — so on average
// 1 of the 5 active foods is a bomb at any given time.
func randomFood(id Id, avoid map[Position]struct{}) Food {
	for {
		pos := Position{X: rand.IntN(Boundary + 1), Y: rand.IntN(Boundary + 1)}
		if _, taken := avoid[pos]; taken {
			continue
		}
		var t FoodType
		switch r := rand.IntN(10); {
		case r < 2:
			t = Bomb
		case r < 6:
			t = Apple
		default:
			t = Carrot
		}
		return Food{Id: id, Position: pos, Type: t}
	}
}
