package flow

import "math/rand/v2"

type FoodType string

const (
	Apple    FoodType = "apple"
	Carrot   FoodType = "carrot"
	Broccoli FoodType = "broccoli"
	// Bomb is a hazard, not a reward — eating one kills the worm.
	Bomb FoodType = "bomb"
)

// FoodCount is how many food items are kept on the field at all times.
const FoodCount = 5

// PointsPerFood maps a food type to its score reward. Bomb is zero because
// the worm dies before it could be scored. Broccoli is the jackpot — bots
// actively chase it (see AIFoodAttraction), so a human has to outmanoeuvre
// the swarm to claim one.
var PointsPerFood = map[FoodType]int{
	Apple:    10,
	Carrot:   5,
	Broccoli: 25,
	Bomb:     0,
}

// AIFoodAttraction biases the AI's nearest-food picker. The value is
// subtracted from the wrap-aware manhattan distance, so a higher number
// makes the bot willing to detour further for that food type. Broccoli is
// the only non-zero entry because it's the high-value prize we want the
// swarm to fight over.
var AIFoodAttraction = map[FoodType]int{
	Broccoli: 6,
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
// bodies). Distribution: 20% bomb, 30% apple, 30% carrot, 20% broccoli — so
// on average 1 of the 5 active foods is a bomb at any given time.
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
		case r < 5:
			t = Apple
		case r < 8:
			t = Carrot
		default:
			t = Broccoli
		}
		return Food{Id: id, Position: pos, Type: t}
	}
}
