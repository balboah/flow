(function(){

	// Match the server tick; same TICK_MS as worms so their motions stay
	// visually synchronised.
	var TICK_MS = 200;

	// Pacman holds the single hunter's render state. Update flow:
	//   server PACMAN packet → update(cell, dir) → tween starts
	//   field rAF loop       → tick(now) advances the tween + mouth phase
	//   field render         → drawAt(ctx, px, py, size) paints
	function Pacman(flow) {
		this.flow = flow;
		this.cell = {x: 0, y: 0};
		this.prevCell = {x: 0, y: 0};
		this.direction = 'RIGHT';

		this.startPx = null;
		this.endPx   = null;
		this.visualPx = null;
		this.tweenStart = 0;
		this.tweenDur = TICK_MS;
		this.smoothedTickMs = null;
		this.lastUpdateAt = null;

		// Mouth angle oscillates between mouthMin and mouthMax over
		// mouthPeriod ms — opens and closes as he moves. The visible
		// half-angle is half of this value (drawn symmetric).
		this.mouthMin = 0.05 * Math.PI;
		this.mouthMax = 0.35 * Math.PI;
		this.mouthPeriod = 220;  // ms per full open-close cycle
	}

	// update is called from game.commands.pacman with the latest server cell
	// + facing. Sets up a fresh tween from the current visual position to
	// the new target cell, computed wrap-aware so an edge crossing snaps
	// instead of sliding across the field.
	Pacman.prototype.update = function(payload) {
		var grid = this.flow.options.grid;
		var newCell = {x: payload.X, y: payload.Y};
		this.direction = payload.Direction || this.direction;

		var endPx = {x: newCell.x * grid, y: newCell.y * grid};
		var snap = false;
		if (this.visualPx == null) {
			snap = true;
		} else {
			// If the server jumped >1 cell on either axis, it's a wrap
			// step. Snap the tween start to the near side instead of
			// sliding across the whole field.
			var dxRaw = newCell.x - this.cell.x;
			var dyRaw = newCell.y - this.cell.y;
			if (Math.abs(dxRaw) > 1 || Math.abs(dyRaw) > 1) {
				snap = true;
			}
		}

		this.prevCell = this.cell;
		this.cell = newCell;
		this.startPx = snap ? {x: endPx.x, y: endPx.y}
		                    : {x: this.visualPx.x, y: this.visualPx.y};
		this.endPx = endPx;
		this.visualPx = {x: this.startPx.x, y: this.startPx.y};

		// EMA-smooth the tween duration to the observed packet cadence,
		// same as worm.js, so Pac-Man and worms move at visually equal
		// rates even when ticks jitter.
		var now = performance.now();
		if (this.lastUpdateAt != null) {
			var dt = now - this.lastUpdateAt;
			if (dt > 80 && dt < 500) {
				if (this.smoothedTickMs == null) this.smoothedTickMs = dt;
				else this.smoothedTickMs = this.smoothedTickMs * 0.7 + dt * 0.3;
			}
		}
		this.lastUpdateAt = now;
		this.tweenStart = now;
		this.tweenDur = this.smoothedTickMs || TICK_MS;

		if (this.flow.requestAnimation) this.flow.requestAnimation();
	};

	// tick advances the active tween. Returns true while still in progress.
	Pacman.prototype.tick = function(now) {
		if (!this.startPx) return false;
		var t = (now - this.tweenStart) / this.tweenDur;
		var done = t >= 1;
		if (t > 1) t = 1;
		if (t < 0) t = 0;
		this.visualPx.x = this.startPx.x + (this.endPx.x - this.startPx.x) * t;
		this.visualPx.y = this.startPx.y + (this.endPx.y - this.startPx.y) * t;
		return !done;
	};

	// drawAt paints Pac-Man as a yellow wedge with an animated mouth, at
	// (px, py) of `size` cell-pixels. Mouth orientation follows direction.
	Pacman.prototype.drawAt = function(ctx, px, py, size, now) {
		var cx = px + size / 2;
		var cy = py + size / 2;
		var r = size * 0.48;

		// Mouth half-angle in [mouthMin/2, mouthMax/2]. 0.5+0.5cos eases
		// the open-close so the corners aren't snappy.
		var t = (now % this.mouthPeriod) / this.mouthPeriod;
		var openness = 0.5 - 0.5 * Math.cos(t * 2 * Math.PI);
		var halfMouth = (this.mouthMin + (this.mouthMax - this.mouthMin) * openness) / 2;

		// Facing → angle of the mouth's centre line (Y axis points down).
		var facing = 0;
		switch (this.direction) {
			case 'RIGHT': facing = 0;          break;
			case 'DOWN':  facing = Math.PI / 2; break;
			case 'LEFT':  facing = Math.PI;    break;
			case 'UP':    facing = -Math.PI / 2; break;
		}

		// Body wedge: full circle minus the mouth.
		ctx.fillStyle = '#ffd23a';
		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.arc(cx, cy, r, facing + halfMouth, facing - halfMouth + 2 * Math.PI);
		ctx.closePath();
		ctx.fill();

		// Eye: small dark dot offset 90° counter-clockwise from the
		// facing direction — i.e., on the *upper* side of his body
		// (port side, if you think of him as a boat). Nudged slightly
		// forward along the facing axis so he reads as "looking
		// somewhere", not staring sideways. The asymmetry is what
		// makes him recognisable as a creature with a face.
		var eyeAng = facing - Math.PI / 2;
		var eyeR = r * 0.5;
		var ex = cx + Math.cos(eyeAng) * eyeR + Math.cos(facing) * r * 0.05;
		var ey = cy + Math.sin(eyeAng) * eyeR + Math.sin(facing) * r * 0.05;
		ctx.fillStyle = '#1a1208';
		ctx.beginPath();
		ctx.arc(ex, ey, Math.max(1, r * 0.13), 0, 2 * Math.PI);
		ctx.fill();
	};

	Pacman.prototype.kill = function() {
		this.startPx = null;
		this.endPx = null;
		this.visualPx = null;
	};

	// SIZE is the side length of Pac-Man's footprint in cells. Must match
	// the server's PacManSize constant. The renderer multiplies the grid
	// pixel size by this so his body engulfs the cells he actually
	// occupies on the server.
	Pacman.SIZE = 2;

	window.Pacman = Pacman;

})();
