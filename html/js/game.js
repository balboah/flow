(function(){

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
		// Packets buffered while the WebSocket is closed. Flushed in
		// onopen so a press during a reconnect (notably "New Game" after
		// the server's 90s idle timeout) still reaches the server, instead
		// of being silently dropped.
		_pending: [],

		// Stored handler references so re-binding (on reconnect) can detach the
		// previous listener before attaching a new one. Replaces the jQuery
		// `.off('event.flow').on('event.flow', fn)` namespace dance.
		_keydownHandler: null,
		_touchStartHandler: null,
		_touchMoveHandler: null,
		_touchEndHandler: null,
		_welcomeSubmitHandler: null,

		init: function(){
			game.field = new Field();
			game.hud = new HUD(game);
			game.bindGameOver();
			game.bindMusicPlayer();
			// Always confirm the alias on page load. Pre-fill with the last
			// one used so a quick refresh is a single Enter press.
			game.showWelcome(loadStored(STORAGE_NAME));
		},

		// Wires the top-bar prev / play-pause / next buttons to the
		// `sounds` music API. The audio context is started by the click
		// itself, so users can toggle music from this control alone (no
		// dependency on the welcome jingle path).
		bindMusicPlayer: function(){
			if (!window.sounds) return;
			var prev   = document.getElementById('music-prev');
			var next   = document.getElementById('music-next');
			var toggle = document.getElementById('music-toggle');
			var label  = document.getElementById('music-track');
			if (!prev || !next || !toggle || !label) return;

			prev.addEventListener('click', function(ev){
				ev.preventDefault();
				sounds.prevTrack();
			});
			next.addEventListener('click', function(ev){
				ev.preventDefault();
				sounds.nextTrack();
			});
			toggle.addEventListener('click', function(ev){
				ev.preventDefault();
				sounds.toggleMusic();
			});

			function render() {
				var t = sounds.getCurrentTrack();
				label.textContent = t.name;
				var playing = sounds.isPlaying();
				toggle.textContent = playing ? '⏸' : '▶';
				toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
				toggle.title = playing ? 'Pause' : 'Play';
			}
			sounds.onStateChange(render);
			render();
		},

		showWelcome: function(prefill){
			var panel = document.getElementById('welcome');
			var form = document.getElementById('welcome-form');
			var input = document.getElementById('welcome-name');
			if (prefill) {
				input.value = prefill;
			}
			panel.hidden = false;
			setTimeout(function(){
				input.focus();
				if (input.select) input.select();
			}, 0);
			if (game._welcomeSubmitHandler) {
				form.removeEventListener('submit', game._welcomeSubmitHandler);
			}
			game._welcomeSubmitHandler = function(ev){
				ev.preventDefault();
				var v = input.value.trim();
				if (!v) {
					input.focus();
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
				panel.hidden = true;
				game.connect(v);
			};
			form.addEventListener('submit', game._welcomeSubmitHandler);
		},

		bindGameOver: function(){
			var panel = document.getElementById('gameover');
			var reason = document.getElementById('gameover-reason');
			var score = document.getElementById('gameover-score');
			document.getElementById('gameover-restart').addEventListener('click', function(){
				panel.hidden = true;
				game.send({Command: 'RESPAWN'});
			});
			game.showGameOver = function(reasonText, scoreVal) {
				reason.textContent = reasonText || 'You died.';
				score.textContent = scoreVal != null ? scoreVal : 0;
				panel.hidden = false;
				var btn = panel.querySelector('button');
				if (btn) btn.focus();
			};
			game.hideGameOver = function() {
				panel.hidden = true;
			};
		},

		// Opens a WebSocket connection. `name` is the player's chosen alias.
		// Also used to re-open after the server's idle timeout drops us.
		connect: function(name){
			// Tear down any prior socket: detach handlers (defensive in case
			// callers wire onclose later) and close it so we don't leak the
			// underlying connection.
			if (game.ws) {
				game.ws.onclose = null;
				game.ws.onerror = null;
				game.ws.onmessage = null;
				game.ws.onopen = null;
				try { game.ws.close(); } catch (e) {}
			}
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
				// Drain anything the user did during the reconnect (e.g.
				// the "New Game" click that woke this socket up).
				var pending = game._pending;
				game._pending = [];
				for (var i = 0; i < pending.length; i++) {
					ws.send(JSON.stringify(pending[i]));
				}
			};

			// Note: no onclose auto-reconnect. The next send() reopens
			// the socket lazily, so an idle disconnected tab doesn't
			// spin up a fresh worm on its own.
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

			if (game._keydownHandler) {
				document.removeEventListener('keydown', game._keydownHandler);
			}
			game._keydownHandler = function(ev){
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
			};
			document.addEventListener('keydown', game._keydownHandler);

			// Touch swipe controls. Fires MOVE as soon as the gesture crosses
			// the threshold (touchmove), not when the finger lifts — waiting
			// for touchend adds 100-200ms of swipe completion time before
			// the server even sees the input.
			var startX = null, startY = null;
			var firedThisGesture = false;
			var SWIPE_PX = 18;
			var field = document.getElementById('playfield');

			if (game._touchStartHandler) {
				field.removeEventListener('touchstart', game._touchStartHandler);
				field.removeEventListener('touchmove', game._touchMoveHandler);
				field.removeEventListener('touchend', game._touchEndHandler);
				field.removeEventListener('touchcancel', game._touchEndHandler);
			}

			game._touchStartHandler = function(ev){
				var t = ev.touches[0];
				if (!t) return;
				startX = t.clientX;
				startY = t.clientY;
				firedThisGesture = false;
				ev.preventDefault();
			};
			game._touchMoveHandler = function(ev){
				if (startX === null) return;
				ev.preventDefault();
				if (firedThisGesture) return;
				var t = ev.touches[0];
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
			};
			game._touchEndHandler = function(ev){
				// Tap-without-swipe fallback: if the finger lifted without
				// crossing the threshold, fall back to the touchend-based
				// direction so a quick tap-flick still registers.
				if (startX === null) return;
				if (!firedThisGesture) {
					var t = (ev.changedTouches || [])[0];
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
			};

			field.addEventListener('touchstart', game._touchStartHandler);
			field.addEventListener('touchmove', game._touchMoveHandler);
			field.addEventListener('touchend', game._touchEndHandler);
			field.addEventListener('touchcancel', game._touchEndHandler);
		},

		// Send packet to server. If the socket has been closed (typically
		// by the server's 90s idle timeout after a long stay on the game
		// over screen), buffer the packet and trigger a reconnect. The
		// onopen handler flushes the buffer once HELLO is in flight.
		send: function(data){
			if (game.ws && game.ws.readyState === WebSocket.OPEN) {
				game.ws.send(JSON.stringify(data));
				return;
			}
			// Reconnect needs a known alias; without one we'd buffer
			// forever with nothing to drain. Warn so the drop is
			// visible in devtools rather than failing silently.
			var n = loadStored(STORAGE_NAME);
			if (!n) {
				console.warn('flow.send: dropping packet, no stored alias yet', data);
				return;
			}
			game._pending.push(data);
			// A CONNECTING socket already has an onopen waiting to drain
			// the buffer. Any other state (CLOSING / CLOSED / no socket)
			// triggers (re)connect. The connect() teardown stripping
			// handlers on the prior socket is the only thing keeping the
			// CLOSING case race-free; if any caller ever wires onclose,
			// revisit (the prior socket's close event would be dropped).
			if (!game.ws || game.ws.readyState !== WebSocket.CONNECTING) {
				game.connect(n);
			}
		},

		// Game commands received from server
		commands: {

			welcome: function(payload) {
				// A different Id means the reconnect landed on a fresh
				// worm: the prior one was swept after DisconnectTTL.
				// Drop everything we had. Orphan worms (no further MOVE
				// updates) and orphan food (eaten while we were out)
				// would otherwise linger forever. Catch-up SCORE/FOOD
				// packets and the next MOVE tick rebuild the view.
				if (game.hud.ownId != null && game.hud.ownId !== payload.Id) {
					Object.keys(game.field.worms).forEach(function(id){
						game.field.kill(Number(id));
					});
					Object.keys(game.field.foods).forEach(function(id){
						game.field.removeFood(Number(id));
					});
					game.hud.scores = {};
					// Drop any stale Pac-Man tween from the prior session;
					// the new session re-announces him via the per-join
					// PACMAN packet (or leaves him absent if the new field
					// has none).
					game.field.pacman = null;
				}

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
			},

			pacman: function(payload) {
				if (!game.field.pacman) {
					game.field.pacman = new Pacman(game.field);
				}
				game.field.pacman.update(payload);
			},

			pacman_kill: function() {
				if (game.field.pacman) {
					game.field.pacman.kill();
					game.field.pacman = null;
				}
			},

			bite: function(payload) {
				if (payload.LostPositions && payload.LostPositions.length) {
					game.field.explode(payload.LostPositions);
				}
				if (window.sounds && payload.WormId === game.hud.ownId && sounds.pop) {
					sounds.pop();
				}
			}

		}

	};

})();
