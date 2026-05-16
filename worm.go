package flow


const (
	Boundary       = 49 // The outer boundary of a playfield
	WormSize       = 3  // Starting length of the worm
	GrowthInterval = 30 // Points between each tail-growth step
)

type Length uint

type Direction uint

const (
	Unknown Direction = iota
	Up
	Down
	Left
	Right
)

func (d Direction) String() string {
	switch d {
	case Up:
		return "UP"
	case Down:
		return "DOWN"
	case Left:
		return "LEFT"
	case Right:
		return "RIGHT"
	}
	return ""
}

// The player controlled worm
type Worm struct {
	// The positions of the points that makes up the worm
	blocks []Position

	// direction is the worm's actual heading after the most recent Move.
	// inputs is a small FIFO of upcoming direction changes — one per tick.
	// Rapid presses like Down+Left buffer as two consecutive moves instead
	// of overwriting each other, but the U-turn guard still checks every
	// new entry against the last actual move so 180° reversals can't slip
	// through by chaining 90° turns inside a single tick window.
	direction Direction
	inputs    []Direction

	// Packets to be sent to the client controlling the worm
	Outbox chan Packet

	// Identity persisted across reconnects.
	Token string

	// AI-controlled worms are driven by the server each tick.
	AI          bool
	personality AIPersonality

	// connected is true while a human-owned worm has a live websocket.
	// Used to gate AI ticking: bots stay still when no human is online.
	connected bool

	// Ticks the AI has been dead — used to auto-respawn.
	aiDeadTicks int

	// Player-visible state
	Name            string
	Score           int
	lastGrowthScore int
	pendingGrowth   int

	// Dead worms stop ticking; the client gets a GAMEOVER and may RESPAWN.
	killed      bool
	deathReason string
}

func NewWorm() *Worm {
	blocks := make([]Position, WormSize)
	for n := 0; n < cap(blocks); n++ {
		blocks[n] = Position{25, 25}
	}
	return &Worm{
		blocks:    blocks,
		direction: Unknown,
		Outbox:    make(chan Packet, 64),
	}
}

func (w *Worm) Positions() []Position {
	return w.blocks
}

// Head is the leading block — what collides with food and walls.
func (w *Worm) Head() Position {
	return w.blocks[0]
}

func (w *Worm) Killed() bool        { return w.killed }
func (w *Worm) DeathReason() string { return w.deathReason }

// Kill terminates the websocket transport.
func (w *Worm) Kill() {
	close(w.Outbox)
}

func (w *Worm) Channel() chan<- Packet {
	return w.Outbox
}

// AddScore credits points and queues growth that crosses the threshold.
// Returns the number of segments queued by this call.
func (w *Worm) AddScore(points int) int {
	w.Score += points
	grown := 0
	for w.Score-w.lastGrowthScore >= GrowthInterval {
		w.lastGrowthScore += GrowthInterval
		w.pendingGrowth++
		grown++
	}
	return grown
}

// Reset returns the worm to its starting state — used on RESPAWN.
func (w *Worm) Reset() {
	blocks := make([]Position, WormSize)
	for n := range blocks {
		blocks[n] = Position{25, 25}
	}
	w.blocks = blocks
	w.direction = Unknown
	w.inputs = nil
	w.Score = 0
	w.lastGrowthScore = 0
	w.pendingGrowth = 0
	w.killed = false
	w.deathReason = ""
}

// Direction returns the current heading. A freshly-spawned worm picks a
// random starting direction so the game loop always advances.
func (w *Worm) Direction() Direction {
	if w.direction == Unknown {
		choice := make(chan Direction, 1)
		select {
		case choice <- Right:
		case choice <- Left:
		case choice <- Down:
		case choice <- Up:
		}
		w.direction = <-choice
	}
	return w.direction
}

// Move advances the worm one cell in d. The field is a torus: leaving the
// right edge re-enters from the left and so on. The worm only dies from
// running into its own body — wall deaths no longer exist.
func (w *Worm) Move(d Direction) {
	if w.killed {
		return
	}
	if d == Unknown {
		return
	}
	w.direction = d
	next := w.blocks[0]
	switch d {
	case Left:
		next.X--
	case Up:
		next.Y--
	case Right:
		next.X++
	case Down:
		next.Y++
	}

	// Wrap around the playfield instead of dying at the edges.
	if next.X < 0 {
		next.X = Boundary
	} else if next.X > Boundary {
		next.X = 0
	}
	if next.Y < 0 {
		next.Y = Boundary
	} else if next.Y > Boundary {
		next.Y = 0
	}

	// Self-collision. The tail block will vacate this tick if no growth is
	// pending, so colliding with the last block is forgiven in that case.
	checkBlocks := w.blocks
	if w.pendingGrowth == 0 {
		checkBlocks = w.blocks[:len(w.blocks)-1]
	}
	for _, b := range checkBlocks {
		if b == next {
			w.killed = true
			w.deathReason = "Ate yourself"
			return
		}
	}

	if w.pendingGrowth > 0 {
		w.blocks = append([]Position{next}, w.blocks...)
		w.pendingGrowth--
	} else {
		w.blocks = append([]Position{next}, w.blocks[0:len(w.blocks)-1]...)
	}
}
