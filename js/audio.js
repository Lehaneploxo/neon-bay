// All sound is synthesised: engine hum that follows the revs, tyre squeal, horns, impacts, doors.
(function (NB) {
  'use strict';
  NB.createAudio = function () {
    let AC = null, master = null, noiseBuf = null, eng = null, skid = null;
    const A = {};
    A.init = function () {
      if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
      try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      const comp = AC.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
      master = AC.createGain(); master.gain.value = .7; master.connect(comp); comp.connect(AC.destination);
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
    const VOICE = { zefiro: 1.25, corsaro: .8, hayride: .7, beachcomber: .75, outbacker: .75, royale: .85, piccolo: 1.35 };
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
