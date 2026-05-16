package flow

import "testing"

func TestEdgeWrap(t *testing.T) {
	cases := []struct {
		name string
		head Position
		dir  Direction
		want Position
	}{
		{"right wraps to left", Position{Boundary, 25}, Right, Position{0, 25}},
		{"left wraps to right", Position{0, 25}, Left, Position{Boundary, 25}},
		{"top wraps to bottom", Position{25, 0}, Up, Position{25, Boundary}},
		{"bottom wraps to top", Position{25, Boundary}, Down, Position{25, 0}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := NewWorm()
			// Spread the tail one cell behind the head so we don't false-trigger
			// the self-collision check (head wrapping onto a co-located body).
			behind := c.head
			switch c.dir {
			case Right:
				behind.X = (behind.X - 1 + Boundary + 1) % (Boundary + 1)
			case Left:
				behind.X = (behind.X + 1) % (Boundary + 1)
			case Up:
				behind.Y = (behind.Y + 1) % (Boundary + 1)
			case Down:
				behind.Y = (behind.Y - 1 + Boundary + 1) % (Boundary + 1)
			}
			w.blocks = []Position{c.head, behind, behind}

			w.Move(c.dir)
			if w.killed {
				t.Errorf("Worm should not die when crossing the edge: %s", w.deathReason)
			}
			if w.blocks[0] != c.want {
				t.Errorf("Head should wrap to %v, got %v", c.want, w.blocks[0])
			}
		})
	}
}

func TestSelfCollisionDeath(t *testing.T) {
	w := NewWorm()
	// Build a tight U-shape: head at (10,10), going Up next would put it onto
	// blocks[3] at (10,10). We construct a 4-block worm that wraps.
	w.blocks = []Position{
		{10, 10}, // head
		{11, 10}, // body
		{11, 11},
		{10, 11},
	}
	// Force "Left" so the head moves into (9,10) — that's safe.
	w.Move(Left)
	if w.killed {
		t.Errorf("Did not expect death after free move, reason: %s", w.deathReason)
	}

	// Now build a configuration where the next move IS into a non-tail body
	// block (the tail would vacate; non-tail body does not).
	w.blocks = []Position{
		{10, 10}, // head
		{11, 10}, // body — what we'll eat
		{11, 11},
		{10, 11}, // tail
	}
	w.direction = Up
	// Move Right: head (10,10) → (11,10), which is blocks[1] (body).
	w.Move(Right)
	if !w.killed {
		t.Errorf("Expected death from eating own body")
	}
}

func TestTailVacateForgiven(t *testing.T) {
	w := NewWorm()
	// Head at (10,10), body, then tail at (11,10). Move Right takes head into
	// (11,10) — the tail's old position. Without pendingGrowth, the tail
	// vacates this tick, so this is allowed.
	w.blocks = []Position{
		{10, 10},
		{10, 11},
		{11, 10},
	}
	w.Move(Right)
	if w.killed {
		t.Errorf("Move into vacating tail should not kill, reason: %s", w.deathReason)
	}
}

func TestHeadIntoOtherBodyKillsVictim(t *testing.T) {
	p := NewPlayfield()
	a := NewWorm()
	a.Name = "A"
	a.blocks = []Position{{10, 10}, {9, 10}, {8, 10}}
	a.direction = Right
	p.addMovable(a)

	b := NewWorm()
	b.Name = "B"
	// B faces away from A; after both move, B's body[1] sits at (11,10),
	// which is exactly where A's head lands. (A's right-move would clip B's
	// body cell.) Old tail at (13,10) vacates so that's not the contact.
	b.blocks = []Position{{11, 10}, {12, 10}, {13, 10}}
	b.direction = Right
	p.addMovable(b)

	p.tick()

	if !b.killed {
		t.Errorf("B should be killed after A ate it, deathReason=%q", b.deathReason)
	}
	if a.killed {
		t.Errorf("A should survive eating B, got killed: %s", a.deathReason)
	}
}

func TestHeadOnHeadKillsBoth(t *testing.T) {
	p := NewPlayfield()
	a := NewWorm()
	a.Name = "A"
	a.blocks = []Position{{10, 10}, {9, 10}, {8, 10}}
	a.direction = Right
	p.addMovable(a)

	b := NewWorm()
	b.Name = "B"
	// B faces left; both A and B advance one cell and land on (11, 10).
	b.blocks = []Position{{12, 10}, {13, 10}, {14, 10}}
	b.direction = Left
	p.addMovable(b)

	p.tick()

	if !a.killed || !b.killed {
		t.Errorf("Head-on should kill both: a.killed=%v b.killed=%v", a.killed, b.killed)
	}
}

// applyInputs simulates what the playfield's MoveCmd handler does. Returns
// true if the input was accepted (queued); false if rejected.
func applyInputs(w *Worm, d Direction) bool {
	if w.killed || d == Unknown {
		return false
	}
	last := w.direction
	if n := len(w.inputs); n > 0 {
		last = w.inputs[n-1]
	}
	if opposite(d) == last && last != Unknown {
		return false
	}
	if d == last {
		return false
	}
	const maxQueued = 3
	if len(w.inputs) >= maxQueued {
		w.inputs = w.inputs[1:]
	}
	w.inputs = append(w.inputs, d)
	return true
}

// TestUTurnLoopholeBlocked: pressing Left → Up → Right rapidly must NOT
// land as a 180° reversal of the last actually-moved direction (Left).
// With the queue, Up and Right are both buffered (Up first), so the worm
// turns Up then Right across two ticks — no self-eat.
func TestUTurnLoopholeBlocked(t *testing.T) {
	w := NewWorm()
	w.direction = Left
	w.blocks = []Position{{24, 25}, {25, 25}, {25, 25}}

	if !applyInputs(w, Up) {
		t.Fatal("Up after Left should be accepted")
	}
	if !applyInputs(w, Right) {
		t.Fatal("Right after Up (90° from queued Up) should be accepted")
	}
	if got := len(w.inputs); got != 2 {
		t.Errorf("Expected 2 buffered inputs, got %d", got)
	}

	// Tick 1: pop Up.
	w.direction = w.inputs[0]
	w.inputs = w.inputs[1:]
	w.Move(w.direction)
	if w.killed {
		t.Fatalf("Tick 1 (Up) should not kill: %s", w.deathReason)
	}

	// Tick 2: pop Right (90° from Up — no self-collision).
	w.direction = w.inputs[0]
	w.inputs = w.inputs[1:]
	w.Move(w.direction)
	if w.killed {
		t.Fatalf("Tick 2 (Right) should not kill: %s", w.deathReason)
	}
}

// TestStraightReversalRejected: a direct 180° request is still blocked.
func TestStraightReversalRejected(t *testing.T) {
	w := NewWorm()
	w.direction = Left
	if applyInputs(w, Right) {
		t.Error("Right after Left (direct 180°) must be rejected")
	}
}

// TestInputBufferConsumedAcrossTicks: queue is drained one entry per tick.
func TestInputBufferConsumedAcrossTicks(t *testing.T) {
	w := NewWorm()
	w.direction = Right
	w.blocks = []Position{{20, 20}, {19, 20}, {18, 20}}

	if !applyInputs(w, Down) {
		t.Fatal("Down should be accepted")
	}
	if !applyInputs(w, Left) {
		t.Fatal("Left should be accepted (90° from queued Down)")
	}

	// First tick consumes Down.
	w.direction = w.inputs[0]
	w.inputs = w.inputs[1:]
	w.Move(w.direction)
	if w.direction != Down {
		t.Errorf("Expected direction Down after first tick, got %v", w.direction)
	}
	if len(w.inputs) != 1 || w.inputs[0] != Left {
		t.Errorf("Expected Left still queued, got %v", w.inputs)
	}

	// Second tick consumes Left.
	w.direction = w.inputs[0]
	w.inputs = w.inputs[1:]
	w.Move(w.direction)
	if w.direction != Left {
		t.Errorf("Expected direction Left after second tick, got %v", w.direction)
	}
}

func TestResetReturnsToSpawn(t *testing.T) {
	w := NewWorm()
	w.AddScore(45)
	w.Move(Right)
	w.Move(Right)
	w.killed = true
	w.deathReason = "Hit a wall"

	w.Reset()

	if w.killed {
		t.Errorf("Worm should be alive after reset")
	}
	if w.Score != 0 {
		t.Errorf("Score should reset, got %d", w.Score)
	}
	if w.pendingGrowth != 0 {
		t.Errorf("pendingGrowth should reset")
	}
	if len(w.blocks) != WormSize {
		t.Errorf("blocks length should reset, got %d", len(w.blocks))
	}
	if w.direction != Unknown {
		t.Errorf("direction should reset")
	}
}
