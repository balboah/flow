(function(){

	// Returns the worm sprite atlas index that this player will render with.
	// Always 3 (rainbow) for the local player so they can spot themselves.
	// Other players cycle deterministically between 2 (blue) and 1 (gray).
	window.atlasFor = function(id, ownId) {
		if (id === ownId) return 3;
		return [2, 1][((id - 1) % 2 + 2) % 2];
	};

	var ATLAS_LABEL = {
		1: 'gray',
		2: 'blue',
		3: 'rainbow'
	};

	function HUD(game) {
		this.game = game;
		this.ownId = null;
		this.ownName = null;
		this.scores = {};

		this.$nameInput = $('#name-input');
		this.$ownScore = $('#own-score');
		this.$scores = $('#scores');

		var self = this;
		this.$nameInput.on('change blur', function(){
			var v = self.$nameInput.val().trim();
			if (v && v !== self.ownName) {
				self.ownName = v;
				if (self.ownId != null && self.scores[self.ownId]) {
					self.scores[self.ownId].name = v;
				}
				self.render();
				game.send({Command: 'RENAME', Payload: v});
			}
		});
		this.$nameInput.on('keydown', function(ev){
			if (ev.keyCode === 13) {
				self.$nameInput.blur();
			}
		});
	}

	HUD.prototype.welcome = function(payload) {
		this.ownId = payload.Id;
		this.ownName = payload.Name;
		this.$nameInput.val(payload.Name);
		this.render();
	};

	HUD.prototype.updateScore = function(payload) {
		this.scores[payload.WormId] = {
			name: payload.Name,
			score: payload.Score
		};
		this.render();
	};

	HUD.prototype.removeWorm = function(id) {
		delete this.scores[id];
		this.render();
	};

	HUD.prototype.render = function() {
		if (this.ownId != null && this.scores[this.ownId]) {
			this.$ownScore.text(this.scores[this.ownId].score);
		}
		var html = '';
		var ids = Object.keys(this.scores).sort(function(a, b){
			return this.scores[b].score - this.scores[a].score;
		}.bind(this));
		for (var i = 0; i < ids.length; i++) {
			var id = Number(ids[i]);
			var entry = this.scores[ids[i]];
			var atlas = atlasFor(id, this.ownId);
			var cls = (id === this.ownId) ? 'entry self' : 'entry';
			cls += ' atlas-' + ATLAS_LABEL[atlas];
			html += '<span class="' + cls + '">' +
				'<span class="dot"></span>' +
				escapeHtml(entry.name) +
				': ' + entry.score +
				'</span>';
		}
		this.$scores.html(html);
		// HUD height can change when scores wrap on narrow viewports — ask
		// the field to refit so the canvas never overflows.
		if (this.game && this.game.field && this.game.field.fit) {
			this.game.field.fit();
		}
	};

	function escapeHtml(s) {
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	window.HUD = HUD;

})();
