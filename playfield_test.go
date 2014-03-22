package flow

import (
	"encoding/json"
	"fmt"
	. "github.com/smartystreets/goconvey/convey"
	"testing"
	"time"
)

func syncfield(t *testing.T, p *Playfield) {
	p.ticker.Tick()
	select {
	case <-time.After(time.Second):
		t.Fatal("Timed out waiting to sync")
	case running := <-p.Running:
		So(running, ShouldBeTrue)
	}
}

func logPacket(t *testing.T, p *Packet) {
	js, _ := json.Marshal(p)
	t.Log(string(js))
}

func TestRunPlayfield(t *testing.T) {
	Convey("A new playfield", t, func() {
		p := NewPlayfield(nil)
		Convey("Should auto start", func() {
			started := false
			select {
			case <-p.Running:
				started = true
			case <-time.After(time.Second):
			}
			So(started, ShouldBeTrue)
		})
		Convey("Adding a worm should increase last id", func() {
			w := NewWorm()
			p.Join <- w
			syncfield(t, p)
			So(p.LastId, ShouldEqual, 1)
		})
	})
}

func TestJoinPart(t *testing.T) {
	// Do manual ticks to know the state of the playfield
	testTicker := NewDefaltTicker(nil)
	Convey("Given a clean playfield", t, func() {
		playfield := NewPlayfield(testTicker)
		w := NewWorm()
		w2 := NewWorm()
		Convey("with two worms joining", func() {
			t.Log("add")
			playfield.Join <- w
			t.Log("add")
			playfield.Join <- w2
			t.Log("done add")
			syncfield(t, playfield)
			t.Log("done sync")
			So(len(playfield.Movers), ShouldEqual, 2)
			So(playfield.LastId, ShouldEqual, 2)
			for n, w := range []*Worm{w, w2} {
				Convey(fmt.Sprintf("A BULK package should be received by worm %d on next update", n+1), func() {
					select {
					case p := <-w.Outbox:
						logPacket(t, &p)
					case <-time.After(time.Second):
						t.Fatal("Timed out waiting on worm", n)
					}
				})
			}
		})
		Convey("and one leaving", func() {
			playfield.Part <- w
			syncfield(t, playfield)
			Convey("It will still be in the playfield", func() {
				So(len(playfield.Movers), ShouldEqual, 2)
			})
			Convey("But marked as killed", func() {
				So(w.Killed(), ShouldBeTrue)
			})
		})
		Convey("A BULK package should be received for the remaining worm", func() {
			select {
			case packet := <-w2.Outbox:
				So(packet.Command, ShouldEqual, "BULK")
				Convey("Where the payload has one kill message", func() {
					v, ok := packet.Payload.(BulkPayload)
					So(ok, ShouldBeTrue)
					So(len(v.Kill), ShouldEqual, 1)
				})
			case <-time.After(time.Second):
				t.Fatal("Timed out waiting for a KILL packet")
			}
		})
		Convey("When the last worm leaves", func() {
			playfield.Part <- w2
			select {
			case running := <-playfield.Running:
				Convey("No worms should be left on the playfield", func() {
					So(len(playfield.Movers), ShouldEqual, 0)
					// TODO: Might as well stop the playfield when the last mover parts
					SkipSo(running, ShouldBeFalse)
				})
			case <-time.After(time.Second):
				t.Fatal("Timed out waiting to part the last worm")
			}
		})
	})
}
