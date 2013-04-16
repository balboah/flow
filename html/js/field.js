(function(){

	function Field(options) {
		this.options = $.extend({}, Field.defaults, options || {});

		this.worms = {};
		this.count = 0;

		this.stage = new Kinetic.Stage({
			container: 'playfield',
			width: this.options.cols * this.options.grid,
			height: this.options.rows * this.options.grid
		});

		return this;
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