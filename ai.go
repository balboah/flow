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
	}
}

// pickAIDirection scores each safe direction by the bot's personality and
// picks the best — with a small chance of choosing the runner-up so two
// bots in similar spots don't always make identical decisions.
func pickAIDirection(w *Worm, p *Playfield) Direction {
	candidates := safeDirections(w, p)
	if len(candidates) == 0 {
		return w.direction
	}

	personality := w.personality
	if personality.Name == "" {
		personality = newPersonality()
	}

	target, hasTarget := nearestFood(w.Head(), p)
	curDist := 0
	if hasTarget {
		curDist = manhattan(w.Head(), target)
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
			s += personality.FoodPull * float64(curDist-manhattan(next, target))
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

// safeDirections returns directions whose next cell is not on any worm's
// (non-vacating) body and isn't a 180° reversal. The field wraps so edges
// are not considered unsafe.
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
		for i, b := range ow.blocks {
			if ow.pendingGrowth == 0 && i == len(ow.blocks)-1 {
				continue
			}
			blocked[b] = struct{}{}
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
