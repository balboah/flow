(function(){

	function Field(options) {
		this.options = $.extend({}, Field.defaults, options || {});

		this.worms = {};
		this.count = 0;
		this.foods = {};

		this.logicalSize = this.options.cols * this.options.grid;

		this.stage = new Kinetic.Stage({
			container: 'playfield',
			width: this.logicalSize,
			height: this.logicalSize
		});

		// Food layer sits below worms so the head sprite always reads cleanly.
		this.foodLayer = new Kinetic.Layer();
		this.stage.add(this.foodLayer);

		// Particle layer for explosion effects — kept above everything else
		// so debris draws on top of the surviving worms.
		this.particleLayer = new Kinetic.Layer();
		this.stage.add(this.particleLayer);

		var self = this;
		this.fit();
		$(window).on('resize.flow-field', function(){ self.fit(); });

		return this;
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
			this.stage.size({width: availW, height: availH});
			this.stage.scale({x: cameraScale, y: cameraScale});
		} else {
			this.cameraMode = false;
			this.stage.size({width: avail, height: avail});
			this.stage.scale({x: fitScale, y: fitScale});
			this.stage.position({x: 0, y: 0});
		}
		this.stage.batchDraw();
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
	};

	Field.prototype.removeFood = function(id) {
		var f = this.foods[id];
		if (f) {
			f.destroy();
			delete this.foods[id];
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