// The animals of Turtle Island (tropic.js): crabs along the waterline, sea turtles that crawl up the beach
// and slip back into the sea when you come close, parrots in the palm crowns that burst out and circle the
// island, little monkeys playing in the grass, iguanas sunning themselves on the rocks, and a shark whose
// fin circles offshore — it goes for anyone swimming near it. One InstancedMesh of boxes, like animals.js;
// all of it sleeps while the hero is far away.
(function (NB) {
  'use strict';
  const { U } = NB;
  const rand = U.rand, pick = a => a[(Math.random() * a.length) | 0], chance = p => Math.random() < p;

  NB.createWildlife = function (scene, world, o) {
    // o: player, vehicles, audio, flash(text, sec), onBite(dmg)
    const T = world.tropic; if (!T) return { update() {} };
    const CAP = 300;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.castShadow = true;
    const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), TC = new THREE.Color();
    for (let i = 0; i < CAP; i++) { mesh.setMatrixAt(i, ZERO); mesh.setColorAt(i, TC.set(1, 1, 1)); }
    scene.add(mesh);
    let used = 0;
    const alloc = n => { const b = used; used += n; return b; };
    const colorize = (base, cols) => { cols.forEach((c, i) => mesh.setColorAt(base + i, TC.set(c))); mesh.instanceColor.needsUpdate = true; };
    const hide = (base, n) => { for (let k = 0; k < n; k++) mesh.setMatrixAt(base + k, ZERO); };
    const M = new THREE.Matrix4(), A = new THREE.Matrix4(), B = new THREE.Matrix4(), E = new THREE.Euler(), SV = new THREE.Vector3();
    function root(x, y, z, yaw, pitch, roll, s) { E.set(pitch, yaw, roll, 'YXZ'); M.makeRotationFromEuler(E); M.setPosition(x, y, z); if (s !== 1) M.scale(SV.set(s, s, s)); }
    function part(i, px, py, pz, rx, ry, rz, cx, cy, cz, sx, sy, sz) {
      E.set(rx, ry, rz, 'YXZ'); A.makeRotationFromEuler(E); A.setPosition(px, py, pz);
      B.makeScale(sx, sy, sz); B.setPosition(cx, cy, cz); A.multiply(B); B.multiplyMatrices(M, A); mesh.setMatrixAt(i, B);
    }
    const ground = (x, z) => Math.max(T.heightAt(x, z), 0);
    const polar = (x, z) => [Math.hypot(x - T.center.x, z - T.center.z), Math.atan2(z - T.center.z, x - T.center.x)];
    const nOf = (x, z) => { const [d, a] = polar(x, z); return d / T.radius(a); };
    const heroOnFoot = P => !o.vehicles.driving && !P.dead;

    /* ---------- crabs: along the wet sand, sideways; they dig in or scuttle off when you come near ---------- */
    const crabs = [];
    for (let k = 0; k < 12; k++) {
      const base = alloc(6), c = pick([['#e0452c', '#c8321c'], ['#6a4ac8', '#4a2e98'], ['#ff8a3d', '#d8601c']]);
      colorize(base, [c[0], c[1], c[1], '#1a1a1a', c[0], c[0]]);
      const a = rand(0, 6.3); crabs.push({ base, a, n: rand(.9, .99), h: rand(0, 6.3), state: 'idle', t: rand(0, 3), ga: a, gn: .95, sink: 0, hideT: 0, leg: 0 });
    }
    function crabStep(c, dt, P) {
      c.t -= dt;
      const [x, z] = T.pointAt(c.a, c.n), dh = Math.hypot(P.x - x, P.z - z), scared = heroOnFoot(P) ? dh < 3.2 : dh < 7;
      if (c.state === 'hide') { c.sink = Math.min(1, c.sink + dt * 2.5); if ((c.hideT -= dt) <= 0 && dh > 6) c.state = 'idle'; return; }
      c.sink = Math.max(0, c.sink - dt * 1.5);
      if (scared && c.state !== 'run') { if (chance(.4)) { c.state = 'hide'; c.hideT = rand(6, 11); return; } c.ga = c.a + (Math.atan2(z - P.z, x - P.x) > 0 ? .1 : -.1); c.gn = rand(.9, .99); c.state = 'run'; }
      if (c.state === 'idle' && c.t <= 0) { c.t = rand(2, 6); if (chance(.6)) { c.ga = c.a + rand(-.05, .05); c.gn = rand(.9, .99); c.state = 'walk'; } }
      if (c.state === 'walk' || c.state === 'run') {
        const [gx, gz] = T.pointAt(c.ga, c.gn), dx = gx - x, dz = gz - z, d = Math.hypot(dx, dz);
        if (d < .05) { c.state = 'idle'; c.t = rand(1, 4); return; }
        const sp = c.state === 'run' ? 2.6 : .7, k = Math.min(1, sp * dt / d);
        c.a += (c.ga - c.a) * k; c.n += (c.gn - c.n) * k; c.leg += dt * (c.state === 'run' ? 30 : 16);
        c.h += U.angDiff(c.h, Math.atan2(dx, dz) + Math.PI / 2) * Math.min(1, dt * 6);
      }
    }
    function crabWrite(c) {
      const [x, z] = T.pointAt(c.a, c.n), i = c.base, y = ground(x, z) + .02 - c.sink * .14, lg = Math.sin(c.leg) * .35, claw = Math.sin(c.leg * .3 + c.base) * .15;
      root(x, y, z, c.h, 0, 0, 1);
      part(i, 0, 0, 0, 0, 0, 0, 0, .07, 0, .24, .08, .17);
      part(i + 1, -.12, .07, .08, 0, claw, 0, -.03, 0, .06, .08, .06, .1); part(i + 2, .12, .07, .08, 0, -claw, 0, .03, 0, .06, .08, .06, .1);
      part(i + 3, 0, .11, .07, 0, 0, 0, 0, .015, 0, .11, .035, .02);
      part(i + 4, -.12, .05, 0, 0, 0, lg, -.07, 0, 0, .15, .02, .15); part(i + 5, .12, .05, 0, 0, 0, -lg, .07, 0, 0, .15, .02, .15);
    }

    /* ---------- sea turtles: up the beach, rest in the sun, back into the sea when disturbed ---------- */
    const turtles = [];
    for (let k = 0; k < 4; k++) {
      const base = alloc(8); colorize(base, ['#5a6a3a', '#7a8a4a', '#8a9a6a', '#8a9a6a', '#8a9a6a', '#8a9a6a', '#8a9a6a', '#e8dcb0']);
      const a = rand(0, 6.3), [x, z] = T.pointAt(a, .85);
      turtles.push({ base, x, z, y: 0, h: a + Math.PI, state: 'rest', t: rand(3, 12), gx: x, gz: z, fl: 0, s: rand(.9, 1.2) });
    }
    function turtleStep(t, dt, P) {
      t.t -= dt; t.fl += dt;
      const dh = Math.hypot(P.x - t.x, P.z - t.z), n = nOf(t.x, t.z);
      if (t.state !== 'swim' && t.state !== 'toSea' && dh < 5) { const [, a] = polar(t.x, t.z); [t.gx, t.gz] = T.pointAt(a, 1.3); t.state = 'toSea'; }
      if (t.state === 'rest' && t.t <= 0) { const [, a] = polar(t.x, t.z); [t.gx, t.gz] = T.pointAt(a + rand(-.15, .15), rand(.72, .9)); t.state = 'crawl'; t.t = 20; }
      if (t.state === 'crawl' || t.state === 'toSea' || t.state === 'ashore') {
        const dx = t.gx - t.x, dz = t.gz - t.z, d = Math.hypot(dx, dz), inSea = n > 1.02;
        const sp = inSea ? 1.6 : t.state === 'toSea' ? .55 : .3;
        if (d < .2 || t.t < 0) {
          if (t.state === 'toSea') { t.state = 'swim'; t.t = rand(18, 40); t.ang = polar(t.x, t.z)[1]; }
          else { t.state = 'rest'; t.t = rand(8, 25); }
        } else {
          t.h += U.angDiff(t.h, Math.atan2(dx, dz)) * Math.min(1, dt * 2);
          t.x += Math.sin(t.h) * sp * dt; t.z += Math.cos(t.h) * sp * dt;
        }
      }
      if (t.state === 'swim') {
        t.ang += dt * .03; const [gx, gz] = T.pointAt(t.ang, 1.35), dx = gx - t.x, dz = gz - t.z;
        t.h += U.angDiff(t.h, Math.atan2(dx, dz)) * Math.min(1, dt * 1.5); t.x += Math.sin(t.h) * 1.2 * dt; t.z += Math.cos(t.h) * 1.2 * dt;
        if (t.t <= 0 && dh > 25) { [t.gx, t.gz] = T.pointAt(t.ang, rand(.75, .88)); t.state = 'ashore'; t.t = 60; }
      }
      const land = nOf(t.x, t.z) < 1.0;
      t.y = land ? ground(t.x, t.z) + .05 : -.12;
    }
    function turtleWrite(t) {
      const i = t.base, moving = t.state !== 'rest', sw = moving ? Math.sin(t.fl * (t.state === 'swim' || t.state === 'toSea' ? 6 : 3)) * .5 : 0;
      root(t.x, t.y, t.z, t.h, 0, 0, t.s);
      part(i, 0, 0, 0, 0, 0, 0, 0, .18, 0, .8, .22, 1);
      part(i + 1, 0, 0, 0, 0, 0, 0, 0, .31, -.02, .6, .08, .76);
      part(i + 2, 0, .14, .5, moving ? .1 : -.1, 0, 0, 0, 0, .12, .2, .16, .26);
      part(i + 3, -.4, .12, .3, 0, sw, 0, -.2, 0, 0, .45, .05, .2); part(i + 4, .4, .12, .3, 0, -sw, 0, .2, 0, 0, .45, .05, .2);
      part(i + 5, -.3, .12, -.35, 0, -sw * .6, 0, -.12, 0, -.05, .24, .05, .18); part(i + 6, .3, .12, -.35, 0, sw * .6, 0, .12, 0, -.05, .24, .05, .18);
      part(i + 7, 0, .09, 0, 0, 0, 0, 0, 0, 0, .7, .04, .9);
    }

    /* ---------- parrots: sitting in the palm crowns; they burst out squawking and circle the island ---------- */
    const parrots = [], perches = T.palmSpots.slice(0, 24);
    const PAL = [['#e8202a', '#ffd23d', '#2a6fe8'], ['#2a6fe8', '#ffd23d', '#2a6fe8'], ['#3cc850', '#e8202a', '#2a8fe8'], ['#ffd23d', '#2a6fe8', '#3cc850'], ['#e8202a', '#3cc850', '#2a6fe8']];
    for (let k = 0; k < 8 && perches.length; k++) {
      const base = alloc(7), p = PAL[k % PAL.length]; colorize(base, [p[0], p[0], '#2a2a2a', p[2], p[2], p[1], '#f5f5f0']);
      const pr = perches[(k * 3) % perches.length];
      parrots.push({ base, perch: pr, x: pr[0], y: pr[1] + 6.2, z: pr[2], h: rand(0, 6.3), state: 'perch', t: rand(5, 20), ang: rand(0, 6.3), r: rand(22, 34), alt: rand(9, 15), dir: chance(.5) ? 1 : -1, flap: 0, ph: rand(0, 6), pitch: 0, roll: 0 });
    }
    function parrotStep(b, dt, P) {
      b.t -= dt; b.ph += dt * 14;
      const dh = Math.hypot(P.x - b.x, P.z - b.z);
      if (b.state === 'perch') {
        b.flap = -1; b.pitch = 0; b.roll = 0; b.h += Math.sin(b.t * .7 + b.base) * dt * .6;
        if ((heroOnFoot(P) && dh < 9 && P.y < b.y) || b.t <= 0) { b.state = 'fly'; b.t = rand(10, 22); b.ang = Math.atan2(b.z - T.center.z, b.x - T.center.x); if (dh < 40) o.audio.flutter([b.x, b.y, b.z]); }
        return;
      }
      if (b.state === 'fly') {
        b.ang += b.dir * 8 / b.r * dt;
        const tx = T.center.x + Math.cos(b.ang + b.dir * .4) * b.r, tz = T.center.z + Math.sin(b.ang + b.dir * .4) * b.r;
        fly(b, tx, b.alt + Math.sin(b.t) * 1.5, tz, 8, dt);
        b.flap = Math.sin(b.ph);
        if (b.t <= 0) { b.state = 'land'; b.perch = pick(perches); }
        return;
      }
      const [px, py, pz] = b.perch, gy = py + 6.2, d = Math.hypot(px - b.x, pz - b.z);
      fly(b, px, d > 4 ? gy + 2 : gy, pz, Math.max(1.5, Math.min(8, d)), dt);
      b.flap = Math.sin(b.ph * 1.3);
      if (d < .4 && Math.abs(b.y - gy) < .5) { b.state = 'perch'; b.x = px; b.z = pz; b.y = gy; b.t = rand(15, 40); }
    }
    function fly(b, tx, ty, tz, sp, dt) {
      const dx = tx - b.x, dz = tz - b.z, turn = U.clamp(U.angDiff(b.h, Math.atan2(dx, dz)) * 2.5, -3, 3);
      b.h += turn * dt; b.roll = U.damp(b.roll, -turn * .35, 4, dt);
      const vy = U.clamp((ty - b.y) * 1.4, -4, 4); b.y += vy * dt; b.pitch = U.damp(b.pitch, -vy * .1, 4, dt);
      b.x += Math.sin(b.h) * sp * dt; b.z += Math.cos(b.h) * sp * dt;
    }
    function parrotWrite(b) {
      const i = b.base, sit = b.state === 'perch';
      root(b.x, b.y, b.z, b.h, b.pitch, b.roll, 1);
      part(i, 0, 0, 0, sit ? -.6 : 0, 0, 0, 0, 0, 0, .16, .16, .34);
      part(i + 1, 0, sit ? .14 : .05, sit ? .08 : .17, 0, 0, 0, 0, .04, .04, .14, .14, .14);
      part(i + 2, 0, sit ? .14 : .05, sit ? .08 : .17, 0, 0, 0, 0, 0, .14, .06, .08, .07);
      if (sit) { part(i + 3, -.09, 0, 0, -.6, 0, 0, 0, 0, -.04, .04, .14, .3); part(i + 4, .09, 0, 0, -.6, 0, 0, 0, 0, -.04, .04, .14, .3); }
      else { part(i + 3, -.08, .03, 0, 0, 0, -b.flap, -.28, 0, 0, .5, .02, .2); part(i + 4, .08, .03, 0, 0, 0, b.flap, .28, 0, 0, .5, .02, .2); }
      part(i + 5, 0, 0, -.16, sit ? -1.1 : .1, 0, 0, 0, 0, -.22, .08, .03, .42);
      part(i + 6, 0, sit ? .16 : .07, sit ? .1 : .2, 0, 0, 0, .05, .06, .06, .02, .04, .02);
    }

    /* ---------- monkeys: in the grass under the palms; they scamper off from you ---------- */
    const monkeys = [];
    for (let k = 0; k < 4; k++) {
      const base = alloc(9); colorize(base, ['#6a4a2a', '#6a4a2a', '#d8b08a', '#5a3a1a', '#5a3a1a', '#5a3a1a', '#5a3a1a', '#6a4a2a', '#ffd23d']);
      const [x, z] = T.pointAt(rand(0, 6.3), rand(.2, .6));
      monkeys.push({ base, x, z, y: 0, h: rand(0, 6.3), state: 'sit', t: rand(2, 6), gx: x, gz: z, ph: rand(0, 6), sp: 0 });
    }
    function monkeyStep(m, dt, P) {
      m.t -= dt; const dh = Math.hypot(P.x - m.x, P.z - m.z);
      if (heroOnFoot(P) && dh < 6 && m.state !== 'flee') { const a = Math.atan2(m.x - P.x, m.z - P.z); m.gx = m.x + Math.sin(a) * 9; m.gz = m.z + Math.cos(a) * 9; m.state = 'flee'; m.t = 4; }
      if (m.t <= 0) { if (m.state === 'sit') { m.state = 'walk'; m.t = rand(3, 7); [m.gx, m.gz] = T.pointAt(rand(0, 6.3), rand(.15, .65)); } else { m.state = 'sit'; m.t = rand(3, 8); } }
      if (nOf(m.gx, m.gz) > .75) [m.gx, m.gz] = T.pointAt(polar(m.gx, m.gz)[1], .6);
      const dx = m.gx - m.x, dz = m.gz - m.z, d = Math.hypot(dx, dz);
      const want = m.state === 'sit' || d < .3 ? 0 : m.state === 'flee' ? 5 : 1.4;
      m.sp = U.damp(m.sp, want, 6, dt);
      if (m.sp > .05 && d > .05) { m.h += U.angDiff(m.h, Math.atan2(dx, dz)) * Math.min(1, dt * 8); m.x += Math.sin(m.h) * m.sp * dt; m.z += Math.cos(m.h) * m.sp * dt; }
      m.ph += dt * (2 + m.sp * 4); m.y = ground(m.x, m.z);
    }
    function monkeyWrite(m) {
      const i = m.base, sit = m.sp < .2, s = Math.sin(m.ph) * Math.min(.8, m.sp * .3), eat = sit ? Math.max(0, Math.sin(m.ph * 1.2)) : 0;
      root(m.x, m.y, m.z, m.h, 0, 0, 1);
      if (sit) {
        part(i, 0, .28, 0, -.2, 0, 0, 0, 0, 0, .3, .34, .24); part(i + 1, 0, .52, .05, 0, 0, 0, 0, .1, 0, .24, .22, .22); part(i + 2, 0, .52, .05, 0, 0, 0, 0, .08, .11, .16, .12, .04);
        part(i + 3, -.16, .42, .05, -1.2 - eat * .6, 0, .2, 0, -.14, 0, .07, .3, .07); part(i + 4, .16, .42, .05, -1.2 - eat * .6, 0, -.2, 0, -.14, 0, .07, .3, .07);
        part(i + 5, -.12, .12, .1, -1.5, 0, 0, 0, -.12, 0, .08, .26, .08); part(i + 6, .12, .12, .1, -1.5, 0, 0, 0, -.12, 0, .08, .26, .08);
        part(i + 7, 0, .12, -.14, .6, 0, 0, 0, .25, 0, .04, .5, .04);
        part(i + 8, .02, .44 + eat * .1, .26, 0, 0, .5, 0, 0, 0, .05, .2, .05);   // a banana
      } else {
        part(i, 0, .38, 0, 0, 0, 0, 0, 0, 0, .28, .26, .5); part(i + 1, 0, .48, .3, 0, 0, 0, 0, .04, .06, .24, .22, .22); part(i + 2, 0, .48, .3, 0, 0, 0, 0, .02, .17, .16, .12, .04);
        part(i + 3, -.12, .32, .2, s, 0, 0, 0, -.16, 0, .07, .34, .07); part(i + 4, .12, .32, .2, -s, 0, 0, 0, -.16, 0, .07, .34, .07);
        part(i + 5, -.12, .32, -.2, -s, 0, 0, 0, -.16, 0, .08, .34, .08); part(i + 6, .12, .32, -.2, s, 0, 0, 0, -.16, 0, .08, .34, .08);
        part(i + 7, 0, .42, -.25, -.9, 0, 0, 0, .25, 0, .04, .5, .04); mesh.setMatrixAt(i + 8, ZERO);
      }
    }

    /* ---------- iguanas: on the sunny rocks; they dash off and come back later ---------- */
    const iguanas = [];
    for (let k = 0; k < Math.min(5, T.sunRocks.length); k++) {
      const base = alloc(6); colorize(base, ['#5a9a3a', '#4a8a2a', '#6aaa4a', '#3a6a2a', '#3a6a2a', '#e8c040']);
      const [x, y, z] = T.sunRocks[k];
      iguanas.push({ base, home: [x, y, z], x, y, z, h: rand(0, 6.3), state: 'bask', t: 0, gx: x, gz: z, ph: 0 });
    }
    function iguanaStep(g, dt, P) {
      g.t -= dt; const dh = Math.hypot(P.x - g.x, P.z - g.z);
      if (g.state === 'bask' && heroOnFoot(P) && dh < 4) { const a = Math.atan2(g.x - P.x, g.z - P.z); g.gx = g.x + Math.sin(a) * 5; g.gz = g.z + Math.cos(a) * 5; g.state = 'run'; g.t = 12; }
      if (g.state === 'run' || g.state === 'back') {
        const tx = g.state === 'back' ? g.home[0] : g.gx, tz = g.state === 'back' ? g.home[2] : g.gz, dx = tx - g.x, dz = tz - g.z, d = Math.hypot(dx, dz);
        if (d > .1) { g.h = Math.atan2(dx, dz); const sp = g.state === 'run' ? 4 : 1; g.x += dx / d * Math.min(d, sp * dt); g.z += dz / d * Math.min(d, sp * dt); g.ph += dt * 20; }
        g.y = g.state === 'back' && d < .6 ? g.home[1] : ground(g.x, g.z);
        if (g.state === 'back' && d <= .1) { g.state = 'bask'; g.y = g.home[1]; }
        if (g.state === 'run' && d <= .1 && g.t <= 0 && dh > 8) g.state = 'back';
      }
    }
    function iguanaWrite(g) {
      const i = g.base, s = Math.sin(g.ph) * .6;
      root(g.x, g.y, g.z, g.h, 0, 0, 1);
      part(i, 0, .07, 0, 0, 0, 0, 0, 0, 0, .18, .1, .5);
      part(i + 1, 0, .1, .28, g.state === 'bask' ? -.3 : 0, 0, 0, 0, .02, .08, .12, .1, .16);
      part(i + 2, 0, .06, -.25, 0, Math.sin(g.ph * .5) * .3, 0, 0, 0, -.32, .06, .05, .64);
      part(i + 3, -.1, .05, .12, 0, s, 0, -.08, -.02, 0, .14, .04, .05); part(i + 4, .1, .05, -.12, 0, s, 0, .08, -.02, 0, .14, .04, .05);
      part(i + 5, 0, .14, 0, 0, 0, 0, 0, .02, 0, .03, .06, .4);
    }

    /* ---------- the shark: a fin circling offshore; it comes for a swimmer ---------- */
    const shark = { base: alloc(5), ang: rand(0, 6.3), x: 0, z: 0, h: 0, state: 'circle', t: 0, biteT: 0, tail: 0 };
    colorize(shark.base, ['#5a6470', '#4a5460', '#5a6470', '#4a5460', '#c8ccd0']);
    function sharkStep(s, dt, P) {
      s.t -= dt; s.biteT -= dt; s.tail += dt * 6;
      const swimmer = P.swim && !o.vehicles.driving && !P.dead, dh = Math.hypot(P.x - s.x, P.z - s.z);
      if (s.state === 'circle') {
        s.ang += dt * .06; const [tx, tz] = T.pointAt(s.ang, 1.55);
        steer(s, tx, tz, 3.5, dt);
        if (swimmer && dh < 18 && s.t <= 0) { s.state = 'hunt'; o.flash('Акула! Плывите к берегу!', 2.4); }
      } else if (s.state === 'hunt') {
        steer(s, P.x, P.z, 5.2, dt);
        if (!swimmer || dh > 30) { s.state = 'circle'; s.t = 4; }
        else if (dh < 1.9 && s.biteT <= 0) { s.biteT = 1.8; o.onBite(12); o.flash('Акула кусает!', 1.4); if (P.fx) P.fx.splash(P.x, .05, P.z, .6); s.state = 'away'; s.t = rand(3, 5); }
      } else {
        const a = Math.atan2(s.x - P.x, s.z - P.z); steer(s, s.x + Math.sin(a) * 10, s.z + Math.cos(a) * 10, 4, dt);
        if (s.t <= 0) s.state = swimmer && dh < 18 ? 'hunt' : 'circle';
      }
      // never onto the beach
      if (nOf(s.x, s.z) < 1.2) { const [, a] = polar(s.x, s.z); [s.x, s.z] = T.pointAt(a, 1.2); }
    }
    function steer(s, tx, tz, sp, dt) { s.h += U.clamp(U.angDiff(s.h, Math.atan2(tx - s.x, tz - s.z)), -1.5 * dt, 1.5 * dt); s.x += Math.sin(s.h) * sp * dt; s.z += Math.cos(s.h) * sp * dt; }
    { const [x, z] = T.pointAt(shark.ang, 1.55); shark.x = x; shark.z = z; }
    function sharkWrite(s) {
      const i = s.base, t = Math.sin(s.tail) * .35;
      root(s.x, -.55, s.z, s.h, 0, 0, 1);
      part(i, 0, 0, 0, 0, 0, 0, 0, 0, 0, .7, .6, 2.6);
      part(i + 1, 0, .3, -.1, -.35, 0, 0, 0, .35, 0, .08, .75, .6);       // the dorsal fin, out of the water
      part(i + 2, 0, 0, -1.3, 0, t, 0, 0, 0, -.45, .12, .8, .9);
      part(i + 3, 0, -.05, .6, 0, 0, 0, 0, 0, 0, 1.6, .06, .4);
      part(i + 4, 0, -.2, .2, 0, 0, 0, 0, 0, 0, .6, .12, 2.2);
    }

    /* ---------- runtime ---------- */
    let awake = true;
    return {
      update(dt, P) {
        const near = Math.hypot(P.x - T.center.x, P.z - T.center.z) < 190;
        if (!near) { if (awake) { for (let k = 0; k < used; k++) mesh.setMatrixAt(k, ZERO); mesh.instanceMatrix.needsUpdate = true; awake = false; } return; }
        awake = true;
        for (const c of crabs) { crabStep(c, dt, P); if (c.sink >= 1) hide(c.base, 6); else crabWrite(c); }
        for (const t of turtles) { turtleStep(t, dt, P); turtleWrite(t); }
        for (const b of parrots) { parrotStep(b, dt, P); parrotWrite(b); }
        for (const m of monkeys) { monkeyStep(m, dt, P); monkeyWrite(m); }
        for (const g of iguanas) { iguanaStep(g, dt, P); iguanaWrite(g); }
        sharkStep(shark, dt, P); sharkWrite(shark);
        mesh.instanceMatrix.needsUpdate = true;
      },
      crabs, turtles, parrots, monkeys, iguanas, shark
    };
  };
})(window.NB);
