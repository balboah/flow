package flow

import (
	"fmt"
	"testing"
	"time"
)

func TestAddRemoveMovable(t *testing.T) {
	playfield := NewPlayfield()
	playfield.Start()
	m := Movable(NewWorm())
	m2 := Movable(NewWorm())
	playfield.Join <- m
	playfield.Join <- m2
	playfield.Part <- m
	playfield.Part <- m2

	for n := 1; n <= 2; n++ {
		select {
		case packet := <-playfield.Broadcast:
			if packet.Command != "KILL" {
				t.Errorf("Expected KILL packet")
			} else if packet.Payload.(string) != fmt.Sprintf("%d", n) {
				t.Errorf("Expected payload to be id %d of worm, got: %v", n, packet.Payload)
			}

		case <-time.After(time.Second):
			t.Errorf("Timed out waiting for a KILL packet")
		}
	}
	if len(playfield.Movables) != 0 {
		t.Error("Expected movables to be empty")
	}
}
