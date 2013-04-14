(function(){

	function randomColor() {
		return Math.round(Math.random() * 200);
	}

	var Worm = function(id, flow) {
		this.id = id;

		this.color = 'rgb(' + randomColor() + ',' + randomColor() + ',' + randomColor() + ')';

		this.flow = flow;
		this.layer = new Kinetic.Layer();

		this.parts = [];

		flow.stage.add(this.layer);

		this.layer.moveToTop();

		return this;
	};

	Worm.prototype.split = function(count) {
		if (count > this.parts.length) {
			var size = this.flow.options.grid,
				i = this.parts.length,
				part;

			for (; i < count; i++) {
				part = new Kinetic.Rect({
					width: size,
					height: size,
					x: - size,
					y: - size,
					fill: this.color
				});
				this.parts.push(part);
				this.layer.add(part);
			}
		}
	};

	Worm.prototype.move = function(positions) {
		var grid = this.flow.options.grid,
			i = 0,
			l = positions.length - 1,
			pos, next,
			x, y,
			w, h;

		this.split(l);

		for (; i < l; i++) {
			pos = positions[i];
			next = positions[i + 1];

			x = (pos.X <= next.X ? pos.X : next.X + 1);
			y = (pos.Y <= next.Y ? pos.Y : next.Y + 1);
			w = Math.max(1, Math.abs(pos.X - next.X));
			h = Math.max(1, Math.abs(pos.Y - next.Y));

			this.parts[i].setPosition(x * grid, y * grid);
			this.parts[i].setSize(w * grid, h * grid);
		}

		this.layer.draw();
	};

	Worm.prototype.kill = function() {
		this.layer.destroy();
		delete this.flow;
	};

	window.Worm = Worm;

})();