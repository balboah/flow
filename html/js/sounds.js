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
	// 16-bar loop in A minor with a jazz-influenced chord progression
	// (Am7 Dm7 G7 Cmaj7 | Fmaj7 Bm7b5 E7 Am, restated and resolved). Three
	// voices: a "sax"-style lead (filtered sawtooth + vibrato), a walking
	// triangle bass, and a soft sustained chord pad. Aimed at a retro
	// space-trader vibe: catchy enough to recognise, sparse enough to leave
	// in the background for long sessions.
	//
	// Notes are scheduled on the AudioContext clock a loop at a time, with a
	// setTimeout that fires slightly before each loop ends to queue the
	// next one. Keeps timing rock-steady regardless of main thread jitter.
	var BEAT = 0.22;            // seconds per beat
	var BAR = BEAT * 4;
	var LOOP_BARS = 16;
	var LOOP = LOOP_BARS * BAR;

	// Lead melody: [freqHz, beats]. freq=0 is a rest. Sum of beats per bar
	// = 4. Built as four 4-bar phrases that stack: statement, answer,
	// climb to a higher restatement, and descending resolution + turnaround.
	var MELODY = [
		// Phrase 1 (bars 1-4): Am7 - Dm7 - G7 - Cmaj7
		[0, 1], [659, 2], [523, 1],            // rest, E5, C5
		[587, 2], [698, 1], [659, 1],          // D5, F5, E5
		[587, 4],                              // D5 held
		[0, 1], [523, 1], [659, 2],            // rest, C5, E5
		// Phrase 2 (bars 5-8): Fmaj7 - Bm7b5 - E7 - Am
		[0, 1], [440, 1], [523, 2],            // rest, A4, C5
		[698, 2], [587, 2],                    // F5, D5
		[0, 1], [415, 1], [494, 2],            // rest, G#4, B4
		[440, 4],                              // A4 held — phrase rest
		// Phrase 3 (bars 9-12): higher restatement, more active
		[659, 1], [880, 1], [1047, 2],         // E5, A5, C6
		[880, 1], [698, 1], [587, 2],          // A5, F5, D5
		[784, 1], [988, 1], [1175, 2],         // G5, B5, D6
		[1047, 4],                             // C6 held — peak
		// Phrase 4 (bars 13-16): descending resolution + turnaround
		[880, 1], [784, 1], [698, 2],          // A5, G5, F5
		[659, 1], [587, 1], [494, 2],          // E5, D5, B4
		[440, 4],                              // A4 held — landing
		[0, 2], [494, 1], [659, 1]             // rest, B4, E5 (lifts back to the top)
	];

	// Walking bass: [freqHz, beats]. Two half-note moves per bar (root then
	// fifth/approach) for a steady but breathing groove; bars 15-16 walk
	// chromatically to set up the loop turnaround.
	var BASS = [
		// Bars 1-8
		[110, 2], [165, 2],            // Am:     A2  → E3
		[147, 2], [110, 2],            // Dm:     D3  → A2
		[ 98, 2], [147, 2],            // G7:     G2  → D3
		[131, 2], [196, 2],            // Cmaj7:  C3  → G3
		[ 87, 2], [131, 2],            // Fmaj7:  F2  → C3
		[123, 2], [175, 2],            // Bm7b5:  B2  → F3
		[ 82, 2], [123, 2],            // E7:     E2  → B2
		[110, 2], [ 82, 2],            // Am   → E2 (lead-in to recap)
		// Bars 9-16. Second half mirrors the first up to bar 13, then skips
		// the Bm7b5 to land on E7 a bar earlier so bars 15-16 (Am, E7) can
		// act as the turnaround back to Am at bar 1.
		[110, 2], [165, 2],            // Am
		[147, 2], [110, 2],            // Dm
		[ 98, 2], [147, 2],            // G7
		[131, 2], [196, 2],            // Cmaj7
		[ 87, 2], [131, 2],            // Fmaj7
		[ 82, 2], [123, 2],            // E7:     E2  → B2
		[110, 1], [104, 1], [110, 2],  // bar 15: Am with G#2 chromatic neighbour
		[ 82, 2], [123, 2]             // bar 16: E7 → loop back to Am
	];

	// Chord pad — root/3rd/5th stacks, one chord per bar, kept in the mid
	// register (F3-A4) so it sits between bass and lead.
	var PAD_CHORDS = [
		[220, 262, 330],   // Am:     A3 C4 E4
		[294, 349, 440],   // Dm:     D4 F4 A4
		[196, 247, 294],   // G7:     G3 B3 D4
		[262, 330, 392],   // Cmaj7:  C4 E4 G4
		[175, 220, 262],   // Fmaj7:  F3 A3 C4
		[247, 294, 349],   // Bm7b5:  B3 D4 F4
		[165, 208, 247],   // E7:     E3 G#3 B3
		[220, 262, 330],   // Am
		// Bars 9-14 mirror 1-5 then jump straight to E7 (no Bm7b5 the
		// second time) so bars 15-16 can do the Am → E7 turnaround.
		[220, 262, 330],   // Am
		[294, 349, 440],   // Dm
		[196, 247, 294],   // G7
		[262, 330, 392],   // Cmaj7
		[175, 220, 262],   // Fmaj7
		[165, 208, 247],   // E7
		[220, 262, 330],   // Am
		[165, 208, 247]    // bar 16: E7 turnaround
	];

	function scheduleVoice(opts) {
		var c = ctx;
		if (!c || !musicGain) return;
		if (!opts.freq) return; // freq=0 → rest
		var o = c.createOscillator();
		var g = c.createGain();
		o.type = opts.type;
		o.frequency.setValueAtTime(opts.freq, opts.startTime);

		var head = o;
		if (opts.filter) {
			var f = c.createBiquadFilter();
			f.type = opts.filter.type;
			f.frequency.setValueAtTime(opts.filter.freq, opts.startTime);
			if (opts.filter.Q != null) f.Q.setValueAtTime(opts.filter.Q, opts.startTime);
			head.connect(f);
			head = f;
		}
		head.connect(g);
		g.connect(musicGain);

		// Optional vibrato — modulates the oscillator frequency. Crucial
		// for the sax-like character of the lead.
		if (opts.vibrato) {
			var lfo = c.createOscillator();
			var lfoGain = c.createGain();
			lfo.frequency.setValueAtTime(opts.vibrato.rate, opts.startTime);
			// Delay vibrato slightly so short notes don't warble unnaturally.
			var depth = opts.freq * opts.vibrato.depth;
			lfoGain.gain.setValueAtTime(0, opts.startTime);
			lfoGain.gain.linearRampToValueAtTime(depth, opts.startTime + Math.min(opts.duration * 0.4, 0.18));
			lfo.connect(lfoGain);
			lfoGain.connect(o.frequency);
			lfo.start(opts.startTime);
			lfo.stop(opts.startTime + opts.duration + 0.02);
		}

		var attack = opts.attack != null ? opts.attack : 0.01;
		var sustain = opts.sustain != null ? opts.sustain : 0.7;
		g.gain.setValueAtTime(0, opts.startTime);
		g.gain.linearRampToValueAtTime(opts.volume, opts.startTime + attack);
		g.gain.linearRampToValueAtTime(opts.volume * sustain, opts.startTime + opts.duration * 0.65);
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

		// Sax-style lead: filtered sawtooth with vibrato.
		var t = start;
		for (var i = 0; i < MELODY.length; i++) {
			var mf = MELODY[i][0];
			var mb = MELODY[i][1];
			var mdur = mb * BEAT;
			if (mf > 0) {
				scheduleVoice({
					type: 'sawtooth',
					freq: mf,
					startTime: t,
					duration: mdur * 0.94,
					volume: 0.07,
					attack: 0.035,
					sustain: 0.85,
					filter: { type: 'bandpass', freq: 1500, Q: 1.4 },
					vibrato: { rate: 5.5, depth: 0.012 }
				});
			}
			t += mdur;
		}

		// Walking bass.
		var tb = start;
		for (var bi = 0; bi < BASS.length; bi++) {
			var bf = BASS[bi][0];
			var bb = BASS[bi][1];
			var bdur = bb * BEAT;
			scheduleVoice({
				type: 'triangle',
				freq: bf,
				startTime: tb,
				duration: bdur * 0.95,
				volume: 0.075,
				attack: 0.006,
				sustain: 0.6
			});
			tb += bdur;
		}

		// Chord pad — one chord per bar, slow swell, very soft.
		for (var pb = 0; pb < PAD_CHORDS.length; pb++) {
			var chord = PAD_CHORDS[pb];
			for (var pn = 0; pn < chord.length; pn++) {
				scheduleVoice({
					type: 'triangle',
					freq: chord[pn],
					startTime: start + pb * BAR,
					duration: BAR * 0.98,
					volume: 0.017,
					attack: 0.09,
					sustain: 0.9
				});
			}
		}

		musicNextStartCtxTime += LOOP;
		// Re-queue ~200ms before this loop ends so the next batch is ready.
		musicTimer = setTimeout(scheduleLoop, (LOOP - 0.2) * 1000);
	}

	function startMusic() {
		var c = ensureCtx();
		if (!c) return;
		if (!musicStopped) return;       // already playing
		musicStopped = false;
		if (!musicGain) {
			musicGain = c.createGain();
			musicGain.gain.setValueAtTime(0.5, c.currentTime);
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

	function safeSuspend() {
		if (!ctx || !ctx.suspend || ctx.state === 'closed') return;
		ctx.suspend();
	}
	function safeResume() {
		if (!ctx || !ctx.resume || ctx.state === 'closed') return;
		ctx.resume();
	}

	// Pause music while the tab is hidden. setTimeout keeps firing on iOS
	// Safari (sometimes only somewhat throttled), and suspending the
	// AudioContext stops the audio thread entirely — together this saves
	// real CPU while the user is away. visibilityPaused tracks the pause
	// so we only resume music we ourselves stopped (not what the user
	// disabled). We never resume the context while audio is disabled — that
	// would wake the audio thread the user explicitly turned off.
	var visibilityPaused = false;
	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', function() {
			if (document.hidden) {
				if (!musicStopped) {
					stopMusic();
					visibilityPaused = true;
				}
				safeSuspend();
			} else if (enabled) {
				safeResume();
				if (visibilityPaused) {
					visibilityPaused = false;
					startMusic();
				}
			}
		});
	}

	window.sounds = {
		init: ensureCtx,
		setEnabled: function(on){
			enabled = !!on;
			if (!enabled) {
				stopMusic();
				// Suspend the audio thread so disabling actually goes
				// quiet — `stopMusic` only clears the loop, the context
				// itself stays awake otherwise.
				safeSuspend();
			}
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
