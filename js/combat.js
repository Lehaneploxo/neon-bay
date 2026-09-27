// Weapons, punches, bullets, police gunfire, pickups and the visual effects of a fight.
(function (NB) {
  'use strict';
  const { U } = NB;
  const rand = U.rand;

  const WEAPONS = {
    fists: { id: 'fists', name: 'Кулаки', melee: true, rate: .42, dmg: 18, reach: 1.6 },
    bat: { id: 'bat', name: 'Бита', melee: true, rate: .6, dmg: 34, reach: 2.0 },
    pistol: { id: 'pistol', name: 'Пистолет', rate: .28, dmg: 34, spread: .012, pellets: 1, auto: false, range: 70, give: 36 },
    smg: { id: 'smg', name: 'Узи', rate: .085, dmg: 16, spread: .032, pellets: 1, auto: true, range: 55, give: 90 },
    shotgun: { id: 'shotgun', name: 'Дробовик', rate: .85, dmg: 12, spread: .07, pellets: 7, auto: false, range: 30, give: 16 },
    rifle: { id: 'rifle', name: 'Винтовка', rate: .11, dmg: 27, spread: .014, pellets: 1, auto: true, range: 85, give: 60 }
  };
  const ORDER = ['fists', 'bat', 'pistol', 'smg', 'shotgun', 'rifle'];
  NB.WEAPON_ORDER = ORDER;
  NB.WEAPONS = WEAPONS;

  NB.createCombat = function (scene, world, o) {
    const { crowd, vehicles, player, audio } = o;
    const col = world.col;
    const inv = { fists: 1, bat: 0, pistol: 0, smg: 0, shotgun: 0, rifle: 0 };
    let cur = 'fists', cd = 0, lastFire = false, range = false;   // range: free ammo while a shooting-range round runs
    const V = new THREE.Vector3();

    /* ---------- effects ---------- */
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1), tracers = [];
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false; m.life = 0; scene.add(m); tracers.push(m);
    }
    let tHead = 0;
    function tracer(ax, ay, az, bx, by, bz) {
      const L = Math.hypot(bx - ax, by - ay, bz - az); if (L < .8) return;
      const m = tracers[tHead]; tHead = (tHead + 1) % tracers.length;
      m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); V.set(bx, by, bz); m.lookAt(V);
      m.scale.set(.02, .02, L); m.visible = true; m.life = .06; m.material.opacity = .9;
    }
    const PN = 400, pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN);
    for (let i = 0; i < PN; i++) pPos[i * 3 + 1] = -999;
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: .09, vertexColors: true, sizeAttenuation: true }));
    pts.frustumCulled = false; scene.add(pts);
    let pHead = 0;
    function burst(x, y, z, n, c, spd) {
      for (let k = 0; k < n; k++) {
        const i = pHead; pHead = (pHead + 1) % PN;
        pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
        pVel[i * 3] = rand(-1, 1) * spd; pVel[i * 3 + 1] = rand(.2, 1.2) * spd; pVel[i * 3 + 2] = rand(-1, 1) * spd;
        const v = rand(.8, 1.1); pCol[i * 3] = c[0] * v; pCol[i * 3 + 1] = c[1] * v; pCol[i * 3 + 2] = c[2] * v; pLife[i] = rand(.3, .7);
      }
      pGeo.attributes.color.needsUpdate = true;
    }
    const BLOOD = [.6, .04, .04], DUST = [.75, .66, .5], SPARK = [1, .85, .5];
    const poolMat = new THREE.MeshBasicMaterial({ color: 0x5a0808, transparent: true, opacity: .85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const pools = [];
    for (let i = 0; i < 16; i++) { const m = new THREE.Mesh(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), poolMat); m.visible = false; scene.add(m); pools.push(m); }
    let poolHead = 0;
    function bloodPool(x, y, z) {
      const m = pools[poolHead]; poolHead = (poolHead + 1) % pools.length;
      m.position.set(x, y + .03, z); m.scale.setScalar(.05); m.grow = rand(.7, 1.1); m.visible = true;
    }
    const flashTex = U.canvasTex(64, 64, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(.35, 'rgba(255,200,90,.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    }, false);
    const flashes = [];
    for (let i = 0; i < 6; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.visible = false; s.life = 0; scene.add(s); flashes.push(s); }
    let fHead = 0;
    function muzzleFlash(x, y, z, size) { const s = flashes[fHead]; fHead = (fHead + 1) % flashes.length; s.position.set(x, y, z); s.scale.setScalar(size); s.visible = true; s.life = .05; }

    /* ---------- pickups ---------- */
    const PICK_COL = { pistol: 0xffd84f, smg: 0x3fe6e0, shotgun: 0xff8a3d, rifle: 0xc28bff, bat: 0xe8c89a, health: 0xff4f6a, cash: 0x6bff8a };
    const beamGeo = new THREE.CylinderGeometry(.35, .35, 2.6, 12, 1, true);
    const pickups = [];
    function makePickupMesh(type) {
      const g = new THREE.Group(), c = PICK_COL[type];
      const icon = new THREE.Group(); icon.position.y = .9; g.add(icon);
      const mat = new THREE.MeshBasicMaterial({ color: c });
      const box = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); icon.add(m); };
      if (type === 'health') { box(.5, .16, .16, 0, 0, 0); box(.16, .5, .16, 0, 0, 0); }
      else if (type === 'pistol') { box(.08, .14, .34, 0, .05, 0); box(.07, .2, .09, 0, -.1, -.1); }
      else if (type === 'smg') { box(.09, .16, .44, 0, .05, 0); box(.07, .26, .08, 0, -.14, .02); }
      else if (type === 'rifle') { box(.07, .12, .95, 0, .05, 0); box(.07, .22, .08, 0, -.12, .12); box(.08, .16, .28, 0, -.02, -.56); }
      else if (type === 'bat') { box(.08, .08, .5, 0, 0, .15); box(.12, .12, .42, 0, 0, -.28); }
      else if (type === 'cash') { box(.36, .1, .2, 0, -.2, 0); box(.36, .1, .2, .04, -.08, .02); box(.1, .02, .21, 0, -.02, .02); }
      else { box(.07, .09, .9, 0, .05, 0); box(.08, .14, .3, 0, 0, -.5); }
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 1.3; g.add(beam);
      g.icon = icon; scene.add(g); return g;
    }
    const groundY = (x, z) => world.col.query(x - .1, z - .1, x + .1, z + .1, []).reduce((m, b) => (b.maxY < .5 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ ? Math.max(m, b.maxY) : m), 0);
    for (const [type, x, z] of [['pistol', 108.6, -12], ['pistol', -7.6, 25], ['pistol', 92.4, 30], ['smg', 25, -25], ['smg', -57.6, 30], ['shotgun', -65, 36], ['shotgun', 57.6, -70],
      ['bat', -75, 16.6], ['rifle', 25, -75],
      ['health', 108.6, 40], ['health', 7.6, -30], ['health', -57.6, -25], ['health', 42.4, 84]]) {
      const y = groundY(x, z);
      const mesh = makePickupMesh(type); mesh.position.set(x, y, z);
      pickups.push({ type, x, y, z, mesh, active: true, t: 0 });
    }
    // money dropped by people the hero knocks out: a small pool of banknote stacks that vanish after a while
    const cashDrops = [];
    for (let i = 0; i < 12; i++) { const mesh = makePickupMesh('cash'); mesh.visible = false; cashDrops.push({ type: 'cash', mesh, active: false, t: 0, amount: 0, x: 0, z: 0 }); }
    let cashHead = 0;
    function dropCash(x, z, amount) {
      const c = cashDrops[cashHead]; cashHead = (cashHead + 1) % cashDrops.length;
      c.x = x + rand(-.4, .4); c.z = z + rand(-.4, .4); c.amount = amount; c.active = true; c.t = 40;
      c.mesh.position.set(c.x, groundY(c.x, c.z), c.z); c.mesh.visible = true;
    }

    /* ---------- tracing ---------- */
    function trace(ox, oy, oz, dx, dy, dz, maxT, skip, withPlayer) {
      let t = col.raycast(ox, oy, oz, dx, dy, dz, maxT), kind = t < maxT ? 'world' : 'none', hit = null, head = false;
      if (dy < -1e-4) { const tg = -oy / dy; if (tg < t) { t = tg; kind = 'world'; } }
      const ph = crowd.hitTest(ox, oy, oz, dx, dy, dz, t, skip);
      if (ph) { t = ph.t; kind = 'person'; hit = ph.p; head = ph.head; }
      const ch = vehicles.hitTest(ox, oy, oz, dx, dy, dz, t);
      if (ch) { t = ch.t; kind = 'car'; hit = ch.car; }
      const tg = o.targets && o.targets();   // pop-up targets in the shooting range
      if (tg) { const h = tg.hitTest(ox, oy, oz, dx, dy, dz, t); if (h) { t = h.t; kind = 'target'; hit = h; } }
      if (withPlayer && !player.inCar && !player.dead) {
        const fx = ox - player.x, fz = oz - player.z, a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - .12;
        const disc = b * b - 4 * a * c;
        if (a > 1e-8 && disc >= 0) { const tp = (-b - Math.sqrt(disc)) / (2 * a), y = oy + dy * tp; if (tp > 0 && tp < t && y > player.y && y < player.y + 1.85) { t = tp; kind = 'player'; hit = player; } }
      }
      return { t, kind, hit, head, x: ox + dx * t, y: oy + dy * t, z: oz + dz * t };
    }

    /* ---------- the hero's attacks ---------- */
    function heroShoot(aim) {
      const w = WEAPONS[cur], m = player.muzzle(V);
      const ox = m.x, oy = m.y, oz = m.z;
      for (let k = 0; k < w.pellets; k++) {
        let dx = aim.x - ox, dy = aim.y - oy, dz = aim.z - oz; const L = Math.hypot(dx, dy, dz) || 1;
        dx = dx / L + rand(-1, 1) * w.spread; dy = dy / L + rand(-1, 1) * w.spread; dz = dz / L + rand(-1, 1) * w.spread;
        const n = Math.hypot(dx, dy, dz); dx /= n; dy /= n; dz /= n;
        const r = trace(ox, oy, oz, dx, dy, dz, w.range, null, false);
        if (r.kind === 'person') {
          crowd.damage(r.hit, w.dmg * (r.head ? 2.5 : 1), { byPlayer: true, kind: 'gun', x: player.x, z: player.z });
          burst(r.x, r.y, r.z, r.head ? 10 : 6, BLOOD, 2);
        } else if (r.kind === 'car') { vehicles.bulletHit(r.hit, w.dmg, r.x, r.z, -dx, -dz); burst(r.x, r.y, r.z, 4, SPARK, 3); }
        else if (r.kind === 'target') { o.targets().onHit(r.hit); burst(r.x, r.y, r.z, 5, DUST, 1.5); }
        else if (r.kind === 'world') burst(r.x, r.y, r.z, 4, DUST, 2);
        if (k === 0 || Math.random() < .4) tracer(ox, oy, oz, r.x, r.y, r.z);
      }
      muzzleFlash(ox, oy, oz, cur === 'shotgun' ? .7 : .45);
      audio.shot(cur, null);
      if (o.quiet && o.quiet()) return;   // the shooting range: nobody panics, nobody calls the police
      o.police.reportCrime('shoot', player.x, player.z);
      crowd.panic(player.x, player.z, 40, true);
    }
    function punch() {
      const w = WEAPONS[cur];
      player.punch();
      const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
      let best = null, bd = w.reach;
      for (const p of crowd.people) {
        if (p.dead || p.down || p.anim === 'lie') continue;
        const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz);
        if (d < bd && (dx * fx + dz * fz) / (d || 1) > .25) { bd = d; best = p; }
      }
      if (!best) return;
      player.heading = Math.atan2(best.x - player.x, best.z - player.z);
      crowd.damage(best, w.dmg, { byPlayer: true, kind: 'melee', x: player.x, z: player.z });
      audio.punch([best.x, 1.5, best.z], cur === 'bat'); burst(best.x, best.y + 1.5, best.z, cur === 'bat' ? 6 : 3, BLOOD, 1.2);
      if (!best.cop) o.police.reportCrime('punch', best.x, best.z);
    }

    /* ---------- police gunfire ---------- */
    function copShoot(p, wanted) {
      const hs = p.look.hs, fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      const ox = p.x + fx * .45 + Math.cos(p.heading) * .15, oy = p.y + 1.38 * hs, oz = p.z + fz * .45 - Math.sin(p.heading) * .15;
      const car = vehicles.driving;
      const tx = car ? car.x : player.x, ty = car ? car.y + .9 : player.y + 1.2, tz = car ? car.z : player.z;
      const spread = Math.max(.035, .12 - wanted * .016);
      let dx = tx - ox, dy = ty - oy, dz = tz - oz; const L = Math.hypot(dx, dy, dz) || 1;
      dx = dx / L + rand(-1, 1) * spread; dy = dy / L + rand(-1, 1) * spread * .6; dz = dz / L + rand(-1, 1) * spread;
      const n = Math.hypot(dx, dy, dz); dx /= n; dy /= n; dz /= n;
      const r = trace(ox, oy, oz, dx, dy, dz, 60, p, true);
      if (r.kind === 'player') { o.onPlayerHit(rand(6, 10) + wanted, p.x, p.z); burst(r.x, r.y, r.z, 5, BLOOD, 1.6); }
      else if (r.kind === 'car') {
        vehicles.bulletHit(r.hit, 12, r.x, r.z, -dx, -dz); burst(r.x, r.y, r.z, 4, SPARK, 3);
        if (r.hit === car && Math.random() < .35) o.onPlayerHit(rand(3, 6), p.x, p.z);
      } else if (r.kind === 'person') { crowd.damage(r.hit, 30, { byPlayer: false, kind: 'gun', x: p.x, z: p.z }); burst(r.x, r.y, r.z, 5, BLOOD, 1.6); }
      else if (r.kind === 'world') burst(r.x, r.y, r.z, 3, DUST, 2);
      tracer(ox, oy, oz, r.x, r.y, r.z);
      muzzleFlash(ox, oy, oz, .4);
      audio.shot('cop', [ox, oy, oz]);
      crowd.panic(p.x, p.z, 25);
    }

    function cycle(dir) {
      let i = ORDER.indexOf(cur);
      for (let k = 0; k < ORDER.length; k++) { i = (i + dir + ORDER.length) % ORDER.length; if (inv[ORDER[i]] > 0) { cur = ORDER[i]; break; } }
      player.setWeapon(cur);
    }

    return {
      get weapon() { return WEAPONS[cur]; },
      get ammo() { return WEAPONS[cur].melee ? null : range ? '∞' : inv[cur]; },
      isMelee: () => !!WEAPONS[cur].melee,
      cycle, copShoot, bloodPool, dropCash,
      select(i) { const id = ORDER[i]; if (id && inv[id] > 0) { cur = id; player.setWeapon(cur); } },
      pickups, cashDrops,
      inv,
      // a purchase: melee weapons are simply owned, guns come with a clip of ammo; picks the new weapon
      give(id, ammo) {
        if (WEAPONS[id].melee) inv[id] = 1; else inv[id] += ammo;
        cur = id; player.setWeapon(cur);
      },
      // shooting range: free ammo; takes out the best gun you own or lends a pistol (returns true if lent)
      startRange() {
        range = true;
        if (!WEAPONS[cur].melee) return false;
        const own = ORDER.filter(k => !WEAPONS[k].melee && inv[k] > 0);
        cur = own.length ? own[own.length - 1] : 'pistol'; player.setWeapon(cur);
        return !own.length;
      },
      endRange(lent) { range = false; if (lent && inv[cur] <= 0) { cur = 'fists'; player.setWeapon(cur); } },
      load(saved) {
        if (!saved) return;
        for (const k of ORDER) if (k !== 'fists' && saved[k] > 0) inv[k] = Math.floor(saved[k]);
      },
      // death costs half the ammo, an arrest costs every weapon
      onDeath() { for (const k of ORDER) if (!WEAPONS[k].melee) inv[k] = Math.floor(inv[k] / 2); if (!inv[cur]) { cur = 'fists'; player.setWeapon(cur); } },
      onBust() { for (const k of ORDER) if (k !== 'fists') inv[k] = 0; cur = 'fists'; player.setWeapon(cur); },
      update(dt, input, aim, driving) {
        cd -= dt;
        if (!driving && !player.dead && input.fire) {
          const w = WEAPONS[cur];
          if (w.melee) { if (cd <= 0) { cd = w.rate; punch(); } }
          else if (range || inv[cur] > 0) {
            if (cd <= 0 && (w.auto || !lastFire) && aim) { cd = w.rate; if (!range) inv[cur]--; heroShoot(aim); player.fired(); if (!inv[cur]) o.flash(w.name + ': патроны кончились', 1.6); }
          } else if (!lastFire) audio.dry();
        }
        lastFire = input.fire;
        // effects
        for (const m of tracers) if (m.visible) { m.life -= dt; m.material.opacity = Math.max(0, m.life / .06) * .9; if (m.life <= 0) m.visible = false; }
        for (const s of flashes) if (s.visible) { s.life -= dt; if (s.life <= 0) s.visible = false; }
        for (const m of pools) if (m.visible && m.scale.x < m.grow) m.scale.setScalar(Math.min(m.grow, m.scale.x + dt * .5));
        let any = false;
        for (let i = 0; i < PN; i++) {
          if (pLife[i] <= 0) continue; any = true;
          pLife[i] -= dt; pVel[i * 3 + 1] -= 9.8 * dt;
          pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
          if (pLife[i] <= 0 || pPos[i * 3 + 1] < 0) { pLife[i] = 0; pPos[i * 3 + 1] = -999; }
        }
        if (any) pGeo.attributes.position.needsUpdate = true;
        // pickups: spin, bob, collect, respawn
        const tt = performance.now() / 1000;
        for (const pk of pickups) {
          if (!pk.active) { pk.t -= dt; if (pk.t <= 0) { pk.active = true; pk.mesh.visible = true; } continue; }
          pk.mesh.icon.rotation.y = tt * 2; pk.mesh.icon.position.y = .9 + Math.sin(tt * 3 + pk.x) * .1;
          if (driving || player.dead || Math.hypot(pk.x - player.x, pk.z - player.z) > 1.3) continue;
          if (pk.type === 'health') {
            if (player.hp >= 100) continue;
            player.hp = Math.min(100, player.hp + 50); o.flash('Аптечка: +50 здоровья', 1.8);
          } else if (WEAPONS[pk.type].melee) {
            if (inv[pk.type] > 0) continue;
            inv[pk.type] = 1; if (cur === 'fists') { cur = pk.type; player.setWeapon(cur); }
            o.flash(WEAPONS[pk.type].name + ' подобрана' + (input.touch ? '' : ' · Q — сменить оружие'), 2.4);
          } else {
            const w = WEAPONS[pk.type]; inv[pk.type] += w.give;
            if (WEAPONS[cur].melee) { cur = pk.type; player.setWeapon(cur); }
            o.flash(w.name + ': +' + w.give + ' патронов' + (input.touch ? '' : ' · Q — сменить оружие'), 2.4);
          }
          audio.pickup(); pk.active = false; pk.mesh.visible = false; pk.t = 40;
        }
        for (const c of cashDrops) {
          if (!c.active) continue;
          c.t -= dt;
          c.mesh.icon.rotation.y = tt * 2.5; c.mesh.icon.position.y = .9 + Math.sin(tt * 3 + c.x) * .1;
          if (c.t <= 0) { c.active = false; c.mesh.visible = false; continue; }
          if (driving || player.dead || Math.hypot(c.x - player.x, c.z - player.z) > 1.3) continue;
          c.active = false; c.mesh.visible = false;
          if (o.onCash) o.onCash(c.amount);
        }
      }
    };
  };
})(window.NB);
