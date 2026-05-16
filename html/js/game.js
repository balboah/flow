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
					sounds.startMusic();
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
			// Send a MOVE and give the local head sprite immediate visual
			// feedback. The server is still authoritative — it'll either
			// confirm the direction on the next tick (200ms) or reject it
			// (U-turn / invalid). Showing the rotation now hides the input
			// latency without lying about the worm's actual position.
			function steer(dir) {
				game.send({Command: 'MOVE', Payload: dir});
				if (game.hud && game.hud.ownId != null &&
					game.field && game.field.worms[game.hud.ownId] &&
					game.field.worms[game.hud.ownId].previewDirection) {
					game.field.worms[game.hud.ownId].previewDirection(dir);
				}
			}

			$document.off('keydown.flow').on('keydown.flow', function(ev){
				if (ev.target && ev.target.tagName === 'INPUT') {
					return;
				}
				if ([37, 38, 39, 40].indexOf(ev.keyCode) > -1) {
					ev.preventDefault();
					steer({37: 'LEFT', 38: 'UP', 39: 'RIGHT', 40: 'DOWN'}[ev.keyCode]);
				}
				if (ev.keyCode === 71) {
					game.field.grid();
				}
			});

			// Touch swipe controls. Fires MOVE as soon as the gesture crosses
			// the threshold (touchmove), not when the finger lifts — waiting
			// for touchend adds 100-200ms of swipe completion time before
			// the server even sees the input.
			var startX = null, startY = null;
			var firedThisGesture = false;
			var SWIPE_PX = 18;
			var $field = $('#playfield');
			$field.off('touchstart.flow touchmove.flow touchend.flow touchcancel.flow');
			$field.on('touchstart.flow', function(ev){
				var t = ev.originalEvent.touches[0];
				if (!t) return;
				startX = t.clientX;
				startY = t.clientY;
				firedThisGesture = false;
				ev.preventDefault();
			});
			$field.on('touchmove.flow', function(ev){
				if (startX === null) return;
				ev.preventDefault();
				if (firedThisGesture) return;
				var t = ev.originalEvent.touches[0];
				if (!t) return;
				var dx = t.clientX - startX;
				var dy = t.clientY - startY;
				if (Math.abs(dx) < SWIPE_PX && Math.abs(dy) < SWIPE_PX) return;
				var dir;
				if (Math.abs(dx) > Math.abs(dy)) {
					dir = dx > 0 ? 'RIGHT' : 'LEFT';
				} else {
					dir = dy > 0 ? 'DOWN' : 'UP';
				}
				steer(dir);
				firedThisGesture = true;
			});
			$field.on('touchend.flow touchcancel.flow', function(ev){
				// Tap-without-swipe fallback: if the finger lifted without
				// crossing the threshold, fall back to the touchend-based
				// direction so a quick tap-flick still registers.
				if (startX === null) return;
				if (!firedThisGesture) {
					var t = (ev.originalEvent.changedTouches || [])[0];
					if (t) {
						var dx = t.clientX - startX;
						var dy = t.clientY - startY;
						if (Math.abs(dx) >= 20 || Math.abs(dy) >= 20) {
							var dir;
							if (Math.abs(dx) > Math.abs(dy)) {
								dir = dx > 0 ? 'RIGHT' : 'LEFT';
							} else {
								dir = dy > 0 ? 'DOWN' : 'UP';
							}
							steer(dir);
						}
					}
				}
				startX = null; startY = null; firedThisGesture = false;
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
				// Camera follow (in camera mode) is driven by Field's rAF
				// loop so it tweens with the interpolated head rather than
				// snapping to the end target ahead of the sprite.
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
					if (food.type === 'bomb') sounds.bomb();
					else if (food.type === 'apple') sounds.apple();
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
