package flow

import "testing"

func TestAddScoreGrows(t *testing.T) {
	w := NewWorm()

	if grown := w.AddScore(GrowthInterval - 1); grown != 0 {
		t.Errorf("Expected no growth below threshold, got %d", grown)
	}
	if w.pendingGrowth != 0 {
		t.Errorf("pendingGrowth should be 0, got %d", w.pendingGrowth)
	}

	if grown := w.AddScore(1); grown != 1 {
		t.Errorf("Expected exactly one growth at threshold, got %d", grown)
	}
	if w.pendingGrowth != 1 {
		t.Errorf("pendingGrowth should be 1, got %d", w.pendingGrowth)
	}

	// Cross two thresholds in one call.
	if grown := w.AddScore(GrowthInterval * 2); grown != 2 {
		t.Errorf("Expected two growths, got %d", grown)
	}
	if w.pendingGrowth != 3 {
		t.Errorf("pendingGrowth should be 3, got %d", w.pendingGrowth)
	}
}

func TestMoveConsumesPendingGrowth(t *testing.T) {
	w := NewWorm()
	initialLen := len(w.blocks)
	w.pendingGrowth = 2

	w.Move(Right)
	if len(w.blocks) != initialLen+1 {
		t.Errorf("Expected growth on first move, len=%d want=%d", len(w.blocks), initialLen+1)
	}
	if w.pendingGrowth != 1 {
		t.Errorf("Expected pendingGrowth to decrement, got %d", w.pendingGrowth)
	}

	w.Move(Right)
	if len(w.blocks) != initialLen+2 {
		t.Errorf("Expected second growth, len=%d want=%d", len(w.blocks), initialLen+2)
	}
	if w.pendingGrowth != 0 {
		t.Errorf("Expected pendingGrowth=0, got %d", w.pendingGrowth)
	}

	// No more pending growth — next move should not grow further.
	w.Move(Right)
	if len(w.blocks) != initialLen+2 {
		t.Errorf("Expected no further growth, len=%d", len(w.blocks))
	}
}

func TestWormStartsWithExpectedSize(t *testing.T) {
	w := NewWorm()
	if got := len(w.blocks); got != WormSize {
		t.Errorf("Expected initial worm length %d, got %d", WormSize, got)
	}
	if WormSize > 3 {
		t.Errorf("Initial worm should be short (≤3), got %d — gameplay regression", WormSize)
	}
}

func TestFoodSpawnsAvoidOccupied(t *testing.T) {
	p := NewPlayfield()
	// Pre-occupy the entire perimeter row to force the spawner to avoid it.
	w := NewWorm()
	w.blocks = nil
	for x := 0; x <= Boundary; x++ {
		w.blocks = append(w.blocks, Position{X: x, Y: 0})
	}
	p.addMovable(w)

	for i := 0; i < 20; i++ {
		f := p.spawnFood()
		if f.Position.Y == 0 {
			t.Fatalf("Food spawned on occupied row 0 at %v", f.Position)
		}
	}
}

func TestPlayfieldSeedFoodOnJoin(t *testing.T) {
	p := NewPlayfield()
	w := NewWorm()
	id := p.addMovable(w)
	p.announceJoin(w, id)

	if got := len(p.Foods); got != FoodCount {
		t.Errorf("Expected %d food items after join, got %d", FoodCount, got)
	}

	// Drain WELCOME from worm's outbox and confirm.
	select {
	case msg := <-w.Outbox:
		if msg.Command != "WELCOME" {
			t.Errorf("First outbox packet should be WELCOME, got %s", msg.Command)
		}
	default:
		t.Errorf("Expected WELCOME in worm outbox")
	}
}

func TestCollisionEatsFoodAndScores(t *testing.T) {
	p := NewPlayfield()
	w := NewWorm()
	id := p.addMovable(w)

	// Place food at the worm's head so the next collision check fires.
	p.LastFoodId++
	target := Food{Id: p.LastFoodId, Position: w.Head(), Type: Apple}
	p.Foods[target.Id] = &target

	p.resolveCollisions()

	if w.Score != PointsPerFood[Apple] {
		t.Errorf("Expected score %d, got %d", PointsPerFood[Apple], w.Score)
	}
	if _, still := p.Foods[target.Id]; still {
		t.Errorf("Food should have been removed after collision")
	}
	if len(p.Foods) != 1 {
		t.Errorf("Expected one replacement food, got %d", len(p.Foods))
	}

	// Drain expected broadcasts: EAT, SCORE, FOOD.
	expected := map[string]bool{"EAT": false, "SCORE": false, "FOOD": false}
	for i := 0; i < 3; i++ {
		select {
		case pkt := <-p.Broadcast:
			if _, ok := expected[pkt.Command]; !ok {
				t.Errorf("Unexpected broadcast %s", pkt.Command)
			}
			expected[pkt.Command] = true
		default:
			t.Fatalf("Missing broadcast (only got %d)", i)
		}
	}
	for cmd, seen := range expected {
		if !seen {
			t.Errorf("Did not see broadcast %s", cmd)
		}
	}
	_ = id
}
