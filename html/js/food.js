(function(){

	var FOOD_EMOJI = {
		apple:  '🍎',  // 🍎
		carrot: '🥕'   // 🥕
	};

	// Pre-render each emoji into an offscreen canvas. Many KineticJS 5.x setups
	// don't draw Kinetic.Text glyphs reliably in this build, so we paint the
	// glyph ourselves via fillText and reuse the result as an Image.
	var bitmapCache = {};
	function bitmapFor(emoji, size) {
		var key = emoji + '@' + size;
		if (bitmapCache[key]) {
			return bitmapCache[key];
		}
		var c = document.createElement('canvas');
		c.width = size;
		c.height = size;
		var ctx = c.getContext('2d');
		ctx.clearRect(0, 0, size, size);
		ctx.font = (size - 2) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla","EmojiOne Color",sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = '#000';
		ctx.fillText(emoji, size / 2, size / 2);
		bitmapCache[key] = c;
		return c;
	}

	function Food(payload, field) {
		this.id = payload.Id;
		this.x = payload.X;
		this.y = payload.Y;
		this.type = payload.Type;
		this.points = payload.Points;
		this.field = field;

		var grid = field.options.grid;
		var glyph = FOOD_EMOJI[this.type] || '?';
		var bitmap = bitmapFor(glyph, grid);

		this.shape = new Kinetic.Image({
			x: this.x * grid,
			y: this.y * grid,
			width: grid,
			height: grid,
			image: bitmap
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
