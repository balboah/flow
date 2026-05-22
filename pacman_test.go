package flow

import "testing"

// addWormAt registers a 4-block worm laid out horizontally with head at h.
// Tail extends in negative-X. Spaces segments far enough from common test
// origin so wrap effects don't interfere.
func addWormAt(p *Playfield, h Position) *Worm {
	w := NewWorm()
	w.blocks = []Position{
		h,
		{h.X - 1, h.Y},
		{h.X - 2, h.Y},
		{h.X - 3, h.Y},
	}
	w.direction = Right
	p.addMovable(w)
	return w
}

// placePacManAnchor builds a PacMan whose anchor is at `anchor`, with
// prevPos equal to anchor (no last move). Returns it ready for a bite check.
func placePacManAnchor(anchor Position) *PacMan {
	pm := NewPacMan(anchor)
	pm.prevPos = anchor
	return pm
}

// TestPacManBiteAtTail: a footprint anchored so only the tail cell of a
// horizontal worm overlaps drops just that one segment.
func TestPacManBiteAtTail(t *testing.T) {
	p := NewPlayfield()
	w := addWormAt(p, Position{30, 30})
	tail := w.blocks[len(w.blocks)-1]
	// Anchor (tail.X-1, tail.Y-1) → footprint covers (tail.X-1, tail.Y-1),
	// (tail.X, tail.Y-1), (tail.X-1, tail.Y), (tail.X, tail.Y). Only the
	// last is on the worm (the tail).
	pm := placePacManAnchor(Position{tail.X - 1, tail.Y - 1})
	prevHeads := map[*Worm]Position{w: w.Head()}

	bitten, idx, lost := resolvePacManBite(pm, prevHeads, p)
	if bitten != w {
		t.Fatalf("expected w to be bitten, got %v", bitten)
	}
	if idx != 3 {
		t.Errorf("expected bite at segment 3 (tail), got %d", idx)
	}
	if len(lost) != 1 {
		t.Errorf("expected one lost segment, got %d (lost=%v)", len(lost), lost)
	}
	if len(w.blocks) != 3 {
		t.Errorf("expected length 3 after tail bite, got %d", len(w.blocks))
	}
}

// TestPacManBiteOverlapMultipleSegmentsTakesNearestHead: when the footprint
// covers multiple worm cells at once, the cell with the smallest segment
// index (closest to head) wins.
func TestPacManBiteOverlapMultipleSegmentsTakesNearestHead(t *testing.T) {
	p := NewPlayfield()
	w := addWormAt(p, Position{30, 30})
	// Anchor at (h.X-2, h.Y-1): footprint covers (h.X-2, h.Y-1),
	// (h.X-1, h.Y-1) [empty], (h.X-2, h.Y) [segment 2], (h.X-1, h.Y)
	// [segment 1]. Lower of {1, 2} is 1.
	pm := placePacManAnchor(Position{w.Head().X - 2, w.Head().Y - 1})
	prevHeads := map[*Worm]Position{w: w.Head()}

	bitten, idx, lost := resolvePacManBite(pm, prevHeads, p)
	if bitten != w {
		t.Fatalf("expected w to be bitten")
	}
	if idx != 1 {
		t.Errorf("expected bite at smallest overlapping index (1), got %d", idx)
	}
	// Length 4 worm; bite at i=1 drops segments [1..3] = 3 segments.
	if len(lost) != 3 {
		t.Errorf("expected 3 lost segments, got %d", len(lost))
	}
	if len(w.blocks) != 1 {
		t.Errorf("expected length 1 after bite at idx 1, got %d", len(w.blocks))
	}
}

// TestPacManBiteHead: the head ends up in the footprint → segment 0 → kill.
func TestPacManBiteHead(t *testing.T) {
	p := NewPlayfield()
	w := addWormAt(p, Position{30, 30})
	// Anchor at (head.X, head.Y - 1): footprint covers (head.X, head.Y-1),
	// (head.X+1, head.Y-1), (head.X, head.Y) [HEAD!], (head.X+1, head.Y).
	pm := placePacManAnchor(Position{w.Head().X, w.Head().Y - 1})
	prevHeads := map[*Worm]Position{w: w.Head()}

	bitten, idx, _ := resolvePacManBite(pm, prevHeads, p)
	if bitten != w {
		t.Fatalf("expected w to be bitten")
	}
	if idx != 0 {
		t.Errorf("expected head bite (idx 0), got %d", idx)
	}
	if !w.killed {
		t.Errorf("head bite should kill")
	}
	if w.deathReason != "Eaten by Pac-Man" {
		t.Errorf("unexpected deathReason: %q", w.deathReason)
	}
}

// TestPacManBiteOnHeadCollision: worm head moves into Pac-Man's footprint
// from one direction while Pac-Man moves toward the worm. After both
// moves the worm's head ends up inside Pac-Man's new footprint → direct
// overlap path catches it as a head bite. The body's trailing cell also
// lands inside the footprint, but the lower-index head wins.
//
// This is not the pure-swap branch (see TestPacManHeadOnSwapPureCase
// for that). With multi-segment worms the body always overlaps too, so
// you almost always hit this direct-overlap path even when they're
// "passing" each other in human terms.
func TestPacManBiteOnHeadCollision(t *testing.T) {
	p := NewPlayfield()
	w := addWormAt(p, Position{30, 30})
	// Pac-Man starts at anchor (31, 29) → footprint covers
	// (31,29), (32,29), (31,30), (32,30). Worm head at (30, 30).
	// Worm moves Right: head → (31,30) — that cell was in Pac-Man's
	// prev footprint. Pac-Man moves Left → anchor (30, 29) → footprint
	// (30,29), (31,29), (30,30), (31,30). Now worm's NEW head (31,30)
	// is still in Pac-Man's new footprint — so this triggers the
	// direct-overlap branch instead, not the swap branch. To force a
	// swap we'd need them to fully pass — hard with overlapping
	// footprints. Test direct overlap here instead.
	pm := NewPacMan(Position{31, 29})
	prevHeads := map[*Worm]Position{w: w.Head()}
	w.Move(Right)
	pm.Move(Left)

	bitten, idx, _ := resolvePacManBite(pm, prevHeads, p)
	if bitten != w {
		t.Fatalf("expected w to be bitten on a head-pass")
	}
	if idx != 0 {
		t.Errorf("expected head bite (idx 0) on head pass, got %d", idx)
	}
	if !w.killed {
		t.Errorf("head pass should kill the worm")
	}
}

// TestPacManHeadOnSwapPureCase: a case where worm and Pac-Man fully trade
// space so their final footprints don't share a cell, but the worm's old
// head was in Pac-Man's new footprint and the worm's new head was in
// Pac-Man's previous footprint. This is the second-pass branch.
//
// Construction is touchy because a multi-cell worm leaves its body in its
// old head's cell after moving, which then *does* overlap Pac-Man's new
// footprint via the direct-overlap path. The pure-swap branch only fires
// for a one-segment worm (or one whose body is otherwise clear of Pac-Man).
func TestPacManHeadOnSwapPureCase(t *testing.T) {
	p := NewPlayfield()
	w := NewWorm()
	w.blocks = []Position{{30, 30}} // one segment so no body trails after the move
	w.direction = Down
	p.addMovable(w)
	prevHeads := map[*Worm]Position{w: w.Head()}

	// Worm at (30,30) moves Down to (30,31). Pacman anchor (30,30) prev
	// footprint covers both (30,30) [worm's old head] and (30,31)
	// [worm's new head]. Pacman moves Up to anchor (30,29) — new
	// footprint is (30,29),(31,29),(30,30),(31,30): contains old head
	// (30,30) but not new head (30,31). Direct overlap finds nothing
	// (the worm's only cell is now (30,31), outside new footprint).
	// Swap branch fires: oldHead ∈ newFootprint and newHead ∈ prevFootprint.
	pm := NewPacMan(Position{30, 30})
	w.Move(Down)
	pm.Move(Up)

	bitten, idx, _ := resolvePacManBite(pm, prevHeads, p)
	if bitten != w {
		t.Fatalf("pure swap should be detected as a head bite, got bitten=%v", bitten)
	}
	if idx != 0 {
		t.Errorf("pure swap should be a head bite (idx 0), got %d", idx)
	}
	if !w.killed {
		t.Errorf("pure swap should kill the worm")
	}
}

func TestPacManBiteZeroesGrowthCredit(t *testing.T) {
	p := NewPlayfield()
	w := addWormAt(p, Position{30, 30})
	w.Score = 90
	w.lastGrowthScore = 90

	// Anchor (head.X-2, head.Y-1) → overlap at segment 1 (3 segments lost).
	pm := placePacManAnchor(Position{w.Head().X - 2, w.Head().Y - 1})
	prevHeads := map[*Worm]Position{w: w.Head()}

	resolvePacManBite(pm, prevHeads, p)

	if w.Score != 90 {
		t.Errorf("Score must not change on body bite, got %d", w.Score)
	}
	// lastGrowthScore is set to Score, so 90 - 90 = 0 progress toward
	// next growth. The worm has to score another GrowthInterval to
	// regrow one segment.
	if w.lastGrowthScore != w.Score {
		t.Errorf("lastGrowthScore should equal Score after bite; got %d, want %d", w.lastGrowthScore, w.Score)
	}
}

// TestPacManBiteForfeitsPartialGrowthCredit: with partial progress toward
// the next growth, a bite zeroes that progress so the bite penalty is
// felt immediately.
func TestPacManBiteForfeitsPartialGrowthCredit(t *testing.T) {
	p := NewPlayfield()
	w := addWormAt(p, Position{30, 30})
	w.Score = 45
	w.lastGrowthScore = 30 // 15 points into the next growth bucket

	pm := placePacManAnchor(Position{w.Head().X - 2, w.Head().Y - 1})
	prevHeads := map[*Worm]Position{w: w.Head()}
	resolvePacManBite(pm, prevHeads, p)

	if w.lastGrowthScore != 45 {
		t.Errorf("partial growth credit should be forfeited; lastGrowthScore=%d, want 45", w.lastGrowthScore)
	}
}

func TestPacManBiteResetsPendingGrowth(t *testing.T) {
	p := NewPlayfield()
	w := addWormAt(p, Position{30, 30})
	w.pendingGrowth = 2

	pm := placePacManAnchor(Position{w.Head().X - 2, w.Head().Y - 1})
	prevHeads := map[*Worm]Position{w: w.Head()}
	resolvePacManBite(pm, prevHeads, p)

	if w.pendingGrowth != 0 {
		t.Errorf("pendingGrowth must reset, got %d", w.pendingGrowth)
	}
}

func TestPacManNoBiteWhenNotOnWorm(t *testing.T) {
	p := NewPlayfield()
	w := addWormAt(p, Position{20, 20})

	pm := placePacManAnchor(Position{40, 40})
	prevHeads := map[*Worm]Position{w: w.Head()}

	bitten, _, _ := resolvePacManBite(pm, prevHeads, p)
	if bitten != nil {
		t.Errorf("Pac-Man on empty cells should not bite, got %v", bitten)
	}
}

func TestPacManFootprintWraps(t *testing.T) {
	// Anchor at the bottom-right corner; footprint must wrap.
	pm := placePacManAnchor(Position{Boundary, Boundary})
	got := pm.Footprint()
	want := map[Position]bool{
		{Boundary, Boundary}: true,
		{0, Boundary}:        true,
		{Boundary, 0}:        true,
		{0, 0}:               true,
	}
	if len(got) != 4 {
		t.Fatalf("expected 4 cells, got %d", len(got))
	}
	for _, c := range got {
		if !want[c] {
			t.Errorf("unexpected footprint cell %v", c)
		}
	}
}

func TestPacManMoveWraps(t *testing.T) {
	pm := NewPacMan(Position{Boundary, 25})
	pm.Move(Right)
	if pm.pos != (Position{0, 25}) {
		t.Errorf("expected wrap to (0,25), got %v", pm.pos)
	}
}

func TestReconcilePacManFollowsHumans(t *testing.T) {
	p := NewPlayfield()
	w := NewWorm()
	w.connected = true
	p.addMovable(w)

	p.reconcilePacMan()
	if p.pacman == nil {
		t.Fatal("Pac-Man should spawn while a human is connected")
	}

	w.connected = false
	p.reconcilePacMan()
	if p.pacman != nil {
		t.Errorf("Pac-Man should despawn when no humans are connected")
	}
}

// TestPacManTargetPrefersLongerWorm: with two worms both inside the hunt
// radius, Pac-Man's target should be the longer worm — even when the
// shorter one is somewhat closer. Otherwise he ends up perpetually
// harassing a head-only victim while a fat winner snacks on broccoli.
func TestPacManTargetPrefersLongerWorm(t *testing.T) {
	p := NewPlayfield()
	// Long worm: 4 segments at y=20.
	long := addWormAt(p, Position{20, 20})
	// Short worm: 1 segment, closer to Pac-Man.
	short := NewWorm()
	short.blocks = []Position{{12, 10}}
	p.addMovable(short)

	// Pac-Man at (10, 10):
	//   dist to long head  (20,20) = 10+10 = 20  (at hunt-radius edge)
	//   dist to short head (12,10) =  2+ 0 =  2
	// With pacManLengthAttraction=3 the effective distances are:
	//   long:  20 - 3*4 =  8
	//   short:  2 - 3*1 = -1
	// Short still wins this case (just barely) — confirming the bias
	// is "prefer longer, not always longer".
	pm := placePacManAnchor(Position{10, 10})
	target, ok := pacManTarget(pm, p)
	if !ok {
		t.Fatal("expected a target")
	}
	if target != short.Head() {
		t.Errorf("short worm next door wins on distance; got target %v", target)
	}

	// Now shift the short worm just far enough that the long worm's
	// length advantage flips the choice. Short at (15,10): dist=5,
	// eff=5-3=2; long unchanged at eff=8 — short still wins.
	// Push short to (20,10): dist=10, eff=10-3=7; long eff=8 — short
	// still wins by 1. At (22,10): dist=12, eff=12-3=9 > 8 — long wins.
	short.blocks = []Position{{22, 10}}
	target, ok = pacManTarget(pm, p)
	if !ok {
		t.Fatal("expected a target")
	}
	if target != long.Head() {
		t.Errorf("long worm should win once length bonus overcomes the gap; got %v", target)
	}
}

// TestPacManTargetHuntRadiusGate: a worm beyond pacManTargetHuntRadius is
// ignored even if it's very long. Stops Pac-Man from sniping a distant
// massive worm and chasing it across the field while another, smaller
// worm sits at his feet.
func TestPacManTargetHuntRadiusGate(t *testing.T) {
	p := NewPlayfield()
	// Long worm far away (well beyond hunt radius).
	long := NewWorm()
	long.blocks = []Position{{45, 45}, {44, 45}, {43, 45}, {42, 45}, {41, 45}, {40, 45}}
	p.addMovable(long)
	// Short worm in range.
	short := NewWorm()
	short.blocks = []Position{{12, 10}}
	p.addMovable(short)

	pm := placePacManAnchor(Position{10, 10})
	// long is ~35+35=70 cells away, well outside the 20 radius.
	target, ok := pacManTarget(pm, p)
	if !ok {
		t.Fatal("expected a target")
	}
	if target != short.Head() {
		t.Errorf("out-of-range long worm should be ignored; got %v", target)
	}
}

func TestSafeDirectionsAvoidsPacManFootprint(t *testing.T) {
	p := NewPlayfield()
	bot := NewWorm()
	bot.AI = true
	bot.blocks = []Position{{20, 20}, {19, 20}, {18, 20}}
	bot.direction = Right
	p.addMovable(bot)

	// Pac-Man at anchor (21, 19), facing Right. Current footprint covers
	// (21,19),(22,19),(21,20),(22,20). Bot moving Right to (21,20) lands
	// in the footprint — Right must be unsafe. Bot moving Down to
	// (20,21) is also unsafe because predicted-next footprint is
	// (22,19),(23,19),(22,20),(23,20)… wait actually pacman moving
	// Right means anchor goes to (22,19) → footprint (22,19),(23,19),
	// (22,20),(23,20). (20,21) is not in either footprint, so Down is
	// safe. Up is to (20,19), also outside both footprints.
	p.pacman = NewPacMan(Position{21, 19})
	p.pacman.direction = Right

	dirs := safeDirections(bot, p)
	for _, d := range dirs {
		if d == Right {
			t.Errorf("Right should be unsafe (Pac-Man footprint covers it)")
		}
	}
}
