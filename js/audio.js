// All sound is synthesised: engine hum that follows the revs, tyre squeal, horns, impacts, doors.
(function (NB) {
  'use strict';
  NB.createAudio = function () {
    let AC = null, master = null, noiseBuf = null, eng = null, skid = null;
    const A = {};
    let volume = 1;
    // overall volume 0..1 (0 = sound off), applied to the master bus
    A.setVolume = function (v) {
      volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.setTargetAtTime(.7 * volume, AC.currentTime, .05);
    };
    A.init = function () {
      if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
      try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      const comp = AC.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
      master = AC.createGain(); master.gain.value = .7 * volume; master.connect(comp); comp.connect(AC.destination);
      noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    };
    const ok = () => AC && AC.state === 'running';
    function out(pos) {
      const g = AC.createGain();
      if (pos) {
        const p = AC.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 6; p.rolloffFactor = 1.2;
        if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else p.setPosition(pos[0], pos[1], pos[2]);
        g.connect(p); p.connect(master);
      } else g.connect(master);
      return g;
    }
    function env(g, t, a, peak, dur) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + dur); }
    function noise(dest, t, dur, type, f, q, peak, f2) {
      const s = AC.createBufferSource(); s.buffer = noiseBuf;
      const flt = AC.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t); if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur); flt.Q.value = q;
      const g = AC.createGain(); env(g, t, .004, peak, dur);
      s.connect(flt); flt.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + .05);
    }
    A.listener = function (x, y, z, fx, fz) {
      if (!AC) return; const L = AC.listener;
      if (L.positionX) { L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z; L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
      else { L.setPosition(x, y, z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
    };
    // engine: two detuned oscillators through a low-pass filter; pitch follows the revs, filter follows the throttle
    A.engineOn = function (on) {
      if (!ok()) return;
      if (on && !eng) {
        const o1 = AC.createOscillator(), o2 = AC.createOscillator(), o3 = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain();
        o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'sine'; f.type = 'lowpass'; f.Q.value = 2; g.gain.value = 0;
        o1.connect(f); o2.connect(f); o3.connect(g); f.connect(g); g.connect(master);
        o1.start(); o2.start(); o3.start();
        eng = { o1, o2, o3, f, g };
        const s = AC.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
        const sf = AC.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1500; sf.Q.value = 3;
        const sg = AC.createGain(); sg.gain.value = 0; s.connect(sf); sf.connect(sg); sg.connect(master); s.start();
        skid = { s, sg, sf };
      }
      if (eng) eng.g.gain.setTargetAtTime(on ? .05 : 0, AC.currentTime, .15);
      if (!on && skid) skid.sg.gain.setTargetAtTime(0, AC.currentTime, .05);
    };
    const VOICE = { zefiro: 1.25, corsaro: .8, hayride: .7, beachcomber: .75, outbacker: .75, royale: .85, piccolo: 1.35, speedboat: .72, jetski: 1.55 };
    A.engine = function (rpm, load, id) {
      if (!eng) { A.engineOn(true); if (!eng) return; }
      const t = AC.currentTime, base = 34 * (VOICE[id] || 1), f = base + rpm * base * 2.4;
      eng.o1.frequency.setTargetAtTime(f, t, .04); eng.o2.frequency.setTargetAtTime(f * .5 + 1.5, t, .04); eng.o3.frequency.setTargetAtTime(f * .5, t, .04);
      eng.f.frequency.setTargetAtTime(260 + rpm * 900 + load * 900, t, .06);
      eng.g.gain.setTargetAtTime(.045 + load * .05 + rpm * .02, t, .08);
    };
    A.skid = function (k) { if (skid) skid.sg.gain.setTargetAtTime(Math.min(1, k) * .22, AC.currentTime, .05); };
    A.horn = function (pos) {
      if (!ok()) return;
      const t = AC.currentTime, d = out(pos), f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; f.connect(d);
      for (const hz of [392, 494]) { const o = AC.createOscillator(); o.type = 'square'; o.frequency.value = hz; const g = AC.createGain(); env(g, t, .01, pos ? .5 : .12, .45); o.connect(g); g.connect(f); o.start(t); o.stop(t + .5); }
    };
    A.impact = function (strength, pos) {
      if (!ok()) return;
      const t = AC.currentTime, d = out(pos), k = Math.min(1, strength / 14);
      noise(d, t, .25 + k * .3, 'lowpass', 900, .8, .3 + k * .6, 120);
      noise(d, t, .12, 'bandpass', 2600, 2, .15 + k * .3);
      const o = AC.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + .2);
      const g = AC.createGain(); env(g, t, .004, .3 + k * .4, .25); o.connect(g); g.connect(d); o.start(t); o.stop(t + .3);
    };
    A.door = function () {
      if (!ok()) return;
      const t = AC.currentTime, d = out(null);
      noise(d, t, .09, 'lowpass', 700, 1, .5); noise(d, t + .02, .05, 'bandpass', 2400, 3, .25);
    };
    const tone = (dest, t, dur, type, f, peak, f2) => {
      const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      const g = AC.createGain(); env(g, t, .003, peak, dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + .05);
    };
    // gunshots: a noise crack, a low thump, and a filtered tail; each weapon has its own weight
    const GUN = { pistol: [1, 150, .7], smg: [.7, 190, .45], shotgun: [1.4, 110, 1], rifle: [1.1, 135, .75], cop: [.9, 160, .6] };
    A.shot = function (kind, pos) {
      if (!ok()) return;
      const [w, thump, len] = GUN[kind] || GUN.pistol, t = AC.currentTime, d = out(pos);
      noise(d, t, .06, 'highpass', 2200, .7, .5 * w);
      noise(d, t, .22 * len + .1, 'lowpass', 4200, .9, .8 * w, 300);
      tone(d, t, .14 * len, 'sine', thump, .8 * w, 42);
    };
    A.dry = function () { if (!ok()) return; const d = out(null); noise(d, AC.currentTime, .02, 'highpass', 4000, .7, .3); };
    A.punch = function (pos, heavy) {
      if (!ok()) return; const t = AC.currentTime, d = out(pos);
      noise(d, t, .12, 'lowpass', 700, 1, .7, 150); tone(d, t, .1, 'sine', 110, .5, 55);
      if (heavy) { noise(d, t, .08, 'bandpass', 1200, 3, .5); tone(d, t, .16, 'triangle', 190, .35, 70); }   // wooden crack of the bat
    };
    // money: a cash-register ring; bigger sums ring twice
    A.cash = function (big) {
      if (!ok()) return; const t = AC.currentTime, d = out(null);
      noise(d, t, .05, 'highpass', 5000, .7, .18);
      [1568, 2093].forEach((f, i) => tone(d, t + .04 + i * .07, .35, 'triangle', f, .12));
      if (big) [2637, 3136].forEach((f, i) => tone(d, t + .22 + i * .07, .4, 'triangle', f, .09));
    };
    A.deny = function () { if (!ok()) return; const t = AC.currentTime, d = out(null); tone(d, t, .12, 'square', 220, .07); tone(d, t + .13, .18, 'square', 165, .07); };
    A.fare = function () { if (!ok()) return; const t = AC.currentTime, d = out(null); [784, 988, 1175].forEach((f, i) => tone(d, t + i * .09, .16, 'square', f, .05)); };
    A.hurt = function () { if (!ok()) return; const t = AC.currentTime, d = out(null); noise(d, t, .2, 'lowpass', 500, 1, .5, 90); tone(d, t, .18, 'sine', 90, .4, 45); };
    A.scream = function (pos) {
      if (!ok()) return; const t = AC.currentTime, d = out(pos), f = 500 + Math.random() * 500;
      const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.5, t + .15); o.frequency.linearRampToValueAtTime(f * .9, t + .6);
      const flt = AC.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 1400; flt.Q.value = 2;
      const g = AC.createGain(); env(g, t, .04, .25, .65); o.connect(flt); flt.connect(g); g.connect(d); o.start(t); o.stop(t + .7);
    };
    A.groan = function (pos) {
      if (!ok()) return; const t = AC.currentTime, d = out(pos);
      const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(140, t); o.frequency.linearRampToValueAtTime(95, t + .7);
      const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; const g = AC.createGain(); env(g, t, .08, .12, .8);
      o.connect(f); f.connect(g); g.connect(d); o.start(t); o.stop(t + .85);
    };
    A.pickup = function () { if (!ok()) return; const t = AC.currentTime, d = out(null); [660, 880, 1320].forEach((f, i) => tone(d, t + i * .06, .14, 'triangle', f, .15)); };
    A.sting = function (kind) {
      if (!ok()) return; const t = AC.currentTime, d = out(null);
      if (kind === 'wasted') { tone(d, t, 1.6, 'sawtooth', 220, .12, 55); tone(d, t, 1.6, 'triangle', 110, .2, 40); }
      else { [523, 415, 330].forEach((f, i) => tone(d, t + i * .22, .3, 'square', f, .08)); }
    };
    A.starUp = function () { if (!ok()) return; const t = AC.currentTime, d = out(null); tone(d, t, .12, 'square', 988, .06); tone(d, t + .12, .18, 'square', 1318, .06); };
    // NEPLOXO 21 music: an 80s disco loop at 118 BPM (four-on-the-floor kick, claps, hats, octave bass,
    // offbeat chord stabs and a quiet arpeggio over Am-F-C-G), scheduled ahead on the audio clock.
    // Outside the club it is quieter and muffled through the walls.
    let club = null;
    const CHORDS = [[55, [220, 261.63, 329.63]], [43.65, [174.61, 220, 261.63]], [65.41, [261.63, 329.63, 392]], [49, [196, 246.94, 293.66]]];
    function clubStep(step, t, bus) {
      const s = step % 16, bar = ((step / 16) | 0) % 4, [root, chord] = CHORDS[bar];
      if (s % 4 === 0) {   // kick
        const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + .12);
        env(g, t, .002, .9, .28); o.connect(g); g.connect(bus); o.start(t); o.stop(t + .3);
      }
      if (s === 4 || s === 12) { noise(bus, t, .16, 'bandpass', 1500, .9, .35); noise(bus, t + .012, .12, 'bandpass', 1100, 1.2, .25); }
      if (s % 4 === 2) noise(bus, t, .14, 'highpass', 7000, .7, .18); else noise(bus, t, .03, 'highpass', 9000, .7, .06);
      if (s % 2 === 0) {   // octave bass on the eighths
        const f = root * ((s / 2) % 2 ? 2 : 1), o = AC.createOscillator(), flt = AC.createBiquadFilter(), g = AC.createGain();
        o.type = 'sawtooth'; o.frequency.value = f; flt.type = 'lowpass'; flt.frequency.setValueAtTime(900, t); flt.frequency.exponentialRampToValueAtTime(220, t + .14);
        env(g, t, .005, .32, .16); o.connect(flt); flt.connect(g); g.connect(bus); o.start(t); o.stop(t + .2);
      }
      if (s === 6 || s === 14 || (s === 3 && bar % 2)) {   // chord stabs
        const flt = AC.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 2400; flt.connect(bus);
        for (const f of chord) { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'square'; o.frequency.value = f; o.detune.value = (Math.random() - .5) * 8; env(g, t, .004, .045, .2); o.connect(g); g.connect(flt); o.start(t); o.stop(t + .25); }
      }
      { const f = chord[s % 3] * (s % 6 < 3 ? 2 : 4), o = AC.createOscillator(), g = AC.createGain(); o.type = 'triangle'; o.frequency.value = f; env(g, t, .003, .03, .09); o.connect(g); g.connect(bus); o.start(t); o.stop(t + .12); }
    }
    /* ---------- music for every venue, one at a time ---------- */
    // small instruments shared by the tracks below
    const kick = (bus, t, v = .8) => { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + .1); env(g, t, .002, v, .22); o.connect(g); g.connect(bus); o.start(t); o.stop(t + .25); };
    const snare = (bus, t, v = .3) => { noise(bus, t, .14, 'bandpass', 1800, .8, v); tone(bus, t, .08, 'triangle', 190, v * .6, 150); };
    const hat = (bus, t, v = .08, len = .03) => noise(bus, t, len, 'highpass', 8000, .7, v);
    const pluck = (bus, t, f, type, v, dur, cut) => {
      const o = AC.createOscillator(), g = AC.createGain(), flt = AC.createBiquadFilter(); o.type = type; o.frequency.value = f;
      flt.type = 'lowpass'; flt.frequency.value = cut || 3000; env(g, t, .004, v, dur); o.connect(flt); flt.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + .05);
    };
    const pad = (bus, t, fs, dur, v, type = 'triangle') => { for (const f of fs) { const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.value = f; o.detune.value = (Math.random() - .5) * 10; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .08); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + .05); } };
    const steel = (bus, t, f, v) => { pluck(bus, t, f, 'sine', v, .35); pluck(bus, t, f * 2.76, 'sine', v * .35, .18); };
    const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
    const TRACKS = {
      club: { bpm: 118, step: clubStep },
      // rock'n'roll: walking bass, backbeat, piano stabs on the offbeat (A–D–E–A)
      diner: { bpm: 150, step(step, t, bus) {
        const s = step % 16, bar = ((step / 16) | 0) % 4, root = [110, 146.83, 164.81, 110][bar];
        if (s === 0 || s === 8) kick(bus, t, .6); if (s === 4 || s === 12) snare(bus, t, .28); if (s % 2 === 0) hat(bus, t, .06);
        if (s % 2 === 0) pluck(bus, t, root / 2 * [1, 1.26, 1.5, 1.68, 2, 1.68, 1.5, 1.26][(s / 2) | 0], 'sawtooth', .22, .18, 700);
        if (s % 4 === 2) for (const k of [1, 1.26, 1.5]) pluck(bus, t, root * 2 * k, 'square', .035, .12, 2200);
      } },
      // surf rock: tremolo guitar on Em–C–D–Em
      diner2: { bpm: 168, step(step, t, bus) {
        const s = step % 16, bar = ((step / 16) | 0) % 4, root = [164.81, 130.81, 146.83, 164.81][bar];
        if (s % 8 === 0) kick(bus, t, .55); if (s === 4 || s === 12) snare(bus, t, .25); hat(bus, t, .04);
        pluck(bus, t, root * [1, 1.5, 2, 1.5][((s / 4) | 0)] * (s % 2 ? 1 : 2), 'sawtooth', .06, .09, 1800);
        if (s % 4 === 0) pluck(bus, t, root / 2, 'triangle', .3, .3, 600);
      } },
      // slow doo-wop in 12/8: C–Am–F–G
      diner3: { bpm: 72, step(step, t, bus) {
        const s = step % 12, bar = ((step / 12) | 0) % 4, ch = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]][bar];
        if (s % 3 === 0) pad(bus, t, ch, .5, .045);
        if (s === 0 || s === 6) pluck(bus, t, ch[0] / 2, 'triangle', .3, .5, 500);
        if (s === 3 || s === 9) snare(bus, t, .15);
        if (s === 0) kick(bus, t, .5);
      } },
      // lounge bossa for the casino: soft maj7 chords, root–fifth bass, rim clicks
      casino: { bpm: 100, step(step, t, bus) {
        const s = step % 16, bar = ((step / 16) | 0) % 4, ch = [[261.6, 329.6, 392, 493.9], [220, 261.6, 329.6, 392], [293.7, 349.2, 440, 523.3], [196, 246.9, 293.7, 349.2]][bar];
        if (s === 0 || s === 8) pad(bus, t, ch, 1.1, .03, 'sine');
        if (s === 0 || s === 6) pluck(bus, t, ch[0] / 2, 'triangle', .28, .4, 500); if (s === 8 || s === 14) pluck(bus, t, ch[2] / 2, 'triangle', .22, .35, 500);
        if ([0, 3, 6, 10, 12].includes(s)) noise(bus, t, .03, 'bandpass', 2600, 4, .12);
        hat(bus, t, .025, .05);
        if (s % 4 === 2 && Math.random() < .5) pluck(bus, t, ch[(Math.random() * 4) | 0] * 2, 'sine', .05, .4);
      } },
      // chiptune for the arcade
      arcade: { bpm: 140, step(step, t, bus) {
        const s = step % 16, bar = ((step / 16) | 0) % 4, ch = [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]][bar];
        pluck(bus, t, ch[s % 3] * 2, 'square', .045, .07, 5000);
        if (s % 2 === 0) pluck(bus, t, ch[0] / 2, 'square', .09, .1, 1200);
        if (s % 4 === 0) kick(bus, t, .5); if (s === 4 || s === 12) noise(bus, t, .08, 'highpass', 3000, .7, .15); if (s % 2) hat(bus, t, .04);
        if (s === 0 || s === 6 || s === 10) pluck(bus, t, ch[(bar + s) % 3] * 4, 'square', .03, .18, 6000);
      } },
      // elevator-style lounge in the hotel lobby
      lounge: { bpm: 84, step(step, t, bus) {
        const s = step % 16, bar = ((step / 16) | 0) % 4, ch = [[261.6, 329.6, 392, 493.9], [293.7, 349.2, 440, 523.3], [220, 277.2, 329.6, 415.3], [246.9, 293.7, 370, 440]][bar];
        if (s === 0) pad(bus, t, ch, 2.6, .025, 'sine');
        if (s % 4 === 0) pluck(bus, t, ch[0] / 2, 'sine', .2, .6, 400);
        if (s % 4 === 2 && Math.random() < .6) pluck(bus, t, 523.3 * Math.pow(2, PENTA[(Math.random() * PENTA.length) | 0] / 12), 'sine', .05, .5);
      } },
      // tropical: steel drum melody, marimba chords, shaker and bongos
      tiki: { bpm: 104, step(step, t, bus) {
        const s = step % 16, bar = ((step / 16) | 0) % 4, root = [392, 523.3, 440, 392][bar];
        if ([0, 3, 6, 8, 11, 14].includes(s)) steel(bus, t, root * Math.pow(2, PENTA[(s + bar * 3) % 6] / 12), .12);
        if (s % 4 === 2) for (const k of [1, 1.26, 1.5]) pluck(bus, t, root / 2 * k, 'sine', .05, .15);
        hat(bus, t, s % 2 ? .05 : .025, .05);
        if (s === 0 || s === 10) pluck(bus, t, 180, 'sine', .3, .12); if (s === 7 || s === 13) pluck(bus, t, 260, 'sine', .22, .1);
        if (s === 0 || s === 8) pluck(bus, t, root / 4, 'triangle', .25, .35, 500);
      } }
    };
    let venue = null;
    // name: which track; level 0..1; inside: full sound, otherwise muffled as if through walls
    A.venue = function (name, level, inside) {
      if (!ok()) return;
      const t = AC.currentTime;
      if (!venue) {
        const bus = AC.createGain(), flt = AC.createBiquadFilter(), out = AC.createGain();
        bus.gain.value = .55; flt.type = 'lowpass'; flt.frequency.value = 600; out.gain.value = 0;
        bus.connect(flt); flt.connect(out); out.connect(master);
        venue = { bus, flt, out, timer: 0, next: 0, step: 0, level: 0, name: null };
      }
      if (!TRACKS[name]) level = 0;
      if (name && name !== venue.name && TRACKS[name]) { venue.name = name; venue.step = 0; venue.next = t + .08; }
      venue.out.gain.setTargetAtTime(level * .8, t, .25);
      venue.flt.frequency.setTargetAtTime(inside ? 15000 : 380 + level * 900, t, .25);
      if (level > .005 && !venue.timer) {
        venue.next = Math.max(venue.next, t + .06);
        venue.timer = setInterval(() => {
          if (!AC || AC.state !== 'running' || !TRACKS[venue.name]) return;
          const tr = TRACKS[venue.name], step = 60 / tr.bpm / 4;
          if (venue.next < AC.currentTime) venue.next = AC.currentTime + .02;
          while (venue.next < AC.currentTime + .18) { tr.step(venue.step++, venue.next, venue.bus); venue.next += step; }
        }, 40);
      } else if (level <= .005 && venue.timer && venue.level <= .005) { clearInterval(venue.timer); venue.timer = 0; }
      venue.level = level;
    };
    A.club = (level, inside) => A.venue('club', level, inside);
    // bank alarm bell: a hard ringing tone chopped by a fast tremolo
    let alarm = null;
    A.alarm = function (on) {
      if (!ok()) return;
      if (!alarm && on) {
        const o = AC.createOscillator(), trem = AC.createOscillator(), depth = AC.createGain(), am = AC.createGain(), g = AC.createGain(), f = AC.createBiquadFilter();
        o.type = 'square'; o.frequency.value = 1150; trem.type = 'square'; trem.frequency.value = 14;
        depth.gain.value = .5; am.gain.value = .5; g.gain.value = 0;   // am swings 0..1, g is the on/off level
        f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2;
        trem.connect(depth); depth.connect(am.gain); o.connect(f); f.connect(am); am.connect(g); g.connect(master); o.start(); trem.start();
        alarm = { g };
      }
      if (alarm) alarm.g.gain.setTargetAtTime(on ? .05 : 0, AC.currentTime, .05);
    };
    // helicopter: the whop-whop of the blades (filtered noise chopped by a pulse) over a turbine whine
    let rotorV = null;
    A.rotor = function (level, pitch) {
      if (!ok()) return;
      const t = AC.currentTime;
      if (!rotorV && level > .01) {
        const src = AC.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const bp = AC.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 420; bp.Q.value = 1.2;
        const chop = AC.createGain(), lfo = AC.createOscillator(), depth = AC.createGain();
        lfo.type = 'sawtooth'; lfo.frequency.value = 5; depth.gain.value = .5; chop.gain.value = .55;
        lfo.connect(depth); depth.connect(chop.gain);
        const out = AC.createGain(); out.gain.value = 0;
        src.connect(bp); bp.connect(chop); chop.connect(out);
        const whine = AC.createOscillator(), wf = AC.createBiquadFilter(), wg = AC.createGain();
        whine.type = 'sawtooth'; whine.frequency.value = 180; wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 3; wg.gain.value = .12;
        whine.connect(wf); wf.connect(wg); wg.connect(out);
        out.connect(master); src.start(); lfo.start(); whine.start();
        rotorV = { out, lfo, whine };
      }
      if (!rotorV) return;
      rotorV.out.gain.setTargetAtTime(Math.min(1, level) * .55, t, .15);
      rotorV.lfo.frequency.setTargetAtTime(2 + level * 9 * pitch, t, .2);
      rotorV.whine.frequency.setTargetAtTime(90 + level * 380 * pitch, t, .25);
    };
    // water: a splash when jumping in, a soft swish for each swimming stroke
    A.splash = function (big) {
      if (!ok()) return; const t = AC.currentTime, d = out(null);
      noise(d, t, big ? .9 : .5, 'lowpass', big ? 2600 : 1800, .7, big ? .55 : .3, 300);
      noise(d, t + .03, big ? .6 : .35, 'bandpass', 900, 1.2, big ? .35 : .2, 200);
      tone(d, t, .18, 'sine', big ? 120 : 160, big ? .35 : .15, 50);
    };
    A.stroke = function () { if (!ok()) return; const t = AC.currentTime, d = out(null); noise(d, t, .32, 'bandpass', 700 + Math.random() * 400, 1.1, .09, 250); };
    // slot machine reel tick and roulette ball
    A.tick = function () { if (!ok()) return; const d = out(null); noise(d, AC.currentTime, .015, 'bandpass', 3500, 3, .25); };

    // two siren voices that follow the nearest police cars: a wailing oscillator driven by a slow LFO
    const sirenV = [];
    A.sirens = function (list) {
      if (!ok()) return;
      while (sirenV.length < 2) {
        const o = AC.createOscillator(), lfo = AC.createOscillator(), lg = AC.createGain(), f = AC.createBiquadFilter(), g = AC.createGain(), p = AC.createPanner();
        o.type = 'square'; o.frequency.value = 950; lfo.frequency.value = .55 + sirenV.length * .07; lg.gain.value = 380;
        lfo.connect(lg); lg.connect(o.frequency); f.type = 'lowpass'; f.frequency.value = 2200; g.gain.value = 0;
        p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 8; p.rolloffFactor = 1.1;
        o.connect(f); f.connect(g); g.connect(p); p.connect(master); o.start(); lfo.start();
        sirenV.push({ g, p });
      }
      sirenV.forEach((v, i) => {
        const pos = list[i];
        v.g.gain.setTargetAtTime(pos ? .09 : 0, AC.currentTime, .1);
        if (pos) { if (v.p.positionX) { v.p.positionX.value = pos[0]; v.p.positionY.value = pos[1]; v.p.positionZ.value = pos[2]; } else v.p.setPosition(pos[0], pos[1], pos[2]); }
      });
    };
    return A;
  };
})(window.NB);
