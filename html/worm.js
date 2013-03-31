(function(){

	function randomColor() {
		return Math.round(Math.random() * 200);
	}

	var Worm = function(id, flow) {
		this.id = id;

		var size = flow.options.grid;

		this.x = - size;
		this.y = - size;

		this.layer = new Kinetic.Layer();

		this.dot = new Kinetic.Rect({
			width: size,
			height: size,
			x: - size,
			y: - size,
			fill: 'rgb(' + randomColor() + ',' + randomColor() + ',' + randomColor() + ')',
			cornerRadius: Math.floor(size / 3)
		});
		this.layer.add(this.dot);

		flow.stage.add(this.layer);

		this.layer.moveToTop();

		return this;
	};

	Worm.prototype.move = function(x, y) {
		if (this.dot.getX() < 0) {
			this.dot.setPosition(x, y);
		}
		else {
			this.dot.transitionTo({
				x: x,
				y: y,
				duration: 0.2
			});
		}
	};

	Worm.prototype.kill = function() {
		this.layer.destroy();
	};

	window.Worm = Worm;

})();