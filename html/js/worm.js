(function(){

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
		var otherAtlases = [2, 1];
		if (window.game && game.hud && id === game.hud.ownId) {
			this.type = 3;
		} else {
			this.type = otherAtlases[(id - 1) % otherAtlases.length];
		}

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
			this.dot.setVisible(false);
		}
	};

	Worm.prototype.move = function(positions) {
		this.lastPositions = positions;
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
			// |delta| > 1 means this pair sits across a wrap-around edge.
			// Skip the cell-spanning interpolation in that case — the body
			// part should appear at `curr` itself so it re-enters on the
			// opposite side without snapping through the middle of the field.
			var wrapped = Math.abs(next.X - curr.X) > 1 || Math.abs(next.Y - curr.Y) > 1;
			if (wrapped) {
				x = curr.X * grid;
				y = curr.Y * grid;
			} else {
				x = (curr.X <= next.X ? curr.X : next.X + 1) * grid;
				y = (curr.Y <= next.Y ? curr.Y : next.Y + 1) * grid;
			}

			part = this.parts[i];
			part.setPosition({x: x, y: y});

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
		// Normalised one-cell deltas from curr to its neighbours.
		var p = stepDelta(curr, prev);
		var n = stepDelta(curr, next);

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
		this.layer.destroy();
		delete this.flow;
	};

	window.Worm = Worm;

})();
