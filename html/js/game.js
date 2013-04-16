(function(){

	var $window = $(window),
		$document = $(document);

	var game = window.game = {

		ws: null,

		init: function(){
			game.field = new Field();
			game.connect();
		},

		// Opens a WebSocket connection to the server
		connect: function(){
			var ws = game.ws = new WebSocket('ws://' + document.location.host + '/worms');

			// Log errors
			ws.onerror = function(error){
				console.error('WebSocket Error', error);
			};

			// Log messages from the server
			ws.onmessage = function(ev){
				var packet = JSON.parse(ev.data);
				game.commands[packet.Command.toLowerCase()](packet.Payload);
			};

			// When the connection is open, send some data to the server
			ws.onopen = function(){
				game.send({
					Command: "HELLO"
				});

				$document.keydown(function(ev){
					// Control the worm: arrow keys
					if ([37, 38, 39, 40].indexOf(ev.keyCode) > -1) {
						ev.preventDefault();

						var dir = {
							37: 'LEFT',
							38: 'UP',
							39: 'RIGHT',
							40: 'DOWN'
						}[ev.keyCode];

						game.send({
							Command: "MOVE",
							Payload: dir
						});
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

			move: function(payload) {
				game.field.getWorm(payload.Id).move(payload.Positions);
			},

			kill: function(payload) {
				game.field.kill(payload);
			}

		}

	};

})();