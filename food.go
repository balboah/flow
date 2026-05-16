package flow

import "math/rand/v2"

type FoodType string

const (
	Apple  FoodType = "apple"
	Carrot FoodType = "carrot"
)

// FoodCount is how many food items are kept on the field at all times.
const FoodCount = 5

// PointsPerFood maps a food type to its score reward.
var PointsPerFood = map[FoodType]int{
	Apple:  10,
	Carrot: 5,
}

type Food struct {
	Id       Id
	Position Position
	Type     FoodType
}

func (f Food) Points() int {
	return PointsPerFood[f.Type]
}

// randomFood picks a uniformly random position on the field and a random type.
// avoid lists positions where food may not spawn (e.g. worm bodies).
func randomFood(id Id, avoid map[Position]struct{}) Food {
	for {
		pos := Position{X: rand.IntN(Boundary + 1), Y: rand.IntN(Boundary + 1)}
		if _, taken := avoid[pos]; taken {
			continue
		}
		t := Apple
		if rand.IntN(2) == 0 {
			t = Carrot
		}
		return Food{Id: id, Position: pos, Type: t}
	}
}
