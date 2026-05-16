(function(){

	// 8-bit-flavoured sound effects via Web Audio. AudioContext can only be
	// started by a user gesture in modern browsers, so the first call into
	// init() should happen from a click/keypress handler.

	var ctx = null;
	var enabled = true;
	var musicGain = null;       // master gain node for background music
	var musicTimer = null;
	var musicNextStartCtxTime = 0;
	var musicStopped = true;

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

	// --- Background music --------------------------------------------------
	//
	// A 4-chord, 4-bar loop in C major. Melody on a square-wave channel and a
	// triangle-wave bass — about as 8-bit as we get without writing a full
	// tracker. Notes are scheduled on the AudioContext clock, one bar at a
	// time, with a setTimeout that fires slightly before each loop ends to
	// queue the next one. This keeps timing rock-steady regardless of main
	// thread jitter.
	//
	// Beat duration tuned to feel upbeat without becoming frenetic.
	var BEAT = 0.18;            // seconds per beat
	var BAR = BEAT * 4;
	var LOOP_BARS = 8;
	var LOOP = LOOP_BARS * BAR;

	// Melody: [freqHz, beats]. Sum of beats per bar = 4 — 8-bar phrase keeps
	// the loop from feeling too short. Built on a I–V–vi–IV opening followed
	// by a higher restate to give the tune somewhere to go before resolving.
	var MELODY = [
		// Bar 1 — C: rising arpeggio
		[523, 1], [659, 1], [784, 2],
		// Bar 2 — G: continues the climb
		[587, 1], [698, 1], [988, 2],
		// Bar 3 — Am: gentle descent
		[659, 1], [523, 1], [440, 2],
		// Bar 4 — F: bounce back up
		[349, 1], [440, 1], [523, 2],
		// Bar 5 — C: peak
		[784, 2], [659, 1], [523, 1],
		// Bar 6 — G: stay high
		[988, 2], [784, 1], [587, 1],
		// Bar 7 — Am: bounce
		[659, 1], [523, 1], [659, 1], [440, 1],
		// Bar 8 — F → C cadence
		[698, 1], [659, 1], [587, 1], [523, 1]
	];

	// One bass note per bar — the chord root.
	var BASS = [131, 196, 220, 175, 131, 196, 220, 175]; // C3 G3 A3 F3 ×2

	function scheduleNote(opts) {
		var c = ctx;
		if (!c || !musicGain) return;
		var o = c.createOscillator();
		var g = c.createGain();
		o.type = opts.type;
		o.frequency.setValueAtTime(opts.freq, opts.startTime);
		o.connect(g);
		g.connect(musicGain);
		// Soft attack/release so square-wave notes don't click.
		g.gain.setValueAtTime(0, opts.startTime);
		g.gain.linearRampToValueAtTime(opts.volume, opts.startTime + 0.01);
		g.gain.linearRampToValueAtTime(opts.volume * 0.6, opts.startTime + opts.duration * 0.6);
		g.gain.exponentialRampToValueAtTime(0.0005, opts.startTime + opts.duration);
		o.start(opts.startTime);
		o.stop(opts.startTime + opts.duration + 0.02);
	}

	function scheduleLoop() {
		var c = ctx;
		if (!c || musicStopped) return;

		// If the tab was backgrounded, `setTimeout` may have fired far
		// later than scheduled — `musicNextStartCtxTime` is then in the
		// past relative to the AudioContext clock, and dumping a loop's
		// worth of `start(t<now)` calls produces a noisy pile-up. Skip
		// forward instead.
		var minStart = c.currentTime + 0.05;
		if (musicNextStartCtxTime < minStart) {
			musicNextStartCtxTime = minStart;
		}

		var start = musicNextStartCtxTime;
		// Melody.
		var t = start;
		for (var i = 0; i < MELODY.length; i++) {
			var freq = MELODY[i][0];
			var beats = MELODY[i][1];
			var dur = beats * BEAT;
			scheduleNote({
				type: 'square',
				freq: freq,
				startTime: t,
				duration: dur * 0.92,
				volume: 0.055
			});
			t += dur;
		}
		// Bass.
		for (var b = 0; b < BASS.length; b++) {
			scheduleNote({
				type: 'triangle',
				freq: BASS[b],
				startTime: start + b * BAR,
				duration: BAR * 0.95,
				volume: 0.08
			});
		}

		musicNextStartCtxTime += LOOP;
		// Re-queue ~150ms before this loop ends so the next batch is ready.
		musicTimer = setTimeout(scheduleLoop, (LOOP - 0.15) * 1000);
	}

	function startMusic() {
		var c = ensureCtx();
		if (!c) return;
		if (!musicStopped) return;       // already playing
		musicStopped = false;
		if (!musicGain) {
			musicGain = c.createGain();
			musicGain.gain.setValueAtTime(0.6, c.currentTime);
			musicGain.connect(c.destination);
		}
		musicNextStartCtxTime = c.currentTime + 0.1;
		scheduleLoop();
	}

	function stopMusic() {
		musicStopped = true;
		if (musicTimer) {
			clearTimeout(musicTimer);
			musicTimer = null;
		}
		// Quickly fade the master so any still-scheduled notes die gracefully.
		if (musicGain && ctx) {
			var now = ctx.currentTime;
			musicGain.gain.cancelScheduledValues(now);
			musicGain.gain.setValueAtTime(musicGain.gain.value, now);
			musicGain.gain.linearRampToValueAtTime(0, now + 0.15);
			// Replace the gain node next time we start so notes get full volume again.
			musicGain.disconnect();
			musicGain = null;
		}
	}

	window.sounds = {
		init: ensureCtx,
		setEnabled: function(on){
			enabled = !!on;
			if (!enabled) stopMusic();
		},

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
		// Bomb pickup — low descending sawtooth + dirty noise burst. Plays
		// just before the die() sound when the local player eats a bomb.
		bomb: function(){
			tone({type: 'sawtooth', freq: 240, freqEnd: 50, duration: 0.40, volume: 0.20});
			noiseBurst(0.45, 0.14);
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
		},

		// Background music. start/stop are idempotent.
		startMusic: startMusic,
		stopMusic: stopMusic
	};

})();
