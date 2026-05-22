package flow

// PacMan is the single hunter that prowls the field while at least one human
// is online. He occupies a PacManSize × PacManSize footprint anchored at
// pm.pos (top-left), moves one anchor-cell per tick (same cadence as worms,
// half the worm's visual speed relative to his own body), wraps the torus,
// ignores food, and bites segments off any worm whose cell falls inside his
// footprint. He is not a Movable — the playfield keeps a direct *PacMan
// pointer and ticks him explicitly, and `occupied()` adds his footprint to
// the food-spawn block list. Kept separate from worms because he shares
// nothing with their growth / food / self-collision rules.
type PacMan struct {
	pos       Position
	prevPos   Position
	direction Direction
}

// PacManSize is the side length (in cells) of Pac-Man's footprint. A 2x2
// footprint means his mouth visibly engulfs neighbouring worm segments
// during a bite — the visual matches the mechanic.
const PacManSize = 2

// NewPacMan spawns a Pac-Man at start, facing Right by default. A real
// direction is committed up front (rather than Unknown + lazy-init in a
// getter) so callers can read pm.direction directly (ai.go's
// safeDirections and scoreCandidates, plus the inertia bonus in
// pickPacManDirection) without a read silently mutating state.
func NewPacMan(start Position) *PacMan {
	return &PacMan{
		pos:       start,
		prevPos:   start,
		direction: Right,
	}
}

// footprintAt returns the PacManSize × PacManSize cells anchored at the
// given (top-left) cell, wrapped onto the torus. Shared by Footprint and
// PrevFootprint so the wrap rule lives in one place.
func footprintAt(anchor Position) []Position {
	out := make([]Position, 0, PacManSize*PacManSize)
	for dy := 0; dy < PacManSize; dy++ {
		for dx := 0; dx < PacManSize; dx++ {
			out = append(out, wrap(Position{anchor.X + dx, anchor.Y + dy}))
		}
	}
	return out
}

// Footprint returns every cell Pac-Man currently occupies.
func (pm *PacMan) Footprint() []Position { return footprintAt(pm.pos) }

// PrevFootprint mirrors Footprint but anchored at pm.prevPos. Used by the
// bite phase to detect head-on swaps (worm head moved through Pac-Man's
// vacated cells while Pac-Man crossed the worm's previous head cell).
func (pm *PacMan) PrevFootprint() []Position { return footprintAt(pm.prevPos) }

func (pm *PacMan) Position() Position     { return pm.pos }
func (pm *PacMan) PrevPosition() Position { return pm.prevPos }
func (pm *PacMan) Direction() Direction   { return pm.direction }

// Move advances Pac-Man one anchor-cell in d, wrapping the torus. Records
// the previous anchor so the bite phase can compute his prior footprint.
func (pm *PacMan) Move(d Direction) {
	if d == Unknown {
		return
	}
	pm.direction = d
	pm.prevPos = pm.pos
	pm.pos = wrap(step(pm.pos, d))
}

// pickPacManDirection scores the four cardinal directions by progress toward
// the nearest worm head (or, if no head is within hunting range, the nearest
// worm body cell). Deterministic — Pac-Man is the threat, not a peer; the
// scariness comes from being predictable in a bad way.
func pickPacManDirection(pm *PacMan, p *Playfield) Direction {
	target, ok := pacManTarget(pm, p)
	if !ok {
		// No worms to hunt; keep heading.
		return pm.direction
	}

	curDist := manhattan(pm.pos, target)
	type scored struct {
		dir   Direction
		score float64
	}
	best := scored{dir: pm.Direction(), score: -1e9}
	for _, d := range []Direction{Up, Down, Left, Right} {
		next := wrap(step(pm.pos, d))
		s := float64(curDist - manhattan(next, target))
		if d == pm.direction {
			s += 0.25 // small inertia: avoid twitching between equally good choices
		}
		if s > best.score {
			best = scored{d, s}
		}
	}
	return best.dir
}

// pacManTargetHuntRadius caps the manhattan range within which Pac-Man
// prefers a head over a body. Beyond this, the nearest body cell wins —
// long worms still have to worry about him picking off a tail even when
// the head is far away.
const pacManTargetHuntRadius = 20

// pacManLengthAttraction is how many cells of "closer" each extra worm
// segment is worth when picking a head target. With this set to 3, a
// six-segment worm reads as ~15 cells nearer than a one-segment worm,
// so Pac-Man swings toward the juicy long worm instead of harassing a
// poor head-only victim while the leader gets fat on fruit.
const pacManLengthAttraction = 3

// pacManTarget returns the cell Pac-Man should currently steer toward.
// Among heads inside pacManTargetHuntRadius the one with the lowest
// "effective distance" (manhattan minus length × pacManLengthAttraction)
// wins, so longer worms attract him from farther away. Beyond the head
// pass he falls back to the nearest body cell.
//
// Two passes: heads first, body only if nobody's head is in range.
func pacManTarget(pm *PacMan, p *Playfield) (Position, bool) {
	var bestHead Position
	bestHeadEff := 0
	haveHead := false
	for m := range p.Movables {
		w, ok := m.(*Worm)
		if !ok || w.killed || len(w.blocks) == 0 {
			continue
		}
		d := manhattan(pm.pos, w.Head())
		if d > pacManTargetHuntRadius {
			continue
		}
		eff := d - pacManLengthAttraction*len(w.blocks)
		if !haveHead || eff < bestHeadEff {
			bestHead = w.Head()
			bestHeadEff = eff
			haveHead = true
		}
	}
	if haveHead {
		return bestHead, true
	}

	var bestBody Position
	bestBodyDist := 0
	haveBody := false
	for m := range p.Movables {
		w, ok := m.(*Worm)
		if !ok || w.killed || len(w.blocks) == 0 {
			continue
		}
		for _, b := range w.blocks {
			db := manhattan(pm.pos, b)
			if !haveBody || db < bestBodyDist {
				bestBody = b
				bestBodyDist = db
				haveBody = true
			}
		}
	}
	if haveBody {
		return bestBody, true
	}
	return Position{}, false
}

// posSet turns a slice of positions into a set for O(1) membership lookup.
func posSet(positions []Position) map[Position]struct{} {
	s := make(map[Position]struct{}, len(positions))
	for _, p := range positions {
		s[p] = struct{}{}
	}
	return s
}

// resolvePacManBite runs after worms and Pac-Man have moved. It detects the
// bite (if any) and mutates the bitten worm — head bite (segment 0) kills
// the worm, body bite truncates blocks[i:] and zeroes growth progress so
// the worm has to re-earn each lost segment. Returns the worm that was
// bitten (if any), the segment index of the bite, and the chopped cells
// for the client puff effect.
//
// Bite priority — direct-overlap wins globally, not per-worm. Across every
// living worm we pick the single (worm, segment_index) with the lowest
// index whose cell lies in Pac-Man's new footprint. Lower index = closer
// to head = more decisive bite. Only if zero worms overlap do we check
// the swap fallback. This ordering matters when two worms each have a
// cell in the footprint: the worm whose head is closer (lower index)
// always wins, even if the other worm could be swap-detected.
//
// Bite phases:
//  1. Direct overlap. The 2x2 footprint can engulf multiple segments at
//     once; the nearest-the-head wins, so the bigger Pac-Man bites more
//     aggressively (a midbody overlap drops the back half, not just the
//     cell right under his mouth).
//  2. Head-on swap. If no direct overlap, check whether a worm head's
//     previous cell is in Pac-Man's new footprint while its new head
//     is in Pac-Man's previous footprint. That's the case where worm
//     and Pac-Man traded space without sharing a cell at end-of-tick.
//
// Limitation: a worm of length ≥ 2 always leaves its body in its old
// head's cell after moving, so the direct-overlap path catches it via
// segment 1 instead of the swap branch firing. In practice the swap
// branch only triggers for 1-segment worms (a worm that just got
// truncated to its head, for instance). Kept in for that edge case
// and for symmetry.
func resolvePacManBite(pm *PacMan, prevHeads map[*Worm]Position, p *Playfield) (*Worm, int, []Position) {
	newFp := posSet(pm.Footprint())

	var bestWorm *Worm
	bestIdx := -1
	for m := range p.Movables {
		w, ok := m.(*Worm)
		if !ok || w.killed || len(w.blocks) == 0 {
			continue
		}
		for i, b := range w.blocks {
			if _, hit := newFp[b]; !hit {
				continue
			}
			if bestWorm == nil || i < bestIdx {
				bestWorm = w
				bestIdx = i
			}
			// Iteration is head→tail, so the first match for *this*
			// worm is already its smallest index — no point scanning
			// the rest of its body.
			break
		}
	}

	if bestWorm == nil {
		// No direct overlap — fall back to head-on swap detection.
		prevFp := posSet(pm.PrevFootprint())
		for m := range p.Movables {
			w, ok := m.(*Worm)
			if !ok || w.killed || len(w.blocks) == 0 {
				continue
			}
			prev, hadPrev := prevHeads[w]
			if !hadPrev {
				continue
			}
			_, newHeadInPrev := prevFp[w.Head()]
			_, oldHeadInNew := newFp[prev]
			if newHeadInPrev && oldHeadInNew {
				lost := append([]Position(nil), w.blocks...)
				w.killed = true
				w.deathReason = "Eaten by Pac-Man"
				return w, 0, lost
			}
		}
		return nil, 0, nil
	}

	w := bestWorm
	i := bestIdx
	if i == 0 {
		lost := append([]Position(nil), w.blocks...)
		w.killed = true
		w.deathReason = "Eaten by Pac-Man"
		return w, 0, lost
	}
	lost := append([]Position(nil), w.blocks[i:]...)
	w.blocks = w.blocks[:i]
	// Lose growth credit. Score is left alone (the player keeps the
	// points) but the next growth has to be re-earned from scratch by
	// scoring another GrowthInterval. Setting lastGrowthScore to the
	// current score zeroes the partial-credit window — any food
	// progress toward the next growth is forfeited, which is the right
	// penalty: a bite that drops N segments should cost N×GrowthInterval
	// to recover, not less.
	w.lastGrowthScore = w.Score
	// In-flight growth from a recent fruit is forfeited too — the worm
	// just got shorter, queueing more growth would look like the bite
	// didn't take.
	w.pendingGrowth = 0
	return w, i, lost
}
