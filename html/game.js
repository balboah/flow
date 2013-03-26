$(function(){

	var ws = new WebSocket('ws://' + document.location.host + ':5000/worms');

	function cmd(data) {
		ws.send(JSON.stringify(data));
	}

	function getWorm(id) {
		var $worm = $('#worm-' + id),
			rgb;

		if (!$worm.length) {
			$worm = $('<div class="worm"/>')
				.attr('id', 'worm-' + id)
				.css('z-index', id);

			rgb = 'rgb(' + parseInt((Math.random()*100)+100) + ',' + parseInt((Math.random()*100)+100) +
				',' + parseInt((Math.random()*100)+100) + ')';
			$worm.css('background-color', rgb);

			$('#playfield').append($worm);

			console.log('New worm id: ', id);
		}

		return $worm;
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
			var data = payload.split(','),
				$worm = getWorm(data[0]),
				newLeft = data[1] * 10;
				newTop = data[2] * 10;

			$worm.animate({
				left: newLeft,
				top: newTop
			}, 200, 'linear');
		},
		KILL: function(payload){
			var $worm = getWorm(payload);

			$worm.fadeOut({
				complete: function(){
					$worm.remove();
				}
			});
		}
	};

});