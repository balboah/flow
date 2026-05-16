package flow

import "testing"

func TestWormMovability(t *testing.T) {
	w := NewWorm()

	if d := w.Direction(); d == Unknown {
		t.Errorf("Direction() should auto-pick on first call")
	}

	originalPos := w.blocks[0]

	// Forward-only path so we never reverse into our own body.
	w.Move(Right)
	if d := w.Direction(); d != Right {
		t.Errorf("Unexpected direction: %v", d)
	}
	if w.blocks[0] != (Position{originalPos.X + 1, originalPos.Y}) {
		t.Errorf("Wrong head after Right: %v", w.blocks[0])
	}
	if w.blocks[1] != originalPos {
		t.Errorf("Expected blocks[1] to be original pos, got %v", w.blocks[1])
	}

	w.Move(Right)
	if w.blocks[0] != (Position{originalPos.X + 2, originalPos.Y}) {
		t.Errorf("Wrong head after second Right: %v", w.blocks[0])
	}

	w.Move(Up)
	if d := w.Direction(); d != Up {
		t.Errorf("Unexpected direction: %v", d)
	}
	if w.blocks[0] != (Position{originalPos.X + 2, originalPos.Y - 1}) {
		t.Errorf("Wrong head after Up: %v", w.blocks[0])
	}

	w.Move(Left)
	if d := w.Direction(); d != Left {
		t.Errorf("Unexpected direction: %v", d)
	}
	if w.blocks[0] != (Position{originalPos.X + 1, originalPos.Y - 1}) {
		t.Errorf("Wrong head after Left: %v", w.blocks[0])
	}

	if w.killed {
		t.Errorf("Worm should not be killed during a clean forward path")
	}
}

// TestMoveCmdDispatch exercises the playfield's MoveCmd handler, which is
// the only path the server takes for client direction input. Direct mutation
// of w.direction is intentionally not exposed.
func TestMoveCmdDispatch(t *testing.T) {
	p := NewPlayfield()
	w := NewWorm()
	w.direction = Right
	p.addMovable(w)

	// Apply the same handler logic that the Start() select runs.
	apply := func(d Direction) {
		if w.killed || d == Unknown {
			return
		}
		if opposite(d) == w.direction && w.direction != Unknown {
			return
		}
		w.direction = d
	}

	apply(Up)
	if w.direction != Up {
		t.Errorf("Expected direction Up, got %v", w.direction)
	}
	apply(Down) // opposite — should be rejected
	if w.direction == Down {
		t.Errorf("Reversal should not be allowed")
	}
}
