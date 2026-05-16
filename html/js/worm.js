(function(){

	// Server tick interval. The worm interpolates each part from its previous
	// to its new cell over this window so motion reads as smooth slide rather
	// than discrete cell-step.
	var TICK_MS = 200;

	// 8 ghost offsets for 3×3 tiling. The "0,0" tile is the primary sprite.
	var GHOST_OFFSETS = [
		[ 1,  0], [-1,  0], [ 0,  1], [ 0, -1],
		[ 1,  1], [-1,  1], [ 1, -1], [-1, -1]
	];

	// TileSprite wraps either a single Kinetic.Sprite (local worm: continuous
	// coords mean one canonical position is enough) or 9 sprites arranged at
	// (0,0) plus the 8 GHOST_OFFSETS. setPosition / setIndex / setVisible
	// fan out to every underlying sprite, so the rest of the renderer
	// treats it as a plain part.
	function TileSprite(opts, layer, fieldPx, tiled) {
		this.fieldPx = fieldPx;
		this.sprites = [new Kinetic.Sprite(opts)];
		layer.add(this.sprites[0]);
		if (tiled) {
			for (var k = 0; k < GHOST_OFFSETS.length; k++) {
				var g = new Kinetic.Sprite(opts);
				this.sprites.push(g);
				layer.add(g);
			}
		}
		this._x = 0;
		this._y = 0;
	}
	TileSprite.prototype.setPosition = function(pos) {
		this._x = pos.x;
		this._y = pos.y;
		this.sprites[0].setPosition({x: pos.x, y: pos.y});
		for (var k = 1; k < this.sprites.length; k++) {
			var o = GHOST_OFFSETS[k - 1];
			this.sprites[k].setPosition({
				x: pos.x + o[0] * this.fieldPx,
				y: pos.y + o[1] * this.fieldPx
			});
		}
	};
	TileSprite.prototype.setIndex = function(idx) {
		for (var k = 0; k < this.sprites.length; k++) this.sprites[k].setIndex(idx);
	};
	TileSprite.prototype.setVisible = function(v) {
		for (var k = 0; k < this.sprites.length; k++) this.sprites[k].setVisible(v);
	};
	TileSprite.prototype.moveToTop = function() {
		for (var k = 0; k < this.sprites.length; k++) this.sprites[k].moveToTop();
	};
	TileSprite.prototype.x = function() { return this._x; };
	TileSprite.prototype.y = function() { return this._y; };

	var sprites = [];

	for (var j = 0; j < 5; j++) {
		for (var i = 0; i < 4; i++) {
			sprites.push(i * 20, j * 20, 20, 20);
		}
	}

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


	var Worm = function(id, flow) {
		var grid = flow.options.grid;

		this.id = id;

		this.color = 'rgb(' + randomColor() + ',' + randomColor() + ',' + randomColor() + ')';

		this.flow = flow;
		this.layer = new Kinetic.Layer();

		this.parts = [];

		this.dot = new Kinetic.Circle({
			fill: this.color
		});

		this.layer.add(this.dot);

		flow.stage.add(this.layer);

		this.layer.moveToTop();

		// The current player's worm always renders as the rainbow atlas so the
		// player can spot themselves at a glance. Other worms cycle through
		// blue / gray, deterministic per id so they don't shuffle on reload.
		var isLocal = window.game && game.hud && id === game.hud.ownId;
		var otherAtlases = [2, 1];
		if (isLocal) {
			this.type = 3;
		} else {
			this.type = otherAtlases[(id - 1) % otherAtlases.length];
		}

		// Local player uses continuous (non-wrapping) cell coordinates so
		// that crossing a field edge does not produce a visible jump. The
		// camera then tracks the head's continuous position and the world
		// stays centred on the player as they wrap. Remote worms render in
		// server cell coords (they wrap visibly) — keeping the local view
		// authoritative for the smooth experience without coupling clients.
		this.useContinuous = !!isLocal;

		this.image = new Image();
		this.image.src = '/img/worm-' + this.type + '.png';

		return this;
	};

	Worm.prototype.split = function(count) {
		if (count > this.parts.length) {
			var grid = this.flow.options.grid,
				i = this.parts.length,
				part;

			// Remote worms render in fixed cell coords. To stay visible while
			// the local player has wrapped far into continuous space, tile
			// their sprites 3×3 around the canonical position. The local
			// player itself renders only once — its continuous coords cover
			// every wrap naturally.
			var tiled = !this.useContinuous;
			for (; i < count; i++) {
				part = new TileSprite({
					width: grid,
					height: grid,
					image: this.image,
					animation: 'idle',
					animations: {
						idle: sprites
					},
					index: 0
				}, this.layer, this.flow.logicalSize, tiled);
				this.parts.push(part);
			}

			this.parts[0].moveToTop();
			this.dot.moveToTop();
			this.dot.setVisible(false);
		}
	};

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

	// move records the new server-authoritative cells for each visible body
	// part, snapshots where each sprite currently is on screen, and kicks the
	// rAF loop on the Field. The loop in `tick` then lerps the sprites from
	// where they are to where they should be over TICK_MS milliseconds.
	Worm.prototype.move = function(positions) {
		this.lastPositions = positions;

		var grid = this.flow.options.grid;
		var l = positions.length - 1;
		this.split(l);
		if (l <= 0) {
			// No visible parts to tween — clear stale tween state so a later
			// `tick` cannot operate on dead positions.
			this.startPx = null;
			this.endPx = null;
			this.visualPx = null;
			this.continuousCells = null;
			this.targetCells = null;
			this.layer.draw();
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

		// For the local player we track continuous (non-wrapping) cell coords
		// per slot. Each slot advances by stepDelta from its previous server
		// cell — a single-cell step even across a wrap, so the visual never
		// jumps. Remote worms use server cells directly (and may visibly
		// wrap, accepted v1 tradeoff).
		var renderCells;
		var newContinuous = null;
		if (this.useContinuous) {
			newContinuous = new Array(positions.length);
			for (var i = 0; i < positions.length; i++) {
				if ((sameLen || (growth && i < prevLen)) && prevContinuous && i < prevContinuous.length) {
					var d = stepDelta(prevTargetCells[i], positions[i]);
					newContinuous[i] = {
						X: prevContinuous[i].X + d.dx,
						Y: prevContinuous[i].Y + d.dy
					};
				} else if (growth && i === prevLen && prevContinuous && prevLen > 0) {
					// New tail slot — same cell as the old tail; continuous
					// matches the old tail's continuous, not its raw cell.
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

		// Target pixel for each visible body part — `pixelFor` is wrap-aware
		// but with continuous coords the wrap branch never fires (deltas are
		// always |1| or 0).
		var endPx = new Array(l);
		for (i = 0; i < l; i++) {
			endPx[i] = pixelFor(renderCells[i], renderCells[i + 1], grid);
		}

		// startPx: where this tween begins for each part. Per-part decision —
		// when the worm grew, the parts that existed last frame still have a
		// prior visual position and should tween from there. Only the brand
		// new tail (no prior visual at its index) snaps to its end pixel.
		// Cell-tracked (remote) worms also snap when their server cell would
		// have wrapped, so they don't slide across the whole field.
		var startPx = new Array(l);
		for (i = 0; i < l; i++) {
			var hasMyVisual = !!this.visualPx && i < this.visualPx.length;
			var snap = !hasMyVisual;
			if (!snap && !this.useContinuous && prevTargetCells && i < prevTargetCells.length) {
				var dxRaw = positions[i].X - prevTargetCells[i].X;
				var dyRaw = positions[i].Y - prevTargetCells[i].Y;
				if (Math.abs(dxRaw) > 1 || Math.abs(dyRaw) > 1) {
					snap = true;
				}
			}
			if (snap) {
				startPx[i] = {x: endPx[i].x, y: endPx[i].y};
				this.parts[i].setPosition({x: endPx[i].x, y: endPx[i].y});
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

		// Renormalize the local player's continuous coord back into the
		// canonical [0, cols) × [0, rows) range whenever the head crosses a
		// tile boundary. The world is tiled 3×3 (-1, 0, 1) around the base,
		// so without renorm the camera would eventually pan past the tile
		// arrangement into empty space after a few wraps. Because every
		// tile renders identical content (same procedural ground, same food
		// IDs, same remote-worm sprites), the renorm shift is visually
		// imperceptible — what disappears on one edge is replaced by an
		// identical copy on the other in the same canvas position.
		if (this.useContinuous && newContinuous && newContinuous[0]) {
			var cols = this.flow.options.cols;
			var rows = this.flow.options.rows;
			var shiftX = Math.floor(newContinuous[0].X / cols) * cols;
			var shiftY = Math.floor(newContinuous[0].Y / rows) * rows;
			if (shiftX !== 0 || shiftY !== 0) {
				this.rebase(shiftX, shiftY);
			}
		}

		// Sprite frames (head/body/tail direction + corners) snap to the new
		// orientation immediately — only translation is tweened.
		for (i = 0; i < l; i++) {
			var c = positions[i];
			var n = positions[i + 1];
			var p = positions[i - 1];
			var part = this.parts[i];

			if (i === 0) {
				this.doHead(part, c, n, endPx[i].x, endPx[i].y);
			} else {
				part.setVisible(c.X !== p.X || c.Y !== p.Y);
				if (i === l - 1) {
					this.doTail(part, c, p);
				} else {
					this.doBody(part, c, p, n);
				}
			}
		}

		this.layer.batchDraw();
		if (this.flow.requestAnimation) this.flow.requestAnimation();
	};

	// tick advances the active tween by one rAF step. Returns true while the
	// tween is still in progress so the Field driver knows to keep looping.
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
			// Pixel-snap to integers so adjacent body sprites share an exact
			// edge instead of sub-pixel positions that produce alpha-blend
			// seams between segments mid-tween.
			this.parts[i].setPosition({x: Math.round(x), y: Math.round(y)});
		}
		this.layer.batchDraw();
		return !done;
	};

	Worm.prototype.doHead = function(part, curr, next, x, y) {
		var grid = this.flow.options.grid;

		this.dot.setPosition({x: x + grid / 2, y: y + grid / 2});
		this.dot.setRadius(grid / 5);

		// Determine the head's facing direction. After a wrap step, the raw
		// (curr - next) sign would point backwards because next sits on the
		// opposite edge; stepDelta normalises the 1-cell step.
		var d = stepDelta(curr, next);

		if (d.dx === 0) {
			// Sprite 1 - head up (next is below curr -> worm moved up)
			if (d.dy > 0) {
				part.setIndex(1);
			}
			// Sprite 2 - head down
			else if (d.dy < 0) {
				part.setIndex(2);
			}
		}
		else {
			// Sprite 0 - head left
			if (d.dx > 0) {
				part.setIndex(0);
			}
			// Sprite 3 - head right
			else if (d.dx < 0) {
				part.setIndex(3);
			}
		}
	};

	Worm.prototype.doBody = function(part, curr, prev, next) {
		// Original used (curr - prev) and (curr - next); reuse those sign
		// conventions so the existing corner conditions match.
		var p = stepDelta(prev, curr);
		var n = stepDelta(next, curr);

		// Sprite 12 - body left-right (both neighbours on the same row)
		if (p.dy === 0 && n.dy === 0) {
			part.setIndex(12);
			return;
		}
		// Sprite 13 - body top-down
		if (p.dx === 0 && n.dx === 0) {
			part.setIndex(13);
			return;
		}

		// Corner pieces. Each one matches two symmetric (prev, next) layouts.
		// Sprite 4 - corner left-down
		if ((p.dx === 0 && p.dy === -1 && n.dx === 1 && n.dy === 0) ||
			(p.dx === 1 && p.dy === 0 && n.dx === 0 && n.dy === -1)) {
			part.setIndex(4);
		}
		// Sprite 5 - corner right-down
		else if ((p.dx === 0 && p.dy === -1 && n.dx === -1 && n.dy === 0) ||
				 (p.dx === -1 && p.dy === 0 && n.dx === 0 && n.dy === -1)) {
			part.setIndex(5);
		}
		// Sprite 6 - corner left-up
		else if ((p.dx === 0 && p.dy === 1 && n.dx === 1 && n.dy === 0) ||
				 (p.dx === 1 && p.dy === 0 && n.dx === 0 && n.dy === 1)) {
			part.setIndex(6);
		}
		// Sprite 7 - corner right-up
		else if ((p.dx === 0 && p.dy === 1 && n.dx === -1 && n.dy === 0) ||
				 (p.dx === -1 && p.dy === 0 && n.dx === 0 && n.dy === 1)) {
			part.setIndex(7);
		}
	};

	Worm.prototype.doTail = function(part, curr, prev) {
		var d = stepDelta(curr, prev);

		if (d.dx === 0) {
			// Sprite 9 - tail up (prev is above curr)
			if (d.dy < 0) {
				part.setIndex(9);
			}
			// Sprite 10 - tail down
			else if (d.dy > 0) {
				part.setIndex(10);
			}
		}
		else {
			// Sprite 8 - tail left (prev is to the left of curr)
			if (d.dx < 0) {
				part.setIndex(8);
			}
			// Sprite 11 - tail right
			else if (d.dx > 0) {
				part.setIndex(11);
			}
		}
	};

	Worm.prototype.kill = function() {
		// Null tween state so any in-flight rAF tick treats this worm as
		// inactive instead of poking at the destroyed Kinetic layer.
		this.startPx = null;
		this.endPx = null;
		this.visualPx = null;
		this.layer.destroy();
		delete this.flow;
	};

	// rebase shifts the worm's continuous + pixel state by (shiftCellsX,
	// shiftCellsY) cells. Called by Field.fit() when leaving camera mode so
	// the local worm doesn't end up at a huge continuous offset that puts
	// it off-screen in fit mode (where stage.position is forced to {0,0}).
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
					this.parts[m].setPosition({
						x: Math.round(this.visualPx[m].x),
						y: Math.round(this.visualPx[m].y)
					});
				}
			}
		}
		this.layer.batchDraw();
	};

	window.Worm = Worm;

})();
