package flow

import (
	"fmt"
	"log"
	"math/rand/v2"
	"strings"
	"sync"
	"time"
)

func joinNames(names []string) string {
	return strings.Join(names, " & ")
}

// How fast playfields switch packets to clients
const Tick = 200

// DisconnectTTL is how long a human worm lingers in the field after its
// websocket drops, before the playfield removes it. Long enough that a
// browser refresh reconnects to the same snake, short enough that idle
// snakes don't pile up and stall the broadcast layer.
const DisconnectTTL = 5 * time.Second

type Id uint

// The lobby takes care of listing all playfields
type Lobby struct {
	Playfields map[string]*Playfield
	mu         sync.Mutex
}

var lobby = &Lobby{Playfields: make(map[string]*Playfield)}

func (l *Lobby) Playfield(key string) *Playfield {
	l.mu.Lock()
	p, ok := l.Playfields[key]
	if !ok {
		p = NewPlayfield()
		p.Start()
		l.Playfields[key] = p
		log.Printf("New playfield: %s", key)
		// AI bots are added/removed by the playfield itself in response to
		// human population — no pre-spawn here.
	}
	l.mu.Unlock()
	return p
}

// RenameRequest is queued by the server layer when a client sets/changes its
// player name. The playfield goroutine applies it so all worm-state writes are
// single-threaded.
type RenameRequest struct {
	Worm *Worm
	Name string
}

// RespawnRequest is queued by the server layer when a client wants to come
// back from a GAMEOVER.
type RespawnRequest struct {
	Worm *Worm
}

// AttachRequest asks the playfield to either resurrect an existing worm by
// token (refresh / reconnect case) or create a fresh worm. The reply contains
// the *Worm the connection should bind to.
type AttachRequest struct {
	Token string
	Name  string
	Reply chan AttachReply
}

type AttachReply struct {
	Worm *Worm
	Id   Id
}

// ConnState lets the server layer report when a human-owned worm's
// websocket connects or disconnects, so the playfield can decide whether
// to tick AI bots.
type ConnState struct {
	Worm      *Worm
	Connected bool
}

// DirectionRequest carries a client's desired next direction. All worm-state
// writes (including direction) flow through the playfield goroutine so the
// client can never bypass game rules.
type DirectionRequest struct {
	Worm      *Worm
	Direction Direction
}

// A playfield is responsible of communicating between clients
type Playfield struct {
	Movables   map[Movable]Id
	Ticker     *time.Ticker
	Join       chan Movable
	Part       chan Movable
	Broadcast  chan Packet
	Rename     chan RenameRequest
	Respawn    chan RespawnRequest
	Attach     chan AttachRequest
	ConnState  chan ConnState
	MoveCmd    chan DirectionRequest
	LastId     Id
	Foods      map[Id]*Food
	LastFoodId Id

	// Tokens maps a session token to the worm it owns. The worm stays in
	// Movables — the loop always ticks regardless of whether its owner has
	// a live websocket — so disconnect just means the client's view goes
	// stale until it reconnects and we resync.
	Tokens map[string]*Worm

	// pacman is the single hunter on the field while any human is online.
	// nil otherwise. Kept as a direct pointer so the tick's bite phase can
	// reach him without iterating Movables.
	pacman *PacMan
}

func NewPlayfield() *Playfield {
	return &Playfield{
		Movables:  make(map[Movable]Id),
		Ticker:    time.NewTicker(Tick * time.Millisecond),
		Join:      make(chan Movable),
		Part:      make(chan Movable),
		Broadcast: make(chan Packet, 1024),
		Rename:    make(chan RenameRequest, 16),
		Respawn:   make(chan RespawnRequest, 16),
		Attach:    make(chan AttachRequest, 16),
		ConnState: make(chan ConnState, 16),
		MoveCmd:   make(chan DirectionRequest, 32),
		LastId:    0,
		Foods:     make(map[Id]*Food),
		Tokens:    make(map[string]*Worm),
	}
}

// occupied returns positions currently blocked (worm bodies + existing
// food + Pac-Man's footprint). Pac-Man isn't a Movable so he has to be
// added explicitly; without this, food could spawn under him.
func (p *Playfield) occupied() map[Position]struct{} {
	out := make(map[Position]struct{})
	for m := range p.Movables {
		for _, pos := range m.Positions() {
			out[pos] = struct{}{}
		}
	}
	if p.pacman != nil {
		for _, c := range p.pacman.Footprint() {
			out[c] = struct{}{}
		}
	}
	for _, f := range p.Foods {
		out[f.Position] = struct{}{}
	}
	return out
}

// MaxActiveBombs caps how many bombs may exist on the field at once. Without
// this, repeated rolls of `Bomb` would gradually replace every fruit until
// the player has nothing edible to chase.
const MaxActiveBombs = 2

// spawnFood adds a new food item to the field. Returns the spawned food
// so callers can broadcast it (or send privately on initial state delivery).
// If the random roll would push the bomb count past MaxActiveBombs, the
// spawn is forced to a fruit instead so the field always has something
// rewarding to eat.
func (p *Playfield) spawnFood() Food {
	p.LastFoodId++
	bombs := 0
	for _, f := range p.Foods {
		if f.Type == Bomb {
			bombs++
		}
	}
	f := randomFood(p.LastFoodId, p.occupied())
	if f.Type == Bomb && bombs >= MaxActiveBombs {
		if rand.IntN(2) == 0 {
			f.Type = Apple
		} else {
			f.Type = Carrot
		}
	}
	p.Foods[f.Id] = &f
	return f
}

func foodPacket(f Food) Packet {
	return Packet{
		Command: "FOOD",
		Payload: FoodPayload{
			Id:     f.Id,
			X:      f.Position.X,
			Y:      f.Position.Y,
			Type:   f.Type,
			Points: f.Points(),
		},
	}
}

func scorePacket(id Id, w *Worm) Packet {
	return Packet{
		Command: "SCORE",
		Payload: ScorePayload{WormId: id, Name: w.Name, Score: w.Score},
	}
}

// placeAt sets every block of w to pos so the worm starts (or respawns) at
// a single cell. Used together with safeSpawn.
func placeAt(w *Worm, pos Position) {
	for i := range w.blocks {
		w.blocks[i] = pos
	}
}

// safeSpawn picks a random cell that's clear of every worm body and at least
// minHeadDistance manhattan-cells away from every living worm's head, so a
// newcomer can't be eaten in the first tick or two.
func (p *Playfield) safeSpawn() Position {
	const minHeadDistance = 6

	occupied := map[Position]struct{}{}
	heads := make([]Position, 0, len(p.Movables))
	for m := range p.Movables {
		w, ok := m.(*Worm)
		if !ok || w.killed {
			continue
		}
		for _, b := range w.blocks {
			occupied[b] = struct{}{}
		}
		heads = append(heads, w.Head())
	}

	// First pass: insist on the head-distance buffer.
	for tries := 0; tries < 200; tries++ {
		pos := Position{X: rand.IntN(Boundary + 1), Y: rand.IntN(Boundary + 1)}
		if _, blocked := occupied[pos]; blocked {
			continue
		}
		ok := true
		for _, h := range heads {
			if manhattan(pos, h) < minHeadDistance {
				ok = false
				break
			}
		}
		if ok {
			return pos
		}
	}
	// Fallback: any empty cell at all.
	for tries := 0; tries < 200; tries++ {
		pos := Position{X: rand.IntN(Boundary + 1), Y: rand.IntN(Boundary + 1)}
		if _, blocked := occupied[pos]; !blocked {
			return pos
		}
	}
	// Last resort — shouldn't be reachable on a 50×50 field.
	return Position{X: rand.IntN(Boundary + 1), Y: rand.IntN(Boundary + 1)}
}

// MinPlayers is the total player count (humans + bots) the playfield tops
// itself up to whenever at least one human is connected. With this set to 4,
// a lone human gets 3 bot rivals, three humans get 1 bot, and four or more
// humans get no bots at all.
const MinPlayers = 4

// aiTargetCount returns how many AI bots the playfield should currently host
// based on how many human worms are connected. With no humans there are no
// bots (no point burning ticks). With humans present, top up to MinPlayers
// so the field always feels populated.
func (p *Playfield) aiTargetCount() int {
	humans := 0
	for m := range p.Movables {
		if w, ok := m.(*Worm); ok && !w.AI && w.connected {
			humans++
		}
	}
	if humans == 0 {
		return 0
	}
	target := MinPlayers - humans
	if target < 0 {
		return 0
	}
	return target
}

// reconcilePopulation nudges the AI roster toward aiTargetCount and the
// Pac-Man hunter toward "present iff a human is online". Called whenever
// the human roster changes (ConnState / stale-sweep). Bots and Pac-Man
// share the same lifetime trigger because both are pointless on an empty
// field.
func (p *Playfield) reconcilePopulation() {
	currentAIs := make([]*Worm, 0, 4)
	for m := range p.Movables {
		if w, ok := m.(*Worm); ok && w.AI {
			currentAIs = append(currentAIs, w)
		}
	}
	target := p.aiTargetCount()
	for i := len(currentAIs); i < target; i++ {
		p.spawnAI()
	}
	for i := target; i < len(currentAIs); i++ {
		p.removeMovable(currentAIs[i])
	}
	p.reconcilePacMan()
}

// reconcilePacMan spawns or despawns the single Pac-Man hunter to match the
// "any human online" predicate. Pac-Man's presence is tied to humans the
// same way AI worms are — no point hunting when the field is empty.
func (p *Playfield) reconcilePacMan() {
	wantPacMan := false
	for m := range p.Movables {
		if w, ok := m.(*Worm); ok && !w.AI && w.connected {
			wantPacMan = true
			break
		}
	}
	if wantPacMan && p.pacman == nil {
		p.spawnPacMan()
	} else if !wantPacMan && p.pacman != nil {
		p.Broadcast <- Packet{Command: "PACMAN_KILL"}
		p.pacman = nil
	}
}

// spawnPacMan places a fresh Pac-Man on a safe anchor (his whole 2x2
// footprint clear of worm bodies, and far enough from every worm head
// that no worm gets a first-tick freebie bite) and broadcasts the
// initial PACMAN packet so clients render him before the next tick.
func (p *Playfield) spawnPacMan() {
	pm := NewPacMan(p.safePacManAnchor())
	p.pacman = pm
	p.Broadcast <- pacManPacket(pm)
}

// safePacManAnchor returns an anchor cell whose 2x2 footprint is clear of
// every worm body and at least minHeadDistance manhattan-cells from each
// worm head. Mirrors safeSpawn (which is single-cell), but extended to
// the full footprint so a freshly spawned Pac-Man doesn't bite on the
// first tick.
func (p *Playfield) safePacManAnchor() Position {
	const minHeadDistance = 6

	bodies := map[Position]struct{}{}
	heads := make([]Position, 0, len(p.Movables))
	for m := range p.Movables {
		w, ok := m.(*Worm)
		if !ok || w.killed {
			continue
		}
		for _, b := range w.blocks {
			bodies[b] = struct{}{}
		}
		heads = append(heads, w.Head())
	}

	footprintClear := func(anchor Position) bool {
		for _, c := range footprintAt(anchor) {
			if _, hit := bodies[c]; hit {
				return false
			}
			for _, h := range heads {
				if manhattan(c, h) < minHeadDistance {
					return false
				}
			}
		}
		return true
	}

	for tries := 0; tries < 200; tries++ {
		anchor := Position{X: rand.IntN(Boundary + 1), Y: rand.IntN(Boundary + 1)}
		if footprintClear(anchor) {
			return anchor
		}
	}
	// Fallback: drop the head-distance constraint but still avoid body
	// overlap, so the spawn at least doesn't start mid-worm.
	for tries := 0; tries < 200; tries++ {
		anchor := Position{X: rand.IntN(Boundary + 1), Y: rand.IntN(Boundary + 1)}
		ok := true
		for _, c := range footprintAt(anchor) {
			if _, hit := bodies[c]; hit {
				ok = false
				break
			}
		}
		if ok {
			return anchor
		}
	}
	// Last resort: scan the field deterministically and return the
	// first body-clear anchor. Shouldn't be reachable on a 50x50 field
	// (would require every 2x2 window to overlap a worm body), but if
	// it ever is, do NOT return an unconstrained random anchor: that
	// would defeat the entire purpose of this function and bite a
	// worm on tick 0. The first body-clear cell is always safe enough.
	for y := 0; y <= Boundary; y++ {
		for x := 0; x <= Boundary; x++ {
			anchor := Position{X: x, Y: y}
			clear := true
			for _, c := range footprintAt(anchor) {
				if _, hit := bodies[c]; hit {
					clear = false
					break
				}
			}
			if clear {
				return anchor
			}
		}
	}
	// Field is fully occupied by worm bodies (mathematically impossible
	// on a 50x50 field with bounded worm counts). Return origin as a
	// safety net rather than a random unsafe anchor; spawnPacMan's
	// caller can detect-and-skip if this proves a problem.
	return Position{}
}

func pacManPacket(pm *PacMan) Packet {
	return Packet{
		Command: "PACMAN",
		Payload: PacManPayload{
			X:         pm.pos.X,
			Y:         pm.pos.Y,
			Direction: pm.Direction().String(),
		},
	}
}

// spawnAI inserts a fresh AI bot into the playfield with a unique
// random-seeded persona and a randomized starting cell.
func (p *Playfield) spawnAI() {
	personality := newPersonality()
	// Avoid colliding with an existing token (extremely unlikely, but safe).
	for _, exists := p.Tokens[personality.Name]; exists; _, exists = p.Tokens[personality.Name] {
		personality = newPersonality()
	}
	w := NewWorm()
	w.AI = true
	w.personality = personality
	w.Name = personality.Name
	w.Token = personality.Name
	placeAt(w, p.safeSpawn())
	p.Tokens[w.Token] = w
	id := p.addMovable(w)
	p.announceJoin(w, id)
}

// addMovable registers a movable in the map and assigns it an id.
// The Join channel handler also calls announceJoin afterwards to send
// the welcome packet and broadcast initial state.
func (p *Playfield) addMovable(m Movable) Id {
	p.LastId++
	id := p.LastId
	p.Movables[m] = id
	log.Print("New movable id:", id)
	return id
}

// announceJoin sends a welcome packet to the new movable and broadcasts
// the field's current state. Called after addMovable from the Join handler.
func (p *Playfield) announceJoin(m Movable, id Id) {
	w, ok := m.(*Worm)
	if !ok {
		return
	}
	if w.Name == "" {
		w.Name = fmt.Sprintf("Worm-%d", id)
	}
	// Seed the field with food on first join so a single player has
	// something to chase. Done before the AI short-circuit below so an
	// AI-only first join still populates the field.
	for len(p.Foods) < FoodCount {
		f := p.spawnFood()
		p.Broadcast <- foodPacket(f)
	}
	if w.AI {
		// AI worms have no consumer draining their Outbox; the broadcast
		// fan-out skips them too. The catch-up WELCOME / food / score /
		// PACMAN sends below would fill the 64-slot buffer and block the
		// playfield goroutine. Only the join announcement to other
		// players is needed.
		p.Broadcast <- scorePacket(id, w)
		return
	}
	// Tell the new client who it is.
	w.Outbox <- Packet{Command: "WELCOME", Payload: WelcomePayload{
		Id:          id,
		Name:        w.Name,
		Token:       w.Token,
		Dead:        w.killed,
		DeathReason: w.deathReason,
		Score:       w.Score,
	}}
	// Catch the new client up on current state.
	for _, f := range p.Foods {
		w.Outbox <- foodPacket(*f)
	}
	for other, otherId := range p.Movables {
		if ow, ok := other.(*Worm); ok {
			w.Outbox <- scorePacket(otherId, ow)
		}
	}
	if p.pacman != nil {
		w.Outbox <- pacManPacket(p.pacman)
	}
	// Announce the new player to everyone (including itself).
	p.Broadcast <- scorePacket(id, w)
}

func (p *Playfield) removeMovable(m Movable) {
	log.Print("Deleting movable", m)
	m.Kill()
	p.Broadcast <- Packet{Command: "KILL", Payload: fmt.Sprintf("%d", p.Movables[m])}
	delete(p.Movables, m)
	if w, ok := m.(*Worm); ok && w.Token != "" {
		delete(p.Tokens, w.Token)
	}
}

// resyncWorm flushes any stale packets and re-pushes the worm's view of the
// world to its outbox. Used when a client reconnects with a known token.
// Defensive no-op on AI worms (which lack a token-based reconnect path)
// so an unexpected match never blocks the playfield goroutine on the
// undrained AI Outbox.
func (p *Playfield) resyncWorm(w *Worm, id Id) {
	if w.AI {
		return
	}
	for {
		select {
		case <-w.Outbox:
		default:
			goto drained
		}
	}
drained:
	w.Outbox <- Packet{Command: "WELCOME", Payload: WelcomePayload{
		Id:          id,
		Name:        w.Name,
		Token:       w.Token,
		Dead:        w.killed,
		DeathReason: w.deathReason,
		Score:       w.Score,
	}}
	for _, f := range p.Foods {
		w.Outbox <- foodPacket(*f)
	}
	for other, otherId := range p.Movables {
		if ow, ok := other.(*Worm); ok {
			w.Outbox <- scorePacket(otherId, ow)
		}
	}
	if p.pacman != nil {
		w.Outbox <- pacManPacket(p.pacman)
	}
	// GAMEOVER state travels in WELCOME above — no separate packet needed
	// (and avoids racing the client's hideGameOver in the welcome handler).
}

// tick runs one game-loop step: advance every active worm, detect death from
// walls / self / other snakes, then broadcast MOVE for survivors and GAMEOVER
// for any newly-dead worm.
func (p *Playfield) tick() {
	// First, sweep human worms whose owners have been disconnected past the
	// TTL. With wrap-around they never die naturally, so without this they'd
	// accumulate forever and stall announceJoin's per-worm SCORE writes.
	now := time.Now()
	var stale []Movable
	for m := range p.Movables {
		w, ok := m.(*Worm)
		if !ok || w.AI || w.connected {
			continue
		}
		if !w.disconnectedAt.IsZero() && now.Sub(w.disconnectedAt) > DisconnectTTL {
			stale = append(stale, m)
		}
	}
	if len(stale) > 0 {
		for _, m := range stale {
			p.removeMovable(m)
		}
		p.reconcilePopulation()
	}

	// AI bots only run while a human has a live websocket — keeps them from
	// growing out of reach in an empty field.
	anyHumanOnline := false
	for m := range p.Movables {
		if w, ok := m.(*Worm); ok && !w.AI && w.connected {
			anyHumanOnline = true
			break
		}
	}

	type death struct {
		id     Id
		reason string
	}
	var deaths []death

	// Snapshot every living worm's pre-move head cell, so the Pac-Man bite
	// phase can detect a head-on swap (worm head and Pac-Man trading cells).
	prevHeads := map[*Worm]Position{}
	for m := range p.Movables {
		if w, ok := m.(*Worm); ok && !w.killed && len(w.blocks) > 0 {
			prevHeads[w] = w.Head()
		}
	}

	// Phase 1: move every living worm. Wall and self-collision deaths are
	// captured by Move; record them so we can broadcast GAMEOVER at the end.
	for m, id := range p.Movables {
		w, isWorm := m.(*Worm)
		if isWorm && w.killed {
			if w.AI {
				w.aiDeadTicks++
				if w.aiDeadTicks >= 10 {
					w.Reset()
					w.aiDeadTicks = 0
					p.Broadcast <- scorePacket(id, w)
				}
			}
			continue
		}
		if isWorm && w.AI && !anyHumanOnline {
			continue
		}
		if isWorm && w.AI {
			w.direction = pickAIDirection(w, p)
		} else if isWorm && len(w.inputs) > 0 {
			// Pop the next queued input; one direction change per tick.
			w.direction = w.inputs[0]
			w.inputs = w.inputs[1:]
		}
		m.Move(m.Direction())
		if isWorm && w.killed {
			deaths = append(deaths, death{id, w.deathReason})
		}
	}

	// Phase 1b: move Pac-Man after worms so his AI reacts to where they
	// just landed, not where they came from. Skipped if no humans are
	// online (he despawns then anyway via reconcilePacMan, but the guard
	// keeps the tick cheap during the brief window before despawn lands).
	if p.pacman != nil && anyHumanOnline {
		p.pacman.Move(pickPacManDirection(p.pacman, p))
	}

	// Phase 2: snake-on-snake — slither.io-style rules.
	//   - If 2+ worms have heads at the same cell, they all die (head-on).
	//   - Otherwise, if a worm's head crashes into another worm's body,
	//     the *head's* owner dies (your body is a hazard to anyone who
	//     touches it with their head). This is the inverse of "eating from
	//     the side", which removes the entire skill of body positioning.
	headsAt := map[Position][]*Worm{}
	bodies := map[Position]*Worm{}
	for m := range p.Movables {
		w, ok := m.(*Worm)
		if !ok || w.killed {
			continue
		}
		for i, b := range w.blocks {
			if i == 0 {
				headsAt[b] = append(headsAt[b], w)
			} else {
				bodies[b] = w
			}
		}
	}
	for _, worms := range headsAt {
		if len(worms) < 2 {
			continue
		}
		names := make([]string, 0, len(worms))
		for _, w := range worms {
			names = append(names, w.Name)
		}
		reason := "Head-on collision (" + joinNames(names) + ")"
		for _, w := range worms {
			if w.killed {
				continue
			}
			w.killed = true
			w.deathReason = reason
			deaths = append(deaths, death{p.Movables[w], w.deathReason})
		}
	}
	for m, id := range p.Movables {
		w, ok := m.(*Worm)
		if !ok || w.killed {
			continue
		}
		head := w.Head()
		owner, hit := bodies[head]
		if !hit || owner == w {
			continue
		}
		w.killed = true
		w.deathReason = "Crashed into " + owner.Name
		deaths = append(deaths, death{id, w.deathReason})
	}

	// Phase 2b: Pac-Man bite. May kill (head bite) or truncate (body bite)
	// at most one worm per tick. Broadcast BITE for the body case after we
	// know which segments were lost; head bite falls through to the regular
	// GAMEOVER broadcast. Gated on anyHumanOnline to match Phase 1b/3b:
	// Pac-Man doesn't move or broadcast in human-less ticks, so he must
	// not bite either (otherwise stationary Pac-Man could still kill AI
	// worms in the gap before reconcilePacMan despawns him).
	var bitePackets []Packet
	if p.pacman != nil && anyHumanOnline {
		bittenWorm, segIdx, lost := resolvePacManBite(p.pacman, prevHeads, p)
		if bittenWorm != nil {
			id := p.Movables[bittenWorm]
			if segIdx == 0 {
				deaths = append(deaths, death{id, bittenWorm.deathReason})
			} else {
				bitePackets = append(bitePackets, Packet{
					Command: "BITE",
					Payload: BitePayload{
						WormId:        id,
						SegmentIndex:  segIdx,
						LostPositions: lost,
					},
				})
				// Score-bar redraw — points unchanged, but clients can
				// react (e.g., name flash) on the SCORE packet too.
				p.Broadcast <- scorePacket(id, bittenWorm)
			}
		}
	}

	// Phase 3: broadcast MOVE for living worms.
	for m, id := range p.Movables {
		w, isWorm := m.(*Worm)
		if isWorm && w.killed {
			continue
		}
		if isWorm && w.AI && !anyHumanOnline {
			// Frozen at spawn; no need to renotify clients each tick.
			continue
		}
		p.Broadcast <- Packet{
			Command: "MOVE",
			Payload: MovePayload{Id: id, Positions: m.Positions()},
		}
	}

	// Phase 3b: broadcast Pac-Man's current cell + facing. One packet per
	// tick while Pac-Man is alive; clients tween the cell-step the same
	// way they tween worm bodies.
	if p.pacman != nil && anyHumanOnline {
		p.Broadcast <- pacManPacket(p.pacman)
	}

	// Phase 4: announce deaths.
	for _, d := range deaths {
		p.Broadcast <- Packet{
			Command: "GAMEOVER",
			Payload: GameOverPayload{WormId: d.id, Reason: d.reason},
		}
	}

	// Phase 4b: bite events (non-fatal). Issued after MOVE so the client
	// already has the post-bite positions; the BITE packet only drives
	// the puff-of-particles effect.
	for _, pkt := range bitePackets {
		p.Broadcast <- pkt
	}

	// Phase 5: food pickups (head must be alive to count).
	p.resolveFoodCollisions()
}

// resolveFoodCollisions checks each living worm's head against every food.
// On a fruit match: credit score, broadcast EAT/SCORE. On a bomb match:
// the worm dies; broadcast EAT/GAMEOVER instead. Either way the food is
// removed and a replacement spawned so the field stays full.
func (p *Playfield) resolveFoodCollisions() {
	for m, id := range p.Movables {
		w, ok := m.(*Worm)
		if !ok || w.killed {
			continue
		}
		head := w.Head()
		for fid, f := range p.Foods {
			if head != f.Position {
				continue
			}
			delete(p.Foods, fid)
			p.Broadcast <- Packet{Command: "EAT", Payload: EatPayload{FoodId: fid, WormId: id}}
			if f.Type == Bomb {
				w.killed = true
				w.deathReason = "Stepped on a bomb"
				p.Broadcast <- Packet{
					Command: "GAMEOVER",
					Payload: GameOverPayload{WormId: id, Reason: w.deathReason},
				}
			} else {
				w.AddScore(f.Points())
				p.Broadcast <- scorePacket(id, w)
			}
			nf := p.spawnFood()
			p.Broadcast <- foodPacket(nf)
			break
		}
	}
}

func (p *Playfield) Start() {
	log.Println("Playfield starting")
	go func() {
		for {
			select {
			case m := <-p.Join:
				id := p.addMovable(m)
				p.announceJoin(m, id)
			case m := <-p.Part:
				p.removeMovable(m)
			case req := <-p.Attach:
				if existing, ok := p.Tokens[req.Token]; ok && req.Token != "" {
					id := p.Movables[existing]
					p.resyncWorm(existing, id)
					req.Reply <- AttachReply{Worm: existing, Id: id}
					break
				}
				w := NewWorm()
				w.Token = req.Token
				if req.Name != "" {
					w.Name = req.Name
				}
				placeAt(w, p.safeSpawn())
				p.Tokens[w.Token] = w
				id := p.addMovable(w)
				p.announceJoin(w, id)
				req.Reply <- AttachReply{Worm: w, Id: id}
			case req := <-p.Rename:
				req.Worm.Name = req.Name
				if id, ok := p.Movables[req.Worm]; ok {
					p.Broadcast <- scorePacket(id, req.Worm)
				}
			case s := <-p.ConnState:
				s.Worm.connected = s.Connected
				if s.Connected {
					s.Worm.disconnectedAt = time.Time{}
				} else {
					s.Worm.disconnectedAt = time.Now()
				}
				p.reconcilePopulation()
			case req := <-p.MoveCmd:
				w := req.Worm
				if w.killed || req.Direction == Unknown {
					break
				}
				// What direction will the worm be heading *after* the queue
				// has drained? Each new input is U-turn-checked against that,
				// not the live direction.
				lastQueued := w.direction
				if n := len(w.inputs); n > 0 {
					lastQueued = w.inputs[n-1]
				}
				if opposite(req.Direction) == lastQueued && lastQueued != Unknown {
					break
				}
				// No-op if the user is re-pressing what's already next.
				if req.Direction == lastQueued {
					break
				}
				// Cap the buffer so a key-masher can't queue up a long combo.
				const maxQueued = 3
				if len(w.inputs) >= maxQueued {
					w.inputs = w.inputs[1:]
				}
				w.inputs = append(w.inputs, req.Direction)
			case <-p.Ticker.C:
				p.tick()
			case req := <-p.Respawn:
				req.Worm.Reset()
				placeAt(req.Worm, p.safeSpawn())
				id, ok := p.Movables[req.Worm]
				if !ok {
					break
				}
				req.Worm.Outbox <- Packet{
					Command: "WELCOME",
					Payload: WelcomePayload{Id: id, Name: req.Worm.Name, Token: req.Worm.Token},
				}
				p.Broadcast <- scorePacket(id, req.Worm)
			case packet := <-p.Broadcast:
				for m, id := range p.Movables {
					// AI worms have no websocket consumer draining their
					// Outbox, so writes would just fill the buffer and then
					// log "Could not send packet" forever.
					if w, ok := m.(*Worm); ok && w.AI {
						continue
					}
					c := m.Channel()
					select {
					case c <- packet:
					default:
						log.Print("Could not send packet to movable:", id)
					}
				}
			}
		}
	}()
}

func (p *Playfield) Stop() {
	p.Ticker.Stop()
}
