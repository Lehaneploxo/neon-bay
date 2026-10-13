// The alien invasion: a giant gift on the owner's stream brings flying saucers over the city round the hero for
// five minutes. They come down out of the sky, hang over the streets with their lights turning, burn cars from
// above with a heavy green ray, and beam aliens down to the ground. The aliens shoot everyone and everything with
// their ray guns — passers-by, cars, the hero too if he is the nearest. The hero can shoot them down (120 hp,
// no police trouble for it). When the time is up the aliens are beamed back up and the saucers fly off.
(function (NB) {
  'use strict';
  const SAUCERS = 3, ALIENS = 14, HOVER_Y = [24, 34];

  NB.createAliens = function (world, o) {
    // o: scene, vehicles, crowd, audio, player, flash(text, sec), shake(v), heroDamage(v), indoors(), view()
    const col = world.col, scene = o.scene;
    const solidAt = (x, z, y) => col.query(x - .4, z - .4, x + .4, z + .4, []).some(b => !b.npcOnly && b.maxY > y + .4 && b.minY < y + 1.6 && x + .4 > b.minX && x - .4 < b.maxX && z + .4 > b.minZ && z - .4 < b.maxZ);
    function groundAt(x, z) {
      let f = 0;
      for (const b of col.query(x - .3, z - .3, x + .3, z + .3, [])) if (b.maxY <= 1.6 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > f) f = b.maxY;
      return f;
    }
    const walkable = (x, z) => !NB.water.at(x, z) && !solidAt(x, z, groundAt(x, z));
    function spotNear(x, z, r) {
      for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2, d = Math.random() * r, px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d; if (walkable(px, pz)) return [px, pz]; }
      return null;
    }

    // the timer at the top of the screen
    const hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;top:164px;left:50%;transform:translateX(-50%);z-index:45;padding:8px 16px;border-radius:12px;font:800 16px Rubik,sans-serif;color:#eafff2;background:rgba(6,30,18,.8);box-shadow:0 0 0 2px rgba(80,255,150,.6),0 4px 18px rgba(0,0,0,.45);pointer-events:none;display:none;white-space:nowrap';
    document.body.appendChild(hud);

    /* ---------- the saucer ---------- */
    const hullMat = new THREE.MeshPhongMaterial({ color: 0xaeb6c0, specular: 0xffffff, shininess: 90 });
    const darkMat = new THREE.MeshPhongMaterial({ color: 0x4a515c, specular: 0x888888, shininess: 40 });
    const domeMat = new THREE.MeshPhongMaterial({ color: 0x7ff5ff, emissive: 0x1a8a9a, transparent: true, opacity: .72, shininess: 120, specular: 0xffffff });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x5cff9d, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false });
    const LIGHT_COLS = [0xff3b3b, 0xffd23b, 0x3bff7a, 0x3bc8ff, 0xd23bff];
    // the hull turned on a lathe: a flat lens, thick at the rim, a skirt underneath
    const hullGeo = new THREE.LatheGeometry([[0, -1.1], [2.6, -1.0], [4.6, -.55], [6.4, -.1], [6.6, .05], [6.2, .3], [4.2, .75], [2.4, 1.0], [0, 1.05]].map(p => new THREE.Vector2(p[0], p[1])), 40);
    const skirtGeo = new THREE.CylinderGeometry(2.4, 3.2, .7, 24);
    const domeGeo = new THREE.SphereGeometry(2.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const lampGeo = new THREE.SphereGeometry(.34, 8, 6);
    const bellyGeo = new THREE.CircleGeometry(2.3, 24).rotateX(Math.PI / 2);
    // the tractor beam: an open cone, brightest at the top
    const beamTex = NB.U.canvasTex(8, 64, (g, s) => { const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(150,255,190,.85)'); gr.addColorStop(1, 'rgba(90,255,160,.12)'); g.fillStyle = gr; g.fillRect(0, 0, 8, 64); }, false);
    const beamGeo = new THREE.CylinderGeometry(1.4, 3.6, 1, 20, 1, true).translate(0, -.5, 0);
    function makeSaucer() {
      const g = new THREE.Group(), spin = new THREE.Group();
      const hull = new THREE.Mesh(hullGeo, hullMat), skirt = new THREE.Mesh(skirtGeo, darkMat), dome = new THREE.Mesh(domeGeo, domeMat), belly = new THREE.Mesh(bellyGeo, glowMat);
      skirt.position.y = -1.2; dome.position.y = .95; belly.position.y = -1.56;
      spin.add(hull);
      const lamps = [];
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2, m = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: LIGHT_COLS[i % LIGHT_COLS.length] }));
        m.position.set(Math.sin(a) * 6.5, 0, Math.cos(a) * 6.5); spin.add(m); lamps.push(m);
      }
      g.add(spin, skirt, dome, belly);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = -1.5; beam.visible = false; g.add(beam);
      g.traverse(m => { m.frustumCulled = false; });
      scene.add(g);
      return { g, spin, lamps, beam, belly };
    }

    /* ---------- rays ---------- */
    // a pool of ray beams (cylinders stretched between two points) and flashes where they land
    const rayGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, .5);
    const rays = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(rayGeo, new THREE.MeshBasicMaterial({ color: 0x6dff9e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.frustumCulled = false; scene.add(m); rays.push({ m, t: 0, max: 1 });
    }
    let rayHead = 0;
    const glowTex = NB.U.canvasTex(64, 64, (g, s) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(235,255,240,1)'); gr.addColorStop(.3, 'rgba(110,255,160,.85)'); gr.addColorStop(1, 'rgba(40,255,120,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, false);
    const sparks = [];
    for (let i = 0; i < 30; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.visible = false; scene.add(s); sparks.push({ s, t: 0, max: 1, size: 1 }); }
    let sparkHead = 0;
    const V = new THREE.Vector3();
    function ray(ax, ay, az, bx, by, bz, width, life) {
      const r = rays[rayHead]; rayHead = (rayHead + 1) % rays.length;
      r.m.position.set(ax, ay, az); V.set(bx, by, bz); r.m.lookAt(V);
      r.m.scale.set(width, width, Math.hypot(bx - ax, by - ay, bz - az));
      r.t = r.max = life; r.m.visible = true; r.m.material.opacity = 1;
      const s = sparks[sparkHead]; sparkHead = (sparkHead + 1) % sparks.length;
      s.s.position.set(bx, by, bz); s.t = s.max = life + .15; s.size = width * 14 + .8; s.s.visible = true;
    }

    /* ---------- sound ---------- */
    const AC = () => o.audio.ctx && o.audio.ctx();
    function pew(x, z, big) {
      const ac = AC(); if (!ac) return;
      const d = Math.hypot(o.player.x - x, o.player.z - z); if (d > 90) return;
      const t = ac.currentTime, g = ac.createGain(), osc = ac.createOscillator(), v = (big ? .1 : .045) * (1 - d / 90);
      osc.type = big ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(big ? 900 : 1700, t); osc.frequency.exponentialRampToValueAtTime(big ? 70 : 240, t + (big ? .6 : .16));
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0005, t + (big ? .7 : .2));
      osc.connect(g); g.connect(o.audio.bus()); osc.start(t); osc.stop(t + (big ? .75 : .22));
    }
    function beamSound(x, z) {
      const ac = AC(); if (!ac) return;
      const d = Math.hypot(o.player.x - x, o.player.z - z); if (d > 100) return;
      const t = ac.currentTime, g = ac.createGain(), osc = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain(), v = .06 * (1 - d / 100);
      osc.type = 'triangle'; osc.frequency.setValueAtTime(220, t); osc.frequency.linearRampToValueAtTime(660, t + 1.6);
      lfo.frequency.value = 14; lg.gain.value = 40; lfo.connect(lg); lg.connect(osc.frequency);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .2); g.gain.setValueAtTime(v, t + 1.4); g.gain.linearRampToValueAtTime(0, t + 1.8);
      osc.connect(g); g.connect(o.audio.bus()); osc.start(t); lfo.start(t); osc.stop(t + 1.9); lfo.stop(t + 1.9);
    }
    // the low throb of the saucers overhead, louder the nearer the nearest one is
    let hum = null;
    function humStart() {
      const ac = AC(); if (!ac || hum) return;
      const g = ac.createGain(), a = ac.createOscillator(), b = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain();
      a.type = 'sawtooth'; a.frequency.value = 58; b.type = 'sine'; b.frequency.value = 117;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
      lfo.frequency.value = 3.2; lg.gain.value = 6; lfo.connect(lg); lg.connect(a.frequency);
      a.connect(lp); b.connect(lp); lp.connect(g); g.connect(o.audio.bus()); g.gain.value = 0;
      a.start(); b.start(); lfo.start();
      hum = { g, stop() { const t = ac.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 1); a.stop(t + 1.1); b.stop(t + 1.1); lfo.stop(t + 1.1); } };
    }
    function siren() {
      const ac = AC(); if (!ac) return;
      const t = ac.currentTime;
      for (let k = 0; k < 6; k++) {   // a weird rising and falling warble, nothing like a city siren
        const g = ac.createGain(), osc = ac.createOscillator(), t0 = t + k * .55;
        osc.type = 'sine'; osc.frequency.setValueAtTime(k % 2 ? 1250 : 620, t0); osc.frequency.exponentialRampToValueAtTime(k % 2 ? 620 : 1250, t0 + .5);
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.06, t0 + .05); g.gain.linearRampToValueAtTime(0, t0 + .52);
        osc.connect(g); g.connect(o.audio.bus()); osc.start(t0); osc.stop(t0 + .55);
      }
    }

    let I = null;   // the invasion going on: { t, dur, saucers: [], aliens: [], retreat }

    /* ---------- the saucers ---------- */
    function hoverPoint(cx, cz) {
      const a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 34;
      return [cx + Math.sin(a) * d, HOVER_Y[0] + Math.random() * (HOVER_Y[1] - HOVER_Y[0]), cz + Math.cos(a) * d];
    }
    function addSaucer(k) {
      const p = o.player, a = Math.random() * Math.PI * 2, S = makeSaucer();
      S.x = p.x + Math.sin(a) * 170; S.z = p.z + Math.cos(a) * 170; S.y = 110;
      S.goal = hoverPoint(p.x, p.z); S.moveT = 8 + Math.random() * 6; S.dropT = 2 + k * 1.5 + Math.random() * 2; S.zapT = 5 + Math.random() * 4;
      S.beamT = 0; S.vx = S.vz = 0; S.phase = Math.random() * 10;
      S.g.position.set(S.x, S.y, S.z);
      I.saucers.push(S);
    }
    // a heavy ray from the belly of a saucer onto a car: it blows up on the spot
    function zapCar(S, player) {
      let best = null, bd = 50;
      for (const c of o.vehicles.cars) {
        if (c.wreck || c === o.vehicles.driving || c.model.boat || (c.model.heli && c.y > 3)) continue;
        const d = Math.hypot(c.x - S.x, c.z - S.z); if (d < bd && Math.hypot(c.x - player.x, c.z - player.z) > 9) { bd = d; best = c; }
      }
      if (!best) return false;
      const by = best.y + 1;
      if (col.raycast(S.x, S.y - 1.6, S.z, (best.x - S.x), (by - S.y + 1.6), (best.z - S.z), 1) < 1 - 2 / Math.hypot(best.x - S.x, by - S.y, best.z - S.z)) return false;   // a roof in the way
      ray(S.x, S.y - 1.6, S.z, best.x, by, best.z, .45, .5);
      best.damage = Math.max(best.damage, 199) + 250; best.blame = false;
      o.vehicles.blast(best.x, best.y, best.z, false);
      pew(S.x, S.z, true);
      return true;
    }
    function beamDown(S) {
      if (I.aliens.filter(p => !p.dead && !p.down).length >= ALIENS) return;
      const at = spotNear(S.x, S.z, 6); if (!at) return;
      // the beam has to reach the ground: no roof between the saucer and the spot
      const gy = groundAt(at[0], at[1]);
      if (col.raycast(at[0], S.y - 2, at[1], 0, -1, 0, S.y - 2 - gy) < S.y - 2.5 - gy) return;
      S.beamT = 2.2; S.beamAt = at;
      const n = Math.random() < .5 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const q = o.crowd.spawnAlien(at[0] + (i ? 1.2 : 0), at[1] + (i ? .8 : 0), S.y - 3);
        if (q) I.aliens.push(q);
      }
      beamSound(at[0], at[1]);
    }
    function saucerStep(S, dt, player) {
      // drift towards the hover point; a new one every so often, round wherever the hero is now
      if (!I.retreat && (S.moveT -= dt) <= 0 && S.beamT <= 0) { S.moveT = 8 + Math.random() * 8; S.goal = hoverPoint(player.x, player.z); }
      const dx = S.goal[0] - S.x, dy = S.goal[1] - S.y, dz = S.goal[2] - S.z, d = Math.hypot(dx, dy, dz);
      const sp = I.retreat ? 40 : S.beamT > 0 ? 0 : Math.min(d > 40 ? 45 : 18, d * .8);   // swoops in fast, then drifts
      const tvx = d > .1 ? dx / d * sp : 0, tvz = d > .1 ? dz / d * sp : 0, tvy = d > .1 ? dy / d * sp : 0;
      S.vx += (tvx - S.vx) * Math.min(1, dt * 1.5); S.vz += (tvz - S.vz) * Math.min(1, dt * 1.5);
      S.x += S.vx * dt; S.z += S.vz * dt; S.y += tvy * dt;
      S.phase += dt;
      S.g.position.set(S.x, S.y + Math.sin(S.phase * 1.7) * .35, S.z);
      S.g.rotation.z = -S.vx * .012; S.g.rotation.x = S.vz * .012;   // leans into where it's going
      S.spin.rotation.y += dt * 1.6;
      const blink = (S.phase * 6) | 0;
      S.lamps.forEach((m, i) => { m.visible = (i + blink) % 3 !== 0; });
      S.belly.material.opacity = .6 + Math.sin(S.phase * 5) * .25;
      // the tractor beam
      if (S.beamT > 0) {
        S.beamT -= dt;
        const h = S.y - 1.5 - groundAt(S.beamAt[0], S.beamAt[1]);
        S.beam.visible = true; S.beam.scale.set(1, h, 1);
        S.beam.material.opacity = Math.min(1, S.beamT * 2, (2.2 - S.beamT) * 4) * .75;
        S.beam.position.x = S.beamAt[0] - S.x; S.beam.position.z = S.beamAt[1] - S.z;
      } else S.beam.visible = false;
      if (I.retreat) return;
      if ((S.dropT -= dt) <= 0) { S.dropT = 6 + Math.random() * 5; if (Math.hypot(S.vx, S.vz) < 3) beamDown(S); else S.dropT = 1; }
      if ((S.zapT -= dt) <= 0) { S.zapT = zapCar(S, player) ? 6 + Math.random() * 6 : 2; }
    }

    /* ---------- an alien's ray gun (npc.js decides when and at whom, this draws it and does the damage) ---------- */
    function shoot(p, t, kind) {
      if (!I) return;
      const hs = p.look.hs, fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      const ox = p.x + fx * .5, oy = p.y + 1.2 * hs, oz = p.z + fz * .5;
      const player = o.player, miss = Math.random() < (kind === 'hero' ? .45 : .25);
      let tx, ty, tz;
      if (kind === 'hero') { tx = player.x; ty = player.y + 1.1; tz = player.z; }
      else if (kind === 'car') { tx = t.x; ty = t.y + 1; tz = t.z; }
      else { tx = t.x; ty = t.y + 1.1 * t.look.hs; tz = t.z; }
      if (miss) { tx += (Math.random() - .5) * 3; tz += (Math.random() - .5) * 3; ty += (Math.random() - .5) * .8; }
      ray(ox, oy, oz, tx, ty, tz, .06, .14);
      pew(ox, oz, false);
      o.crowd.panic(p.x, p.z, 30, false);
      if (miss) return;
      if (kind === 'hero') { if (!o.indoors()) o.heroDamage(6 + Math.random() * 4); }
      else if (kind === 'car') { t.damage += 55; t.blame = false; if (t.ai) t.ai.shock = Math.max(t.ai.shock, 1.2); }
      else o.crowd.damage(t, 60, { byPlayer: false, kind: 'gun', x: p.x, z: p.z });
    }

    function end() {
      I.retreat = true; I.retreatT = 0;
      for (const p of I.aliens) if (p.alien) p.alien.leave = true;
      o.flash('🛸 Пришельцы улетают!', 4);
    }
    function cleanup() {
      for (const S of I.saucers) scene.remove(S.g);
      for (const p of I.aliens) if (!p.dead && !p.down) o.crowd.despawnPerson(p); else p.keep = false;
      if (hum) { hum.stop(); hum = null; }
      hud.style.display = 'none'; I = null;
    }

    return {
      get busy() { return !!I; },
      get state() { return I; },   // for the automatic test of the draft
      shoot,
      start(nick, dur) {
        if (I) return false;
        if (o.indoors()) { o.flash('Нашествие идёт на улицах — выйдите из помещения', 2.5); return false; }
        I = { t: 0, dur: dur || 300, nick: nick || '', saucers: [], aliens: [], retreat: false, panicT: 0 };
        for (let k = 0; k < SAUCERS; k++) addSaucer(k);
        o.flash('🛸 ' + (nick ? '@' + nick + ' вызвал ' : '') + 'НАШЕСТВИЕ ПРИШЕЛЬЦЕВ! Летающие тарелки над городом — прячься!', 5);
        siren(); humStart();
        return true;
      },
      update(dt, player) {
        for (const r of rays) if (r.t > 0) { r.t -= dt; r.m.material.opacity = Math.max(0, r.t / r.max); if (r.t <= 0) r.m.visible = false; }
        for (const s of sparks) if (s.t > 0) { s.t -= dt; const k = Math.max(0, s.t / s.max); s.s.material.opacity = k; s.s.scale.set(s.size * (1.4 - k * .4), s.size * (1.4 - k * .4), 1); if (s.t <= 0) s.s.visible = false; }
        if (!I) return;
        I.t += dt;
        I.aliens = I.aliens.filter(p => o.crowd.people.includes(p));
        for (const S of I.saucers) saucerStep(S, dt, player);
        if (hum) { let nd = 1e9; for (const S of I.saucers) nd = Math.min(nd, Math.hypot(S.x - player.x, S.y - player.y, S.z - player.z)); hum.g.gain.value = .09 * Math.max(0, 1 - nd / 160); }
        if (!I.retreat) {
          const left = Math.max(0, I.dur - I.t), m = Math.floor(left / 60), s = Math.floor(left % 60);
          hud.style.display = 'block'; hud.textContent = '🛸 НАШЕСТВИЕ · ' + m + ':' + String(s).padStart(2, '0');
          if ((I.panicT -= dt) <= 0) { I.panicT = 2.5; o.crowd.panic(player.x, player.z, 90, false); }
          if (I.t >= I.dur) end();
        } else {
          I.retreatT += dt;
          hud.style.display = 'block'; hud.textContent = '🛸 Пришельцы улетают';
          // each alien left standing goes back up in a beam, a few at a time
          if (I.retreatT < 6) for (const p of I.aliens.slice()) {
            if (p.dead || p.down || Math.random() > dt * 1.2) continue;
            ray(p.x, p.y + 60, p.z, p.x, p.y, p.z, 1.6, .9); beamSound(p.x, p.z); o.crowd.despawnPerson(p);
          }
          if (I.retreatT > 6) for (const S of I.saucers) if (S.goal[1] < 200) { const a = Math.random() * Math.PI * 2; S.goal = [S.x + Math.sin(a) * 400, 260, S.z + Math.cos(a) * 400]; }
          if (I.retreatT > 18) cleanup();
        }
      }
    };
  };
})(window.NB);
