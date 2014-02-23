package flow

import "testing"

func TestWormMovability(t *testing.T) {
	w := NewWorm()
	var prevPos *Position

	if d := w.Direction(); d == Unknown {
		t.Errorf("Expeceted direction to be initialized")
	}

	testPos := func(p Position) {
		if p != w.blocks[0] {
			t.Error("Wrong position", w.blocks[0], "!=", p)
		}
		if prevPos != nil {
			if w.blocks[1] != *prevPos {
				t.Errorf(
					"Expected next blocks in chain to have moved, got: %s instead of %s",
					w.blocks[1], *prevPos,
				)
			}
		}
		prevPos = &p
	}

	originalPos := w.blocks[0]

	w.Move(Left)
	if d := w.Direction(); d != Left {
		t.Errorf("Unexpected direction", d)
	}
	testPos(Position{originalPos.X - 1, w.blocks[0].Y})

	if w.blocks[1] != originalPos {
		t.Error("Expected next block to be same as original position")
	}

	w.Move(Right)
	if d := w.Direction(); d != Right {
		t.Errorf("Unexpected direction", d)
	}
	testPos(Position{originalPos.X, w.blocks[0].Y})

	w.Move(Up)
	if d := w.Direction(); d != Up {
		t.Errorf("Unexpected direction", d)
	}
	testPos(Position{originalPos.X, originalPos.Y - 1})

	w.Move(Down)
	if d := w.Direction(); d != Down {
		t.Errorf("Unexpected direction", d)
	}
	testPos(Position{originalPos.X, originalPos.Y})
}

func TestCommunicate(t *testing.T) {
	w := NewWorm()
	w.Move(Right)

	if err := w.Communicate(Packet{Command: "MOVE", Payload: "UP"}); err != nil {
		t.Error(err)
	}
	if d := w.Direction(); d != Up {
		t.Error("Did not obey communicated command, direction is:", d)
	}

	if err := w.Communicate(Packet{Command: "MOVE", Payload: "DOWN"}); err != nil {
		t.Error(err)
	}
	if d := w.Direction(); d == Down {
		t.Error("Should not be able to move in opposite direction")
	}
}
