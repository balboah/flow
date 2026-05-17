(function(){

	var FOOD_EMOJI = {
		apple:    '🍎',
		carrot:   '🥕',
		broccoli: '🥦',
		bomb:     '💣'
	};

	// Pre-render each emoji into an offscreen canvas. We paint the glyph
	// ourselves via fillText so the same bitmap can be reused across every
	// food of a given type / size — drawImage of a cached bitmap is much
	// cheaper than fillText every frame.
	var bitmapCache = {};
	function bitmapFor(emoji, size) {
		var key = emoji + '@' + size;
		if (bitmapCache[key]) return bitmapCache[key];
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

	// Food is plain state. Field's render loop draws every food at the 9
	// tile offsets so the camera always finds a copy somewhere in view —
	// the 3×3 tile arrangement matches the worm wrap behaviour.
	function Food(payload, field) {
		this.id = payload.Id;
		this.x = payload.X;
		this.y = payload.Y;
		this.type = payload.Type;
		this.points = payload.Points;
		this.bitmap = bitmapFor(FOOD_EMOJI[this.type] || '?', field.options.grid);
	}

	// Kept as a no-op so callers (Field.removeFood) don't need to special-case.
	Food.prototype.destroy = function() {};

	window.Food = Food;

})();
