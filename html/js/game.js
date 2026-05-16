(function(){

	var $document = $(document);

	var STORAGE_NAME = 'flow.name';
	var STORAGE_TOKEN = 'flow.token';

	function loadStored(key) {
		try { return localStorage.getItem(key) || ''; }
		catch (e) { return ''; }
	}
	function storeKey(key, value) {
		try { localStorage.setItem(key, value); } catch (e) {}
	}

	var game = window.game = {

		ws: null,

		init: function(){
			game.field = new Field();
			game.hud = new HUD(game);
			game.bindGameOver();
			// Always confirm the alias on page load. Pre-fill with the last
			// one used so a quick refresh is a single Enter press.
			game.showWelcome(loadStored(STORAGE_NAME));
		},

		showWelcome: function(prefill){
			var $panel = $('#welcome');
			var $form = $('#welcome-form');
			var $input = $('#welcome-name');
			if (prefill) {
				$input.val(prefill);
			}
			$panel.removeAttr('hidden');
			setTimeout(function(){
				$input.focus();
				$input[0] && $input[0].select && $input[0].select();
			}, 0);
			$form.off('submit').on('submit', function(ev){
				ev.preventDefault();
				var v = $input.val().trim();
				if (!v) {
					$input.focus();
					return;
				}
				// User gesture — kick the audio context awake here so the
				// welcome jingle and subsequent SFX can play in browsers
				// that gate audio on interaction.
				if (window.sounds) {
					sounds.init();
					sounds.welcome();
				}
				storeKey(STORAGE_NAME, v);
				$panel.attr('hidden', true);
				game.connect(v);
			});
		},

		bindGameOver: function(){
			var $panel = $('#gameover');
			var $reason = $('#gameover-reason');
			var $score = $('#gameover-score');
			$('#gameover-restart').on('click', function(){
				$panel.attr('hidden', true);
				game.send({Command: 'RESPAWN'});
			});
			game.showGameOver = function(reason, score) {
				$reason.text(reason || 'You died.');
				$score.text(score != null ? score : 0);
				$panel.removeAttr('hidden').find('button').focus();
			};
			game.hideGameOver = function() {
				$panel.attr('hidden', true);
			};
		},

		// Opens a WebSocket connection. `name` is the player's chosen alias.
		connect: function(name){
			var proto = (document.location.protocol === 'https:') ? 'wss:' : 'ws:';
			var ws = game.ws = new WebSocket(proto + '//' + document.location.host + '/worms');

			ws.onerror = function(error){
				console.error('WebSocket Error', error);
			};

			ws.onmessage = function(ev){
				var packet = JSON.parse(ev.data);
				var handler = game.commands[packet.Command.toLowerCase()];
				if (handler) {
					handler(packet.Payload);
				} else {
					console.warn('Unhandled packet', packet);
				}
			};

			ws.onopen = function(){
				var token = loadStored(STORAGE_TOKEN);
				game.send({Command: 'HELLO', Payload: {Name: name, Token: token}});
				game.bindControls();
			};

		},

		bindControls: function(){
			$document.off('keydown.flow').on('keydown.flow', function(ev){
				if (ev.target && ev.target.tagName === 'INPUT') {
					return;
				}
				if ([37, 38, 39, 40].indexOf(ev.keyCode) > -1) {
					ev.preventDefault();
					var dir = {37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN'}[ev.keyCode];
					game.send({Command: 'MOVE', Payload: dir});
				}
				if (ev.keyCode === 71) {
					game.field.grid();
				}
			});

			// Touch swipe controls. Bound to #playfield so HUD interaction
			// (typing in the name input, scrolling the leaderboard) still
			// behaves normally. The CSS `touch-action: none` on the canvas
			// prevents the browser from scrolling the page on the same
			// gesture; preventDefault is a backup for older browsers.
			var startX = null, startY = null;
			var $field = $('#playfield');
			$field.off('touchstart.flow touchmove.flow touchend.flow touchcancel.flow');
			$field.on('touchstart.flow', function(ev){
				var t = ev.originalEvent.touches[0];
				if (!t) return;
				startX = t.clientX;
				startY = t.clientY;
				ev.preventDefault();
			});
			$field.on('touchmove.flow', function(ev){
				if (startX !== null) ev.preventDefault();
			});
			$field.on('touchend.flow touchcancel.flow', function(ev){
				if (startX === null) return;
				var t = (ev.originalEvent.changedTouches || [])[0];
				var sx = startX, sy = startY;
				startX = null; startY = null;
				if (!t) return;
				var dx = t.clientX - sx;
				var dy = t.clientY - sy;
				if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
				var dir;
				if (Math.abs(dx) > Math.abs(dy)) {
					dir = dx > 0 ? 'RIGHT' : 'LEFT';
				} else {
					dir = dy > 0 ? 'DOWN' : 'UP';
				}
				game.send({Command: 'MOVE', Payload: dir});
			});
		},

		// Send packet to server
		send: function(data){
			if (game.ws && game.ws.readyState === WebSocket.OPEN) {
				game.ws.send(JSON.stringify(data));
			}
		},

		// Game commands received from server
		commands: {

			welcome: function(payload) {
				game.hud.welcome(payload);
				if (payload.Token) {
					storeKey(STORAGE_TOKEN, payload.Token);
				}
				if (payload.Name) {
					storeKey(STORAGE_NAME, payload.Name);
				}
				// Drop any stale worm visual on (re)connect so the next MOVE
				// renders fresh blocks for our worm.
				if (game.field.worms[payload.Id]) {
					game.field.kill(payload.Id);
				}
				if (payload.Dead) {
					// Reconnected to a worm that died while we were away.
					game.showGameOver(payload.DeathReason, payload.Score || 0);
				} else {
					game.hideGameOver();
				}
			},

			move: function(payload) {
				var worm = game.field.getWorm(payload.Id);
				worm.move(payload.Positions);
				// Keep the local player's head centered when the field's in
				// camera-follow mode (narrow viewports).
				if (payload.Id === game.hud.ownId && payload.Positions.length > 0) {
					var head = payload.Positions[0];
					var grid = game.field.options.grid;
					game.field.centerOn(
						head.X * grid + grid / 2,
						head.Y * grid + grid / 2
					);
				}
			},

			kill: function(payload) {
				var id = parseInt(payload, 10);
				game.field.kill(id);
				game.hud.removeWorm(id);
			},

			food: function(payload) {
				game.field.addFood(payload);
			},

			eat: function(payload) {
				var food = game.field.foods[payload.FoodId];
				if (window.sounds && payload.WormId === game.hud.ownId && food) {
					if (food.type === 'apple') sounds.apple();
					else sounds.carrot();
				}
				game.field.removeFood(payload.FoodId);
			},

			score: function(payload) {
				// Detect crossing a growth threshold for the local player so
				// we can ping the grow jingle. The actual grow logic is on
				// the server; this is purely audio feedback.
				if (window.sounds && payload.WormId === game.hud.ownId) {
					var prev = game.hud.scores[payload.WormId];
					var prevScore = prev ? prev.score : 0;
					var threshold = 30;
					if (Math.floor(payload.Score / threshold) > Math.floor(prevScore / threshold)) {
						sounds.grow();
					}
				}
				game.hud.updateScore(payload);
			},

			gameover: function(payload) {
				var id = payload.WormId;
				var dying = game.field.worms[id];
				if (dying && dying.lastPositions) {
					game.field.explode(dying.lastPositions);
				}
				game.field.kill(id);
				if (window.sounds) {
					if (id === game.hud.ownId) sounds.die();
					else sounds.pop();
				}
				if (id === game.hud.ownId) {
					var score = (game.hud.scores[id] && game.hud.scores[id].score) || 0;
					game.showGameOver(payload.Reason, score);
				}
			}

		}

	};

})();
