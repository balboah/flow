(function(){

	// 8-bit-flavoured sound effects via Web Audio. AudioContext can only be
	// started by a user gesture in modern browsers, so the first call into
	// init() should happen from a click/keypress handler.

	var ctx = null;
	var enabled = true;

	function ensureCtx() {
		if (!enabled) return null;
		if (!ctx) {
			var AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) { enabled = false; return null; }
			try { ctx = new AC(); }
			catch (e) { enabled = false; return null; }
		}
		if (ctx.state === 'suspended' && ctx.resume) {
			ctx.resume();
		}
		return ctx;
	}

	function tone(opts) {
		var c = ensureCtx();
		if (!c) return;
		var o = c.createOscillator();
		var g = c.createGain();
		o.type = opts.type || 'square';
		var t0 = c.currentTime + (opts.delay || 0);
		o.frequency.setValueAtTime(opts.freq, t0);
		if (opts.freqEnd != null) {
			o.frequency.exponentialRampToValueAtTime(
				Math.max(0.001, opts.freqEnd),
				t0 + opts.duration
			);
		}
		o.connect(g);
		g.connect(c.destination);
		var vol = opts.volume != null ? opts.volume : 0.12;
		g.gain.setValueAtTime(0, t0);
		g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
		g.gain.exponentialRampToValueAtTime(0.0005, t0 + opts.duration);
		o.start(t0);
		o.stop(t0 + opts.duration + 0.02);
	}

	function noiseBurst(duration, volume) {
		var c = ensureCtx();
		if (!c) return;
		var len = Math.floor(c.sampleRate * duration);
		var buf = c.createBuffer(1, len, c.sampleRate);
		var data = buf.getChannelData(0);
		for (var i = 0; i < len; i++) {
			data[i] = (Math.random() * 2 - 1) * (1 - i / len);
		}
		var src = c.createBufferSource();
		src.buffer = buf;
		var g = c.createGain();
		src.connect(g);
		g.connect(c.destination);
		g.gain.setValueAtTime(volume != null ? volume : 0.08, c.currentTime);
		g.gain.exponentialRampToValueAtTime(0.0005, c.currentTime + duration);
		src.start();
	}

	window.sounds = {
		init: ensureCtx,
		setEnabled: function(on){ enabled = !!on; },

		// Quick high blip for picking up a carrot.
		carrot: function(){
			tone({freq: 660, duration: 0.06, volume: 0.10});
		},
		// Two-step ascending blip for the more valuable apple.
		apple: function(){
			tone({freq: 880, duration: 0.07, volume: 0.12});
			tone({freq: 1175, duration: 0.10, volume: 0.10, delay: 0.07});
		},
		// Small ascending arpeggio when the worm grows.
		grow: function(){
			tone({freq: 523, duration: 0.07, volume: 0.10});
			tone({freq: 659, duration: 0.07, volume: 0.10, delay: 0.08});
			tone({freq: 784, duration: 0.10, volume: 0.10, delay: 0.16});
		},
		// Downward sweep + noise for the player's own death.
		die: function(){
			tone({type: 'sawtooth', freq: 440, freqEnd: 80, duration: 0.55, volume: 0.18});
			noiseBurst(0.4, 0.08);
		},
		// Tiny pop when another worm dies — quieter so it doesn't drown the field.
		pop: function(){
			tone({freq: 220, freqEnd: 90, duration: 0.18, volume: 0.08});
		},
		// Cheerful jingle on welcome.
		welcome: function(){
			tone({freq: 523, duration: 0.08, volume: 0.10});
			tone({freq: 659, duration: 0.08, volume: 0.10, delay: 0.09});
			tone({freq: 784, duration: 0.10, volume: 0.10, delay: 0.18});
			tone({freq: 1047, duration: 0.16, volume: 0.10, delay: 0.27});
		}
	};

})();
