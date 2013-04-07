$(function(){

	var ws = new WebSocket('ws://' + document.location.host + '/worms');

	var $window = $(window);

	var flow = new Flow({
		grid: Math.max(5, Math.floor(Math.min($window.width(), $window.height()) / 50))
	});

	$window.resize(function(){
		flow.update({
			grid: Math.max(5, Math.floor(Math.min($window.width(), $window.height()) / 50))
		});
	});

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

		ServerCommands[packet.Command](packet.Payload);
	};

	// Game commands received from server
	var ServerCommands = {
		MOVE: function(payload){
			flow.moveWorm.apply(flow, payload.split(','));
		},
		KILL: function(payload){
			flow.kill(payload);
		}
	};

});