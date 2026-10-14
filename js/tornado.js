// The tornado: a Crown on the owner's stream sets a twister loose round the hero for five minutes (three crowns —
// three twisters, each with its own five minutes). A dark funnel reaching up into a storm cloud, a ring of dust and
// junk whirling round its foot, a howl of wind. It wanders the streets near the hero, now and then right past him.
// Whatever comes under it is sucked in — cars, people, the hero himself — whirled round and up thirty metres and
// flung out: people don't survive the fall, cars come down wrecked and burning. The hero is thrown and hurt (not
// killed by the fall). Indoors he's safe. It runs alongside any other event and shows no timer on the screen.
// At most MAXT twisters at once (the phone has to draw them all); more wait and come as the first ones die down.
(function (NB) {
  'use strict';
  const H = 62, GRAB = 9, MAXC = 10, MAXP = 16, MAXT = 4;   // the funnel's height, the radius it sucks things in, cars / people one carries at once, twisters at once

  NB.createTornado = function (world, o) {
    // o: scene, vehicles, crowd, audio, player, flash(text, sec), shake(v), heroDamage(v), indoors(), view()
    const col = world.col, scene = o.scene, U = NB.U;
    // the top of whatever is at (x, z): the street, a roof
    const topAt = (x, z) => Math.max(0, 120 - col.raycast(x, 120, z, 0, -1, 0, 120));
    function groundAt(x, z) {
      let f = 0;
      for (const b of col.query(x - .3, z - .3, x + .3, z + .3, [])) if (b.maxY <= 1.6 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > f) f = b.maxY;
      return f;
    }

    /* ---------- the funnel (shared textures; each twister has its own meshes) ---------- */
    const streakTex = U.canvasTex(128, 256, (g) => {
      g.fillStyle = 'rgba(120,112,100,.55)'; g.fillRect(0, 0, 128, 256);
      for (let i = 0; i < 90; i++) {   // streaks of dust running round and up
        const x = Math.random() * 128, w = 2 + Math.random() * 10, a = .15 + Math.random() * .5, c = Math.random() < .5 ? '60,55,50' : '190,182,170';
        g.fillStyle = 'rgba(' + c + ',' + a + ')'; g.fillRect(x, 0, w, 256); g.fillRect(x - 128, 0, w, 256);
      }
      const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.12, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.25)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 256);
    }, false);
    streakTex.wrapS = streakTex.wrapT = THREE.RepeatWrapping; streakTex.repeat.set(3, 1);
    const pts = [];
    for (let i = 0; i <= 24; i++) { const k = i / 24, y = k * H; pts.push(new THREE.Vector2(1.6 + Math.pow(k, 1.7) * 30 + Math.sin(k * 9) * .6, y)); }
    const funGeo = new THREE.LatheGeometry(pts, 40, 0, Math.PI * 2);
    const funMat = new THREE.MeshBasicMaterial({ map: streakTex, transparent: true, opacity: .78, side: THREE.DoubleSide, depthWrite: false, color: 0x9a948a });
    const tex2 = streakTex.clone(); tex2.needsUpdate = true; tex2.repeat.set(5, 1);
    const innerMat = new THREE.MeshBasicMaterial({ map: tex2, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false, color: 0x5e5850 });
    // the storm cloud it hangs from
    const cloudTex = U.canvasTex(128, 128, (g, s) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(40,40,46,.95)'); gr.addColorStop(.6, 'rgba(55,56,62,.7)'); gr.addColorStop(1, 'rgba(70,72,80,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }, false);
    const cloudGeo = new THREE.CircleGeometry(95, 32).rotateX(Math.PI / 2), cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const junkGeo = new THREE.BoxGeometry(.5, .08, .7), junkMats = [0x6b5a44, 0x8a8f96, 0x3d3a36, 0xb5a27a, 0x5d6b52].map(c => new THREE.MeshLambertMaterial({ color: c }));
    // a set of meshes for one twister, made once and used again by the next one
    const kits = [];
    function kit() {
      const free = kits.find(k => !k.used); if (free) { free.used = true; return free; }
      const funnel = new THREE.Group(), outer = new THREE.Mesh(funGeo, funMat), inner = new THREE.Mesh(funGeo, innerMat);
      inner.scale.set(.72, 1, .72); funnel.add(outer, inner);
      const cloud = new THREE.Mesh(cloudGeo, cloudMat); cloud.position.y = H + 2; funnel.add(cloud);
      funnel.traverse(m => { m.frustumCulled = false; }); funnel.visible = false; scene.add(funnel);
      const junk = [];
      for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(junkGeo, junkMats[i % junkMats.length]); m.visible = false; scene.add(m); junk.push({ m, a: Math.random() * 6.3, r: 3 + Math.random() * 14, y: Math.random() * 40, w: 1.5 + Math.random() * 2, rs: Math.random() * 6 }); }
      const k = { funnel, junk, used: true }; kits.push(k); return k;
    }

    // dust round their feet (one pool for all of them)
    const dustTex = U.canvasTex(64, 64, (g, s) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(150,138,118,.8)'); gr.addColorStop(.6, 'rgba(130,120,104,.35)'); gr.addColorStop(1, 'rgba(120,110,96,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, false);
    const dust = [];
    for (let i = 0; i < 120; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false })); sp.visible = false; scene.add(sp); dust.push({ s: sp, T: null, life: 0, max: 1, a: 0, r: 0, y: 0, vy: 0, size: 1 }); }
    let dustHead = 0;

    /* ---------- sound: the howl (one, as loud as the nearest twister) ---------- */
    let wind = null;
    function windStart() {
      const ac = o.audio.ctx && o.audio.ctx(), buf = o.audio.noiseBuf && o.audio.noiseBuf(); if (!ac || !buf || wind) return;
      const s = ac.createBufferSource(), bp = ac.createBiquadFilter(), lp = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      s.buffer = buf; s.loop = true; bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = .7; lp.type = 'lowpass'; lp.frequency.value = 900;
      lfo.frequency.value = .35; lg.gain.value = 160; lfo.connect(lg); lg.connect(bp.frequency);
      s.connect(bp); bp.connect(lp); lp.connect(g); g.connect(o.audio.bus()); g.gain.value = 0;
      s.start(); lfo.start();
      wind = { g, lp, stop() { const t = ac.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 2); s.stop(t + 2.1); lfo.stop(t + 2.1); } };
    }

    const list = [];    // the twisters going on: { t, dur, x, z, vx, vz, goal, goalT, carried: [], grow, kit }
    const waiting = []; // nicks of the ones still to come

    function newGoal(T, player) {
      // somewhere round the hero; every third time straight at him
      const a = Math.random() * Math.PI * 2, d = Math.random() < .33 ? Math.random() * 6 : 18 + Math.random() * 40;
      T.goal = [player.x + Math.sin(a) * d, player.z + Math.cos(a) * d]; T.goalT = 9 + Math.random() * 8;
    }
    function grab(T, kind, ob) {
      const dx = ob.x - T.x, dz = ob.z - T.z;
      T.carried.push({ kind, o: ob, a: Math.atan2(dx, dz), r: Math.max(2, Math.hypot(dx, dz)), y: ob.y, top: 16 + Math.random() * 18, hold: 1.5 + Math.random() * 3, phase: 'up', vx: 0, vy: 0, vz: 0, spin: (Math.random() - .5) * 10, tilt: 0 });
    }
    const caught = ob => list.some(T => T.carried.some(k => k.o === ob));
    function fling(T, k) {
      const w = 2.6, tx = Math.cos(k.a), tz = -Math.sin(k.a), ox = Math.sin(k.a), oz = Math.cos(k.a);   // tangent and outward directions
      const v = w * k.r + 4;
      k.vx = tx * v + ox * (8 + Math.random() * 6) + T.vx; k.vz = tz * v + oz * (8 + Math.random() * 6) + T.vz; k.vy = 3 + Math.random() * 5;
      k.phase = 'fly';
    }
    function land(T, k, x, y, z) {
      const ob = k.o;
      if (k.kind === 'p') {
        ob.x = x; ob.y = y; ob.z = z; ob.fallT = .79;
        if (!ob.dead) o.crowd.damage(ob, 9999, { byPlayer: false, kind: 'car', x: T.x, z: T.z });   // nobody survives that fall
      } else if (k.kind === 'c') {
        ob.x = x; ob.y = y; ob.z = z; ob.vx = ob.vz = 0; ob.hop = .5;
        ob.body.rotation.x = 0; ob.body.rotation.z = 0; ob.root.position.set(x, y, z);
        ob.damage = Math.max(ob.damage, 199) + 260; ob.blame = false;   // it burns, then blows up
        o.vehicles.blast(x, y, z, false);
        if (ob === o.vehicles.driving) o.heroDamage(35);
      } else {
        const p = o.player;
        p.x = x; p.y = y; p.z = z; p.vy = 0; p.vx = p.vz = 0; p.onGround = true; p.fallTop = y; p.air = 0;
        o.heroDamage(30); o.shake(.9);
      }
    }
    function carry(T, dt) {
      const p = o.player;
      for (let i = T.carried.length - 1; i >= 0; i--) {
        const k = T.carried[i], ob = k.o;
        if (k.kind === 'c' && !o.vehicles.cars.includes(ob)) { T.carried.splice(i, 1); continue; }
        if (k.kind === 'p' && !o.crowd.people.includes(ob)) { T.carried.splice(i, 1); continue; }
        if (k.kind === 'hero' && (p.dead || o.indoors())) { T.carried.splice(i, 1); continue; }
        let x, y, z;
        if (k.phase !== 'fly') {
          // round and round, drawn in towards the middle and up
          k.a += (2.6 + 6 / Math.max(2, k.r)) * dt;
          k.r = U.damp(k.r, 3 + (k.y / H) * 14, 1.2, dt);
          if (k.phase === 'up') { k.y += (7 + Math.random() * 2) * dt; if (k.y >= k.top) k.phase = 'hold'; }
          else if ((k.hold -= dt) <= 0) fling(T, k);
          x = T.x + Math.sin(k.a) * k.r; z = T.z + Math.cos(k.a) * k.r; y = k.y;
        } else {
          k.vy -= 20 * dt;
          x = ob.x + k.vx * dt; y = ob.y + k.vy * dt; z = ob.z + k.vz * dt;
          const top = topAt(x, z);
          if (y <= top) { T.carried.splice(i, 1); land(T, k, x, top, z); continue; }
        }
        k.tilt += k.spin * dt;
        if (k.kind === 'p') { ob.x = x; ob.y = y; ob.z = z; ob.heading += dt * 6; ob.fallT = .45; ob.deadT = 0; }
        else if (k.kind === 'c') {
          ob.x = x; ob.y = y; ob.z = z; ob.vx = ob.vz = 0; ob.h += dt * 2.5;
          ob.root.position.set(x, y, z); ob.root.rotation.y = ob.h; ob.body.rotation.z = k.tilt; ob.body.rotation.x = Math.sin(k.tilt * .7) * .8;
        } else { p.x = x; p.y = y; p.z = z; p.vy = 0; p.vx = p.vz = 0; p.onGround = false; p.fallTop = y; }
      }
    }
    function emitDust(T) {
      for (let n = 0; n < 3; n++) {
        const d = dust[dustHead]; dustHead = (dustHead + 1) % dust.length;
        d.T = T; d.a = Math.random() * 6.3; d.r = 3 + Math.random() * 9; d.y = groundAt(T.x, T.z) + Math.random() * 2; d.vy = 2 + Math.random() * 5;
        d.life = d.max = 1.6 + Math.random() * 1.4; d.size = 4 + Math.random() * 5; d.s.visible = true;
      }
    }

    // a new twister, out in front of the hero (the next ones a little to the side, so they don't stand in one spot)
    function begin(nick) {
      const p = o.player, v = o.view(), side = list.length ? (list.length % 2 ? 1 : -1) * (25 + list.length * 12) : 0;
      const x = p.x + v[0] * 70 + v[1] * side, z = p.z + v[1] * 70 - v[0] * side;
      const T = { t: 0, dur: 300, nick, x, z, vx: 0, vz: 0, goal: null, goalT: 0, carried: [], grow: 0, kit: kit() };
      T.goal = [p.x + v[0] * 25 + v[1] * side * .4, p.z + v[1] * 25 - v[0] * side * .4]; T.goalT = 9 + Math.random() * 8;
      T.kit.funnel.visible = true; T.kit.funnel.scale.set(.05, 1, .05);
      list.push(T);
      windStart();
    }

    return {
      get busy() { return false; },   // never holds the other events up
      get count() { return list.length + waiting.length; },
      get state() { return list[0] || null; },   // for the automatic test of the draft
      start(nick, n) {
        if (o.indoors()) { o.flash('Торнадо идёт по улицам — выйдите из помещения', 2.5); return false; }
        n = Math.max(1, Math.min(50, n | 0 || 1)); nick = nick || '';
        for (let i = 0; i < n; i++) { if (list.length < MAXT) begin(nick); else waiting.push(nick); }
        o.flash('🌪 ' + (nick ? '@' + nick + ' вызвал ' : '') + (n > 1 ? n + ' ТОРНАДО' : 'ТОРНАДО') + '! Затягивает машины и людей — прячься в здании!', 5);
        return true;
      },
      update(dt, player) {
        for (const d of dust) {
          if (!d.s.visible) continue;
          d.life -= dt; if (d.life <= 0 || !list.includes(d.T)) { d.s.visible = false; continue; }
          d.a += 3 * dt; d.y += d.vy * dt; d.r += dt * 1.5;
          d.s.position.set(d.T.x + Math.sin(d.a) * d.r, d.y, d.T.z + Math.cos(d.a) * d.r);
          const k = d.life / d.max; d.s.material.opacity = Math.min(1, k * 1.5) * .7; d.s.scale.set(d.size, d.size, 1);
        }
        if (!list.length) return;
        streakTex.offset.x -= dt * .9; tex2.offset.x -= dt * 1.5; streakTex.offset.y -= dt * .2;
        let loud = 0;
        for (let ti = list.length - 1; ti >= 0; ti--) {
          const T = list[ti], K = T.kit;
          T.t += dt;
          const ending = T.t >= T.dur;
          // grows out of the cloud at the start, shrinks back into it at the end
          T.grow = U.clamp(ending ? T.grow - dt / 4 : T.grow + dt / 3, 0, 1);
          const sc = .05 + T.grow * .95;
          // it wanders: towards a point round the hero, a new one every so often
          if ((T.goalT -= dt) <= 0 || Math.hypot(T.goal[0] - T.x, T.goal[1] - T.z) < 4) newGoal(T, player);
          const gx = T.goal[0] - T.x, gz = T.goal[1] - T.z, gd = Math.hypot(gx, gz) || 1, sp = Math.min(7.5, gd);
          T.vx = U.damp(T.vx, gx / gd * sp, .8, dt); T.vz = U.damp(T.vz, gz / gd * sp, .8, dt);
          T.x += T.vx * dt; T.z += T.vz * dt;
          const gy = groundAt(T.x, T.z);
          K.funnel.position.set(T.x, gy, T.z); K.funnel.scale.set(sc, .3 + T.grow * .7, sc);
          K.funnel.rotation.z = Math.sin(T.t * .4) * .06 + T.vx * .006; K.funnel.rotation.x = Math.cos(T.t * .33) * .06 - T.vz * .006;
          // junk round its foot
          for (const j of K.junk) {
            j.a += j.w * dt; j.y += dt * 3; if (j.y > 45) j.y = 0;
            const r = j.r * (.6 + j.y / 45);
            j.m.position.set(T.x + Math.sin(j.a) * r, gy + j.y, T.z + Math.cos(j.a) * r); j.m.rotation.x += j.rs * dt; j.m.rotation.y += j.rs * .7 * dt;
            j.m.visible = T.grow > .3;
          }
          if (T.grow > .3) emitDust(T);
          const dh = Math.hypot(player.x - T.x, player.z - T.z);
          loud = Math.max(loud, U.clamp(1 - dh / 220, 0, 1) * T.grow);
          if (dh < 45) o.shake(dt * 1.6 * (1 - dh / 45) * T.grow);
          // what it sucks in
          if (!ending && T.grow > .6) {
            let nc = T.carried.filter(k => k.kind === 'c').length, np = T.carried.filter(k => k.kind === 'p').length;
            for (const c of o.vehicles.cars) {
              if (nc >= MAXC) break;
              if (c.model.heli && c.y > 3 || c.model.boat || c.model.id === 'tank' || caught(c)) continue;
              if (Math.hypot(c.x - T.x, c.z - T.z) < GRAB && c.y < gy + 4) {
                const mine = c === o.vehicles.driving;
                o.vehicles.wash(c, !mine); grab(T, 'c', c); nc++;
                if (mine) o.flash('🌪 Торнадо подхватил вашу машину!', 2.5);
              }
            }
            for (const p of o.crowd.people) {
              if (np >= MAXP) break;
              if (p.mirror || p.dead || caught(p) || p.y > gy + 4) continue;
              if (Math.hypot(p.x - T.x, p.z - T.z) < GRAB) {
                if (!p.down) o.crowd.damage(p, 999, { byPlayer: false, kind: 'melee', x: T.x, z: T.z });   // off their feet
                p.keep = true; grab(T, 'p', p); np++;
              }
            }
            if (dh < GRAB * .8 && !player.dead && !o.vehicles.driving && !o.indoors() && !caught(player) && player.y < gy + 4) {
              grab(T, 'hero', player); o.heroDamage(10); o.flash('🌪 Вас затянуло в торнадо!', 2.5);
            }
            // people round about run from it
            if (Math.random() < dt * 2) o.crowd.panic(T.x, T.z, 45, false);
          }
          carry(T, dt);
          if (ending && T.grow <= 0) {
            for (const k of T.carried) if (k.phase !== 'fly') fling(T, k);
            if (!T.carried.length) {
              K.funnel.visible = false; for (const j of K.junk) j.m.visible = false; K.used = false;
              list.splice(ti, 1);
              if (waiting.length && !o.indoors()) begin(waiting.shift());
              else if (!list.length && !waiting.length) o.flash('🌪 Торнадо закончился', 3);
            }
          }
        }
        // the ones still waiting come when there's room (and the hero is out on the street)
        while (waiting.length && list.length < MAXT && !o.indoors()) begin(waiting.shift());
        if (wind) {
          if (!list.length) { wind.stop(); wind = null; }
          else { wind.g.gain.value = .05 + .55 * loud * loud; wind.lp.frequency.value = 500 + 1500 * loud; }
        }
      }
    };
  };
})(window.NB);
