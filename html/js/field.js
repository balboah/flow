(function(){

	function Field(options) {
		this.options = $.extend({}, Field.defaults, options || {});

		this.worms = {};
		this.count = 0;
		this.foods = {};
		this.markerNodes = {};

		this.logicalSize = this.options.cols * this.options.grid;

		this.stage = new Kinetic.Stage({
			container: 'playfield',
			width: this.logicalSize,
			height: this.logicalSize
		});

		// Ground layer at the bottom. Sparse procedural dots scroll past the
		// player in camera-follow mode, giving the worm a sense of motion
		// even when the head stays pinned to the centre of the canvas.
		this.groundLayer = new Kinetic.Layer();
		this.stage.add(this.groundLayer);
		this.buildGround();

		// Food layer sits above the ground but below worms so the head sprite
		// always reads cleanly.
		this.foodLayer = new Kinetic.Layer();
		this.stage.add(this.foodLayer);

		// Particle layer for explosion effects.
		this.particleLayer = new Kinetic.Layer();
		this.stage.add(this.particleLayer);

		// Marker layer for off-screen food indicators in camera mode. Lives
		// on top of everything else so the arrows never get covered.
		this.markerLayer = new Kinetic.Layer();
		this.stage.add(this.markerLayer);

		this._perf = createPerfOverlay();

		var self = this;
		this.fit();
		$(window).on('resize.flow-field', function(){ self.fit(); });

		return this;
	};

	// createPerfOverlay shows FPS / avg+max frame-time in the corner when
	// the page is loaded with ?perf=1. Used to compare rendering cost
	// before/after optimisations on actual devices (iPhone in particular).
	function createPerfOverlay() {
		if (typeof location === 'undefined' || !/[?&]perf=1\b/.test(location.search)) {
			return null;
		}
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

	// buildGround sprinkles deterministic dots across the field and replicates
	// the same pattern in a 3×3 tile arrangement around the canonical field.
	// This way when the camera pans past an edge in camera-follow mode there
	// is always content under the player — the world reads as continuous
	// instead of suddenly hitting a "void".
	//
	// The dots are static, so we rasterise the whole tile into one offscreen
	// canvas once and stamp it 9 times as Kinetic.Image. The previous version
	// added ~3,300 individual Kinetic.Circle nodes which got re-stroked on
	// every stage.batchDraw() (i.e. every camera-mode rAF) — the dominant
	// cost on mobile.
	Field.prototype.buildGround = function() {
		var fieldPx = this.logicalSize;
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

		// Rasterise once into a tile-sized offscreen canvas. Entries are
		// also drawn at each 8-neighbour offset so the wrap-bleed (big
		// blobs near a tile edge spilling into the adjacent tile) is baked
		// into the cached image — visually identical to the prior 3×3
		// node replication, just paid once at startup instead of every
		// frame.
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
					// Cheap reject: skip offsets that can't intersect
					// the tile rect. Canvas would clip anyway, but skipping
					// avoids the arc-fill setup cost.
					if (cx + en.r < 0 || cx - en.r > fieldPx ||
						cy + en.r < 0 || cy - en.r > fieldPx) continue;
					cctx.beginPath();
					cctx.arc(cx, cy, en.r, 0, Math.PI * 2);
					cctx.fill();
				}
			}
		}
		cctx.globalAlpha = 1;

		for (var tx = -1; tx <= 1; tx++) {
			for (var ty = -1; ty <= 1; ty++) {
				this.groundLayer.add(new Kinetic.Image({
					x: tx * fieldPx, y: ty * fieldPx,
					width: fieldPx, height: fieldPx,
					image: cache,
					listening: false
				}));
			}
		}
	};

	// fit resizes the stage canvas to whatever fits in the viewport (below the
	// HUD). On viewports large enough to show the whole 50×50 field at a
	// comfortable cell size, we use "fit" mode (entire field scaled to fit).
	// On narrower viewports, we switch to "camera" mode: the canvas fills the
	// viewport, the cells render closer to native size, and the stage is
	// panned each tick to keep the player's head centred (centerOn()).
	Field.prototype.fit = function() {
		var hudHeight = $('#hud').outerHeight() || 0;
		$('#playfield').css('top', hudHeight + 'px');

		var availW = Math.max(160, window.innerWidth - 8);
		var availH = Math.max(160, window.innerHeight - hudHeight - 8);
		var avail = Math.min(availW, availH);

		// What scale would fit the whole field? If that scale shrinks cells
		// below comfortPx, drop into camera-follow mode at a native-ish scale.
		var fitScale = avail / this.logicalSize;
		var nativeCellPx = this.options.grid;
		var comfortPx = 14; // smallest cell size we tolerate in fit mode
		var comfortScale = comfortPx / nativeCellPx;

		if (fitScale < comfortScale) {
			this.cameraMode = true;
			var cameraScale = Math.min(0.9, Math.max(comfortScale, fitScale * 1.6));
			// Cap canvas dimensions to one tile (= logicalSize * scale in canvas
			// px). The world is tiled 3×3 for the wrap-camera feel; if either
			// axis of the viewport projected to more world units than one
			// tile, neighbouring tile copies would become simultaneously
			// visible and the player would see mirrored worms / food. Padding
			// at the top/bottom or sides is the lesser evil — it reads as a
			// neat letterbox around the play area.
			var oneTilePx = Math.floor(this.logicalSize * cameraScale);
			var canvasW = Math.min(availW, oneTilePx);
			var canvasH = Math.min(availH, oneTilePx);
			this.stage.setWidth(canvasW);
			this.stage.setHeight(canvasH);
			this.stage.scale({x: cameraScale, y: cameraScale});
		} else {
			this.cameraMode = false;
			this.stage.size({width: avail, height: avail});
			this.stage.scale({x: fitScale, y: fitScale});
			this.stage.position({x: 0, y: 0});
			// Camera mode lets the local worm accumulate continuous-coord
			// offset past the field boundary. Fit mode forces stage origin
			// to (0,0) which would leave the local worm rendered far off
			// the canvas — rebase its continuous state back into [0, cols)
			// so it stays visible.
			if (window.game && game.hud && this.worms[game.hud.ownId]) {
				var local = this.worms[game.hud.ownId];
				if (local.useContinuous && local.continuousCells && local.continuousCells[0]) {
					var shiftX = Math.floor(local.continuousCells[0].X / this.options.cols) * this.options.cols;
					var shiftY = Math.floor(local.continuousCells[0].Y / this.options.rows) * this.options.rows;
					if (shiftX !== 0 || shiftY !== 0) {
						local.rebase(shiftX, shiftY);
					}
				}
			}
		}
		this.stage.batchDraw();
		// Marker visibility depends on cameraMode; refresh after a refit.
		this.updateMarkers();
	};

	// centerOn pans the stage so a logical pixel point (x, y) sits at the
	// middle of the visible canvas. No-op outside camera mode.
	Field.prototype.centerOn = function(x, y) {
		if (!this.cameraMode) return;
		var s = this.stage.scale().x;
		var w = this.stage.width();
		var h = this.stage.height();
		this.stage.position({
			x: w / 2 - x * s,
			y: h / 2 - y * s
		});
		this.stage.batchDraw();
	};

	// MARKER_THROTTLE_MS caps how often the off-screen food markers
	// recompute from inside the rAF loop. They follow the camera, so 50ms
	// (~20Hz) is well below the threshold where the lag is noticeable but
	// avoids redoing the per-food / 9-tile-offset math 60 times per second.
	var MARKER_THROTTLE_MS = 50;

	// requestAnimation kicks a single rAF loop that ticks every worm's tween,
	// recenters the camera on the local player's interpolated head, and
	// refreshes the off-screen food markers. The loop ends as soon as no
	// worm reports an active tween. Browsers already pause rAF when the tab
	// is hidden — worm.tick() clamps t to 1, so on visibility resume the
	// next rAF cleanly snaps sprites to their tween end and the loop exits.
	Field.prototype.requestAnimation = function() {
		if (this.rafScheduled) return;
		this.rafScheduled = true;
		var self = this;
		var loop = function(now) {
			if (self._perf) self._perf.sample(now);
			var anyActive = false;
			var ownId = (window.game && game.hud) ? game.hud.ownId : null;
			var grid = self.options.grid;
			var ids = Object.keys(self.worms);
			for (var i = 0; i < ids.length; i++) {
				var idNum = parseInt(ids[i], 10);
				var w = self.worms[ids[i]];
				var active = w.tick(now);
				if (active) anyActive = true;
				// Camera tracks the local player by interpolated head pixel.
				if (idNum === ownId && w.visualPx && w.visualPx[0]) {
					self.centerOn(
						w.visualPx[0].x + grid / 2,
						w.visualPx[0].y + grid / 2
					);
				}
			}
			if (now - (self._lastMarkerTime || 0) >= MARKER_THROTTLE_MS) {
				self._lastMarkerTime = now;
				self.updateMarkers();
			}
			if (anyActive) {
				requestAnimationFrame(loop);
			} else {
				self.rafScheduled = false;
			}
		};
		requestAnimationFrame(loop);
	};

	// updateMarkers draws small triangles at the viewport edges pointing
	// toward foods that fall outside the visible camera area. Cheap pool:
	// one Kinetic node per food id, reused across frames.
	Field.prototype.updateMarkers = function() {
		if (!this.markerLayer) return;
		if (!this.cameraMode) {
			// No off-screen problem in fit mode — clear any leftovers.
			var existing = Object.keys(this.markerNodes);
			for (var e = 0; e < existing.length; e++) {
				this.markerNodes[existing[e]].destroy();
				delete this.markerNodes[existing[e]];
			}
			this.markerLayer.batchDraw();
			return;
		}

		var s = this.stage.scale().x;
		var pos = this.stage.position();
		var W = this.stage.width(), H = this.stage.height();
		var grid = this.options.grid;

		// Viewport bounds expressed in world (logical pixel) coordinates.
		var worldLeft = -pos.x / s;
		var worldRight = (W - pos.x) / s;
		var worldTop = -pos.y / s;
		var worldBottom = (H - pos.y) / s;

		var cx = (worldLeft + worldRight) / 2;
		var cy = (worldTop + worldBottom) / 2;

		// Inset markers slightly from the canvas edge so they don't clip.
		var insetCanvasPx = 14;
		var inset = insetCanvasPx / s;
		var minX = worldLeft + inset;
		var maxX = worldRight - inset;
		var minY = worldTop + inset;
		var maxY = worldBottom - inset;

		// Each food has 9 tile copies (see Food). Pick the copy nearest the
		// camera so the marker points to the closest instance — which is
		// what the player will actually run into, especially after the
		// local worm has wrapped and the camera lives in a non-zero tile.
		var fieldPx = this.logicalSize;
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
				// Inside the camera — no marker needed.
				if (this.markerNodes[id]) {
					this.markerNodes[id].destroy();
					delete this.markerNodes[id];
				}
				continue;
			}

			// Ray from camera centre toward the food, clipped to the
			// inset viewport rect. Pick the nearer axis intersection.
			var dx = fx - cx, dy = fy - cy;
			var tX = Infinity, tY = Infinity;
			if (dx > 0) tX = (maxX - cx) / dx;
			else if (dx < 0) tX = (minX - cx) / dx;
			if (dy > 0) tY = (maxY - cy) / dy;
			else if (dy < 0) tY = (minY - cy) / dy;
			var t = Math.min(tX, tY);
			if (!isFinite(t) || t < 0) continue;
			var mx = cx + dx * t;
			var my = cy + dy * t;
			var angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;

			// Subtle palette — markers should hint, not shout. Bombs use a
			// muted gray so the player can recognise them as warnings
			// rather than rewards without the marker dominating the HUD.
			var color, opacity;
			if (f.type === 'bomb') {
				color = '#5a5e72';
				opacity = 0.35;
			} else if (f.type === 'apple') {
				color = '#c45c5c';
				opacity = 0.40;
			} else {
				color = '#c98a4a';
				opacity = 0.40;
			}
			var radius = 5.5 / s;           // constant ~5.5px in canvas space

			var node = this.markerNodes[id];
			if (!node) {
				node = new Kinetic.RegularPolygon({
					sides: 3,
					radius: radius,
					fill: color,
					opacity: opacity
				});
				this.markerLayer.add(node);
				this.markerNodes[id] = node;
			}
			node.setPosition({x: mx, y: my});
			node.setRadius(radius);
			node.setFill(color);
			node.setOpacity(opacity);
			// RegularPolygon's tip points up at rotation 0; +90° aligns it
			// with the +X axis, then atan2 deg rotates toward the food.
			node.setRotation(angleDeg + 90);
			seen[id] = true;
		}

		// Reap markers for foods that are gone or now in view.
		var current = Object.keys(this.markerNodes);
		for (var c = 0; c < current.length; c++) {
			if (!seen[current[c]]) {
				this.markerNodes[current[c]].destroy();
				delete this.markerNodes[current[c]];
			}
		}
		this.markerLayer.batchDraw();
	};

	Field.defaults = {
		grid: 20,
		cols: 50,
		rows: 50
	};

	Field.prototype.getWorm = function(id) {
		if (!this.worms[id]) {
			this.worms[id] = new Worm(id, this);
			this.count++;
			console.info('[Field] new worm: %s - total worms: %s', id, this.count);
		}
		return this.worms[id];
	};

	Field.prototype.kill = function(id) {
		if (this.worms[id]) {
			this.worms[id].kill();
			delete this.worms[id];
			this.count--;
			console.info('[Field] killed worm: %s - total worms: %s', id, this.count);
		}
	};

	// explode scatters short-lived pixel debris from each cell in `positions`.
	// Used by the game-over handler so a dying worm leaves a visual mark
	// instead of just blinking out.
	Field.prototype.explode = function(positions) {
		if (!positions || !positions.length) return;
		var grid = this.options.grid;
		var layer = this.particleLayer;
		var particlesPerCell = 7;
		for (var p = 0; p < positions.length; p++) {
			var pos = positions[p];
			var cx = pos.X * grid + grid / 2;
			var cy = pos.Y * grid + grid / 2;
			for (var i = 0; i < particlesPerCell; i++) {
				var size = 3 + Math.random() * 4;
				var angle = Math.random() * Math.PI * 2;
				var dist = 18 + Math.random() * 36;
				var dx = Math.cos(angle) * dist;
				var dy = Math.sin(angle) * dist;
				// Warm explosion palette: red → orange → yellow.
				var hue = 10 + Math.random() * 50;
				var part = new Kinetic.Rect({
					x: cx - size / 2,
					y: cy - size / 2,
					width: size,
					height: size,
					fill: 'hsl(' + hue + ', 100%, 55%)',
					opacity: 1
				});
				layer.add(part);
				(function(node, tx, ty){
					new Kinetic.Tween({
						node: node,
						duration: 0.45 + Math.random() * 0.2,
						x: tx,
						y: ty,
						opacity: 0,
						onFinish: function(){
							node.destroy();
							layer.batchDraw();
						}
					}).play();
				})(part, cx + dx - size / 2, cy + dy - size / 2);
			}
		}
		layer.batchDraw();
	};

	Field.prototype.addFood = function(payload) {
		if (this.foods[payload.Id]) {
			return;
		}
		this.foods[payload.Id] = new Food(payload, this);
		this.updateMarkers();
	};

	Field.prototype.removeFood = function(id) {
		var f = this.foods[id];
		if (f) {
			f.destroy();
			delete this.foods[id];
			this.updateMarkers();
		}
	};

	Field.prototype.update = function(_options) {
		var oldGrid = this.options.grid;

		this.options = $.extend(this.options, _options);

		if (_options.grid !== oldGrid) {
			this.stage.setWidth(this.options.cols * this.options.grid);
			this.stage.setHeight(this.options.rows * this.options.grid);
		}
	};

	Field.prototype.grid = function(enable) {
		if (!this.gridLayer) {
			this.gridLayer = new Kinetic.Layer();

			var options = this.options,
				i;

			for (i = 0; i < options.rows; i++) {
				this.gridLayer.add(new Kinetic.Line({
					points: [
						[0,                           i * options.grid],
						[options.cols * options.grid, i * options.grid]
					],
					stroke: '#eee'
				}));
			}
			for (i = 0; i < options.cols; i++) {
				this.gridLayer.add(new Kinetic.Line({
					points: [
						[i * options.grid, 0],
						[i * options.grid, options.rows * options.grid]
					],
					stroke: '#eee'
				}));
			}

			this.stage.add(this.gridLayer);

			this.gridLayer.moveToBottom();
			this.gridLayer.setVisible(false);
		}

		if (arguments.length) {
			this.gridLayer.setVisible(enable);
		}
		else {
			this.gridLayer.setVisible(!this.gridLayer.getVisible());
		}
	};

	window.Field = Field;

})();