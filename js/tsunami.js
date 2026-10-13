// The tsunami: a giant gift on the owner's stream sends a wall of water in from the open sea in the east.
// A siren wails, the wave grows as it reaches the beach (about 18 m), then rolls across the whole city from the
// beach to the west embankment, losing height as it goes. Whatever it reaches is carried along: people are swept
// off their feet and knocked out (not killed — the ambulance brings them round), cars tumble and are left on their
// sides or roofs with dead engines, the hero is dragged and hurt unless inside a building or up on a roof. The
// streets stay flooded behind it, with junk floating about, and slowly drain.
(function (NB) {
  'use strict';
  const { U } = NB;
  const START_X = 430, END_X = -175;       // where the wave appears out at sea and where it dies off the west embankment
  const HALF_Z = 270;                      // half its length along the coast
  const NZ = 170;                          // columns along the length
  // its cross-section: [u, h] with u metres ahead of the leading edge (+ is the way it travels) and h a share of
  // its height. A long back, a crest, the curling lip hanging over the front and the concave face under it.
  const PROF = [[-70, 0], [-46, .22], [-28, .55], [-15, .84], [-6, .98], [0, 1.03], [3.4, .97], [5.6, .82], [5.4, .66], [3.6, .52], [1.6, .34], [.5, .16], [.9, -.05]];
  const COLS = [0x0b3d4c, 0x0f5566, 0x1a7584, 0x2a95a2, 0x4cb8c0, 0xbfeef0, 0xffffff, 0xf2fbfb, 0xbfe9ec, 0x6cc8cf, 0x3fa5b0, 0x2a8c99, 0x2a8c99];

  NB.createTsunami = function (world, o) {
    // o: scene, vehicles, crowd, audio, player, flash(text, sec), shake(v), heroDamage(v), indoors()
    const col = world.col, scene = o.scene, L = world.layout, SHORE = L.SHORE, WEST = -112, LANDZ = 112;

    /* ---------- the wall of water ---------- */
    const P = PROF.length, nv = P * NZ;
    const pos = new Float32Array(nv * 3), clr = new Float32Array(nv * 3), idx = [];
    const tmpC = new THREE.Color();
    for (let j = 0; j < NZ; j++) for (let i = 0; i < P; i++) { tmpC.setHex(COLS[i]); clr.set([tmpC.r, tmpC.g, tmpC.b], (j * P + i) * 3); }
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < P - 1; i++) { const a = j * P + i, b = a + 1, c = a + P, d = c + 1; idx.push(a, c, b, b, c, d); }
    const waveGeo = new THREE.BufferGeometry();
    waveGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    waveGeo.setAttribute('color', new THREE.BufferAttribute(clr, 3));
    waveGeo.setIndex(idx);
    const waveMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .25, metalness: .05, transparent: true, opacity: .93, side: THREE.DoubleSide, emissive: 0x0b3640, emissiveIntensity: .6 });
    const waveMesh = new THREE.Mesh(waveGeo, waveMat);
    waveMesh.frustumCulled = false; waveMesh.visible = false; scene.add(waveMesh);

    /* ---------- the flood it leaves behind ---------- */
    const floodTex = U.canvasTex(256, 256, (g, s) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
      for (let k = 0; k < 140; k++) { g.fillStyle = 'rgba(160,215,220,' + (.15 + Math.random() * .35) + ')'; g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 6 + Math.random() * 26, 2 + Math.random() * 5, 0, 0, Math.PI * 2); g.fill(); }
      for (let k = 0; k < 60; k++) { g.fillStyle = 'rgba(255,255,255,' + (.4 + Math.random() * .5) + ')'; g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 3 + Math.random() * 10, 1 + Math.random() * 2, 0, 0, Math.PI * 2); g.fill(); }
    }, true);
    floodTex.repeat.set(14, 12);
    const floodMat = new THREE.MeshStandardMaterial({ color: 0x3f8c96, map: floodTex, roughness: .15, metalness: .1, transparent: true, opacity: .82, depthWrite: false, emissive: 0x0a2a30, emissiveIntensity: .5 });
    const flood = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), floodMat);
    flood.visible = false; flood.renderOrder = 1; scene.add(flood);
    const FLOOD_Y = .62;

    /* ---------- spray and foam ---------- */
    const foamTex = U.canvasTex(64, 64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(.5, 'rgba(230,248,250,.55)'); gr.addColorStop(1, 'rgba(220,245,248,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }, false);
    const parts = [];
    for (let i = 0; i < 280; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: foamTex, transparent: true, depthWrite: false }));
      s.visible = false; scene.add(s); parts.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, g: 0 });
    }
    let head = 0;
    function emit(x, y, z, size, life, vx, vy, vz, grow, grav) {
      const p = parts[head]; head = (head + 1) % parts.length;
      p.s.position.set(x, y, z); p.life = p.max = life; p.size = size; p.grow = grow || 0; p.g = grav || 0;
      p.vx = vx || 0; p.vy = vy || 0; p.vz = vz || 0; p.s.visible = true;
    }

    /* ---------- floating junk: crates, barrels, planks ---------- */
    const junkGeos = [new THREE.BoxGeometry(1.1, .8, 1.1), new THREE.CylinderGeometry(.4, .4, 1.1, 10), new THREE.BoxGeometry(2.6, .18, .5), new THREE.BoxGeometry(1.6, .5, 1)];
    const junkMats = [0x8a6a44, 0x2f6fb0, 0x6b4f33, 0xc23b2f, 0x3a8a4a, 0xd9c9a0].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: .9 }));
    const junk = [];

    /* ---------- sound: the siren, and the roar of the water that grows as it nears ---------- */
    let snd = null;
    function siren() {
      const AC = o.audio.ctx && o.audio.ctx(); if (!AC) return;
      const t = AC.currentTime, g = AC.createGain(), osc = AC.createOscillator();
      osc.type = 'sine';
      for (let k = 0; k < 3; k++) { const t0 = t + k * 3.2; osc.frequency.setValueAtTime(300, t0); osc.frequency.linearRampToValueAtTime(660, t0 + 1.6); osc.frequency.linearRampToValueAtTime(300, t0 + 3.2); }
      osc.connect(g); g.connect(o.audio.bus());
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.09, t + .4); g.gain.setValueAtTime(.09, t + 9); g.gain.linearRampToValueAtTime(0, t + 9.6);
      osc.start(t); osc.stop(t + 9.7);
    }
    function roarStart() {
      const AC = o.audio.ctx && o.audio.ctx(), buf = o.audio.noiseBuf && o.audio.noiseBuf(); if (!AC || !buf) return null;
      const s = AC.createBufferSource(), lp = AC.createBiquadFilter(), g = AC.createGain();
      s.buffer = buf; s.loop = true; lp.type = 'lowpass'; lp.frequency.value = 300; g.gain.value = 0;
      s.connect(lp); lp.connect(g); g.connect(o.audio.bus()); s.start();
      return { s, lp, g, AC };
    }
    function roarStop() { if (!snd) return; const t = snd.AC.currentTime; snd.g.gain.cancelScheduledValues(t); snd.g.gain.setValueAtTime(snd.g.gain.value, t); snd.g.gain.linearRampToValueAtTime(0, t + 2); snd.s.stop(t + 2.1); snd = null; }

    /* ---------- helpers ---------- */
    const solidAt = (x, z, y) => col.query(x - .1, z - .1, x + .1, z + .1, []).some(b => !b.npcOnly && b.maxY > y + .4 && b.minY < y + 1.6 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
    function groundAt(x, z) {
      let f = 0;
      for (const b of col.query(x - .3, z - .3, x + .3, z + .3, [])) if (b.maxY <= 1.6 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > f) f = b.maxY;
      return f;
    }
    // the speed and the height of the wave where its front is: fast and low at sea, tallest at the beach, slowing
    // and sinking across the city, gone off the west embankment
    const speedAt = x => x > SHORE ? 30 : 14 + 16 * U.clamp((x - WEST) / (SHORE - WEST), 0, 1);
    function heightAt(x) {
      if (x > 300) return 8;
      if (x > SHORE) return 8 + 10 * (300 - x) / (300 - SHORE);
      if (x > WEST) return 18 - 8 * (SHORE - x) / (SHORE - WEST);
      return Math.max(0, 10 * (1 - (WEST - x) / (WEST - END_X)));
    }
    let w = null;   // the wave on its way: { X, t, H, nick, hits: Set, done }
    const frontAt = z => w.X + Math.sin(z * .013 + 1.1) * 6 + Math.sin(z * .041) * 2;
    const carried = [];   // { kind: 'p'|'c'|'hero', o, t, v, dz, spin }
    const tipped = [];    // cars left on their sides/roofs: { c, ang, lift, t }

    function layWave(t) {
      const H = w.H, s = Math.max(.35, H / 16);
      for (let j = 0; j < NZ; j++) {
        const z = -HALF_Z + 2 * HALF_Z * j / (NZ - 1), az = Math.abs(z);
        const taper = az < 190 ? 1 : Math.max(.08, 1 - (az - 190) / 80);
        const amp = H * taper * (1 + .1 * Math.sin(z * .05 + t * 1.3) + .06 * Math.sin(z * .17 - t * 2.1)), sx = s * (.8 + .2 * taper);
        const fx = frontAt(z), lip = 1 + .25 * Math.sin(z * .09 + t * 1.7);
        for (let i = 0; i < P; i++) {
          const u = PROF[i][0] * sx * (i >= 6 && i <= 9 ? lip : 1), k = (j * P + i) * 3;
          pos[k] = fx - u; pos[k + 1] = PROF[i][1] * amp; pos[k + 2] = z;
        }
      }
      waveGeo.attributes.position.needsUpdate = true;
      waveGeo.computeVertexNormals();
    }
    // the water surface height a little behind the front (for junk riding the wave)
    function surfAt(u) {
      for (let i = 0; i < P - 1; i++) if (u >= PROF[i][0] && u <= PROF[i + 1][0]) { const a = PROF[i], b = PROF[i + 1]; return a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0]); }
      return 0;
    }

    function hitPerson(p) {
      if (p.mirror || p.dead || p.y > groundAt(p.x, p.z) + w.H * .7) return;
      carried.push({ kind: 'p', o: p, t: 2.2 + Math.random() * 1.6, v: speedAt(w.X) * (.75 + Math.random() * .2), dz: (Math.random() - .5) * 4 });
      if (!p.down) o.crowd.damage(p, 999, { byPlayer: false, kind: 'melee', x: p.x + 3, z: p.z });   // knocked out, not killed
    }
    function hitCar(c) {
      if (c.model.heli || c.model.jet || c.model.boat || c.y > w.H * .7) return;
      const mine = c === o.vehicles.driving;
      o.vehicles.wash(c, !mine);
      const flip = Math.random() < .55 ? Math.PI : Math.PI / 2 * (Math.random() < .5 ? 1 : -1);
      carried.push({ kind: 'c', o: c, t: 2.6 + Math.random() * 1.8, v: speedAt(w.X) * (.7 + Math.random() * .25), dz: (Math.random() - .5) * 5, spin: (Math.random() < .5 ? -1 : 1) * (2 + Math.random() * 3), flip: mine ? 0 : flip, ang: 0, yaw: (Math.random() - .5) * 2 });
      if (mine) { o.heroDamage(55); o.shake(.8); o.flash('🌊 Волна уносит вашу машину!', 2.5); }
    }
    function hitHero() {
      const p = o.player;
      if (o.indoors() || p.dead || o.vehicles.driving) return;
      if (p.y > groundAt(p.x, p.z) + w.H * .7) { o.flash('Вы переждали волну на высоте!', 2.5); return; }
      carried.push({ kind: 'hero', o: p, t: 2.4, v: speedAt(w.X) * .8, dz: (Math.random() - .5) * 3 });
      o.heroDamage(70); o.shake(1); o.flash('🌊 Вас смыло волной!', 2.5);
    }

    function spawnJunk(z) {
      const m = new THREE.Mesh(junkGeos[(Math.random() * junkGeos.length) | 0], junkMats[(Math.random() * junkMats.length) | 0]);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); scene.add(m);
      junk.push({ m, z, u: -3 - Math.random() * 16, ride: true, x: 0, rs: (Math.random() - .5) * 3, t: 0 });
    }

    function finish() {
      w.done = true; waveMesh.visible = false; roarStop();
      for (const j of junk) if (j.ride) { j.ride = false; j.x = j.m.position.x; }
    }

    return {
      get busy() { return !!w; },
      launch(nick) {
        if (w) return false;
        w = { X: START_X, t: 0, H: heightAt(START_X), nick: nick || '', hits: new Set(), heroHit: false, done: false, drain: 0, junkT: 0, crashT: 0 };
        waveMesh.visible = true; layWave(0);
        o.flash('🌊 ' + (nick ? '@' + nick + ' вызвал ' : '') + 'ЦУНАМИ! Волна идёт с моря (с востока) — беги в здание или на крышу!', 6);
        siren(); snd = roarStart();
        return true;
      },
      update(dt, player) {
        // things the wave is carrying
        for (let i = carried.length - 1; i >= 0; i--) {
          const k = carried[i], ob = k.o; k.t -= dt;
          if (k.kind === 'c' && !o.vehicles.cars.includes(ob)) { carried.splice(i, 1); continue; }
          if (k.t <= 0) {
            carried.splice(i, 1);
            if (k.kind === 'c' && k.flip) tipped.push({ c: ob, ang: k.flip, yaw: ob.h, t: 60 });
            if (k.kind === 'c') { ob.root.position.y = ob.y; ob.body.rotation.x = 0; }
            continue;
          }
          const f = Math.min(1, k.t / 1.2), nx = ob.x - k.v * f * dt, nz = ob.z + k.dz * f * dt;
          const y = ob.y;
          if (!solidAt(nx, nz, y)) { ob.x = nx; ob.z = nz; } else if (!solidAt(ob.x, nz, y)) ob.z = nz; else k.v *= .5;
          if (k.kind === 'c') {
            ob.vx = ob.vz = 0;
            k.ang += k.spin * dt; ob.h += k.yaw * dt;
            const tumble = k.flip ? k.ang : Math.sin(k.ang) * .3;
            ob.root.position.set(ob.x, ob.y + 1.2 + Math.sin(k.ang * 1.3) * .5, ob.z); ob.root.rotation.y = ob.h;
            ob.body.rotation.z = tumble; ob.body.rotation.x = Math.sin(k.ang * .7) * .5;
            if (k.t < .6 && k.flip) { const e = 1 - k.t / .6; ob.body.rotation.z = tumble + (k.flip - tumble) * e; }
          }
        }
        // cars left on their side or roof (the car's own update rights them every frame, so this tips them back)
        for (let i = tipped.length - 1; i >= 0; i--) {
          const q = tipped[i], c = q.c; q.t -= dt;
          if (q.t <= 0 || c === o.vehicles.driving || !o.vehicles.cars.includes(c)) { c.body.rotation.z = 0; c.body.position.y = 0; tipped.splice(i, 1); continue; }
          c.body.rotation.z = q.ang; c.body.rotation.x = 0; c.body.position.y = Math.abs(q.ang) > 2 ? 1.45 : c.model.w / 2;
          c.root.position.y = c.y;
        }

        if (w && !w.done) {
          w.t += dt;
          w.X -= speedAt(w.X) * dt; w.H = heightAt(w.X);
          layWave(w.t);
          const near = Math.abs(player.x - w.X);
          // the roar: rising as it nears the hero, a crashing rumble once it's in the streets
          if (snd) { const k = U.clamp(1 - near / 260, 0, 1); snd.g.gain.value = .04 + .6 * k * k; snd.lp.frequency.value = 250 + 900 * k; }
          if (near < 60) o.shake(dt * 2.2 * (1 - near / 60));
          // spray off the crest and mist at the foot, round the hero's part of the coast
          const H = w.H, s = Math.max(.35, H / 16);
          for (let n = 0; n < 7; n++) {
            const z = player.z + (Math.random() - .5) * 220, fx = frontAt(z);
            emit(fx - 2 * s, H * (.95 + Math.random() * .1), z, 3 + Math.random() * 4, .9 + Math.random() * .6, -speedAt(w.X) * .5, 2 + Math.random() * 3, (Math.random() - .5) * 2, 4, 6);
          }
          if (w.X < SHORE + 10) for (let n = 0; n < 5; n++) {
            const z = player.z + (Math.random() - .5) * 160, fx = frontAt(z);
            emit(fx - 4, 1 + Math.random() * 3, z, 6 + Math.random() * 5, 1.2 + Math.random() * .8, -speedAt(w.X) * .9, 1.5 + Math.random() * 2, (Math.random() - .5) * 3, 6, 0);
          }
          // crashing into the streets: big white bursts thrown up along the front
          if (w.X < SHORE && (w.crashT -= dt) <= 0) {
            w.crashT = .08;
            const z = player.z + (Math.random() - .5) * 140, fx = frontAt(z);
            for (let n = 0; n < 4; n++) emit(fx - 3 + Math.random() * 4, 2 + Math.random() * H * .6, z + (Math.random() - .5) * 6, 5 + Math.random() * 6, 1.4 + Math.random(), -8 - Math.random() * 6, 8 + Math.random() * 10, (Math.random() - .5) * 6, 5, 9);
          }
          // junk picked up in the city rides on the back of the wave
          if (w.X < SHORE - 4 && w.X > WEST + 10 && junk.length < 46 && (w.junkT -= dt) <= 0) { w.junkT = .25; spawnJunk(U.clamp(player.z + (Math.random() - .5) * 120, -LANDZ + 4, LANDZ - 4)); }
          // the front reaches people, cars and the hero
          if (w.X < SHORE + 30) {
            for (const p of o.crowd.people) if (!w.hits.has(p) && Math.abs(p.z) < LANDZ + 20 && p.x > frontAt(p.z) - 1) { w.hits.add(p); hitPerson(p); }
            for (const c of o.vehicles.cars) if (!w.hits.has(c) && Math.abs(c.z) < LANDZ + 20 && c.x > frontAt(c.z) - 1.5) { w.hits.add(c); hitCar(c); }
            if (!w.heroHit && Math.abs(player.z) < LANDZ + 20 && player.x > frontAt(player.z) - 1) { w.heroHit = true; hitHero(); }
          }
          if (w.X < SHORE) o.crowd.panic(w.X - 30, U.clamp(player.z, -LANDZ, LANDZ), 90, false);
          // the flood behind it, from the front back to the beach
          if (w.X < SHORE) {
            const x0 = Math.max(WEST - 2, w.X + 2), x1 = SHORE + 8;
            flood.visible = true; flood.scale.set(Math.max(.1, x1 - x0), 1, LANDZ * 2 + 4); flood.position.set((x0 + x1) / 2, FLOOD_Y, 0);
            floodMat.opacity = .82;
          }
          if (w.X <= END_X) finish();
        }
        // the flood: flowing west while the wave is in town, then slowly draining away
        if (flood.visible) {
          floodTex.offset.x += dt * (w && !w.done ? .25 : .03); floodTex.offset.y += dt * .01;
          if (w && w.done) {
            w.drain += dt;
            const k = U.clamp(w.drain / 30, 0, 1);
            flood.position.y = FLOOD_Y - k * .7; floodMat.opacity = .82 * (1 - k * k);
            if (k >= 1) { flood.visible = false; w = null; }
          }
        } else if (w && w.done) w = null;
        // junk: riding the wave, then floating in the flood, then left on the ground when it drains
        const floodY = flood.visible ? flood.position.y : 0;
        for (let i = junk.length - 1; i >= 0; i--) {
          const j = junk[i]; j.t += dt;
          if (j.ride && w && !w.done) {
            const s = Math.max(.35, w.H / 16), x = frontAt(j.z) - j.u * s;
            j.m.position.set(x, Math.max(FLOOD_Y, surfAt(j.u) * w.H) + .2, j.z);
            j.m.rotation.x += j.rs * dt; j.m.rotation.z += j.rs * .7 * dt;
            if (w.X < WEST + 6 && Math.random() < dt * .8) { j.ride = false; j.x = x; }
          } else {
            j.ride = false;
            j.m.position.y = U.damp(j.m.position.y, Math.max(.25, floodY + .15) + Math.sin(j.t * 1.5 + j.z) * .06, 2, dt);
            j.m.rotation.x = U.damp(j.m.rotation.x, 0, .5, dt); j.m.rotation.z = U.damp(j.m.rotation.z, 0, .5, dt);
            if (j.t > 90) { scene.remove(j.m); junk.splice(i, 1); }
          }
        }
        for (const p of parts) {
          if (!p.s.visible) continue;
          p.life -= dt; if (p.life <= 0) { p.s.visible = false; continue; }
          const k = p.life / p.max;
          p.vy -= p.g * dt;
          p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
          p.size = Math.max(.2, p.size + p.grow * dt); p.s.scale.set(p.size, p.size, 1);
          p.s.material.opacity = Math.min(1, k * 1.8) * .85;
        }
      }
    };
  };
})(window.NB);
