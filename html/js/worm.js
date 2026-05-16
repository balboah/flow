(function(){

	// Server tick interval. The worm interpolates each part from its previous
	// to its new cell over this window so motion reads as smooth slide rather
	// than discrete cell-step.
	var TICK_MS = 200;

	function randomColor() {
		return Math.round(50 + Math.random() * 150);
	}

	// stepDelta returns the signed one-cell delta from `from` to `to` along
	// each axis. The field wraps so a delta of magnitude > 1 means the cells
	// are adjacent across an edge; we flip the sign in that case so the
	// returned delta always represents the *actual* one-cell step.
	function stepDelta(from, to) {
		var dx = to.X - from.X;
		var dy = to.Y - from.Y;
		if (dx > 1)  dx = -1;
		if (dx < -1) dx = 1;
		if (dy > 1)  dy = -1;
		if (dy < -1) dy = 1;
		return {dx: dx, dy: dy};
	}

	// pixelFor mirrors the legacy "visible cell" placement: the body part
	// occupies the cell between `curr` and `next`. After a wrap step the pair
	// straddles an edge — render at `curr` itself so the part lives on the
	// near side instead of jumping across the field.
	function pixelFor(curr, next, grid) {
		var wrapped = Math.abs(next.X - curr.X) > 1 || Math.abs(next.Y - curr.Y) > 1;
		if (wrapped) {
			return {x: curr.X * grid, y: curr.Y * grid};
		}
		return {
			x: (curr.X <= next.X ? curr.X : next.X + 1) * grid,
			y: (curr.Y <= next.Y ? curr.Y : next.Y + 1) * grid
		};
	}

	// A Worm is pure state now — sprite atlas frame indices plus per-part
	// pixel positions, tweened between server ticks. Rendering reads this
	// state from Field's render loop; no Kinetic node graph is held here.
	var Worm = function(id, flow) {
		this.id = id;
		this.flow = flow;
		this.color = 'rgb(' + randomColor() + ',' + randomColor() + ',' + randomColor() + ')';

		// Per visible body part: {x, y, frame, visible}. x/y are pixel
		// coords in the worm's own coordinate space (continuous for the
		// local player, raw cell coords for remotes). frame indexes into
		// Field.SPRITE_SRC (0..19 over the 4×5 atlas).
		this.parts = [];

		// The current player's worm always renders as the rainbow atlas
		// (worm-3.png) so the player can spot themselves at a glance.
		// Other worms cycle through blue / gray, deterministic per id so
		// they don't shuffle on reload.
		var isLocal = window.game && game.hud && id === game.hud.ownId;
		var otherAtlases = [2, 1];
		this.type = isLocal ? 3 : otherAtlases[(id - 1) % otherAtlases.length];

		// Local player uses continuous (non-wrapping) cell coordinates so
		// crossing a field edge does not produce a visible jump. The camera
		// then tracks the head's continuous position and the world stays
		// centred on the player. Remote worms render in server cell coords
		// (they wrap visibly) and the renderer compensates by drawing them
		// at all 9 tile offsets.
		this.useContinuous = !!isLocal;

		// The sprite atlas loads async. If it finishes after the rAF loop
		// has already settled (no worms tweening, no particles), nothing
		// would repaint until the next server MOVE wakes the loop — leaving
		// a freshly-spawned worm invisible for up to a tick. Wake the loop
		// on load to paint the first frame as soon as pixels are available.
		var self = this;
		this.image = new Image();
		this.image.onload = function() {
			if (self.flow && self.flow.requestAnimation) self.flow.requestAnimation();
		};
		this.image.src = '/img/worm-' + this.type + '.png';
	};

	Worm.prototype.split = function(count) {
		while (this.parts.length < count) {
			this.parts.push({x: 0, y: 0, frame: 0, visible: true});
		}
	};

	// move records the new server-authoritative cells for each visible body
	// part, snapshots where each part currently is on screen, and asks the
	// Field to keep its rAF loop running. `tick` then lerps the part
	// positions from where they are to where they should be over TICK_MS.
	Worm.prototype.move = function(positions) {
		this.lastPositions = positions;

		var grid = this.flow.options.grid;
		var l = positions.length - 1;
		this.split(l);
		if (l <= 0) {
			// No visible parts to tween — clear stale tween state so a
			// later tick() cannot operate on dead positions.
			this.startPx = null;
			this.endPx = null;
			this.visualPx = null;
			this.continuousCells = null;
			this.targetCells = null;
			return;
		}

		var prevTargetCells = this.targetCells;
		var prevContinuous = this.continuousCells;
		var prevLen = prevTargetCells ? prevTargetCells.length : 0;
		var sameLen = (prevLen === positions.length);
		// Growth = length grew by exactly 1 (the worm ate). The brand-new
		// tail slot inherits its continuous coord from the old tail because
		// the new tail's cell == the old tail's cell (pendingGrowth keeps
		// the tail in place for one tick). Without this, after a wrap the
		// new tail would re-initialize to its raw server cell and visibly
		// teleport back into [0, cols) every grow tick.
		var growth = (prevLen > 0) && (positions.length === prevLen + 1);

		// For the local player track continuous (non-wrapping) cell coords
		// per slot. Each slot advances by stepDelta from its previous
		// server cell — a single-cell step even across a wrap, so the
		// visual never jumps. Remote worms use server cells directly (and
		// may visibly wrap, accepted v1 tradeoff).
		var renderCells;
		var newContinuous = null;
		var i;
		if (this.useContinuous) {
			newContinuous = new Array(positions.length);
			for (i = 0; i < positions.length; i++) {
				if ((sameLen || (growth && i < prevLen)) && prevContinuous && i < prevContinuous.length) {
					var d = stepDelta(prevTargetCells[i], positions[i]);
					newContinuous[i] = {
						X: prevContinuous[i].X + d.dx,
						Y: prevContinuous[i].Y + d.dy
					};
				} else if (growth && i === prevLen && prevContinuous && prevLen > 0) {
					newContinuous[i] = {
						X: prevContinuous[prevLen - 1].X,
						Y: prevContinuous[prevLen - 1].Y
					};
				} else {
					newContinuous[i] = {X: positions[i].X, Y: positions[i].Y};
				}
			}
			renderCells = newContinuous;
		} else {
			renderCells = positions;
		}

		// Target pixel for each visible body part. pixelFor is wrap-aware
		// but with continuous coords the wrap branch never fires (deltas
		// are always |1| or 0).
		var endPx = new Array(l);
		for (i = 0; i < l; i++) {
			endPx[i] = pixelFor(renderCells[i], renderCells[i + 1], grid);
		}

		// startPx: where this tween begins per part. Parts that existed
		// last frame still have a prior visual position and tween from
		// there. Only a brand-new tail (no prior visual at its index)
		// snaps to its end pixel. Cell-tracked remote worms also snap
		// when the server cell jumped >1 (wrap) so they don't slide all
		// the way across the field.
		var startPx = new Array(l);
		for (i = 0; i < l; i++) {
			var hasMyVisual = !!this.visualPx && i < this.visualPx.length;
			var snap = !hasMyVisual;
			if (!snap && !this.useContinuous && prevTargetCells && i < prevTargetCells.length) {
				var dxRaw = positions[i].X - prevTargetCells[i].X;
				var dyRaw = positions[i].Y - prevTargetCells[i].Y;
				if (Math.abs(dxRaw) > 1 || Math.abs(dyRaw) > 1) snap = true;
			}
			if (snap) {
				startPx[i] = {x: endPx[i].x, y: endPx[i].y};
				this.parts[i].x = endPx[i].x;
				this.parts[i].y = endPx[i].y;
			} else {
				startPx[i] = {x: this.visualPx[i].x, y: this.visualPx[i].y};
			}
		}

		this.startPx = startPx;
		this.endPx = endPx;
		this.visualPx = startPx.map(function(p){ return {x: p.x, y: p.y}; });
		this.tweenStart = performance.now();
		this.tweenDur = TICK_MS;
		this.targetCells = positions.map(function(c){ return {X: c.X, Y: c.Y}; });
		this.continuousCells = newContinuous;

		// Renormalise the local player's continuous coord back into the
		// canonical [0, cols) × [0, rows) range whenever the head crosses
		// a tile boundary. The world is tiled 3×3 (-1, 0, 1) around the
		// base; without renorm the camera would eventually pan past the
		// tile arrangement into empty space after a few wraps. Because
		// every tile renders identical content, the renorm shift is
		// visually imperceptible.
		if (this.useContinuous && newContinuous && newContinuous[0]) {
			var cols = this.flow.options.cols;
			var rows = this.flow.options.rows;
			var shiftX = Math.floor(newContinuous[0].X / cols) * cols;
			var shiftY = Math.floor(newContinuous[0].Y / rows) * rows;
			if (shiftX !== 0 || shiftY !== 0) this.rebase(shiftX, shiftY);
		}

		// Sprite frames (head/body/tail direction + corners) snap to the
		// new orientation immediately — only translation is tweened.
		for (i = 0; i < l; i++) {
			var c = positions[i];
			var n = positions[i + 1];
			var p = positions[i - 1];
			var part = this.parts[i];
			part.x = startPx[i].x;
			part.y = startPx[i].y;

			if (i === 0) {
				part.frame = headFrame(c, n);
				part.visible = true;
			} else {
				part.visible = (c.X !== p.X || c.Y !== p.Y);
				if (i === l - 1) part.frame = tailFrame(c, p);
				else              part.frame = bodyFrame(c, p, n);
			}
		}

		if (this.flow.requestAnimation) this.flow.requestAnimation();
	};

	// tick advances the active tween by one rAF step. Returns true while
	// the tween is still in progress so the Field driver knows to keep
	// looping.
	Worm.prototype.tick = function(now) {
		if (!this.startPx) return false;
		var t = (now - this.tweenStart) / this.tweenDur;
		var done = t >= 1;
		if (t > 1) t = 1;
		if (t < 0) t = 0;

		var l = this.startPx.length;
		for (var i = 0; i < l; i++) {
			var sx = this.startPx[i].x, sy = this.startPx[i].y;
			var ex = this.endPx[i].x, ey = this.endPx[i].y;
			var x = sx + (ex - sx) * t;
			var y = sy + (ey - sy) * t;
			this.visualPx[i].x = x;
			this.visualPx[i].y = y;
			// Pixel-snap so adjacent body sprites share an exact edge
			// instead of sub-pixel positions that produce alpha-blend
			// seams between segments mid-tween.
			this.parts[i].x = Math.round(x);
			this.parts[i].y = Math.round(y);
		}
		return !done;
	};

	// Direction → sprite frame mappings. Sprite layout (worm.js comment in
	// the original Kinetic version): 0 head-left, 1 head-up, 2 head-down,
	// 3 head-right, 4..7 corners, 8 tail-left, 9 tail-up, 10 tail-down,
	// 11 tail-right, 12 body-horizontal, 13 body-vertical.
	function headFrame(curr, next) {
		var d = stepDelta(curr, next);
		if (d.dx === 0) {
			if (d.dy > 0) return 1;       // head up
			if (d.dy < 0) return 2;       // head down
		} else {
			if (d.dx > 0) return 0;       // head left
			if (d.dx < 0) return 3;       // head right
		}
		return 0;
	}

	function tailFrame(curr, prev) {
		var d = stepDelta(curr, prev);
		if (d.dx === 0) {
			if (d.dy < 0) return 9;       // tail up
			if (d.dy > 0) return 10;      // tail down
		} else {
			if (d.dx < 0) return 8;       // tail left
			if (d.dx > 0) return 11;      // tail right
		}
		return 8;
	}

	function bodyFrame(curr, prev, next) {
		var p = stepDelta(prev, curr);
		var n = stepDelta(next, curr);
		if (p.dy === 0 && n.dy === 0) return 12;
		if (p.dx === 0 && n.dx === 0) return 13;
		// Corner pieces — each matches two symmetric (prev, next) layouts.
		if ((p.dx === 0 && p.dy === -1 && n.dx === 1 && n.dy === 0) ||
			(p.dx === 1 && p.dy === 0 && n.dx === 0 && n.dy === -1)) return 4;
		if ((p.dx === 0 && p.dy === -1 && n.dx === -1 && n.dy === 0) ||
			(p.dx === -1 && p.dy === 0 && n.dx === 0 && n.dy === -1)) return 5;
		if ((p.dx === 0 && p.dy === 1 && n.dx === 1 && n.dy === 0) ||
			(p.dx === 1 && p.dy === 0 && n.dx === 0 && n.dy === 1)) return 6;
		if ((p.dx === 0 && p.dy === 1 && n.dx === -1 && n.dy === 0) ||
			(p.dx === -1 && p.dy === 0 && n.dx === 0 && n.dy === 1)) return 7;
		return 12;
	}

	// previewDirection rotates the head sprite to face `dirName`
	// immediately, without waiting for the server to confirm. The next
	// MOVE packet's move() will overwrite this preview based on the
	// actual cell delta (so a server-rejected U-turn snaps back). Pure
	// client-side feedback — the worm doesn't actually move until the
	// server says so.
	Worm.prototype.previewDirection = function(dirName) {
		if (!this.parts || !this.parts[0]) return;
		var frame;
		switch (dirName) {
			case 'LEFT':  frame = 0; break;
			case 'UP':    frame = 1; break;
			case 'DOWN':  frame = 2; break;
			case 'RIGHT': frame = 3; break;
			default: return;
		}
		this.parts[0].frame = frame;
	};

	Worm.prototype.kill = function() {
		this.startPx = null;
		this.endPx = null;
		this.visualPx = null;
		this.parts = [];
		delete this.flow;
	};

	// rebase shifts the worm's continuous + pixel state by (shiftCellsX,
	// shiftCellsY) cells. Called when the head crosses a tile boundary so
	// continuous coords stay near zero; also called by Field.fit() when
	// leaving camera mode so the local worm doesn't end up at a huge
	// continuous offset that puts it off-screen in fit mode (where
	// camera pan is forced back to (0,0)).
	Worm.prototype.rebase = function(shiftCellsX, shiftCellsY) {
		if (shiftCellsX === 0 && shiftCellsY === 0) return;
		if (!this.flow) return;
		var grid = this.flow.options.grid;
		var dxPx = shiftCellsX * grid;
		var dyPx = shiftCellsY * grid;
		if (this.continuousCells) {
			for (var i = 0; i < this.continuousCells.length; i++) {
				this.continuousCells[i].X -= shiftCellsX;
				this.continuousCells[i].Y -= shiftCellsY;
			}
		}
		if (this.startPx) {
			for (var j = 0; j < this.startPx.length; j++) {
				this.startPx[j].x -= dxPx;
				this.startPx[j].y -= dyPx;
			}
		}
		if (this.endPx) {
			for (var k = 0; k < this.endPx.length; k++) {
				this.endPx[k].x -= dxPx;
				this.endPx[k].y -= dyPx;
			}
		}
		if (this.visualPx) {
			for (var m = 0; m < this.visualPx.length; m++) {
				this.visualPx[m].x -= dxPx;
				this.visualPx[m].y -= dyPx;
				if (this.parts[m]) {
					this.parts[m].x = Math.round(this.visualPx[m].x);
					this.parts[m].y = Math.round(this.visualPx[m].y);
				}
			}
		}
	};

	window.Worm = Worm;

})();
