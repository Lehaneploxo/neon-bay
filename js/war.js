// The war: a giant gift on the owner's stream starts a battle round the hero for five minutes. Two armies come in
// from either side of the camera's view — the Green army and the Sand army — soldiers fighting street by street,
// tanks rolling up and duelling with their guns, artillery shells whistling in between the lines. Passers-by run
// for their lives, and a stray bullet or a shell kills them. The hero is nobody's enemy, but stray fire hits him
// too, and a side he shoots at turns its guns on him. When the time is up both armies fall back and leave.
(function (NB) {
  'use strict';
  const { U } = NB;
  const SIDES = { A: { name: 'Зелёная армия', flag: 0x2f8a3a }, B: { name: 'Песочная армия', flag: 0xc0392b } };
  const TROOPS = 11, TANKS = 2, BASE_D = 75;

  NB.createWar = function (world, o) {
    // o: scene, vehicles, crowd, audio, player, flash(text, sec), shake(v), heroDamage(v), indoors(), view()
    const col = world.col, scene = o.scene;
    const solidAt = (x, z, y) => col.query(x - .4, z - .4, x + .4, z + .4, []).some(b => !b.npcOnly && b.maxY > y + .4 && b.minY < y + 1.6 && x + .4 > b.minX && x - .4 < b.maxX && z + .4 > b.minZ && z - .4 < b.maxZ);
    function groundAt(x, z) {
      let f = 0;
      for (const b of col.query(x - .3, z - .3, x + .3, z + .3, [])) if (b.maxY <= 1.6 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > f) f = b.maxY;
      return f;
    }
    const walkable = (x, z) => !NB.water.at(x, z) && !solidAt(x, z, groundAt(x, z));

    // the timer at the top of the screen
    const hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;top:164px;left:50%;transform:translateX(-50%);z-index:45;padding:8px 16px;border-radius:12px;font:800 16px Rubik,sans-serif;color:#fff;background:rgba(40,10,10,.78);box-shadow:0 0 0 2px rgba(255,80,60,.6),0 4px 18px rgba(0,0,0,.45);pointer-events:none;display:none;white-space:nowrap';
    document.body.appendChild(hud);

    const shellGeo = new THREE.SphereGeometry(.2, 8, 6), shellMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
    const poleGeo = new THREE.CylinderGeometry(.04, .04, 2.2, 6), flagGeo = new THREE.PlaneGeometry(1.1, .7), poleMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const flagMat = { A: new THREE.MeshBasicMaterial({ color: SIDES.A.flag, side: THREE.DoubleSide }), B: new THREE.MeshBasicMaterial({ color: SIDES.B.flag, side: THREE.DoubleSide }) };

    let W = null;   // the war going on: { t, dur, cx, cz, bases, troops: [], tanks: [], shells: [], incoming: [], retreat }

    /* ---------- sound ---------- */
    function siren() {
      const AC = o.audio.ctx && o.audio.ctx(); if (!AC) return;
      const t = AC.currentTime, g = AC.createGain(), osc = AC.createOscillator();
      osc.type = 'sawtooth';
      for (let k = 0; k < 2; k++) { const t0 = t + k * 3; osc.frequency.setValueAtTime(220, t0); osc.frequency.linearRampToValueAtTime(520, t0 + 1.5); osc.frequency.linearRampToValueAtTime(220, t0 + 3); }
      const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      osc.connect(lp); lp.connect(g); g.connect(o.audio.bus());
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.07, t + .3); g.gain.setValueAtTime(.07, t + 5.6); g.gain.linearRampToValueAtTime(0, t + 6);
      osc.start(t); osc.stop(t + 6.1);
    }
    function whistle(x, z) {
      const AC = o.audio.ctx && o.audio.ctx(); if (!AC) return;
      const d = Math.hypot(o.player.x - x, o.player.z - z); if (d > 120) return;
      const t = AC.currentTime, g = AC.createGain(), osc = AC.createOscillator(), v = .06 * (1 - d / 120);
      osc.type = 'sine'; osc.frequency.setValueAtTime(1800, t); osc.frequency.exponentialRampToValueAtTime(400, t + 1.1);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .2); g.gain.linearRampToValueAtTime(0, t + 1.15);
      osc.connect(g); g.connect(o.audio.bus()); osc.start(t); osc.stop(t + 1.2);
    }

    /* ---------- the armies ---------- */
    // a free spot near a point (not inside a building, not in the water)
    function spotNear(x, z, r) {
      for (let i = 0; i < 14; i++) { const a = Math.random() * Math.PI * 2, d = Math.random() * r, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d; if (walkable(px, pz)) return [px, pz]; }
      return null;
    }
    function addTrooper(side) {
      const B = W.bases[side], E = W.bases[side === 'A' ? 'B' : 'A'];
      const s = spotNear(B[0], B[1], 22); if (!s) return;
      const g = spotNear(E[0], E[1], 18) || E;
      const p = o.crowd.spawnTrooper(s[0], s[1], side, g[0], g[1], B[0] * 1.6 - W.cx * .6, B[1] * 1.6 - W.cz * .6);
      if (p) W.troops.push(p);
    }
    function addTank(side) {
      const B = W.bases[side];
      const c = o.vehicles.spawnService('tank', B[0], B[1], 0, 0, 1, 55);
      if (!c) return;
      c.war = side; c.driver = 'war';
      if (side === 'B') o.vehicles.recolor(c, '#a8935e', '#8f7c4c');
      const pole = new THREE.Mesh(poleGeo, poleMat), flag = new THREE.Mesh(flagGeo, flagMat[side]);
      pole.position.set(-.9, 3.6, -2.2); flag.position.set(-.9 + 0, 4.35, -2.75); flag.rotation.y = Math.PI / 2;
      c.root.add(pole, flag); c.warFlag = [pole, flag];
      const F = W.fronts[side];
      o.vehicles.driveTo(c, F[0], F[1], 7);
      W.tanks.push({ c, side, reload: 2 + Math.random() * 2, scanT: 0, target: null });
    }
    // a tank's gun: the shell flies straight down the barrel to the first thing in its way
    function fire(T) {
      const car = T.c, fx = Math.sin(car.h), fz = Math.cos(car.h), ox = car.x + fx * 5.7, oy = car.y + 2.1, oz = car.z + fz * 5.7;
      let t = col.raycast(ox, oy, oz, fx, -.02, fz, 120); if (oy - .02 * t < 0) t = Math.min(t, oy / .02);
      const hitCar = o.vehicles.cars.find(c => c !== car && !c.wreck && (() => { const dx = c.x - ox, dz = c.z - oz, a = dx * fx + dz * fz; return a > 0 && a < t && Math.abs(dx * fz - dz * fx) < c.model.w / 2 + .6 && Math.abs(c.y - car.y) < 4; })());
      if (hitCar) t = Math.min(t, (hitCar.x - ox) * fx + (hitCar.z - oz) * fz);
      for (const p of o.crowd.people) { if (p.dead) continue; const dx = p.x - ox, dz = p.z - oz, a = dx * fx + dz * fz; if (a > 0 && a < t && Math.abs(dx * fz - dz * fx) < .5) t = a; }
      const m = new THREE.Mesh(shellGeo, shellMat); m.position.set(ox, oy, oz); scene.add(m);
      W.shells.push({ m, x: ox, y: oy, z: oz, fx, fz, left: t, hitCar });
      o.audio.explosion([ox, oy, oz]);
      const d = Math.hypot(o.player.x - ox, o.player.z - oz); if (d < 60) o.shake(.25 * (1 - d / 60));
      car.vx -= fx * 1.5; car.vz -= fz * 1.5;
    }
    function tankStep(T, dt) {
      const c = T.c;
      T.reload -= dt; T.scanT -= dt;
      if (T.scanT <= 0) {
        T.scanT = .5;
        let best = null, bd = 90;
        // enemy tanks first, then the enemy's soldiers
        for (const U2 of W.tanks) { if (U2.side === T.side || U2.c.wreck) continue; const d = Math.hypot(U2.c.x - c.x, U2.c.z - c.z); if (d < bd && clear(c, U2.c.x, U2.c.z, d)) { bd = d; best = U2.c; } }
        if (!best) { bd = 60; for (const p of W.troops) { if (p.trooper.side === T.side || p.dead || p.down) continue; const d = Math.hypot(p.x - c.x, p.z - c.z); if (d < bd && d > 9 && clear(c, p.x, p.z, d)) { bd = d; best = p; } } }
        T.target = best;
      }
      const tg = T.target;
      if (tg && !tg.dead && !tg.wreck) {
        // stop, swing the hull round onto the target, fire
        if (c.goto) { c.goto = null; }
        c.vx *= Math.exp(-4 * dt); c.vz *= Math.exp(-4 * dt);
        const want = Math.atan2(tg.x - c.x, tg.z - c.z), diff = U.angDiff(c.h, want);
        c.h += U.clamp(diff, -.8 * dt, .8 * dt);
        if (Math.abs(diff) < .05 && T.reload <= 0) { T.reload = 3.5 + Math.random() * 2; fire(T); }
      } else if (!c.goto && !W.retreat) {
        // nothing in sight: roll on towards the enemy's side
        const E = W.bases[T.side === 'A' ? 'B' : 'A'], F = W.fronts[T.side];
        const near = Math.hypot(F[0] - c.x, F[1] - c.z) < 10;
        o.vehicles.driveTo(c, near ? E[0] : F[0], near ? E[1] : F[1], 6);
      }
    }
    const clear = (c, x, z, d) => { const dx = (x - c.x) / d, dz = (z - c.z) / d; return col.raycast(c.x + dx * 4, 1.6, c.z + dz * 4, dx, 0, dz, d - 4) >= d - 5; };

    function end() {
      W.retreat = true; W.retreatT = 0;
      for (const p of W.troops) if (p.trooper) p.trooper.retreat = true;
      for (const T of W.tanks) if (!T.c.wreck) { const B = W.bases[T.side]; o.vehicles.driveTo(T.c, B[0] * 2 - W.cx, B[1] * 2 - W.cz, 9); }
      o.flash('🏳 Время вышло — войска отступают!', 4);
    }
    function cleanup() {
      for (const p of W.troops) if (!p.dead && !p.down) o.crowd.despawnPerson(p); else if (p.trooper) { p.keep = false; }
      for (const T of W.tanks) o.vehicles.remove(T.c);
      for (const s of W.shells) scene.remove(s.m);
      o.crowd.warReset(); hud.style.display = 'none'; W = null;
    }

    return {
      get busy() { return !!W; },
      start(nick, dur) {
        if (W) return false;
        if (o.indoors()) { o.flash('Война идёт на улицах — выйдите из помещения', 2.5); return false; }
        const p = o.player, v = o.view(), px = -v[1], pz = v[0];   // the armies come from the left and the right of the view
        const cx = p.x + v[0] * 12, cz = p.z + v[1] * 12;
        W = { t: 0, dur: dur || 300, cx, cz, nick: nick || '', troops: [], tanks: [], shells: [], incoming: [], retreat: false, spawnT: 0, tankT: 6, artT: 8, panicT: 0, tanksUsed: { A: 0, B: 0 },
          bases: { A: [cx + px * BASE_D, cz + pz * BASE_D], B: [cx - px * BASE_D, cz - pz * BASE_D] },
          fronts: { A: [cx + px * 22, cz + pz * 22], B: [cx - px * 22, cz - pz * 22] } };
        for (let k = 0; k < 6; k++) { addTrooper('A'); addTrooper('B'); }
        o.crowd.panic(cx, cz, 120, false);
        o.flash('⚔ ' + (nick ? '@' + nick + ' начал ' : '') + 'ВОЙНУ! Зелёная армия против Песочной — прячься!', 5);
        siren();
        return true;
      },
      update(dt, player) {
        // shells in flight (they keep flying after the retreat)
        if (W) for (let k = W.shells.length - 1; k >= 0; k--) {
          const s = W.shells[k], step = Math.min(s.left, 140 * dt);
          s.x += s.fx * step; s.z += s.fz * step; s.y -= .02 * step; s.left -= step; s.m.position.set(s.x, s.y, s.z);
          if (s.left <= .01) {
            scene.remove(s.m); W.shells.splice(k, 1);
            if (s.hitCar) { s.hitCar.damage += s.hitCar.war ? 230 : 400; }
            o.vehicles.blast(s.x, Math.max(0, s.y - 1), s.z, false);
          }
        }
        if (!W) return;
        W.t += dt;
        W.troops = W.troops.filter(p => o.crowd.people.includes(p));
        for (const T of W.tanks) if (!T.c.wreck && o.vehicles.cars.includes(T.c)) tankStep(T, dt);
        W.tanks = W.tanks.filter(T => o.vehicles.cars.includes(T.c));
        if (!W.retreat) {
          const left = Math.max(0, W.dur - W.t), m = Math.floor(left / 60), s = Math.floor(left % 60);
          hud.style.display = 'block'; hud.textContent = '⚔ ВОЙНА · ' + m + ':' + String(s).padStart(2, '0');
          // reinforcements: the soldiers keep coming, the tanks too (a few per side)
          if ((W.spawnT -= dt) <= 0) {
            W.spawnT = .7;
            for (const side of ['A', 'B']) if (W.troops.filter(p => p.trooper.side === side && !p.dead && !p.down).length < TROOPS) addTrooper(side);
          }
          if ((W.tankT -= dt) <= 0) {
            W.tankT = 12;
            for (const side of ['A', 'B']) if (W.tanks.filter(T => T.side === side && !T.c.wreck).length < TANKS && W.tanksUsed[side] < 6) { W.tanksUsed[side]++; addTank(side); }
          }
          // artillery: shells whistle in and land between the lines (never right on the hero)
          if ((W.artT -= dt) <= 0) {
            W.artT = 3 + Math.random() * 4;
            for (let i = 0; i < 8; i++) {
              const a = Math.random() * Math.PI * 2, d = Math.random() * 40, x = W.cx + Math.sin(a) * d, z = W.cz + Math.cos(a) * d;
              if (Math.hypot(x - player.x, z - player.z) < 9 || !walkable(x, z)) continue;
              W.incoming.push({ x, z, t: 1.1 }); whistle(x, z); break;
            }
          }
          if ((W.panicT -= dt) <= 0) { W.panicT = 2; o.crowd.panic(W.cx, W.cz, 110, false); }
          if (W.t >= W.dur) end();
        } else {
          W.retreatT += dt;
          hud.style.display = 'block'; hud.textContent = '🏳 Войска отступают';
          for (const p of W.troops.slice()) if (!p.dead && !p.down && Math.hypot(p.x - player.x, p.z - player.z) > 70) o.crowd.despawnPerson(p);
          for (const T of W.tanks.slice()) if (Math.hypot(T.c.x - player.x, T.c.z - player.z) > 110) o.vehicles.remove(T.c);
          if (W.retreatT > 40 || (!W.troops.some(p => !p.dead && !p.down) && !W.tanks.some(T => !T.c.wreck))) { cleanup(); return; }
        }
        for (let i = W.incoming.length - 1; i >= 0; i--) {
          const s = W.incoming[i]; s.t -= dt;
          if (s.t <= 0) { W.incoming.splice(i, 1); o.vehicles.blast(s.x, groundAt(s.x, s.z), s.z, false); }
        }
      }
    };
  };
})(window.NB);
