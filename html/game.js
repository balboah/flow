$(function(){

	var ws = new WebSocket('ws://' + document.location.host + '/worms');

	var flow = new Flow();

	function cmd(data) {
		ws.send(JSON.stringify(data));
	}

	// When the connection is open, send some data to the server
	ws.onopen = function() {
		cmd({
			Command: "HELLO"
		});

		$(document).keydown(function(ev) {
			if ([37, 38, 39, 40].indexOf(ev.keyCode) > -1) {
				ev.preventDefault();

				var dir = {
					37: 'LEFT',
					38: 'UP',
					39: 'RIGHT',
					40: 'DOWN'
				}[ev.keyCode];

				cmd({
					Command: "MOVE",
					Payload: dir
				});
			}
			if (ev.keyCode == 71) {
				flow.grid();
			}
		});
	};

	// Log errors
	ws.onerror = function(error) {
		console.error('WebSocket Error ', error);
	};

	// Log messages from the server
	ws.onmessage = function(ev) {
		var packet = JSON.parse(ev.data);

		ServerCommands[packet.Command.toLowerCase()](packet.Payload);
	};

	// Game commands received from server
	var ServerCommands = {
		move: function(payload) {
			// TODO: remove this once new worm growing is implemented
			var x = payload.Positions[0].X,
				y = payload.Positions[0].Y;
			payload.Positions.push({ X: x, Y: y + 1 });
			payload.Positions.push({ X: x + 4, Y: y + 1 });
			payload.Positions.push({ X: x + 4, Y: y + 3 });
			payload.Positions.push({ X: x + 2, Y: y + 3 });
			payload.Positions.push({ X: x + 2, Y: y + 6 });
			payload.Positions.push({ X: x - 1, Y: y + 6 });
			payload.Positions.push({ X: x - 1, Y: y + 3 });
			// TODO: remove until here
			flow.getWorm(payload.Id).move(payload.Positions);
		},
		kill: function(payload) {
			flow.kill(payload);
		}
	};

});