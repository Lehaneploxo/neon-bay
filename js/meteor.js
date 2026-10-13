// The meteor: a big gift on the owner's stream (1000 coins and up) drops one on the city near the hero.
// A red circle marks where it will land, a fireball with a smoke trail comes down out of the sky, and the
// impact throws people and cars about, sets cars on fire and leaves a smoking crater. If it lands on a building
// the building burns until the fire brigade comes and puts it out. People in the blast are knocked out, not
// killed (the ambulance brings them round), so the stream stays on the right side of TikTok's rules.
(function (NB) {
  'use strict';
  const { U } = NB;
  const WARN = 3, FLIGHT = 3.2, RADIUS = 11;   // seconds of warning, seconds in the air, metres of the blast

  NB.createMeteor = function (world, o) {
    // o: scene, vehicles, crowd, audio, player, flash(text, sec), shake(v), heroDamage(v), indoors(), view() -> [x, z] where the camera looks
    const col = world.col, scene = o.scene;
    const glowTex = U.canvasTex(64, 64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(.25, 'rgba(255,190,90,.9)'); gr.addColorStop(.6, 'rgba(255,90,20,.35)'); gr.addColorStop(1, 'rgba(255,60,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }, false);
    const smokeTex = U.canvasTex(64, 64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(70,64,60,.85)'); gr.addColorStop(.6, 'rgba(60,55,52,.4)'); gr.addColorStop(1, 'rgba(50,48,46,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }, false);

    // a pool of sprites for fire and smoke (the trail, the blast, the burning building, the crater)
    const parts = [];
    for (let i = 0; i < 260; i++) {
      const fire = i < 150;
      const m = new THREE.SpriteMaterial({ map: fire ? glowTex : smokeTex, transparent: true, depthWrite: false, blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending });
      const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
      parts.push({ s, fire, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1, grow: 0 });
    }
    let fireHead = 0, smokeHead = 150;
    function emit(fire, x, y, z, size, life, vx, vy, vz, grow) {
      let p;
      if (fire) { p = parts[fireHead]; fireHead = fireHead + 1 >= 150 ? 0 : fireHead + 1; }
      else { p = parts[smokeHead]; smokeHead = smokeHead + 1 >= parts.length ? 150 : smokeHead + 1; }
      p.s.position.set(x, y, z); p.life = p.max = life; p.size = size; p.grow = grow || 0;
      p.vx = vx || 0; p.vy = vy || 0; p.vz = vz || 0; p.s.visible = true;
    }

    // the rock itself, its glow and the light it throws on the street
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshStandardMaterial({ color: 0x3a2a22, emissive: 0xff5a14, emissiveIntensity: .9, roughness: 1, flatShading: true }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(16, 16, 1);
    const light = new THREE.PointLight(0xff7a2a, 0, 140, 1.4);
    rock.visible = glow.visible = false; scene.add(rock, glow, light);

    // the warning circle on the ground
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide });
    const fillMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: .18, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(RADIUS - .6, RADIUS, 64).rotateX(-Math.PI / 2), ringMat);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(RADIUS - .6, 64).rotateX(-Math.PI / 2), fillMat);
    ring.visible = fill.visible = false; ring.renderOrder = fill.renderOrder = 2; scene.add(ring, fill);

    // the white flash over the whole screen at the moment of impact
    const flashEl = document.createElement('div');
    flashEl.style.cssText = 'position:fixed;inset:0;background:#fff6e0;opacity:0;pointer-events:none;z-index:40;transition:opacity 1.2s ease-out';
    document.body.appendChild(flashEl);

    const craterMat = new THREE.MeshBasicMaterial({ color: 0x0d0a09, transparent: true, opacity: .8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const rimMat = new THREE.MeshBasicMaterial({ color: 0x3b2e26, transparent: true, opacity: .85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const chunkMat = new THREE.MeshStandardMaterial({ color: 0x241c18, emissive: 0xff3a00, emissiveIntensity: .35, roughness: 1, flatShading: true });
    const debrisGeo = new THREE.DodecahedronGeometry(.35, 0);
    const craters = [], debris = [], fires = [];
    let m = null;   // the meteor on its way: { phase, t, x, y, z, from, nick, building }

    // the ground under a point (sidewalks and plazas are low boxes; the street is 0)
    function groundAt(x, z) {
      let f = 0;
      for (const b of col.query(x - .3, z - .3, x + .3, z + .3, [])) if (b.maxY <= 1.6 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > f) f = b.maxY;
      return f;
    }
    const solidAt = (x, z, y) => col.query(x - .1, z - .1, x + .1, z + .1, []).some(b => !b.npcOnly && b.maxY > y + .4 && b.minY < y + 1.6 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);

    // where it falls: in front of the camera (the stream has to see it), on a building 18–45 m away if there
    // is one, otherwise on the open street
    function pickTarget(px, pz, va) {
      const hits = [];
      for (let i = 0; i < 24; i++) {
        const a = va + (i / 23 - .5) * 1.8, dx = Math.sin(a), dz = Math.cos(a);
        const t = col.raycast(px, 1.5, pz, dx, 0, dz, 45);
        if (t > 18 && t < 45) {
          const ix = px + dx * (t + .8), iz = pz + dz * (t + .8), top = 90 - col.raycast(ix, 90, iz, 0, -1, 0, 90);
          if (top > 5) hits.push({ dx, dz, t, top });
        }
      }
      if (hits.length) {
        const h = hits[(Math.random() * hits.length) | 0];
        const wx = px + h.dx * h.t, wz = pz + h.dz * h.t;   // the wall facing the hero
        return { x: wx - h.dx * 1.5, z: wz - h.dz * 1.5, wall: { x: wx, z: wz, nx: -h.dx, nz: -h.dz, top: Math.min(h.top, 26) } };
      }
      for (let i = 0; i < 12; i++) {
        const a = va + (Math.random() - .5) * 1.4, d = 24 + Math.random() * 12, x = px + Math.sin(a) * d, z = pz + Math.cos(a) * d;
        if (!solidAt(x, z, groundAt(x, z))) return { x, z, wall: null };
      }
      return { x: px + Math.sin(va) * 26, z: pz + Math.cos(va) * 26, wall: null };
    }

    /* ---------- sound: an alarm while the circle is up, a rising roar while it falls ---------- */
    function alarm() {
      const AC = o.audio.ctx && o.audio.ctx(); if (!AC) return;
      const t = AC.currentTime, g = AC.createGain(), osc = AC.createOscillator();
      osc.type = 'sawtooth'; g.gain.value = 0; osc.connect(g); g.connect(o.audio.bus());
      for (let k = 0; k < 6; k++) { osc.frequency.setValueAtTime(k % 2 ? 520 : 760, t + k * .5); }
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.06, t + .05); g.gain.setValueAtTime(.06, t + 2.9); g.gain.linearRampToValueAtTime(0, t + 3);
      osc.start(t); osc.stop(t + 3.05);
    }
    function roar() {
      const AC = o.audio.ctx && o.audio.ctx(), buf = o.audio.noiseBuf && o.audio.noiseBuf(); if (!AC || !buf) return;
      const t = AC.currentTime, s = AC.createBufferSource(), lp = AC.createBiquadFilter(), g = AC.createGain();
      s.buffer = buf; s.loop = true; lp.type = 'lowpass'; lp.frequency.setValueAtTime(200, t); lp.frequency.exponentialRampToValueAtTime(1600, t + FLIGHT);
      g.gain.setValueAtTime(.001, t); g.gain.exponentialRampToValueAtTime(.5, t + FLIGHT); g.gain.linearRampToValueAtTime(0, t + FLIGHT + .15);
      s.connect(lp); lp.connect(g); g.connect(o.audio.bus()); s.start(t); s.stop(t + FLIGHT + .2);
      const w = AC.createOscillator(), wg = AC.createGain();   // the whistle, falling in pitch
      w.type = 'sine'; w.frequency.setValueAtTime(1500, t); w.frequency.exponentialRampToValueAtTime(260, t + FLIGHT);
      wg.gain.setValueAtTime(0, t); wg.gain.linearRampToValueAtTime(.05, t + 1); wg.gain.linearRampToValueAtTime(0, t + FLIGHT);
      w.connect(wg); wg.connect(o.audio.bus()); w.start(t); w.stop(t + FLIGHT + .05);
    }

    /* ---------- the impact ---------- */
    function impact() {
      const { x, z } = m, y = m.y;
      rock.visible = glow.visible = false; ring.visible = fill.visible = false;
      light.intensity = 60; light.position.set(x, y + 6, z);
      flashEl.style.transition = 'none'; flashEl.style.opacity = '.85';
      requestAnimationFrame(() => { flashEl.style.transition = 'opacity 1.2s ease-out'; flashEl.style.opacity = '0'; });
      // the fireball: the cars' own explosions around the centre (they shove and burn cars and make the boom)
      o.vehicles.blast(x, y, z, false);
      m.later = [[.12, 5], [.22, 5], [.3, 7]];
      for (let k = 0; k < 40; k++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 6; emit(true, x + Math.sin(a) * r, y + 1 + Math.random() * 4, z + Math.cos(a) * r, 5 + Math.random() * 6, .8 + Math.random() * .6, Math.sin(a) * 4, 3 + Math.random() * 5, Math.cos(a) * 4, 3); }
      for (let k = 0; k < 30; k++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 8; emit(false, x + Math.sin(a) * r, y + 2 + Math.random() * 6, z + Math.cos(a) * r, 6 + Math.random() * 5, 3 + Math.random() * 2, Math.sin(a) * 2, 2 + Math.random() * 3, Math.cos(a) * 2, 4); }
      // flying stones
      for (let k = 0; k < 26; k++) {
        const c = new THREE.Mesh(debrisGeo, chunkMat), a = Math.random() * Math.PI * 2, sp = 6 + Math.random() * 14;
        c.position.set(x, y + 1, z); c.scale.setScalar(.4 + Math.random() * .8); scene.add(c);
        debris.push({ c, vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, vy: 8 + Math.random() * 12, t: 0, ry: Math.random() * 6 });
      }
      // the wider blast: cars further out are shoved and damaged (the close ones catch fire), people are thrown and knocked out
      for (const c of o.vehicles.cars) {
        if (c === o.vehicles.driving || (c.model.heli && c.y > y + 6)) continue;
        const dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz); if (d > RADIUS * 1.7 || d < .01) continue;
        const k = 1 - d / (RADIUS * 1.7);
        if (c.ai) c.ai.shock = 3; else { c.vx += dx / d * 14 * k; c.vz += dz / d * 14 * k; c.awake = true; }
        c.hop = Math.max(c.hop || 0, k); c.damage += 260 * k;
      }
      for (const p of o.crowd.people.slice()) {
        if (p.dead || p.down || p.mirror || Math.abs(p.y - y) > 4) continue;
        const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz); if (d > RADIUS * 1.5) continue;
        const k = 1 - d / (RADIUS * 1.5), dir = d > .01 ? [dx / d, dz / d] : [1, 0];
        p.meteorFly = { vx: dir[0] * (6 + 12 * k), vz: dir[1] * (6 + 12 * k), t: .45 };
        o.crowd.damage(p, d < RADIUS ? 999 : 30 * k, { byPlayer: false, kind: 'melee', x, z });   // knocked out, not killed
      }
      o.crowd.panic(x, z, 70, false);
      const pd = Math.hypot(o.player.x - x, o.player.z - z);
      o.shake(Math.max(.25, 1.2 * (1 - pd / 80)));
      if (pd < RADIUS && Math.abs(o.player.y - y) < 4) o.heroDamage(160 * (1 - pd / RADIUS) + 30);
      // the crater
      const cr = new THREE.Group();
      cr.add(new THREE.Mesh(new THREE.RingGeometry(5.2, 7.4, 28).rotateX(-Math.PI / 2), rimMat));
      cr.add(new THREE.Mesh(new THREE.CircleGeometry(5.4, 28).rotateX(-Math.PI / 2), craterMat));
      for (let k = 0; k < 7; k++) { const s = new THREE.Mesh(debrisGeo, chunkMat), a = Math.random() * Math.PI * 2, r = Math.random() * 3.2; s.position.set(Math.sin(a) * r, .15, Math.cos(a) * r); s.scale.setScalar(1.2 + Math.random() * 1.8); cr.add(s); }
      cr.position.set(x, y + .04, z); scene.add(cr);
      craters.push({ g: cr, t: 0, x, y, z });
      if (craters.length > 3) { const old = craters.shift(); scene.remove(old.g); }
      // a building hit: it burns until the firefighters put it out
      if (m.wall) {
        const w = m.wall, fx = w.x + w.nx * 3.5, fz = w.z + w.nz * 3.5;
        fires.push({ extra: true, x: fx, y: groundAt(fx, fz) + 1.2, z: fz, wall: w, t: 150, out: 0, sprayTime: 10, fireUnit: null, flameT: 0 });
        o.flash('☄ Метеорит попал в здание! Пожар!', 3);
      }
    }

    return {
      // burning buildings, for the fire brigade (fire.js): { x, y, z, t > 0 while burning, fireUnit }
      fires,
      get busy() { return !!m; },
      drop(nick) {
        if (m) return false;
        if (o.indoors()) { o.flash('Метеорит не залетает в помещения — выйдите на улицу', 2.5); return false; }
        const p = o.player, v = o.view(), va = Math.atan2(v[0], v[1]), tg = pickTarget(p.x, p.z, va), gy = groundAt(tg.x, tg.z);
        // it comes down from the sky beyond the target, towards the camera, a little from one side
        const a = va + (Math.random() < .5 ? -1 : 1) * (.35 + Math.random() * .35);
        m = { phase: 'warn', t: 0, x: tg.x, y: gy, z: tg.z, wall: tg.wall, nick: nick || '', from: [tg.x + Math.sin(a) * 220, gy + 230, tg.z + Math.cos(a) * 220] };
        ring.position.set(tg.x, gy + .06, tg.z); fill.position.copy(ring.position); ring.visible = fill.visible = true;
        o.flash('☄ ' + (nick ? '@' + nick + ' вызвал ' : '') + 'МЕТЕОРИТ! Беги из красного круга!', 4);
        alarm();
        return true;
      },
      update(dt, player) {
        if (m) {
          m.t += dt;
          if (m.phase === 'warn') {
            ringMat.opacity = .55 + .4 * Math.abs(Math.sin(m.t * 6)); fillMat.opacity = .12 + .1 * Math.abs(Math.sin(m.t * 6));
            if (m.t >= WARN) { m.phase = 'fall'; m.t = 0; rock.visible = glow.visible = true; roar(); }
          } else if (m.phase === 'fall') {
            ringMat.opacity = .55 + .4 * Math.abs(Math.sin(m.t * 12)); fillMat.opacity = .14 + .14 * Math.abs(Math.sin(m.t * 12));
            const k = Math.min(1, m.t / FLIGHT), e = k * k * (1.6 - .6 * k);   // speeding up as it comes down
            const fx = m.from[0] + (m.x - m.from[0]) * e, fy = m.from[1] + (m.y - m.from[1]) * e, fz = m.from[2] + (m.z - m.from[2]) * e;
            rock.position.set(fx, fy, fz); rock.rotation.x += dt * 3; rock.rotation.y += dt * 2;
            glow.position.set(fx, fy, fz); glow.scale.setScalar(14 + Math.sin(m.t * 30) * 1.5);
            light.position.set(fx, fy, fz); light.intensity = 4 + k * 26;
            for (let i = 0; i < 5; i++) emit(true, fx + (Math.random() - .5) * 1.5, fy + (Math.random() - .5) * 1.5, fz + (Math.random() - .5) * 1.5, 4 + Math.random() * 3, .35 + Math.random() * .3, 0, 0, 0, -2);
            for (let i = 0; i < 2; i++) emit(false, fx + (Math.random() - .5) * 2, fy, fz + (Math.random() - .5) * 2, 3 + Math.random() * 2, 2.2 + Math.random(), (Math.random() - .5), .5, (Math.random() - .5), 3);
            if (k >= 1) { impact(); m.phase = 'after'; m.t = 0; }
          } else {
            light.intensity = Math.max(0, light.intensity - dt * 70);
            for (const l of m.later) if (l[0] > 0 && (l[0] -= dt) <= 0) { const a = Math.random() * Math.PI * 2; o.vehicles.blast(m.x + Math.sin(a) * l[1], m.y, m.z + Math.cos(a) * l[1], false); }
            if (m.t > 1.2) m = null;
          }
        }
        // people thrown by the blast slide away from it (stopping at walls)
        for (const p of o.crowd.people) {
          const f = p.meteorFly; if (!f) continue;
          f.t -= dt; if (f.t <= 0) { p.meteorFly = null; continue; }
          const nx = p.x + f.vx * dt, nz = p.z + f.vz * dt;
          if (!solidAt(nx, nz, p.y)) { p.x = nx; p.z = nz; } else p.meteorFly = null;
        }
        for (let i = debris.length - 1; i >= 0; i--) {
          const d = debris[i]; d.t += dt; d.vy -= 25 * dt;
          d.c.position.x += d.vx * dt; d.c.position.y += d.vy * dt; d.c.position.z += d.vz * dt; d.c.rotation.y += d.ry * dt; d.c.rotation.x += d.ry * dt;
          if (d.c.position.y < .2) { d.c.position.y = .2; d.vx *= .5; d.vz *= .5; d.vy = Math.abs(d.vy) * .3; }
          if (d.t > 6) { scene.remove(d.c); debris.splice(i, 1); }
        }
        // the crater smokes for a while; the stones in it stop glowing
        for (const c of craters) {
          c.t += dt;
          if (c.t < 40 && Math.random() < dt * 6 && Math.hypot(c.x - player.x, c.z - player.z) < 120) emit(false, c.x + (Math.random() - .5) * 4, c.y + 1, c.z + (Math.random() - .5) * 4, 3 + Math.random() * 2, 4 + Math.random() * 2, 0, 1.6, 0, 2.5);
        }
        chunkMat.emissiveIntensity = Math.max(.03, chunkMat.emissiveIntensity - dt * .012);
        // the burning building: flames up the wall, black smoke from the top
        for (let i = fires.length - 1; i >= 0; i--) {
          const f = fires[i];
          if (f.t > 0) f.t -= dt; else { f.out += dt; if (f.out > 25) { fires.splice(i, 1); continue; } }
          if (Math.hypot(f.x - player.x, f.z - player.z) > 160) continue;
          const w = f.wall, sx = -w.nz, sz = w.nx, burning = f.t > 0;
          f.flameT -= dt;
          if (f.flameT <= 0) {
            f.flameT = burning ? .04 : .25;
            const along = (Math.random() - .5) * 10, h = Math.random() * w.top;
            const bx = w.x + sx * along + w.nx * .6, bz = w.z + sz * along + w.nz * .6;
            if (burning) emit(true, bx, h + 1, bz, 2.5 + Math.random() * 3, .5 + Math.random() * .5, w.nx * .5, 2.5 + Math.random() * 2, w.nz * .5, 1);
            emit(false, bx, Math.max(h, w.top - 2) + 2, bz, 4 + Math.random() * 3, 4 + Math.random() * 2, w.nx * .4, 2.2, w.nz * .4, 3);
          }
        }
        for (const p of parts) {
          if (!p.s.visible) continue;
          p.life -= dt; if (p.life <= 0) { p.s.visible = false; continue; }
          const k = p.life / p.max;
          p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
          p.size = Math.max(.2, p.size + p.grow * dt); p.s.scale.set(p.size, p.size, 1);
          p.s.material.opacity = p.fire ? k : Math.min(1, k * 1.6) * .8;
        }
      }
    };
  };
})(window.NB);
