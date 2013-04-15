package flow

import (
	"strconv"
	"testing"
	"time"
)

func TestAddRemoveMovable(t *testing.T) {
	playfield := NewPlayfield()
	m := Movable(NewWorm())
	m2 := Movable(NewWorm())
	playfield.addMovable(m)
	playfield.addMovable(m2)
	playfield.removeMovable(m)
	playfield.removeMovable(m2)

	if len(playfield.Movables) != 0 {
		t.Error("Expected movables to be empty")
	}

	for n := 1; n <= 2; n++ {
		select {
		case packet := <-playfield.Broadcast:
			if packet.Command != "KILL" {
				t.Errorf("Expected KILL packet")
			} else if packet.Payload.(string) != strconv.FormatInt(int64(n), 10) {
				t.Errorf("Expected payload to be id %d of worm, got: %v", n, packet.Payload)
			}

		case <-time.After(time.Second):
			t.Errorf("Timed out waiting for a KILL packet")
		}
	}
}
