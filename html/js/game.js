(function(){

	var $document = $(document);

	// Persist the chosen name across reloads.
	var STORAGE_KEY = 'flow.name';
	function loadStoredName() {
		try { return localStorage.getItem(STORAGE_KEY) || ''; }
		catch (e) { return ''; }
	}
	function storeName(name) {
		try { localStorage.setItem(STORAGE_KEY, name); } catch (e) {}
	}

	var game = window.game = {

		ws: null,

		init: function(){
			game.field = new Field();
			game.hud = new HUD(game);
			game.connect();
		},

		// Opens a WebSocket connection to the server
		connect: function(){
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
				var name = loadStoredName();
				game.send({Command: 'HELLO', Payload: name});

				$document.keydown(function(ev){
					// Skip when typing in the name input.
					if (ev.target && ev.target.tagName === 'INPUT') {
						return;
					}
					// Control the worm: arrow keys
					if ([37, 38, 39, 40].indexOf(ev.keyCode) > -1) {
						ev.preventDefault();

						var dir = {
							37: 'LEFT',
							38: 'UP',
							39: 'RIGHT',
							40: 'DOWN'
						}[ev.keyCode];

						game.send({Command: 'MOVE', Payload: dir});
					}
					// Enable/Disable the grid: `g`
					if (ev.keyCode === 71) {
						game.field.grid();
					}
				});
			};

		},

		// Send packet to server
		send: function(data){
			game.ws.send(JSON.stringify(data));
		},

		// Game commands received from server
		commands: {

			welcome: function(payload) {
				game.hud.welcome(payload);
				storeName(payload.Name);
			},

			move: function(payload) {
				game.field.getWorm(payload.Id).move(payload.Positions);
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
				game.field.removeFood(payload.FoodId);
			},

			score: function(payload) {
				game.hud.updateScore(payload);
				if (game.hud.ownName) {
					storeName(game.hud.ownName);
				}
			}

		}

	};

})();
