package flow

import "testing"

func TestWormMovability(t *testing.T) {
	w := NewWorm()

	if d := w.Direction(); d == UNKOWN {
		t.Errorf("Expeceted direction to be initialized")
	}

	testPos := func(p Position) {
		if p != w.position {
			t.Error("Wrong position", w.position, "!=", p)
		}
	}

	originalPos := w.position

	w.MoveLeft()
	if d := w.Direction(); d != LEFT {
		t.Errorf("Unexpected direction", d)
	}
	testPos(Position{originalPos.X - 1, w.position.Y})

	w.MoveRight()
	if d := w.Direction(); d != RIGHT {
		t.Errorf("Unexpected direction", d)
	}
	testPos(Position{originalPos.X, w.position.Y})

	w.MoveUp()
	if d := w.Direction(); d != UP {
		t.Errorf("Unexpected direction", d)
	}
	testPos(Position{originalPos.X, originalPos.Y - 1})

	w.MoveDown()
	if d := w.Direction(); d != DOWN {
		t.Errorf("Unexpected direction", d)
	}
	testPos(Position{originalPos.X, originalPos.Y})
}

func TestCommunicate(t *testing.T) {
	w := NewWorm()
	w.MoveRight()

	done := make(chan int)
	go func() {
		w.Communicate()
		done <- 1
	}()

	w.C.Inbox <- Packet{Command: "MOVE", Payload: "UP"}
	<-done

	if d := w.Direction(); d != UP {
		t.Error("Did not obey communicated command, direction is:", d)
	}

	go func() {
		w.Communicate()
		done <- 1
	}()

	w.C.Inbox <- Packet{Command: "MOVE", Payload: "DOWN"}
	<-done

	if d := w.Direction(); d == DOWN {
		t.Error("Should not be able to move in opposite direction")
	}
}

func TestAttachable(t *testing.T) {
	head := &Block{position: Position{X: 1, Y: 1}}
	tail := &Block{position: Position{X: 0, Y: 0}}

	head.Attach(tail)
	if w := head.Next(); w != tail {
		t.Error("Expected tail")
	}

	positions := head.Positions()
	if l := len(positions); l != 2 {
		t.Error("Expected 2 Positions for two attachables got", l)
	}

	correct := []Position{Position{X: 1, Y: 1}, Position{X: 0, Y: 0}}
	if positions[0] != correct[0] {
		t.Error("Wrong position for worm", positions[0])
	}
	if positions[1] != correct[1] {
		t.Error("Wrong position for tail", positions[1])
	}

	head.Follow(Position{2, 2})
	correct = []Position{Position{X: 2, Y: 2}, Position{X: 1, Y: 1}}
	positions = head.Positions()
	if positions[0] != correct[0] {
		t.Error("Wrong position for worm", positions[0])
	}
	if positions[1] != correct[1] {
		t.Error("Wrong position for tail", positions[1])
	}
}

func TestTail(t *testing.T) {
	w1 := NewWorm()
	original := len(Attachable(w1).Positions())
	w1.AddTail(1)

	if l := len(Attachable(w1).Positions()); l != original+1 {
		t.Error("Expected +1 Positions for two attachables got total of", l)
	}
}
