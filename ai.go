package flow

import (
	"fmt"
	"math/rand/v2"
)

// AIPersonality is the per-bot tuning that drives pickAIDirection.
// Each AI is constructed from a random seed at spawn time so two bots on the
// field have different priors and don't move in lockstep.
type AIPersonality struct {
	Seed uint64
	Name string
	// FoodPull weights how strongly the bot pursues the nearest food (per
	// cell closer to it).
	FoodPull float64
	// Inertia is the bonus for continuing in the worm's current heading.
	// High values produce a "committed" bot that doesn't twitch.
	Inertia float64
	// CenterPull biases toward the middle of the field, away from walls.
	CenterPull float64
	// HesitationRate is the chance per tick of picking the second-best
	// move instead of the best — the "whoops, mistimed" effect.
	HesitationRate float64
	// MistakeRate is the per-tick probability that the bot temporarily
	// doesn't see opponent bodies as hazards. The chosen direction can
	// then walk into a snake and die — the bot looks human, not infallible.
	// Self-collision and 180° reversals stay filtered out (those would
	// be unforced errors no human would make).
	MistakeRate float64
}

// newPersonality draws a fresh persona from a random seed. The seed becomes
// the bot's identity (name) so the same seed always produces the same player.
func newPersonality() AIPersonality {
	seed := rand.Uint64()
	r := rand.New(rand.NewPCG(seed, seed^0x9E3779B97F4A7C15))
	return AIPersonality{
		Seed:           seed,
		Name:           fmt.Sprintf("Bot-%04X", uint16(seed)),
		FoodPull:       0.8 + r.Float64()*2.0,   // 0.8 – 2.8
		Inertia:        0.5 + r.Float64()*2.5,   // 0.5 – 3.0
		CenterPull:     r.Float64() * 0.5,       // 0.0 – 0.5
		HesitationRate: 0.03 + r.Float64()*0.07, // 3% – 10%
		MistakeRate:    0.02 + r.Float64()*0.05, // 2% – 7%
	}
}

// pickAIDirection scores each safe direction by the bot's personality and
// picks the best — with a small chance of choosing the runner-up so two
// bots in similar spots don't always make identical decisions.
func pickAIDirection(w *Worm, p *Playfield) Direction {
	personality := w.personality
	if personality.Name == "" {
		personality = newPersonality()
	}

	candidates := safeDirections(w, p)
	// Occasionally the bot "doesn't see" an opponent body and may pick a
	// direction that walks into one — that's the human-like mistake we
	// want. Own-body and 180° reversals are still filtered, so the bot
	// never makes an unforced error.
	if rand.Float64() < personality.MistakeRate {
		risky := bodyOblivousDirections(w)
		if len(risky) > 0 {
			candidates = risky
		}
	}
	if len(candidates) == 0 {
		return w.direction
	}

	target, hasTarget := nearestFood(w.Head(), p)
	curFoodDist := 0
	if hasTarget {
		curFoodDist = manhattan(w.Head(), target)
	}

	type scored struct {
		dir   Direction
		score float64
	}
	scores := make([]scored, 0, len(candidates))
	for _, d := range candidates {
		next := wrap(step(w.Head(), d))
		s := 0.0
		if hasTarget {
			// Reward directions that close the gap. Diminishing return on
			// distance avoids the bot wildly cornering for far-away food.
			s += personality.FoodPull * float64(curFoodDist-manhattan(next, target))
		}
		if d == w.direction && w.direction != Unknown {
			s += personality.Inertia
		}
		s -= personality.CenterPull * float64(manhattan(next, Position{Boundary / 2, Boundary / 2}))
		scores = append(scores, scored{d, s})
	}

	// Sort indices by score descending.
	order := make([]int, len(scores))
	for i := range order {
		order[i] = i
	}
	for i := 1; i < len(order); i++ {
		for j := i; j > 0 && scores[order[j]].score > scores[order[j-1]].score; j-- {
			order[j], order[j-1] = order[j-1], order[j]
		}
	}

	// Hesitation: occasionally pick the runner-up instead of the best.
	pick := 0
	if len(order) > 1 && rand.Float64() < personality.HesitationRate {
		pick = 1
	}
	return scores[order[pick]].dir
}

// bodyOblivousDirections returns directions that filter out only the
// "unforced error" cases: own body and 180° reversal. Opponent bodies and
// heads are NOT filtered — used when the bot is having a brain-fart so it
// can plausibly walk into another snake.
func bodyOblivousDirections(w *Worm) []Direction {
	head := w.Head()
	blocked := map[Position]struct{}{}
	for i, b := range w.blocks {
		if w.pendingGrowth == 0 && i == len(w.blocks)-1 {
			continue
		}
		blocked[b] = struct{}{}
	}
	out := make([]Direction, 0, 4)
	for _, d := range []Direction{Up, Down, Left, Right} {
		if opposite(d) == w.direction && w.direction != Unknown {
			continue
		}
		next := wrap(step(head, d))
		if _, hit := blocked[next]; hit {
			continue
		}
		out = append(out, d)
	}
	return out
}

// safeDirections returns directions whose next cell would not kill us. Own
// body, every opponent's body, every opponent's head and their predicted
// next-head cell are all blocked — under slither.io rules, your head
// touching anyone's body is *your* death, so the AI must steer clear of
// all snake cells, not just its own. 180° reversals are excluded. The
// field wraps so edges aren't unsafe.
func safeDirections(w *Worm, p *Playfield) []Direction {
	head := w.Head()
	blocked := map[Position]struct{}{}
	for i, b := range w.blocks {
		if w.pendingGrowth == 0 && i == len(w.blocks)-1 {
			continue
		}
		blocked[b] = struct{}{}
	}
	for m := range p.Movables {
		ow, ok := m.(*Worm)
		if !ok || ow == w || ow.killed {
			continue
		}
		// Opponent's entire body (incl. head) — touching any of it with
		// our head is fatal under the new rules.
		for i, b := range ow.blocks {
			if ow.pendingGrowth == 0 && i == len(ow.blocks)-1 {
				continue // tail vacates this tick
			}
			blocked[b] = struct{}{}
		}
		// Predicted next-head cell — head-on with another head still
		// kills both, so dodge if we can.
		if ow.direction != Unknown {
			blocked[wrap(step(ow.Head(), ow.direction))] = struct{}{}
		}
	}
	out := make([]Direction, 0, 4)
	for _, d := range []Direction{Up, Down, Left, Right} {
		if opposite(d) == w.direction && w.direction != Unknown {
			continue
		}
		next := wrap(step(head, d))
		if _, hit := blocked[next]; hit {
			continue
		}
		out = append(out, d)
	}
	return out
}

// wrap normalises a cell position onto the toroidal playfield.
func wrap(p Position) Position {
	if p.X < 0 {
		p.X = Boundary
	} else if p.X > Boundary {
		p.X = 0
	}
	if p.Y < 0 {
		p.Y = Boundary
	} else if p.Y > Boundary {
		p.Y = 0
	}
	return p
}

func opposite(d Direction) Direction {
	switch d {
	case Up:
		return Down
	case Down:
		return Up
	case Left:
		return Right
	case Right:
		return Left
	}
	return Unknown
}

func step(p Position, d Direction) Position {
	switch d {
	case Up:
		return Position{p.X, p.Y - 1}
	case Down:
		return Position{p.X, p.Y + 1}
	case Left:
		return Position{p.X - 1, p.Y}
	case Right:
		return Position{p.X + 1, p.Y}
	}
	return p
}

func nearestFood(from Position, p *Playfield) (Position, bool) {
	var best Position
	bestDist := -1
	for _, f := range p.Foods {
		if f.Type == Bomb {
			// Bots don't deliberately chase bombs (those are hazards, not
			// rewards). They can still wander onto one — the safeDirections
			// check doesn't filter bombs because the bomb cell behaves like
			// any other unoccupied cell from a pathing standpoint.
			continue
		}
		d := manhattan(from, f.Position)
		if bestDist < 0 || d < bestDist {
			bestDist = d
			best = f.Position
		}
	}
	return best, bestDist >= 0
}

// manhattan is wrap-aware: the field is a torus so distance along each axis
// is the shorter of going direct or wrapping around the edge.
func manhattan(a, b Position) int {
	dx := abs(a.X - b.X)
	if w := (Boundary + 1) - dx; w < dx {
		dx = w
	}
	dy := abs(a.Y - b.Y)
	if w := (Boundary + 1) - dy; w < dy {
		dy = w
	}
	return dx + dy
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
