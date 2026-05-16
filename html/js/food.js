(function(){

	var FOOD_COLORS = {
		apple:  '#e53935',
		carrot: '#fb8c00'
	};

	function Food(payload, field) {
		this.id = payload.Id;
		this.x = payload.X;
		this.y = payload.Y;
		this.type = payload.Type;
		this.points = payload.Points;
		this.field = field;

		var grid = field.options.grid;
		this.shape = new Kinetic.Circle({
			x: this.x * grid + grid / 2,
			y: this.y * grid + grid / 2,
			radius: grid / 2 - 2,
			fill: FOOD_COLORS[this.type] || '#aaa',
			stroke: '#222',
			strokeWidth: 1
		});

		field.foodLayer.add(this.shape);
		field.foodLayer.draw();

		return this;
	}

	Food.prototype.destroy = function(){
		this.shape.destroy();
		this.field.foodLayer.draw();
	};

	window.Food = Food;

})();
