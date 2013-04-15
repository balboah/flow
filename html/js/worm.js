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
				if (i === 0) {
					part = new Kinetic.Wedge({
						radius: size / 2,
						angleDeg: 180,
						rotationDeg: 0,
						fill: this.color
					});
				}
				else {
					part = new Kinetic.Rect({
						width: size,
						height: size,
						fill: this.color
					});
				}
				this.parts.push(part);
				this.layer.add(part);
			}

			this.parts[0].moveToTop();
		}
	};

	Worm.prototype.move = function(positions) {
		var grid = this.flow.options.grid,
			half = grid / 2,
			i = 0,
			l = positions.length - 1,
			curr, next, prev,
			part,
			x, y,
			w, h;

		this.split(l);

		for (; i < l; i++) {
			curr = positions[i];
			next = positions[i + 1];

			x = (curr.X <= next.X ? curr.X : next.X + 1) * grid;
			y = (curr.Y <= next.Y ? curr.Y : next.Y + 1) * grid;
			w = grid;
			h = grid;

			part = this.parts[i];

			if (i === 0) {
				part.setPosition(x + half, y + half);
				if (curr.X === next.X) {
					if (curr.Y < next.Y) {
						part.setRotationDeg(180);
					}
					if (curr.Y > next.Y) {
						part.setRotationDeg(0);
					}
				}
				else if (curr.Y === next.Y) {
					if (curr.X < next.X) {
						part.setRotationDeg(90);
					}
					if (curr.X > next.X) {
						part.setRotationDeg(270);
					}
				}
			}
			else {
				if (i === 1) {
					prev = positions[0];
					if (curr.Y === prev.Y) {
						w += half;
						if (curr.X > prev.X) {
							x -= half;
						}
					}
					else {
						h += half;
						if (curr.Y > prev.Y) {
							y -= half;
						}
					}
				}
				part.setPosition(x, y);
				part.setSize(w, h);
			}
		}

		this.layer.draw();
	};

	Worm.prototype.kill = function() {
		this.layer.destroy();
		delete this.flow;
	};

	window.Worm = Worm;

})();