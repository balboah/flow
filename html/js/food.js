(function(){

	var FOOD_EMOJI = {
		apple:  '🍎',
		carrot: '🥕',
		bomb:   '💣'
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

	// Food renders 9 sprites in a 3×3 tile arrangement so that as the camera
	// pans past a field edge in camera-follow mode the next tile's copy comes
	// into view — no food ever "vanishes" at the boundary. Eight of the nine
	// copies lie outside the canonical 0..logicalSize rect; they only become
	// visible when the camera has panned beyond an edge.
	function Food(payload, field) {
		this.id = payload.Id;
		this.x = payload.X;
		this.y = payload.Y;
		this.type = payload.Type;
		this.points = payload.Points;
		this.field = field;

		var grid = field.options.grid;
		var fieldPx = field.logicalSize;
		var glyph = FOOD_EMOJI[this.type] || '?';
		var bitmap = bitmapFor(glyph, grid);

		this.shapes = [];
		for (var tx = -1; tx <= 1; tx++) {
			for (var ty = -1; ty <= 1; ty++) {
				var shape = new Kinetic.Image({
					x: this.x * grid + tx * fieldPx,
					y: this.y * grid + ty * fieldPx,
					width: grid,
					height: grid,
					image: bitmap
				});
				field.foodLayer.add(shape);
				this.shapes.push(shape);
			}
		}
		field.foodLayer.draw();

		return this;
	}

	Food.prototype.destroy = function(){
		for (var i = 0; i < this.shapes.length; i++) {
			this.shapes[i].destroy();
		}
		this.field.foodLayer.draw();
	};

	window.Food = Food;

})();
