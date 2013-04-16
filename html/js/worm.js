(function(){

	var sprites = [];

	for (var j = 0; j < 5; j++) {
		for (var i = 0; i < 4; i++) {
			sprites.push({
				x: i * 20,
				y: j * 20,
				width: 20,
				height: 20
			});
		}
	}

	function randomColor() {
		return Math.round(50 + Math.random() * 150);
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

		this.type = Math.ceil(Math.random() * 2);

		this.image = new Image();
		this.image.src = '/img/worm-' + this.type + '.png';

		return this;
	};

	Worm.prototype.split = function(count) {
		if (count > this.parts.length) {
			var grid = this.flow.options.grid,
				i = this.parts.length,
				part;

			for (; i < count; i++) {
				part = new Kinetic.Sprite({
					width: grid,
					height: grid,
					image: this.image,
					animation: 'idle',
					animations: {
						idle: sprites
					},
					index: 0
				});
				this.parts.push(part);
				this.layer.add(part);
			}

			this.parts[0].moveToTop();
			this.dot.moveToTop();
		}
	};

	Worm.prototype.move = function(positions) {
		var grid = this.flow.options.grid,
			i = 0,
			l = positions.length - 1,
			prev, curr, next,
			part,
			x, y;

		this.split(l);

		for (; i < l; i++) {
			curr = positions[i];
			next = positions[i + 1];

			x = (curr.X <= next.X ? curr.X : next.X + 1) * grid;
			y = (curr.Y <= next.Y ? curr.Y : next.Y + 1) * grid;

			part = this.parts[i];
			part.setPosition(x, y);

			if (i === 0) {
				this.doHead(part, curr, next, x, y);
			}
			else {
				prev = positions[i - 1];

				// Hide inital spawned parts in the same spot
				part.setVisible(curr.X !== prev.X || curr.Y !== prev.Y);

				if (i === l - 1) {
					this.doTail(part, curr, prev);
				}
				else {
					this.doBody(part, curr, prev, next);
				}
			}
		}

		this.layer.draw();
	};

	Worm.prototype.doHead = function(part, curr, next, x, y) {
		var grid = this.flow.options.grid;

		this.dot.setPosition(x + grid / 2, y + grid / 2);
		this.dot.setRadius(grid / 5);

		if (curr.X === next.X) {
			// Sprite 1 - head up
			if (curr.Y < next.Y) {
				part.setIndex(1);
			}
			// Sprite 2 - head down
			else if (curr.Y > next.Y) {
				part.setIndex(2);
			}
		}
		else {
			// Sprite 0 - head left
			if (curr.X < next.X) {
				part.setIndex(0);
			}
			// Sprite 3 - head right
			else if (curr.X > next.X) {
				part.setIndex(3);
			}
		}
	};

	Worm.prototype.doBody = function(part, curr, prev, next) {
		// Sprite 12 - body left-right
		if (next.Y === prev.Y) {
			part.setIndex(12);
		}
		// Sprite 13 - body top-down
		else if (next.X === prev.X) {
			part.setIndex(13);
		}
		else {
			var px = curr.X - prev.X,
				py = curr.Y - prev.Y,
				nx = curr.X - next.X,
				ny = curr.Y - next.Y;

			// Sprite 4 - corner left-down
			if ((!px && py === -1 && nx === 1 && !ny) ||
				(px === 1 && !py && !nx && ny === -1)) {
				part.setIndex(4);
			}
			// Sprite 5 - corner right-down
			else if ((!px && py === -1 && nx === -1 && !ny) ||
					(px === -1 && !py && !nx && ny === -1)) {
				part.setIndex(5);
			}
			// Sprite 6 - corner left-up
			else if ((!px && py === 1 && nx === 1 && !ny) ||
					(px === 1 && !py && !nx && ny === 1)) {
				part.setIndex(6);
			}
			// Sprite 7 - corner right-up
			else if ((!px && py === 1 && nx === -1 && !ny) ||
					(px === -1 && !py && !nx && ny === 1)) {
				part.setIndex(7);
			}
		}
	};

	Worm.prototype.doTail = function(part, curr, prev) {
		if (curr.X === prev.X) {
			// Sprite 9 - tail up
			if (curr.Y > prev.Y) {
				part.setIndex(9);
			}
			// Sprite 10 - tail down
			else if (curr.Y < prev.Y) {
				part.setIndex(10);
			}
		}
		else {
			// Sprite 8 - tail left
			if (curr.X > prev.X) {
				part.setIndex(8);
			}
			// Sprite 11 - tail right
			else if (curr.X < prev.X) {
				part.setIndex(11);
			}
		}
	};

	Worm.prototype.kill = function() {
		this.layer.destroy();
		delete this.flow;
	};

	window.Worm = Worm;

})();