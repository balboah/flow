(function(){

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
			var id = ids[i];
			var entry = this.scores[id];
			var cls = (String(id) === String(this.ownId)) ? 'entry self' : 'entry';
			html += '<span class="' + cls + '">' + escapeHtml(entry.name) +
				': ' + entry.score + '</span>';
		}
		this.$scores.html(html);
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
