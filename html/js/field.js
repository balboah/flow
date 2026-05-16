(function(){

	// Sprite atlas frame rects. Each worm-*.png is 4 columns × 5 rows of
	// 20×20 frames; frame index maps to (col, row) row-major.
	var SPRITE_SRC = (function(){
		var arr = [];
		for (var j = 0; j < 5; j++) {
			for (var i = 0; i < 4; i++) {
				arr.push({sx: i * 20, sy: j * 20, sw: 20, sh: 20});
			}
		}
		return arr;
	})();

	// 3×3 tile offsets. The world wraps in cell coords, so when the camera
	// pans past an edge the next tile copy comes into view — every food /
	// remote-worm is drawn 9 times at these offsets so something is always
	// under the player.
	var GHOST_OFFSETS = [
		[ 0,  0], [ 1,  0], [-1,  0], [ 0,  1], [ 0, -1],
		[ 1,  1], [-1,  1], [ 1, -1], [-1, -1]
	];

	// Throttle camera-mode marker recompute to ~20Hz. Markers follow the
	// camera; 50ms is well below perceptual threshold for a slow pan but
	// avoids redoing the per-food / 9-offset math every rAF.
	var MARKER_THROTTLE_MS = 50;

	function Field(options) {
		this.options = Object.assign({}, Field.defaults, options || {});
		this.worms = {};
		this.foods = {};
		this.particles = [];
		this.markers = {};      // id → {x, y, color, opacity, angle} (rad)
		this.showGrid = false;
		this.logicalSize = this.options.cols * this.options.grid;

		// Cap DPR at 2: iPhone DPR is 3, and the third pixel doesn't buy
		// readable detail for pixel-art sprites — capping cuts paint cost
		// to ~44% of native DPR with no visible loss.
		this.dpr = Math.min(2, window.devicePixelRatio || 1);

		this.cameraMode = false;
		this.scale = 1;
		this.panX = 0;
		this.panY = 0;
		this.cssW = 0;
		this.cssH = 0;
		this._lastMarkerTime = 0;
		this._rafScheduled = false;

		var container = document.getElementById('playfield');
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'playfield-canvas';
		container.appendChild(this.canvas);
		this.ctx = this.canvas.getContext('2d');
		// Pixel art: nearest-neighbour scaling preserves crisp edges.
		this.ctx.imageSmoothingEnabled = false;

		this.groundCache = buildGround(this.logicalSize);
		this.perf = createPerfOverlay();

		var self = this;
		this.fit();
		this._resizeHandler = function(){ self.fit(); };
		window.addEventListener('resize', this._resizeHandler);

		// One full repaint at boot so the empty stage shows the ground +
		// gradient even before the first server MOVE wakes the rAF loop.
		this.render(performance.now());
	}

	Field.defaults = {grid: 20, cols: 50, rows: 50};
	Field.SPRITE_SRC = SPRITE_SRC;

	// buildGround rasterises a single tile-sized image containing the
	// procedurally-placed dots and large soft blobs. The same image stamps
	// the 9 world tiles at render time. Entries are also drawn at each
	// 8-neighbour offset so wrap-bleed (a large blob near a tile edge
	// spilling into the adjacent tile) tiles seamlessly.
	function buildGround(fieldPx) {
		// Mulberry32 PRNG. Seeded so the dot field is identical across
		// reloads; otherwise the static-looking ground would shuffle on
		// every refresh and the player would notice.
		var s = 0x1337c0de;
		var rand = function() {
			s = (s + 0x6D2B79F5) | 0;
			var t = s;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};

		var entries = [];
		for (var b = 0; b < 10; b++) {
			entries.push({
				x: rand() * fieldPx, y: rand() * fieldPx,
				r: 60 + rand() * 110,
				fill: 'hsl(' + (250 + rand() * 70) + ', 55%, 40%)',
				opacity: 0.07 + rand() * 0.05
			});
		}
		for (var i = 0; i < 340; i++) {
			entries.push({
				x: rand() * fieldPx, y: rand() * fieldPx,
				r: 1 + rand() * 2.2,
				fill: 'hsl(' + (200 + rand() * 100) + ', 60%, 78%)',
				opacity: 0.35 + rand() * 0.35
			});
		}
		for (var k = 0; k < 18; k++) {
			entries.push({
				x: rand() * fieldPx, y: rand() * fieldPx,
				r: 1.5 + rand() * 1.5,
				fill: 'hsl(' + (40 + rand() * 30) + ', 90%, 70%)',
				opacity: 0.45
			});
		}

		var cache = document.createElement('canvas');
		cache.width = fieldPx;
		cache.height = fieldPx;
		var cctx = cache.getContext('2d');
		for (var e = 0; e < entries.length; e++) {
			var en = entries[e];
			cctx.fillStyle = en.fill;
			cctx.globalAlpha = en.opacity;
			for (var ox = -1; ox <= 1; ox++) {
				for (var oy = -1; oy <= 1; oy++) {
					var cx = en.x + ox * fieldPx;
					var cy = en.y + oy * fieldPx;
					if (cx + en.r < 0 || cx - en.r > fieldPx ||
						cy + en.r < 0 || cy - en.r > fieldPx) continue;
					cctx.beginPath();
					cctx.arc(cx, cy, en.r, 0, Math.PI * 2);
					cctx.fill();
				}
			}
		}
		cctx.globalAlpha = 1;
		return cache;
	}

	// fit sizes the canvas to fit the viewport (below the HUD). On viewports
	// large enough to show the whole 50×50 field at a comfortable cell
	// size we use "fit" mode (entire field scaled to fit). On narrower
	// viewports we drop into "camera" mode: the canvas fills the viewport,
	// cells render closer to native size, and the camera pans each tick to
	// keep the player's head centred (centerOn).
	Field.prototype.fit = function() {
		var hudEl = document.getElementById('hud');
		var hudHeight = (hudEl && hudEl.offsetHeight) || 0;
		document.getElementById('playfield').style.top = hudHeight + 'px';

		var availW = Math.max(160, window.innerWidth - 8);
		var availH = Math.max(160, window.innerHeight - hudHeight - 8);
		var avail = Math.min(availW, availH);

		var fitScale = avail / this.logicalSize;
		var nativeCellPx = this.options.grid;
		var comfortPx = 14;
		var comfortScale = comfortPx / nativeCellPx;

		var cssW, cssH;
		if (fitScale < comfortScale) {
			this.cameraMode = true;
			var cameraScale = Math.min(0.9, Math.max(comfortScale, fitScale * 1.6));
			// Cap canvas size to one tile so neighbouring tile copies don't
			// become simultaneously visible — the camera-mode world is
			// tiled 3×3 around the player, and if the viewport projected
			// past one tile in either axis you'd see mirrored worms / food.
			var oneTilePx = Math.floor(this.logicalSize * cameraScale);
			cssW = Math.min(availW, oneTilePx);
			cssH = Math.min(availH, oneTilePx);
			this.scale = cameraScale;
		} else {
			this.cameraMode = false;
			this.scale = fitScale;
			cssW = avail;
			cssH = avail;
			this.panX = 0;
			this.panY = 0;
			// Camera mode lets the local worm accumulate continuous offset
			// past the field boundary. Fit mode forces camera origin to
			// (0,0) — rebase the local worm back into [0, cols) so it
			// stays visible.
			if (window.game && game.hud && this.worms[game.hud.ownId]) {
				var local = this.worms[game.hud.ownId];
				if (local.useContinuous && local.continuousCells && local.continuousCells[0]) {
					var shiftX = Math.floor(local.continuousCells[0].X / this.options.cols) * this.options.cols;
					var shiftY = Math.floor(local.continuousCells[0].Y / this.options.rows) * this.options.rows;
					if (shiftX !== 0 || shiftY !== 0) local.rebase(shiftX, shiftY);
				}
			}
		}

		this.cssW = cssW;
		this.cssH = cssH;
		this.canvas.style.width = cssW + 'px';
		this.canvas.style.height = cssH + 'px';
		this.canvas.width = Math.floor(cssW * this.dpr);
		this.canvas.height = Math.floor(cssH * this.dpr);
		this.ctx.imageSmoothingEnabled = false;

		this.render(performance.now());
	};

	// centerOn pans the camera so a logical pixel point (x, y) sits at the
	// middle of the visible canvas. No-op outside camera mode.
	Field.prototype.centerOn = function(x, y) {
		if (!this.cameraMode) return;
		this.panX = this.cssW / 2 - x * this.scale;
		this.panY = this.cssH / 2 - y * this.scale;
	};

	Field.prototype.getWorm = function(id) {
		if (!this.worms[id]) {
			this.worms[id] = new Worm(id, this);
			console.info('[Field] new worm: %s - total worms: %s', id, Object.keys(this.worms).length);
		}
		return this.worms[id];
	};

	Field.prototype.kill = function(id) {
		if (this.worms[id]) {
			this.worms[id].kill();
			delete this.worms[id];
			console.info('[Field] killed worm: %s - total worms: %s', id, Object.keys(this.worms).length);
		}
	};

	Field.prototype.addFood = function(payload) {
		if (this.foods[payload.Id]) return;
		this.foods[payload.Id] = new Food(payload, this);
		this.requestAnimation();
	};

	Field.prototype.removeFood = function(id) {
		var f = this.foods[id];
		if (f) {
			f.destroy();
			delete this.foods[id];
			delete this.markers[id];
			this.requestAnimation();
		}
	};

	// explode scatters short-lived pixel debris from each cell in
	// `positions`. Used by the game-over handler so a dying worm leaves a
	// visual mark instead of just blinking out.
	Field.prototype.explode = function(positions) {
		if (!positions || !positions.length) return;
		var grid = this.options.grid;
		var now = performance.now();
		var particlesPerCell = 7;
		for (var p = 0; p < positions.length; p++) {
			var pos = positions[p];
			var cx = pos.X * grid + grid / 2;
			var cy = pos.Y * grid + grid / 2;
			for (var i = 0; i < particlesPerCell; i++) {
				var size = 3 + Math.random() * 4;
				var angle = Math.random() * Math.PI * 2;
				var dist = 18 + Math.random() * 36;
				// Warm explosion palette: red → orange → yellow.
				var hue = 10 + Math.random() * 50;
				this.particles.push({
					x0: cx, y0: cy,
					x1: cx + Math.cos(angle) * dist,
					y1: cy + Math.sin(angle) * dist,
					size: size,
					color: 'hsl(' + hue + ', 100%, 55%)',
					t0: now,
					dur: 450 + Math.random() * 200
				});
			}
		}
		this.requestAnimation();
	};

	// grid toggles a 1px line grid overlay for debugging cell alignment.
	Field.prototype.grid = function(enable) {
		if (arguments.length) this.showGrid = !!enable;
		else this.showGrid = !this.showGrid;
		this.render(performance.now());
	};

	// requestAnimation kicks the rAF loop. The loop ticks every worm tween,
	// recenters the camera on the local player's interpolated head, refreshes
	// off-screen food markers, then paints. It ends when no worm is tweening
	// and no particles are alive — until the next server MOVE wakes it.
	// Browsers already pause rAF when the tab is hidden; worm.tick() clamps
	// t to 1 so on resume the next frame snaps cleanly to the tween end.
	Field.prototype.requestAnimation = function() {
		if (this._rafScheduled) return;
		this._rafScheduled = true;
		var self = this;
		var loop = function(now) {
			if (self.perf) self.perf.sample(now);

			var anyActive = false;
			var ownId = (window.game && game.hud) ? game.hud.ownId : null;
			var grid = self.options.grid;
			var ids = Object.keys(self.worms);
			for (var i = 0; i < ids.length; i++) {
				var idNum = parseInt(ids[i], 10);
				var w = self.worms[ids[i]];
				if (w.tick(now)) anyActive = true;
				// Camera tracks the local player's interpolated head pixel.
				if (idNum === ownId && w.visualPx && w.visualPx[0]) {
					self.centerOn(
						w.visualPx[0].x + grid / 2,
						w.visualPx[0].y + grid / 2
					);
				}
			}

			if (now - self._lastMarkerTime >= MARKER_THROTTLE_MS) {
				self._lastMarkerTime = now;
				self.updateMarkers();
			}

			self.render(now);

			if (anyActive || self.particles.length > 0) {
				requestAnimationFrame(loop);
			} else {
				self._rafScheduled = false;
			}
		};
		requestAnimationFrame(loop);
	};

	// updateMarkers computes triangular indicator positions at the
	// viewport edges, pointing toward foods that are off-screen. Each
	// food has 9 tile copies; pick the copy nearest the camera so the
	// marker points to the closest instance — which is what the player
	// will actually run into, especially after wrapping into a non-zero
	// tile. Foods inside the viewport get their marker entry removed.
	Field.prototype.updateMarkers = function() {
		if (!this.cameraMode) {
			this.markers = {};
			return;
		}
		var s = this.scale;
		var grid = this.options.grid;
		var fieldPx = this.logicalSize;

		var worldLeft = -this.panX / s;
		var worldRight = (this.cssW - this.panX) / s;
		var worldTop = -this.panY / s;
		var worldBottom = (this.cssH - this.panY) / s;

		var cx = (worldLeft + worldRight) / 2;
		var cy = (worldTop + worldBottom) / 2;

		// Inset markers slightly from the canvas edge so they don't clip.
		var insetCanvasPx = 14;
		var inset = insetCanvasPx / s;
		var minX = worldLeft + inset;
		var maxX = worldRight - inset;
		var minY = worldTop + inset;
		var maxY = worldBottom - inset;

		var seen = {};
		var ids = Object.keys(this.foods);
		for (var i = 0; i < ids.length; i++) {
			var id = ids[i];
			var f = this.foods[id];
			var baseFx = f.x * grid + grid / 2;
			var baseFy = f.y * grid + grid / 2;
			var bestDist = Infinity;
			var fx = baseFx, fy = baseFy;
			for (var tx = -1; tx <= 1; tx++) {
				for (var ty = -1; ty <= 1; ty++) {
					var cFx = baseFx + tx * fieldPx;
					var cFy = baseFy + ty * fieldPx;
					var ddx = cFx - cx, ddy = cFy - cy;
					var dd = ddx * ddx + ddy * ddy;
					if (dd < bestDist) {
						bestDist = dd;
						fx = cFx;
						fy = cFy;
					}
				}
			}
			if (fx >= worldLeft && fx <= worldRight &&
				fy >= worldTop && fy <= worldBottom) {
				delete this.markers[id];
				continue;
			}

			// Ray from camera centre toward the food, clipped to the
			// inset viewport rect.
			var dx = fx - cx, dy = fy - cy;
			var tX = Infinity, tY = Infinity;
			if (dx > 0) tX = (maxX - cx) / dx;
			else if (dx < 0) tX = (minX - cx) / dx;
			if (dy > 0) tY = (maxY - cy) / dy;
			else if (dy < 0) tY = (minY - cy) / dy;
			var t = Math.min(tX, tY);
			if (!isFinite(t) || t < 0) continue;

			// Subtle palette — markers should hint, not shout.
			var color, opacity;
			if (f.type === 'bomb')        { color = '#5a5e72'; opacity = 0.35; }
			else if (f.type === 'apple')  { color = '#c45c5c'; opacity = 0.40; }
			else                          { color = '#c98a4a'; opacity = 0.40; }

			this.markers[id] = {
				x: cx + dx * t,
				y: cy + dy * t,
				color: color,
				opacity: opacity,
				angle: Math.atan2(dy, dx) + Math.PI / 2  // tip points along +X at 0
			};
			seen[id] = true;
		}

		var current = Object.keys(this.markers);
		for (var c = 0; c < current.length; c++) {
			if (!seen[current[c]]) delete this.markers[current[c]];
		}
	};

	// render paints one frame from the current scene state. World space:
	// every drawing call uses logical pixel coords. The transform combines
	// DPR (for crisp output on retina), camera scale, and camera pan into a
	// single ctx.setTransform — so no nested save/restore is needed for the
	// main passes.
	Field.prototype.render = function(now) {
		var ctx = this.ctx;
		var dpr = this.dpr;
		var s = this.scale;
		var grid = this.options.grid;
		var fieldPx = this.logicalSize;

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * this.panX, dpr * this.panY);

		// 1. Ground — 9 tiles, all painted (drawImage of a cached canvas
		//    is cheap and the canvas clips automatically).
		for (var tx = -1; tx <= 1; tx++) {
			for (var ty = -1; ty <= 1; ty++) {
				ctx.drawImage(this.groundCache, tx * fieldPx, ty * fieldPx);
			}
		}

		// 2. Foods — 9 copies per food.
		var foodIds = Object.keys(this.foods);
		for (var fi = 0; fi < foodIds.length; fi++) {
			var f = this.foods[foodIds[fi]];
			var fx = f.x * grid;
			var fy = f.y * grid;
			for (var g = 0; g < GHOST_OFFSETS.length; g++) {
				var off = GHOST_OFFSETS[g];
				ctx.drawImage(f.bitmap, fx + off[0] * fieldPx, fy + off[1] * fieldPx);
			}
		}

		// 3. Particles — fade out as they fly outward; drop when done.
		var particles = this.particles;
		for (var p = particles.length - 1; p >= 0; p--) {
			var par = particles[p];
			var pt = (now - par.t0) / par.dur;
			if (pt >= 1) {
				particles.splice(p, 1);
				continue;
			}
			ctx.globalAlpha = 1 - pt;
			ctx.fillStyle = par.color;
			var px = par.x0 + (par.x1 - par.x0) * pt;
			var py = par.y0 + (par.y1 - par.y0) * pt;
			ctx.fillRect(px - par.size / 2, py - par.size / 2, par.size, par.size);
		}
		ctx.globalAlpha = 1;

		// 4. Worms — local once, remotes tiled 9×.
		var wormIds = Object.keys(this.worms);
		for (var wi = 0; wi < wormIds.length; wi++) {
			var w = this.worms[wormIds[wi]];
			if (!w.image || !w.image.complete || !w.image.naturalWidth) continue;
			var copies = w.useContinuous ? 1 : GHOST_OFFSETS.length;
			for (var c = 0; c < copies; c++) {
				var coff = GHOST_OFFSETS[c];
				var cdx = coff[0] * fieldPx;
				var cdy = coff[1] * fieldPx;
				for (var pi = 0; pi < w.parts.length; pi++) {
					var part = w.parts[pi];
					if (!part.visible) continue;
					var src = SPRITE_SRC[part.frame];
					if (!src) continue;
					ctx.drawImage(
						w.image, src.sx, src.sy, src.sw, src.sh,
						part.x + cdx, part.y + cdy, grid, grid
					);
				}
			}
		}

		// 5. Debug grid (toggle with G).
		if (this.showGrid) {
			ctx.strokeStyle = 'rgba(238, 238, 238, 0.5)';
			ctx.lineWidth = 1 / s;
			ctx.beginPath();
			for (var gx = 0; gx <= this.options.cols; gx++) {
				ctx.moveTo(gx * grid, 0);
				ctx.lineTo(gx * grid, this.options.rows * grid);
			}
			for (var gy = 0; gy <= this.options.rows; gy++) {
				ctx.moveTo(0, gy * grid);
				ctx.lineTo(this.options.cols * grid, gy * grid);
			}
			ctx.stroke();
		}

		// 6. Markers — drawn in world space with size pre-scaled so the
		//    triangle stays a constant ~5.5px on canvas regardless of zoom.
		var markerIds = Object.keys(this.markers);
		if (markerIds.length > 0) {
			var radius = 5.5 / s;
			for (var mi = 0; mi < markerIds.length; mi++) {
				var m = this.markers[markerIds[mi]];
				ctx.save();
				ctx.translate(m.x, m.y);
				ctx.rotate(m.angle);
				ctx.globalAlpha = m.opacity;
				ctx.fillStyle = m.color;
				ctx.beginPath();
				ctx.moveTo(radius, 0);
				ctx.lineTo(-radius * 0.5, radius * 0.87);
				ctx.lineTo(-radius * 0.5, -radius * 0.87);
				ctx.closePath();
				ctx.fill();
				ctx.restore();
			}
			ctx.globalAlpha = 1;
		}
	};

	// createPerfOverlay shows FPS / avg+max frame-time in the corner when
	// the page is loaded with ?perf=1. Used to compare rendering cost
	// before/after optimisations on actual devices.
	function createPerfOverlay() {
		if (typeof location === 'undefined' || !/[?&]perf=1\b/.test(location.search)) return null;
		var el = document.createElement('div');
		el.style.cssText = [
			'position:fixed', 'top:42px', 'right:8px', 'z-index:30',
			'background:rgba(0,0,0,0.6)', 'color:#fff',
			'font:11px/1.25 ui-monospace,Menlo,monospace',
			'padding:4px 7px', 'border-radius:3px',
			'pointer-events:none', 'white-space:pre'
		].join(';');
		document.body.appendChild(el);

		var deltas = new Array(120);
		var head = 0, count = 0;
		var lastT = 0;
		var lastRender = 0;
		return {
			sample: function(now) {
				if (lastT > 0) {
					deltas[head] = now - lastT;
					head = (head + 1) % deltas.length;
					if (count < deltas.length) count++;
				}
				lastT = now;
				if (now - lastRender < 250) return;
				lastRender = now;
				if (count === 0) return;
				var sum = 0, max = 0;
				for (var i = 0; i < count; i++) {
					var d = deltas[i];
					sum += d;
					if (d > max) max = d;
				}
				var avg = sum / count;
				el.textContent =
					'FPS ' + (1000 / avg).toFixed(0) +
					'\navg ' + avg.toFixed(1) + 'ms' +
					'\nmax ' + max.toFixed(1) + 'ms';
			}
		};
	}

	window.Field = Field;

})();
