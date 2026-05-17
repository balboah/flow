(function(){

	// 8-bit-flavoured sound effects + a small multi-track background music
	// engine, all on Web Audio. AudioContext can only be started by a user
	// gesture in modern browsers, so the first call into init() should
	// happen from a click/keypress handler.

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


	// ===== Music engine ================================================
	//
	// Tracks are arrays of [note, beats] pairs (melody/bass) and chord
	// stacks (pad). A note is a scientific-pitch string like "A4" or "Bb3";
	// 0 or "rest" means silence. makeTrack() normalises every note to Hz at
	// definition time so the scheduler only sees numbers at playback time.

	var NOTES = (function() {
		var f = { rest: 0 };
		var names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
		var flats = { 'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#' };
		for (var oct = 0; oct <= 8; oct++) {
			for (var i = 0; i < 12; i++) {
				// A4 is midi 69 = 440 Hz
				var midi = (oct + 1) * 12 + i;
				f[names[i] + oct] = 440 * Math.pow(2, (midi - 69) / 12);
			}
		}
		for (oct = 0; oct <= 8; oct++) {
			for (var alt in flats) {
				f[alt + oct] = f[flats[alt] + oct];
			}
		}
		return f;
	})();

	function freqOf(n) {
		if (n === 0 || n == null || n === 'rest') return 0;
		if (typeof n === 'number') return n;
		return NOTES[n] || 0;
	}

	// Per-voice synth defaults. Tracks override anything they need.
	var DEFAULT_LEAD = {
		type: 'sawtooth',
		volume: 0.07, attack: 0.035, sustain: 0.85,
		filter:  { type: 'bandpass', freq: 1500, Q: 1.4 },
		vibrato: { rate: 5.5, depth: 0.012 }
	};
	var DEFAULT_BASS = {
		type: 'triangle',
		volume: 0.075, attack: 0.006, sustain: 0.6
	};
	var DEFAULT_PAD = {
		type: 'triangle',
		volume: 0.017, attack: 0.09, sustain: 0.9
	};

	// A track's `lead`/`bassParams`/`padParams` (if provided) REPLACE the
	// defaults wholesale rather than merging — so an override must specify
	// every field the voice needs (at minimum `type` and `volume`). This
	// keeps "no filter, no vibrato" expressible as `{type:'square', ...}`
	// without having to pass explicit `filter:null` / `vibrato:null` markers.
	function makeTrack(spec) {
		var i, j;
		var melody = [];
		for (i = 0; i < spec.melody.length; i++) {
			melody.push([freqOf(spec.melody[i][0]), spec.melody[i][1]]);
		}
		var bass = [];
		for (i = 0; i < spec.bass.length; i++) {
			bass.push([freqOf(spec.bass[i][0]), spec.bass[i][1]]);
		}
		var pad = [];
		for (i = 0; i < spec.pad.length; i++) {
			var chord = [];
			for (j = 0; j < spec.pad[i].length; j++) {
				chord.push(freqOf(spec.pad[i][j]));
			}
			pad.push(chord);
		}
		return {
			name:       spec.name,
			beat:       spec.beat,
			loopBars:   spec.loopBars,
			melody:     melody,
			bass:       bass,
			pad:        pad,
			lead:       spec.lead       || DEFAULT_LEAD,
			bassParams: spec.bassParams || DEFAULT_BASS,
			padParams:  spec.padParams  || DEFAULT_PAD
		};
	}

	var TRACKS = [

	// ---- 1. Sax Drifter ------------------------------------------------
	makeTrack({
		name: 'Sax Drifter',
		beat: 0.22, loopBars: 16,
		// Am7 Dm7 G7 Cmaj7 | Fmaj7 Bm7b5 E7 Am | (restate, end with Am-E7 turnaround)
		melody: [
			['rest', 1], ['E5', 2],  ['C5', 1],
			['D5', 2],   ['F5', 1],  ['E5', 1],
			['D5', 4],
			['rest', 1], ['C5', 1],  ['E5', 2],
			['rest', 1], ['A4', 1],  ['C5', 2],
			['F5', 2],   ['D5', 2],
			['rest', 1], ['G#4', 1], ['B4', 2],
			['A4', 4],
			['E5', 1],   ['A5', 1],  ['C6', 2],
			['A5', 1],   ['F5', 1],  ['D5', 2],
			['G5', 1],   ['B5', 1],  ['D6', 2],
			['C6', 4],
			['A5', 1],   ['G5', 1],  ['F5', 2],
			['E5', 1],   ['D5', 1],  ['B4', 2],
			['A4', 4],
			['rest', 2], ['B4', 1],  ['E5', 1]
		],
		bass: [
			['A2', 2], ['E3', 2],   ['D3', 2], ['A2', 2],
			['G2', 2], ['D3', 2],   ['C3', 2], ['G3', 2],
			['F2', 2], ['C3', 2],   ['B2', 2], ['F3', 2],
			['E2', 2], ['B2', 2],   ['A2', 2], ['E2', 2],
			['A2', 2], ['E3', 2],   ['D3', 2], ['A2', 2],
			['G2', 2], ['D3', 2],   ['C3', 2], ['G3', 2],
			['F2', 2], ['C3', 2],   ['E2', 2], ['B2', 2],
			['A2', 2], ['E3', 2],
			['E2', 2], ['B2', 2]
		],
		pad: [
			['A3','C4','E4'], ['D4','F4','A4'], ['G3','B3','D4'], ['C4','E4','G4'],
			['F3','A3','C4'], ['B3','D4','F4'], ['E3','G#3','B3'],['A3','C4','E4'],
			['A3','C4','E4'], ['D4','F4','A4'], ['G3','B3','D4'], ['C4','E4','G4'],
			['F3','A3','C4'], ['E3','G#3','B3'],['A3','C4','E4'], ['E3','G#3','B3']
		]
	}),

	// ---- 2. Hyperlane Cruise -------------------------------------------
	// Em chiptune cruise — square-wave arpeggios over a root-fifth pulse.
	// Fast and brisk; the loop comes around quickly which is part of the fun.
	makeTrack({
		name: 'Hyperlane Cruise',
		beat: 0.15, loopBars: 16,
		lead: { type: 'square', volume: 0.05, attack: 0.005, sustain: 0.65 },
		bassParams: { type: 'triangle', volume: 0.085, attack: 0.004, sustain: 0.55 },
		padParams:  { type: 'triangle', volume: 0.012, attack: 0.06, sustain: 0.85 },
		// Em - G - D - Am | C - G - Am - B7 | (restate descending)
		melody: [
			['E5', 1], ['G5', 1], ['B5', 1], ['G5', 1],
			['G5', 1], ['B5', 1], ['D6', 1], ['B5', 1],
			['D5', 1], ['F#5', 1], ['A5', 1], ['F#5', 1],
			['A4', 1], ['C5', 1], ['E5', 1], ['C5', 1],
			['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1],
			['G5', 1], ['B5', 1], ['D6', 1], ['B5', 1],
			['A4', 1], ['C5', 1], ['E5', 1], ['C5', 1],
			['B4', 1], ['D#5', 1], ['F#5', 1], ['B5', 1],
			['B5', 1], ['G5', 1], ['E5', 1], ['B4', 1],
			['D6', 1], ['B5', 1], ['G5', 1], ['D5', 1],
			['A5', 1], ['F#5', 1], ['D5', 1], ['A4', 1],
			['E5', 1], ['C5', 1], ['A4', 1], ['E4', 1],
			['G5', 1], ['E5', 1], ['C5', 1], ['G4', 1],
			['B5', 1], ['G5', 1], ['D5', 1], ['G4', 1],
			['F#5', 1], ['D#5', 1], ['F#5', 1], ['B5', 1],
			['E5', 4]
		],
		bass: [
			['E2', 1], ['B2', 1], ['E2', 1], ['B2', 1],
			['G2', 1], ['D3', 1], ['G2', 1], ['D3', 1],
			['D3', 1], ['A2', 1], ['D3', 1], ['A2', 1],
			['A2', 1], ['E3', 1], ['A2', 1], ['E3', 1],
			['C3', 1], ['G2', 1], ['C3', 1], ['G2', 1],
			['G2', 1], ['D3', 1], ['G2', 1], ['D3', 1],
			['A2', 1], ['E3', 1], ['A2', 1], ['E3', 1],
			['B2', 1], ['F#3', 1], ['B2', 1], ['F#3', 1],
			['E2', 1], ['B2', 1], ['E2', 1], ['B2', 1],
			['G2', 1], ['D3', 1], ['G2', 1], ['D3', 1],
			['D3', 1], ['A2', 1], ['D3', 1], ['A2', 1],
			['A2', 1], ['E3', 1], ['A2', 1], ['E3', 1],
			['C3', 1], ['G2', 1], ['C3', 1], ['G2', 1],
			['G2', 1], ['D3', 1], ['G2', 1], ['D3', 1],
			['B2', 1], ['F#3', 1], ['B2', 1], ['F#3', 1],
			['E2', 1], ['B2', 1], ['E2', 1], ['B2', 1]
		],
		pad: [
			['E3','G3','B3'], ['G3','B3','D4'], ['D4','F#4','A4'], ['A3','C4','E4'],
			['C4','E4','G4'], ['G3','B3','D4'], ['A3','C4','E4'],  ['B3','D#4','F#4'],
			['E3','G3','B3'], ['G3','B3','D4'], ['D4','F#4','A4'], ['A3','C4','E4'],
			['C4','E4','G4'], ['G3','B3','D4'], ['B3','D#4','F#4'],['E3','G3','B3']
		]
	}),

	// ---- 3. Asteroid Drift ---------------------------------------------
	// Dm slow ambient — long held triangle notes over a sleepy walking
	// bass. 8 bars but at 0.32s per beat the loop is ~10s long.
	makeTrack({
		name: 'Asteroid Drift',
		beat: 0.32, loopBars: 8,
		lead: {
			type: 'triangle',
			volume: 0.065, attack: 0.08, sustain: 0.95,
			vibrato: { rate: 3.8, depth: 0.008 }
		},
		bassParams: { type: 'triangle', volume: 0.08, attack: 0.04, sustain: 0.9 },
		padParams:  { type: 'triangle', volume: 0.022, attack: 0.18, sustain: 1.0 },
		// Dm Bb F C | Gm A7 Dm Dm
		melody: [
			['rest', 1], ['D5', 3],
			['rest', 1], ['F5', 2], ['D5', 1],
			['rest', 1], ['A4', 3],
			['G4', 2], ['C5', 2],
			['D5', 2], ['F5', 2],
			['E5', 2], ['C#5', 2],
			['D5', 4],
			['rest', 2], ['A4', 1], ['F4', 1]
		],
		bass: [
			['D2', 4],
			['Bb1', 4],
			['F2', 4],
			['C2', 4],
			['G2', 4],
			['A1', 4],
			['D2', 4],
			['A1', 4]
		],
		pad: [
			['D3','F3','A3'],   ['Bb2','D3','F3'],
			['F3','A3','C4'],   ['C3','E3','G3'],
			['G3','Bb3','D4'],  ['A3','C#4','E4'],
			['D3','F3','A3'],   ['A2','C#3','E3']
		]
	}),

	// ---- 4. Cantina Run ------------------------------------------------
	// Gm "clarinet" lounge — triangle through a bandpass for a reedy
	// timbre, walking bass, fluid melody.
	makeTrack({
		name: 'Cantina Run',
		beat: 0.20, loopBars: 16,
		lead: {
			type: 'triangle',
			volume: 0.085, attack: 0.018, sustain: 0.85,
			filter: { type: 'bandpass', freq: 900, Q: 1.0 },
			vibrato: { rate: 5.0, depth: 0.010 }
		},
		// Gm - Cm - D7 - Gm | Eb - F - Bb - Bb | Gm - Cm - D7 - Gm | Eb - D7 - Gm - D7
		melody: [
			['G4', 1], ['Bb4', 1], ['D5', 2],
			['C5', 1], ['Eb5', 1], ['G5', 2],
			['F#5', 1], ['A5', 1], ['D5', 2],
			['G4', 4],
			['Bb4', 1], ['G4', 1], ['Eb5', 2],
			['F5', 2], ['A5', 2],
			['Bb5', 2], ['F5', 2],
			['D5', 1], ['Bb4', 1], ['G4', 2],
			['G5', 1], ['F5', 1], ['D5', 2],
			['Eb5', 1], ['D5', 1], ['C5', 2],
			['A4', 1], ['D5', 1], ['F#5', 2],
			['G5', 4],
			['G5', 1], ['F5', 1], ['Eb5', 2],
			['D5', 2], ['F#5', 2],
			['G4', 1], ['Bb4', 1], ['D5', 1], ['G5', 1],
			['F#5', 1], ['A5', 1], ['C6', 1], ['A5', 1]
		],
		bass: [
			['G2', 2], ['D3', 2],    ['C3', 2], ['G2', 2],
			['D3', 2], ['A2', 2],    ['G2', 2], ['D3', 2],
			['Eb2', 2], ['Bb2', 2],  ['F2', 2], ['C3', 2],
			['Bb2', 2], ['F3', 2],   ['Bb2', 2], ['F3', 2],
			['G2', 2], ['D3', 2],    ['C3', 2], ['G2', 2],
			['D3', 2], ['A2', 2],    ['G2', 2], ['D3', 2],
			['Eb2', 2], ['Bb2', 2],  ['D3', 2], ['A2', 2],
			['G2', 2], ['D3', 2],    ['D3', 2], ['A2', 2]
		],
		pad: [
			['G3','Bb3','D4'], ['C4','Eb4','G4'], ['D4','F#4','A4'], ['G3','Bb3','D4'],
			['Eb3','G3','Bb3'],['F3','A3','C4'],  ['Bb3','D4','F4'], ['Bb3','D4','F4'],
			['G3','Bb3','D4'], ['C4','Eb4','G4'], ['D4','F#4','A4'], ['G3','Bb3','D4'],
			['Eb3','G3','Bb3'],['D4','F#4','A4'], ['G3','Bb3','D4'], ['D4','F#4','A4']
		]
	}),

	// ---- 5. Nebula Lounge ----------------------------------------------
	// Cmaj hopeful pop — soft triangle lead, gentle pad, the brightest of
	// the bunch. Singable melody, mostly stepwise.
	makeTrack({
		name: 'Nebula Lounge',
		beat: 0.22, loopBars: 16,
		lead: {
			type: 'triangle',
			volume: 0.072, attack: 0.03, sustain: 0.9,
			vibrato: { rate: 4.5, depth: 0.008 }
		},
		// C Am F G | C Em F G | C Am Dm G | C F G C
		melody: [
			['C5', 2], ['E5', 1], ['G5', 1],
			['A5', 2], ['E5', 1], ['C5', 1],
			['F5', 2], ['A5', 1], ['C6', 1],
			['B5', 2], ['G5', 2],
			['E5', 1], ['G5', 1], ['C6', 2],
			['B5', 2], ['G5', 2],
			['A5', 1], ['F5', 1], ['C5', 2],
			['D5', 2], ['G5', 2],
			['rest', 1], ['G5', 1], ['E5', 2],
			['A5', 1], ['G5', 1], ['E5', 2],
			['F5', 1], ['A5', 1], ['D6', 2],
			['B5', 1], ['D6', 1], ['G5', 2],
			['G5', 2], ['E5', 2],
			['F5', 1], ['A5', 1], ['C5', 2],
			['D5', 1], ['G5', 1], ['B5', 2],
			['C5', 4]
		],
		bass: [
			['C3', 2], ['G2', 2],  ['A2', 2], ['E3', 2],
			['F2', 2], ['C3', 2],  ['G2', 2], ['D3', 2],
			['C3', 2], ['G2', 2],  ['E2', 2], ['B2', 2],
			['F2', 2], ['C3', 2],  ['G2', 2], ['D3', 2],
			['C3', 2], ['G2', 2],  ['A2', 2], ['E3', 2],
			['D3', 2], ['A2', 2],  ['G2', 2], ['D3', 2],
			['C3', 2], ['G2', 2],  ['F2', 2], ['C3', 2],
			['G2', 2], ['D3', 2],  ['C3', 2], ['G2', 2]
		],
		pad: [
			['C4','E4','G4'], ['A3','C4','E4'], ['F3','A3','C4'], ['G3','B3','D4'],
			['C4','E4','G4'], ['E3','G3','B3'], ['F3','A3','C4'], ['G3','B3','D4'],
			['C4','E4','G4'], ['A3','C4','E4'], ['D3','F3','A3'], ['G3','B3','D4'],
			['C4','E4','G4'], ['F3','A3','C4'], ['G3','B3','D4'], ['C4','E4','G4']
		]
	}),

	// ---- 6. Pulsar Drive -----------------------------------------------
	// Am driving rock — fast square-lead riff over a hammered root-pulse
	// bass. Short loop, lots of motion.
	makeTrack({
		name: 'Pulsar Drive',
		beat: 0.14, loopBars: 8,
		lead: { type: 'square', volume: 0.055, attack: 0.003, sustain: 0.55 },
		bassParams: { type: 'sawtooth', volume: 0.06, attack: 0.003, sustain: 0.4,
		              filter: { type: 'lowpass', freq: 600, Q: 1.0 } },
		padParams:  { type: 'triangle', volume: 0.014, attack: 0.05, sustain: 0.85 },
		// Am - F - C - G | Am - F - E - Am
		melody: [
			['A4', 1], ['E5', 1], ['A5', 1], ['E5', 1],
			['F4', 1], ['C5', 1], ['F5', 1], ['C5', 1],
			['C5', 1], ['G5', 1], ['C6', 1], ['G5', 1],
			['G4', 1], ['D5', 1], ['G5', 1], ['B5', 1],
			['A5', 0.5], ['G5', 0.5], ['E5', 1], ['C5', 1], ['A4', 1],
			['F5', 0.5], ['E5', 0.5], ['C5', 1], ['A4', 1], ['F4', 1],
			['E5', 1], ['G#5', 1], ['B5', 1], ['E5', 1],
			['A4', 4]
		],
		bass: [
			['A2', 1], ['A2', 1], ['A2', 1], ['A2', 1],
			['F2', 1], ['F2', 1], ['F2', 1], ['F2', 1],
			['C3', 1], ['C3', 1], ['C3', 1], ['C3', 1],
			['G2', 1], ['G2', 1], ['G2', 1], ['G2', 1],
			['A2', 1], ['A2', 1], ['A2', 1], ['A2', 1],
			['F2', 1], ['F2', 1], ['F2', 1], ['F2', 1],
			['E2', 1], ['E2', 1], ['E2', 1], ['E2', 1],
			['A2', 1], ['A2', 1], ['A2', 1], ['A2', 1]
		],
		pad: [
			['A3','C4','E4'], ['F3','A3','C4'], ['C4','E4','G4'], ['G3','B3','D4'],
			['A3','C4','E4'], ['F3','A3','C4'], ['E3','G#3','B3'],['A3','C4','E4']
		]
	}),

	// ---- 7. Trade Winds ------------------------------------------------
	// F major bossa-flavoured cruise — soft sax over jazz changes,
	// syncopated rests in the melody let the bass breathe.
	makeTrack({
		name: 'Trade Winds',
		beat: 0.20, loopBars: 16,
		lead: {
			type: 'sawtooth',
			volume: 0.058, attack: 0.04, sustain: 0.88,
			filter: { type: 'bandpass', freq: 1300, Q: 1.2 },
			vibrato: { rate: 5.0, depth: 0.009 }
		},
		padParams: { type: 'triangle', volume: 0.018, attack: 0.12, sustain: 0.95 },
		// Fmaj7 - Dm7 - Bb - C7 | Am - Dm - G7 - C7 |
		// Fmaj7 - Dm - Gm7 - C7 | Am7 - D7 - G7 - C7
		melody: [
			['rest', 1], ['F5', 1], ['A5', 2],
			['rest', 1], ['A5', 1], ['F5', 2],
			['rest', 1], ['D5', 1], ['Bb4', 2],
			['rest', 1], ['G4', 1], ['C5', 2],
			['E5', 1], ['C5', 1], ['A4', 2],
			['F5', 1], ['A5', 1], ['D5', 2],
			['G5', 1], ['B5', 1], ['F5', 2],
			['E5', 1], ['G5', 1], ['C5', 2],
			['rest', 1], ['A5', 1], ['F5', 1], ['C5', 1],
			['D5', 1], ['F5', 1], ['A5', 2],
			['rest', 1], ['Bb5', 1], ['G5', 1], ['D5', 1],
			['E5', 1], ['G5', 1], ['Bb5', 2],
			['C5', 1], ['E5', 1], ['G5', 2],
			['rest', 1], ['F#5', 1], ['D5', 2],
			['G5', 1], ['F5', 1], ['D5', 1], ['B4', 1],
			['G4', 1], ['Bb4', 1], ['C5', 2]
		],
		bass: [
			['F2', 2], ['C3', 2],    ['D3', 2], ['A2', 2],
			['Bb2', 2], ['F3', 2],   ['C3', 2], ['G2', 2],
			['A2', 2], ['E3', 2],    ['D3', 2], ['A2', 2],
			['G2', 2], ['D3', 2],    ['C3', 2], ['G2', 2],
			['F2', 2], ['C3', 2],    ['D3', 2], ['A2', 2],
			['G2', 2], ['D3', 2],    ['C3', 2], ['G2', 2],
			['A2', 2], ['E3', 2],    ['D3', 2], ['A2', 2],
			['G2', 2], ['D3', 2],    ['C3', 2], ['G2', 2]
		],
		pad: [
			['F3','A3','C4'], ['D3','F3','A3'],   ['Bb3','D4','F4'], ['C4','E4','G4'],
			['A3','C4','E4'], ['D3','F3','A3'],   ['G3','B3','D4'],  ['C4','E4','G4'],
			['F3','A3','C4'], ['D3','F3','A3'],   ['G3','Bb3','D4'], ['C4','E4','G4'],
			['A3','C4','E4'], ['D4','F#4','A4'],  ['G3','B3','D4'],  ['C4','E4','G4']
		]
	}),

	// ---- 8. Outer Rim Blues --------------------------------------------
	// E minor 12-bar blues — wailing lead with heavier vibrato, classic
	// blues bass pattern.
	makeTrack({
		name: 'Outer Rim Blues',
		beat: 0.22, loopBars: 12,
		lead: {
			type: 'sawtooth',
			volume: 0.075, attack: 0.04, sustain: 0.95,
			filter: { type: 'bandpass', freq: 1250, Q: 1.7 },
			vibrato: { rate: 6.5, depth: 0.020 }
		},
		// Em(4) Am(2) Em(2) B7(1) Am(1) Em(1) B7(1)
		melody: [
			['B4', 2], ['D5', 1], ['E5', 1],
			['G5', 2], ['E5', 2],
			['D5', 1], ['B4', 1], ['G4', 2],
			['A4', 1], ['B4', 1], ['E5', 2],
			['E5', 1], ['C5', 1], ['A4', 2],
			['C5', 2], ['A4', 1], ['G4', 1],
			['E5', 1], ['G5', 1], ['B5', 2],
			['D5', 2], ['B4', 2],
			['F#5', 1], ['D#5', 1], ['B4', 2],
			['G5', 1], ['E5', 1], ['A4', 2],
			['B4', 2], ['E4', 2],
			['rest', 1], ['D#5', 1], ['F#5', 2]
		],
		bass: [
			['E2', 2], ['B2', 2],   ['E2', 2], ['B2', 2],
			['E2', 2], ['B2', 2],   ['E2', 2], ['B2', 2],
			['A2', 2], ['E3', 2],   ['A2', 2], ['E3', 2],
			['E2', 2], ['B2', 2],   ['E2', 2], ['B2', 2],
			['B2', 2], ['F#3', 2],
			['A2', 2], ['E3', 2],
			['E2', 2], ['B2', 2],
			['B2', 2], ['F#3', 2]
		],
		pad: [
			['E3','G3','B3'], ['E3','G3','B3'], ['E3','G3','B3'], ['E3','G3','B3'],
			['A3','C4','E4'], ['A3','C4','E4'],
			['E3','G3','B3'], ['E3','G3','B3'],
			['B3','D#4','F#4'],
			['A3','C4','E4'],
			['E3','G3','B3'],
			['B3','D#4','F#4']
		]
	}),

	// ---- 9. Stardust Boogie --------------------------------------------
	// Bb boogie shuffle — square-lead riff over a classic 1-3-5-6 walking
	// bass. 8 bars so the loop hits often.
	makeTrack({
		name: 'Stardust Boogie',
		beat: 0.18, loopBars: 8,
		lead: { type: 'square', volume: 0.05, attack: 0.005, sustain: 0.7 },
		bassParams: { type: 'triangle', volume: 0.08, attack: 0.005, sustain: 0.55 },
		// Bb - Bb - Eb - Bb | F7 - Eb - Bb - F7
		melody: [
			['Bb4', 1], ['D5', 1], ['F5', 1], ['D5', 1],
			['Bb4', 1], ['D5', 1], ['F5', 1], ['Bb5', 1],
			['Eb5', 1], ['G5', 1], ['Bb5', 1], ['G5', 1],
			['F5', 1], ['D5', 1], ['Bb4', 2],
			['F5', 1], ['A5', 1], ['C6', 1], ['A5', 1],
			['Eb5', 1], ['G5', 1], ['Bb5', 1], ['G5', 1],
			['F5', 1], ['D5', 1], ['Bb4', 1], ['F4', 1],
			['A4', 1], ['C5', 1], ['Eb5', 1], ['F5', 1]
		],
		// Boogie 1-3-5-6 walking pattern in eighth notes.
		bass: [
			['Bb2', 0.5], ['D3', 0.5], ['F3', 0.5], ['G3', 0.5],
			['F3', 0.5], ['D3', 0.5], ['Bb2', 0.5], ['Bb2', 0.5],
			['Bb2', 0.5], ['D3', 0.5], ['F3', 0.5], ['G3', 0.5],
			['F3', 0.5], ['D3', 0.5], ['Bb2', 0.5], ['Bb2', 0.5],
			['Eb2', 0.5], ['G2', 0.5], ['Bb2', 0.5], ['C3', 0.5],
			['Bb2', 0.5], ['G2', 0.5], ['Eb2', 0.5], ['Eb2', 0.5],
			['Bb2', 0.5], ['D3', 0.5], ['F3', 0.5], ['G3', 0.5],
			['F3', 0.5], ['D3', 0.5], ['Bb2', 0.5], ['Bb2', 0.5],
			['F2', 0.5], ['A2', 0.5], ['C3', 0.5], ['D3', 0.5],
			['C3', 0.5], ['A2', 0.5], ['F2', 0.5], ['F2', 0.5],
			['Eb2', 0.5], ['G2', 0.5], ['Bb2', 0.5], ['C3', 0.5],
			['Bb2', 0.5], ['G2', 0.5], ['Eb2', 0.5], ['Eb2', 0.5],
			['Bb2', 0.5], ['D3', 0.5], ['F3', 0.5], ['G3', 0.5],
			['F3', 0.5], ['D3', 0.5], ['Bb2', 0.5], ['Bb2', 0.5],
			['F2', 0.5], ['A2', 0.5], ['C3', 0.5], ['D3', 0.5],
			['C3', 0.5], ['A2', 0.5], ['F2', 0.5], ['F2', 0.5]
		],
		pad: [
			['Bb3','D4','F4'], ['Bb3','D4','F4'], ['Eb3','G3','Bb3'], ['Bb3','D4','F4'],
			['F3','A3','Eb4'], ['Eb3','G3','Bb3'], ['Bb3','D4','F4'], ['F3','A3','Eb4']
		]
	}),

	// ---- 10. Frontier Theme --------------------------------------------
	// D major anthemic — square lead through a gentle lowpass for a
	// warmer "heroic" timbre over a stately progression.
	makeTrack({
		name: 'Frontier Theme',
		beat: 0.24, loopBars: 16,
		lead: {
			type: 'square',
			volume: 0.058, attack: 0.012, sustain: 0.85,
			filter: { type: 'lowpass', freq: 2800, Q: 0.6 }
		},
		// D - A - Bm - G | D - G - A - D | D - A - Bm - F#m | G - A - G - D
		melody: [
			['D5', 2], ['A4', 1], ['F#4', 1],
			['A4', 2], ['C#5', 1], ['E5', 1],
			['D5', 2], ['F#5', 1], ['A5', 1],
			['G5', 2], ['B4', 1], ['D5', 1],
			['A5', 2], ['F#5', 1], ['D5', 1],
			['G5', 1], ['B5', 1], ['D6', 2],
			['C#6', 1], ['A5', 1], ['E5', 2],
			['D5', 4],
			['D5', 1], ['F#5', 1], ['A5', 2],
			['C#5', 1], ['E5', 1], ['A5', 2],
			['rest', 1], ['F#5', 1], ['B5', 2],
			['A5', 1], ['F#5', 1], ['C#5', 2],
			['G5', 2], ['B5', 2],
			['A5', 2], ['E5', 2],
			['B5', 1], ['G5', 1], ['D5', 2],
			['D5', 4]
		],
		bass: [
			['D3', 2], ['A2', 2],   ['A2', 2], ['E3', 2],
			['B2', 2], ['F#3', 2],  ['G2', 2], ['D3', 2],
			['D3', 2], ['A2', 2],   ['G2', 2], ['D3', 2],
			['A2', 2], ['E3', 2],   ['D3', 2], ['A2', 2],
			['D3', 2], ['A2', 2],   ['A2', 2], ['E3', 2],
			['B2', 2], ['F#3', 2],  ['F#2', 2], ['C#3', 2],
			['G2', 2], ['D3', 2],   ['A2', 2], ['E3', 2],
			['G2', 2], ['D3', 2],   ['D3', 2], ['A2', 2]
		],
		pad: [
			['D4','F#4','A4'], ['A3','C#4','E4'], ['B3','D4','F#4'], ['G3','B3','D4'],
			['D4','F#4','A4'], ['G3','B3','D4'],  ['A3','C#4','E4'], ['D4','F#4','A4'],
			['D4','F#4','A4'], ['A3','C#4','E4'], ['B3','D4','F#4'], ['F#3','A3','C#4'],
			['G3','B3','D4'],  ['A3','C#4','E4'], ['G3','B3','D4'],  ['D4','F#4','A4']
		]
	})

	];


	function scheduleVoice(params, freq, startTime, duration) {
		var c = ctx;
		if (!c || !musicGain) return;
		if (!freq) return;
		// Defensive guard: if a future track ships with an incomplete voice
		// override (missing volume), silence it rather than feeding NaN
		// into the WebAudio gain ramp.
		if (!params || params.volume == null) return;
		var o = c.createOscillator();
		var g = c.createGain();
		o.type = params.type;
		o.frequency.setValueAtTime(freq, startTime);
		var head = o;
		if (params.filter) {
			var f = c.createBiquadFilter();
			f.type = params.filter.type;
			f.frequency.setValueAtTime(params.filter.freq, startTime);
			if (params.filter.Q != null) f.Q.setValueAtTime(params.filter.Q, startTime);
			head.connect(f);
			head = f;
		}
		head.connect(g);
		g.connect(musicGain);

		// Vibrato — modulates the oscillator frequency. Ramps in over the
		// first portion of the note so short notes don't warble unnaturally.
		if (params.vibrato) {
			var lfo = c.createOscillator();
			var lfoGain = c.createGain();
			lfo.frequency.setValueAtTime(params.vibrato.rate, startTime);
			var depth = freq * params.vibrato.depth;
			lfoGain.gain.setValueAtTime(0, startTime);
			lfoGain.gain.linearRampToValueAtTime(depth, startTime + Math.min(duration * 0.4, 0.18));
			lfo.connect(lfoGain);
			lfoGain.connect(o.frequency);
			lfo.start(startTime);
			lfo.stop(startTime + duration + 0.02);
		}

		var attack = params.attack != null ? params.attack : 0.01;
		var sustain = params.sustain != null ? params.sustain : 0.7;
		g.gain.setValueAtTime(0, startTime);
		g.gain.linearRampToValueAtTime(params.volume, startTime + attack);
		g.gain.linearRampToValueAtTime(params.volume * sustain, startTime + duration * 0.65);
		g.gain.exponentialRampToValueAtTime(0.0005, startTime + duration);
		o.start(startTime);
		o.stop(startTime + duration + 0.02);
	}


	// ----- Playback state -----------------------------------------------
	var musicGain = null;
	var musicTimer = null;
	var musicNextStartCtxTime = 0;
	var musicStopped = true;
	var currentTrackIndex = 0;
	var stateChangeListeners = [];

	function emitStateChange() {
		for (var i = 0; i < stateChangeListeners.length; i++) {
			try { stateChangeListeners[i](); } catch (e) {}
		}
	}

	function scheduleLoop() {
		var c = ctx;
		if (!c || musicStopped) return;
		var track = TRACKS[currentTrackIndex];
		var beat = track.beat;
		var bar = beat * 4;
		var loop = track.loopBars * bar;

		// If the tab was backgrounded, `setTimeout` may have fired far later
		// than scheduled — skip forward instead of piling notes in the past.
		var minStart = c.currentTime + 0.05;
		if (musicNextStartCtxTime < minStart) musicNextStartCtxTime = minStart;
		var start = musicNextStartCtxTime;

		// Lead.
		var t = start;
		for (var i = 0; i < track.melody.length; i++) {
			var mf = track.melody[i][0];
			var mdur = track.melody[i][1] * beat;
			if (mf > 0) scheduleVoice(track.lead, mf, t, mdur * 0.94);
			t += mdur;
		}
		// Bass.
		var tb = start;
		for (var bi = 0; bi < track.bass.length; bi++) {
			var bf = track.bass[bi][0];
			var bdur = track.bass[bi][1] * beat;
			if (bf > 0) scheduleVoice(track.bassParams, bf, tb, bdur * 0.95);
			tb += bdur;
		}
		// Pad — one chord per bar, slow swell.
		for (var pb = 0; pb < track.pad.length; pb++) {
			var chord = track.pad[pb];
			for (var pn = 0; pn < chord.length; pn++) {
				scheduleVoice(track.padParams, chord[pn], start + pb * bar, bar * 0.98);
			}
		}

		musicNextStartCtxTime += loop;
		musicTimer = setTimeout(scheduleLoop, (loop - 0.2) * 1000);
	}

	function startMusic() {
		var c = ensureCtx();
		if (!c) return;
		if (!musicStopped) return;
		musicStopped = false;
		if (!musicGain) {
			musicGain = c.createGain();
			musicGain.gain.setValueAtTime(0.5, c.currentTime);
			musicGain.connect(c.destination);
		}
		musicNextStartCtxTime = c.currentTime + 0.1;
		scheduleLoop();
		emitStateChange();
	}

	function stopMusic() {
		var wasPlaying = !musicStopped;
		musicStopped = true;
		if (musicTimer) {
			clearTimeout(musicTimer);
			musicTimer = null;
		}
		if (musicGain && ctx) {
			// Let the master gain fade out cleanly so rapid Next/Next
			// switches don't produce audible clicks. Hold a local
			// reference and defer the disconnect until after the ramp
			// has had time to play.
			var now = ctx.currentTime;
			var oldGain = musicGain;
			musicGain = null;
			oldGain.gain.cancelScheduledValues(now);
			oldGain.gain.setValueAtTime(oldGain.gain.value, now);
			oldGain.gain.linearRampToValueAtTime(0, now + 0.15);
			setTimeout(function(){
				try { oldGain.disconnect(); } catch (e) {}
			}, 200);
		}
		if (wasPlaying) emitStateChange();
	}

	function toggleMusic() {
		if (musicStopped) startMusic();
		else stopMusic();
	}

	function switchTrack(delta) {
		var n = TRACKS.length;
		currentTrackIndex = ((currentTrackIndex + delta) % n + n) % n;
		if (!musicStopped) {
			// Restart playback at the top of the new track.
			stopMusic();
			startMusic();
		} else {
			emitStateChange();
		}
	}

	function getCurrentTrack() {
		return {
			name:  TRACKS[currentTrackIndex].name,
			index: currentTrackIndex,
			total: TRACKS.length
		};
	}

	function onStateChange(fn) {
		if (typeof fn === 'function') stateChangeListeners.push(fn);
	}


	function safeSuspend() {
		if (!ctx || !ctx.suspend || ctx.state === 'closed') return;
		ctx.suspend();
	}
	function safeResume() {
		if (!ctx || !ctx.resume || ctx.state === 'closed') return;
		ctx.resume();
	}

	// Pause music while the tab is hidden — saves real CPU on mobile.
	// visibilityPaused tracks the pause so we only resume music we
	// ourselves stopped, not what the user disabled.
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
		// Bomb pickup — low descending sawtooth + dirty noise burst.
		bomb: function(){
			tone({type: 'sawtooth', freq: 240, freqEnd: 50, duration: 0.40, volume: 0.20});
			noiseBurst(0.45, 0.14);
		},
		// Downward sweep + noise for the player's own death.
		die: function(){
			tone({type: 'sawtooth', freq: 440, freqEnd: 80, duration: 0.55, volume: 0.18});
			noiseBurst(0.4, 0.08);
		},
		// Tiny pop when another worm dies.
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

		// Music transport. All calls are safe to make from a click handler —
		// they internally ensureCtx() if the audio thread isn't running yet.
		startMusic:      startMusic,
		stopMusic:       stopMusic,
		toggleMusic:     toggleMusic,
		nextTrack:       function(){ switchTrack(+1); },
		prevTrack:       function(){ switchTrack(-1); },
		getCurrentTrack: getCurrentTrack,
		isPlaying:       function(){ return !musicStopped; },
		onStateChange:   onStateChange,
		trackCount:      function(){ return TRACKS.length; }
	};

})();
