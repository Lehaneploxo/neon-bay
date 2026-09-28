// Animals: seagulls wheeling over the beach and the bay (and landing on the sand in groups), pigeons
// pecking in the park and on the plazas, dogs out for a walk on a lead (and a couple of strays on the
// beach), crabs scuttling along the waterline and a pod of dolphins jumping out in the bay.
// Like the crowd, every body part is one instance of a single unit-box InstancedMesh: one draw call.
// Animals get out of the way: birds take off when you come close, a car comes by or a gun goes off,
// crabs dig themselves in, dogs jump aside and bark. You can pet a dog and feed the pigeons.
(function (NB) {
  'use strict';
  const { U } = NB;
  const rand = U.rand, pick = a => a[(Math.random() * a.length) | 0], chance = p => Math.random() < p;

  // bird parts: body, head, beak, wing L, wing R, tail, legs
  const BIRD = {
    gull: { s: 1, cols: ['#f5f5f2', '#f7f7f4', '#ffb52e', '#c3c8d2', '#c3c8d2', '#6f737e', '#e8995a'], fly: 7.5, walk: .75, scare: 5.5, flapHz: 8 },
    pigeon: { s: .6, cols: ['#8c92a3', '#5f7486', '#3a3a3a', '#a4aab8', '#a4aab8', '#5e6373', '#d0705e'], fly: 6.5, walk: .5, scare: 3.4, flapHz: 15 }
  };
  const BIRD_PARTS = 7, DOG_PARTS = 12, CRAB_PARTS = 6, DOLPHIN_PARTS = 6;
  const DOG_LOOKS = [
    { s: .6, body: '#f5f0e6', head: '#f5f0e6', ear: '#c9a27a', leg: '#f5f0e6', name: 'терьер' },
    { s: .95, body: '#d9a45a', head: '#dcaa62', ear: '#b8843a', leg: '#d9a45a', name: 'ретривер' },
    { s: 1.05, body: '#1c1a1e', head: '#1c1a1e', ear: '#1c1a1e', leg: '#9a6a36', name: 'доберман' },
    { s: .8, body: '#7a4f33', head: '#7a4f33', ear: '#4a2e1c', leg: '#e8e0d4', name: 'дворняга' },
    { s: .75, body: '#ece6dc', head: '#ece6dc', ear: '#2a2a2a', leg: '#ece6dc', name: 'далматинец' },
    { s: .7, body: '#c98a4a', head: '#c98a4a', ear: '#c98a4a', leg: '#f5f0e6', name: 'корги', short: true }
  ];
  const DOG_NAMES = ['Рекс', 'Бади', 'Лаки', 'Бобик', 'Макс', 'Белла', 'Чарли', 'Луна', 'Джек', 'Тоби'];

  NB.createAnimals = function (scene, world, o) {
    const CAP = 560;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.castShadow = true;
    const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), TC = new THREE.Color();
    for (let i = 0; i < CAP; i++) { mesh.setMatrixAt(i, ZERO); mesh.setColorAt(i, TC.set(1, 1, 1)); }
    scene.add(mesh);
    let used = 0;
    const alloc = n => { const b = used; used += n; return b; };
    const colorize = (base, cols) => { cols.forEach((c, i) => mesh.setColorAt(base + i, TC.set(c))); mesh.instanceColor.needsUpdate = true; };
    const hideAll = (base, n) => { for (let k = 0; k < n; k++) mesh.setMatrixAt(base + k, ZERO); };
    const col = world.col, tmp = [];

    /* ---------- building a pose: root transform, then boxes hung off pivots ---------- */
    const M = new THREE.Matrix4(), A = new THREE.Matrix4(), B = new THREE.Matrix4(), E = new THREE.Euler(), SV = new THREE.Vector3();
    function root(x, y, z, yaw, pitch, roll, s) { E.set(pitch, yaw, roll, 'YXZ'); M.makeRotationFromEuler(E); M.setPosition(x, y, z); if (s !== 1) M.scale(SV.set(s, s, s)); }
    // a box of size (sx, sy, sz) centred at (cx, cy, cz) in the frame of a pivot at (px, py, pz) turned by (rx, ry, rz)
    function part(i, px, py, pz, rx, ry, rz, cx, cy, cz, sx, sy, sz) {
      E.set(rx, ry, rz, 'YXZ'); A.makeRotationFromEuler(E); A.setPosition(px, py, pz);
      B.makeScale(sx, sy, sz); B.setPosition(cx, cy, cz);
      A.multiply(B); B.multiplyMatrices(M, A); mesh.setMatrixAt(i, B);
    }
    function floorAt(x, z, fromY) {
      let f = NB.water.at(x, z) ? -9 : 0;
      for (const b of col.query(x - .3, z - .3, x + .3, z + .3, tmp)) {
        if (b.maxY > fromY + .45) continue;
        if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > f) f = b.maxY;
      }
      return Math.max(f, 0);
    }
    function blocked(x, z, y, r) {
      for (const b of col.query(x - r, z - r, x + r, z + r, tmp)) {
        if (b.maxY <= y + .45 || b.minY >= y + .8) continue;
        if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return true;
      }
      return false;
    }

    /* ---------- noise: gunshots and the like (the crowd tells us) ---------- */
    const noises = [];
    let clock = 0;

    /* ---------- birds ---------- */
    const birds = [];
    function bird(kind, home, anchor, soar) {
      const K = BIRD[kind], base = alloc(BIRD_PARTS); colorize(base, K.cols);
      const b = { kind, K, base, home, anchor, soar, x: home.x + rand(-home.r, home.r), z: home.z + rand(-home.r, home.r), y: 0, h: rand(0, 6.3), pitch: 0, roll: 0,
        state: soar ? 'circle' : 'ground', t: rand(0, 5), ang: rand(0, 6.3), dir: chance(.5) ? 1 : -1, flap: 0, flapT: 0, phase: rand(0, 6), gx: 0, gz: 0, walkT: rand(0, 3), peck: 0,
        cryT: rand(4, 20), hopT: 0, circleT: 0, alt: anchor.alt + rand(-2, 3), r: anchor.r * rand(.7, 1.2) };
      if (soar) { b.x = anchor.x + Math.sin(b.ang) * b.r; b.z = anchor.z + Math.cos(b.ang) * b.r; b.y = b.alt; }
      else { b.y = floorAt(b.x, b.z, 2) + .17 * K.s; b.gx = b.x; b.gz = b.z; }
      birds.push(b); return b;
    }
    // the gulls that never land: over the beach, the pier, the yacht, the bridge and the lighthouse
    for (const [x, z, r, alt, n] of [[128, -45, 26, 15, 2], [140, 30, 20, 18, 2], [200, 200, 14, 12, 2], [150, 46, 12, 10, 1], [228, -98, 30, 26, 1], [505, 28, 16, 22, 2]]) {
      for (let k = 0; k < n; k++) bird('gull', { x, z, r: 4 }, { x, z, r, alt }, true);
    }
    // gulls resting on the sand in little groups
    const gullGroups = [[124, -84, 5], [118, -2, 4], [127, 70, 4]].map(([x, z, r]) => ({ x, z, r }));
    for (const g of gullGroups) for (let k = 0; k < 4; k++) bird('gull', g, { x: g.x + 8, z: g.z, r: 14, alt: 11 }, false);
    // pigeons: the park fountain, the promenade, the plaza on Palm Island
    const flocks = [[-75, 25, 6.5, 8], [107.8, -26, 4, 7], [425, -30, 7, 7]].map(([x, z, r, n]) => ({ x, z, r, n, feedT: 0, fx: 0, fz: 0, birds: [] }));
    for (const f of flocks) for (let k = 0; k < f.n; k++) { const b = bird('pigeon', f, { x: f.x, z: f.z, r: 9, alt: 12 }, false); b.flock = f; f.birds.push(b); }

    function threatFor(b, P, dangers) {
      const K = b.K, hero = o.vehicles.driving;
      const dh = Math.hypot(P.x - b.x, P.z - b.z);
      if (hero) { if (dh < 11 && o.vehicles.speedKmh() > 6) return [P.x, P.z]; }
      else if (!P.dead) {
        const fed = b.flock && b.flock.feedT > 0 && P.speed < 2.2;
        if (!fed && (dh < K.scare || (P.speed > 3.2 && dh < K.scare * 1.8))) return [P.x, P.z];
      }
      for (const c of dangers) if (Math.abs(c.x - b.x) < 9 && Math.abs(c.z - b.z) < 9) return [c.x, c.z];
      for (const n of noises) if (Math.hypot(n.x - b.x, n.z - b.z) < n.r * 1.3) return [n.x, n.z];
      for (const d of dogs) if (d.active && d.speed > 2.5 && Math.hypot(d.x - b.x, d.z - b.z) < 3.5) return [d.x, d.z];
      return null;
    }
    function takeOff(b, from) {
      b.state = 'takeoff'; b.t = 0; b.flapT = 2.2;
      b.h = Math.atan2(b.x - from[0], b.z - from[1]) + rand(-.5, .5);
      if (Math.hypot(o.player.x - b.x, o.player.z - b.z) < 30) {
        if (b.kind === 'pigeon') { if (!b.flock.flutterT || clock - b.flock.flutterT > 1) { b.flock.flutterT = clock; o.audio.flutter([b.x, 1, b.z]); } }
        else if (chance(.5)) o.audio.gull([b.x, 2, b.z]);
      }
    }
    function flyTo(b, tx, ty, tz, sp, dt, turnK) {
      const dx = tx - b.x, dz = tz - b.z, want = Math.atan2(dx, dz), dh = U.angDiff(b.h, want), turn = U.clamp(dh * (turnK || 2), -2, 2);
      b.h += turn * dt; b.roll = U.damp(b.roll, -turn * .4, 4, dt);
      const vy = U.clamp((ty - b.y) * 1.3, -3.5, 4.5); b.y += vy * dt; b.pitch = U.damp(b.pitch, -vy * .12, 4, dt);
      b.x += Math.sin(b.h) * sp * dt; b.z += Math.cos(b.h) * sp * dt;
      return Math.hypot(dx, dz);
    }
    function groundPoint(b) {
      const f = b.flock, H = b.home;
      if (f && f.feedT > 0) { const a = rand(0, 6.3), r = rand(.6, 1.8); return [f.fx + Math.sin(a) * r, f.fz + Math.cos(a) * r]; }
      for (let k = 0; k < 6; k++) { const x = H.x + rand(-H.r, H.r), z = H.z + rand(-H.r, H.r); if (!blocked(x, z, floorAt(x, z, 2), .15)) return [x, z]; }
      return [H.x, H.z];
    }
    function birdUpdate(b, dt, P, dangers) {
      const K = b.K;
      b.t += dt; b.phase += dt * K.flapHz;
      switch (b.state) {
        case 'ground': {
          const thr = threatFor(b, P, dangers);
          if (thr) { takeOff(b, thr); break; }
          // a pigeon hops out of the way of people walking by
          if (b.kind === 'pigeon' && b.hopT <= 0) for (const p of o.crowd.people) {
            if (p.dead || Math.abs(p.x - b.x) > 1.3 || Math.abs(p.z - b.z) > 1.3) continue;
            if (p.running) { takeOff(b, [p.x, p.z]); break; }
            const a = Math.atan2(b.x - p.x, b.z - p.z); b.gx = b.x + Math.sin(a) * .9; b.gz = b.z + Math.cos(a) * .9; b.hopT = .5; b.walkT = 1.5; break;
          }
          if (b.state !== 'ground') break;
          if ((b.walkT -= dt) <= 0) { b.walkT = rand(1.5, 5); if (chance(.6)) [b.gx, b.gz] = groundPoint(b); }
          const dx = b.gx - b.x, dz = b.gz - b.z, d = Math.hypot(dx, dz);
          if (b.hopT > 0) b.hopT -= dt;
          if (d > .08) {
            const sp = b.hopT > 0 ? 2.2 : K.walk;
            b.h += U.angDiff(b.h, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
            const nx = b.x + dx / d * Math.min(d, sp * dt), nz = b.z + dz / d * Math.min(d, sp * dt);
            if (!blocked(nx, nz, b.y - .17 * K.s, .1)) { b.x = nx; b.z = nz; } else b.walkT = 0;
            b.peck = 0;
          } else b.peck = Math.max(0, Math.sin(b.t * 7 + b.phase * .1)) * (Math.sin(b.t * .9 + b.base) > .2 ? 1 : 0);
          b.y = floorAt(b.x, b.z, b.y) + .17 * K.s + (b.hopT > 0 ? Math.sin(b.hopT / .5 * Math.PI) * .12 : 0);
          b.pitch = U.damp(b.pitch, b.peck * .55, 12, dt); b.roll = 0;
          b.flap = b.hopT > 0 ? Math.sin(b.phase) * .8 : -1;
          if (b.kind === 'gull' && (b.cryT -= dt) <= 0) { b.cryT = rand(10, 30); if (Math.hypot(P.x - b.x, P.z - b.z) < 35) o.audio.gull([b.x, 1, b.z]); }
          break;
        }
        case 'takeoff': {
          b.y += dt * (4.5 - b.t * 1.5); b.x += Math.sin(b.h) * K.fly * .8 * dt; b.z += Math.cos(b.h) * K.fly * .8 * dt; b.pitch = U.damp(b.pitch, -.5, 6, dt);
          b.flap = Math.sin(b.phase) * 1.1;
          if (b.t > 1.3) { b.state = 'circle'; b.t = 0; b.circleT = rand(7, 15); b.ang = Math.atan2(b.x - b.anchor.x, b.z - b.anchor.z); }
          break;
        }
        case 'circle': {
          const A = b.anchor, sp = K.fly * (b.soar ? .85 : 1);
          b.ang += b.dir * sp / b.r * dt;
          const lead = b.ang + b.dir * .5, ty = b.alt + Math.sin(b.t * .4 + b.base) * 2;
          flyTo(b, A.x + Math.sin(lead) * b.r, ty, A.z + Math.cos(lead) * b.r, sp, dt, 1.6);
          if ((b.flapT -= dt) > 0) b.flap = Math.sin(b.phase) * .9; else { b.flap = U.damp(b.flap, .12, 3, dt); if (chance(dt * .25)) b.flapT = rand(.8, 1.8); }
          if (b.kind === 'gull' && (b.cryT -= dt) <= 0) { b.cryT = rand(8, 25); if (Math.hypot(P.x - b.x, P.z - b.z) < 60) o.audio.gull([b.x, b.y, b.z]); }
          if (!b.soar && (b.circleT -= dt) <= 0) { b.state = 'land'; b.t = 0; [b.gx, b.gz] = groundPoint(b); }
          break;
        }
        case 'land': {
          const gy = floorAt(b.gx, b.gz, 3) + .17 * b.K.s, d = Math.hypot(b.gx - b.x, b.gz - b.z);
          const sp = Math.max(1.2, Math.min(K.fly, d * 1.1));
          flyTo(b, b.gx, d > 4 ? gy + 2.5 : gy, b.gz, sp, dt, 3);
          b.flap = d < 3 ? Math.sin(b.phase * 1.4) * 1.1 : Math.sin(b.phase) * .7;
          // something scary still there: go round again
          if (d < 8 && threatFor(b, P, dangers)) { b.state = 'circle'; b.circleT = rand(5, 9); break; }
          if ((d < .35 && b.y - gy < .4) || b.t > 14) { b.state = 'ground'; b.y = gy; b.x = b.gx; b.z = b.gz; b.walkT = rand(1, 3); b.pitch = 0; b.roll = 0; }
          break;
        }
      }
    }
    function birdWrite(b) {
      const i = b.base, s = b.K.s, g = b.state === 'ground';
      root(b.x, b.y, b.z, b.h, b.pitch, b.roll, s);
      part(i, 0, 0, 0, 0, 0, 0, 0, 0, 0, .16, .14, .42);
      part(i + 1, 0, .06, .18, b.peck * .5, 0, 0, 0, .04, .06, .12, .12, .13);
      part(i + 2, 0, .06, .18, b.peck * .5, 0, 0, 0, .03, .15, .035, .035, .08);
      if (g) {   // wings folded along the back
        part(i + 3, -.07, .04, 0, 0, 0, 0, -.01, 0, -.04, .05, .1, .34);
        part(i + 4, .07, .04, 0, 0, 0, 0, .01, 0, -.04, .05, .1, .34);
        part(i + 6, 0, -.07, .02, 0, 0, 0, 0, -.05, 0, .07, .1, .03);
      } else {
        part(i + 3, -.07, .04, 0, 0, 0, -b.flap, -.3, 0, -.02, .6, .02, .22);
        part(i + 4, .07, .04, 0, 0, 0, b.flap, .3, 0, -.02, .6, .02, .22);
        mesh.setMatrixAt(i + 6, ZERO);
      }
      part(i + 5, 0, .02, -.2, g ? -.2 : 0, 0, 0, 0, 0, -.07, .12, .03, .15);
    }

    /* ---------- dogs ---------- */
    const dogs = [];
    for (let k = 0; k < 6; k++) dogs.push({ base: alloc(DOG_PARTS), active: false });
    const leashPos = new Float32Array(dogs.length * 4 * 3);
    const leashGeo = new THREE.BufferGeometry(); leashGeo.setAttribute('position', new THREE.BufferAttribute(leashPos, 3));
    const leash = new THREE.LineSegments(leashGeo, new THREE.LineBasicMaterial({ color: 0xe8202a })); leash.frustumCulled = false; scene.add(leash);
    function dogSpawn(d, x, z, owner) {
      const L = pick(DOG_LOOKS);
      Object.assign(d, { active: true, L, s: L.s * rand(.93, 1.07), x, z, y: floorAt(x, z, 1), h: owner ? owner.heading : rand(0, 6.3), speed: 0, phase: rand(0, 6), owner: owner || null,
        mode: owner ? 'leash' : 'stray', t: 0, gx: x, gz: z, wanderT: 0, barkT: rand(2, 6), wag: 0, sitT: 0, sniffT: 0, headYaw: 0, headPitch: 0, pose: 'stand',
        fleeT: 0, fx: 0, fz: 0, biteT: 0, name: pick(DOG_NAMES), tumble: 0, petT: 0, interestT: 0, prey: null, stray: !owner, beach: !owner, home: owner ? null : { x, z } });
      colorize(d.base, [L.body, L.head, L.head, '#141414', L.ear, L.ear, L.leg, L.leg, L.leg, L.leg, L.body, '#e8202a']);
      if (owner) owner.dog = d;
    }
    function dogDespawn(d) { d.active = false; hideAll(d.base, DOG_PARTS); if (d.owner && d.owner.dog === d) d.owner.dog = null; d.owner = null; }
    // the lead goes from the collar to the owner's right hand, sagging in the middle
    function leashWrite() {
      let n = 0;
      for (const d of dogs) {
        if (!d.active || d.mode !== 'leash' || !d.owner) continue;
        const p = d.owner, hs = p.look.hs, rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
        const hx = p.x + rx * .33, hy = p.y + .78 * hs, hz = p.z + rz * .33;
        const cx = d.x + Math.sin(d.h) * .3 * d.s, cy = d.y + .62 * d.s, cz = d.z + Math.cos(d.h) * .3 * d.s;
        const L = Math.hypot(hx - cx, hz - cz), mx = (hx + cx) / 2, mz = (hz + cz) / 2, my = (hy + cy) / 2 - Math.max(0, 1.6 - L) * .25;
        leashPos.set([cx, cy, cz, mx, my, mz, mx, my, mz, hx, hy, hz], n * 12); n++;
      }
      leashGeo.setDrawRange(0, n * 4); leashGeo.attributes.position.needsUpdate = true;
    }
    // walkers who might have a dog: not police, not at work, not already busy
    const canOwn = p => p.mode === 'graph' && !p.cop && !p.medic && !p.puppet && !p.spot && !p.fare && !p.dead && !p.down && !p.dog && p.fleeT <= 0 && p.fightT <= 0 &&
      ['tourist_m', 'tourist_f', 'elderly', 'business_f', 'jogger'].includes(p.look.type);
    let dogPopT = 1;
    function dogPopulate(P, lim) {
      const owned = dogs.filter(d => d.active && d.mode !== 'stray').length, strays = dogs.filter(d => d.active && d.beach).length;
      // a dog that lost its owner in town wanders off once the hero is well away
      for (const d of dogs) if (d.active && Math.hypot(d.x - P.x, d.z - P.z) > (d.stray && !d.beach ? 50 : 120)) dogDespawn(d);
      const free = dogs.find(d => !d.active);
      if (!free) return;
      if (owned < lim.dogs) {
        const cands = o.crowd.people.filter(p => canOwn(p) && Math.hypot(p.x - P.x, p.z - P.z) > 32 && Math.hypot(p.x - P.x, p.z - P.z) < 85);
        if (cands.length && chance(.5)) { const p = pick(cands); dogSpawn(free, p.x - Math.sin(p.heading) * .9, p.z - Math.cos(p.heading) * .9, p); return; }
      }
      // two dogs of no fixed abode on the beach
      if (strays < 2 && P.x > 70 && Math.abs(P.z) < 110) {
        const x = rand(113, 136), z = U.clamp(P.z + rand(-70, 70), -98, 98), dd = Math.hypot(x - P.x, z - P.z);
        if (dd > 30 && dd < 90 && !(world.reserved || []).some(r => x > r.x0 - 1 && x < r.x1 + 1 && z > r.z0 - 1 && z < r.z1 + 1)) dogSpawn(free, x, z, null);
      }
    }
    function bark(d, angry) { d.barkT = angry ? rand(.6, 1.1) : rand(3, 7); d.barking = .35; o.audio.bark([d.x, .6, d.z], d.s); }
    function dogUpdate(d, dt, P, dangers) {
      d.t += dt; d.barkT -= dt; if (d.barking > 0) d.barking -= dt; if (d.petT > 0) d.petT -= dt; if (d.tumble > 0) d.tumble -= dt;
      const hero = !o.vehicles.driving && !P.dead, dh = Math.hypot(P.x - d.x, P.z - d.z);
      let tx = d.x, tz = d.z, sp = 0, faceX = null, faceZ = null;
      // the owner: gone, down or dead leaves the dog on its own
      const w = d.owner;
      if (d.mode === 'leash' && (!w || w.dead || w.down || !o.crowd.people.includes(w) || w.puppet)) {
        if (w && w.dog === d) w.dog = null;
        d.owner = null; d.mode = 'stray'; d.stray = true; d.home = { x: d.x, z: d.z };
        if (w && (w.dead || w.down)) { d.sitT = 8; o.audio.whine([d.x, .5, d.z]); }
      }
      // scared: gunfire, a car coming straight at it
      for (const n of noises) if (Math.hypot(n.x - d.x, n.z - d.z) < n.r) { d.fleeT = rand(4, 6); d.fx = n.x; d.fz = n.z; if (chance(.5)) o.audio.yelp([d.x, .5, d.z]); }
      for (const c of dangers) {
        const cx = d.x - c.x, cz = d.z - c.z; if (Math.abs(cx) > 12 || Math.abs(cz) > 12) continue;
        const a = cx * c.fx + cz * c.fz, b = cx * -c.fz + cz * c.fx;
        if (a < -c.hl - .3 || a > c.hl + c.speed * .7 + 1 || Math.abs(b) > c.hw + .7) continue;
        const sd = b >= 0 ? 1 : -1;
        if (Math.abs(a) < c.hl + .2 && Math.abs(b) < c.hw + .3) {
          // too late: knocked over, yelps, runs off (no harm done)
          d.x += -c.fz * sd * (c.hw + .5 - Math.abs(b)); d.z += c.fx * sd * (c.hw + .5 - Math.abs(b));
          if (d.tumble <= 0) { d.tumble = .7; o.audio.yelp([d.x, .5, d.z]); d.fleeT = 3; d.fx = c.x; d.fz = c.z; }
        } else if (d.fleeT <= 0) { d.fleeT = .6; d.fx = c.x - c.fz * sd * 3; d.fz = c.z + c.fx * sd * 3; }
      }
      if (d.fleeT > 0) {
        d.fleeT -= dt;
        const a = Math.atan2(d.x - d.fx, d.z - d.fz); tx = d.x + Math.sin(a) * 4; tz = d.z + Math.cos(a) * 4; sp = 6.5;
        if (d.mode === 'leash' && Math.hypot(w.x - d.x, w.z - d.z) > 2.2) { tx = w.x; tz = w.z; }   // the lead holds it back
      } else if (d.mode === 'leash') {
        // at heel, a step behind and to the right; the owner in a fight means the dog goes for the hero
        if (w.fightT > 0 && hero && dh < 12) {
          tx = P.x; tz = P.z; sp = dh > .9 ? 5.5 : 0; faceX = P.x; faceZ = P.z;
          if (d.barkT <= 0) bark(d, true);
          if (dh < 1.1 && (d.biteT -= dt) <= 0) { d.biteT = rand(1, 1.6); o.onBite(3 + d.s * 3); o.audio.bark([d.x, .6, d.z], d.s * 1.2); }
        } else {
          const fx = Math.sin(w.heading), fz = Math.cos(w.heading), rx = Math.cos(w.heading), rz = -Math.sin(w.heading);
          tx = w.x - fx * .8 + rx * .55; tz = w.z - fz * .8 + rz * .55;
          const dd = Math.hypot(tx - d.x, tz - d.z), ws = w.speed || 0;
          sp = dd > .25 ? Math.min(7, ws + dd * 1.8) : 0;
          if (w.fleeT > 0) sp = Math.max(sp, 5);
          if (dd > 4) { d.x = tx; d.z = tz; }   // caught on something: the lead drags it along
          if (ws < .3) { d.sitT += dt; if (d.sitT > 3 && dd < .6) sp = 0; } else d.sitT = 0;
          if (hero && dh < 3 && P.speed > 3.5 && d.barkT <= 0) bark(d);
        }
      } else {
        // a stray: pads about, comes to sniff the hero, chases gulls, sits in the sun
        d.wanderT -= dt;
        const H = d.home || { x: d.x, z: d.z };
        const prey = d.prey && d.prey.state === 'ground' ? d.prey : null;
        if (d.sitT > 0) { d.sitT -= dt; sp = 0; }
        else if (prey) { tx = prey.x; tz = prey.z; sp = 6; if (d.barkT <= 0 && chance(.5)) bark(d); }
        else if (hero && dh < 7 && d.interestT < 9) {
          d.interestT += dt; tx = P.x; tz = P.z; faceX = P.x; faceZ = P.z;
          sp = dh > 1.2 ? Math.min(3, dh) : 0;
          if (P.speed > 3.5 && d.barkT <= 0 && dh < 5) bark(d);
        } else {
          if (dh > 12) d.interestT = 0;
          if (d.wanderT <= 0) {
            d.wanderT = rand(3, 8); d.prey = null;
            const r = chance(.25) ? 'sit' : chance(.35) ? 'gull' : 'walk';
            if (r === 'sit') d.sitT = rand(3, 7);
            else if (r === 'gull') { const g = birds.filter(b => b.kind === 'gull' && b.state === 'ground' && Math.hypot(b.x - d.x, b.z - d.z) < 22)[0]; if (g) d.prey = g; }
            else if (H.x > 108) { d.gx = U.clamp(H.x + rand(-12, 12), 111, 137); d.gz = U.clamp(H.z + rand(-15, 15), -100, 100); }
            else { d.gx = H.x + rand(-5, 5); d.gz = H.z + rand(-5, 5); }   // lost its owner in town: stays about where it was
          }
          tx = d.gx; tz = d.gz; sp = Math.hypot(tx - d.x, tz - d.z) > .4 ? 1.4 : 0;
        }
      }
      // move
      const dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz);
      if (d.tumble > 0) sp = 0;
      d.speed = U.damp(d.speed, dist > .05 ? sp : 0, 6, dt);
      if (d.speed > .05 && dist > .05) {
        d.h += U.angDiff(d.h, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
        const step = Math.min(dist, d.speed * dt), nx = d.x + Math.sin(d.h) * step, nz = d.z + Math.cos(d.h) * step;
        if (!blocked(nx, nz, d.y, .22)) { d.x = nx; d.z = nz; }
        else if (!blocked(nx, d.z, d.y, .22)) d.x = nx; else if (!blocked(d.x, nz, d.y, .22)) d.z = nz;
        else if (d.mode === 'stray') d.wanderT = 0;
        if (NB.water.at(d.x, d.z) && NB.water.floorAt(d.x, d.z) < -.3) { d.x -= Math.sin(d.h) * step; d.z -= Math.cos(d.h) * step; d.wanderT = 0; }   // no swimming
      } else if (faceX != null) d.h += U.angDiff(d.h, Math.atan2(faceX - d.x, faceZ - d.z)) * Math.min(1, dt * 5);
      d.y = floorAt(d.x, d.z, d.y);
      d.phase += dt * (3 + d.speed * 5.5) / Math.max(.6, d.s);
      // tail: wags when happy, down when scared
      const happy = d.petT > 0 || (d.mode === 'stray' && dh < 3 && hero) || d.speed < .2;
      d.wag = d.fleeT > 0 ? 0 : Math.sin(d.t * (d.petT > 0 ? 22 : 14)) * (happy ? .7 : .3);
      d.pose = d.tumble > 0 ? 'tumble' : d.speed < .15 && (d.sitT > 1.5 || d.petT > 0) ? 'sit' : 'stand';
      d.headPitch = d.speed < .2 && d.pose === 'stand' && !faceX ? Math.max(0, Math.sin(d.t * .8 + d.base)) * .6 : d.barking > 0 ? -.3 : 0;
    }
    function dogWrite(d) {
      const i = d.base, L = d.L, legLen = L.short ? .24 : .42, sit = d.pose === 'sit', tumble = d.pose === 'tumble';
      const bob = d.speed > .3 ? Math.abs(Math.sin(d.phase)) * .025 : 0;
      const pitch = sit ? -.5 : 0, lift = sit ? -.1 : 0, roll = tumble ? Math.sin((.7 - d.tumble) / .7 * Math.PI) * 2.2 : 0;
      root(d.x, d.y + (L.short ? -.18 : 0) * d.s + lift * d.s + bob, d.z, d.h, pitch, roll, d.s);
      const amp = Math.min(.7, d.speed * .28), s = Math.sin(d.phase) * amp, ly = .42;
      part(i, 0, 0, 0, 0, 0, 0, 0, .52, 0, .26, .24, .66);
      const hp = d.headPitch + (sit ? .45 : 0), hyw = 0;
      part(i + 1, 0, .64, .32, hp, hyw, 0, 0, .08, .06, .22, .2, .22);
      part(i + 2, 0, .64, .32, hp, hyw, 0, 0, .03, .22, .12, .1, .16);
      part(i + 3, 0, .64, .32, hp, hyw, 0, 0, .075, .305, .05, .04, .03);
      part(i + 4, 0, .64, .32, hp, hyw, 0, -.08, .21, .02, .06, .1 + (L.name === 'доберман' ? .06 : 0), .05);
      part(i + 5, 0, .64, .32, hp, hyw, 0, .08, .21, .02, .06, .1 + (L.name === 'доберман' ? .06 : 0), .05);
      // legs: diagonal pairs swing together; sitting, the hind legs fold under
      const fl = sit ? .5 : s, fr = sit ? .5 : -s, bl = sit ? -1.1 : -s, br = sit ? -1.1 : s, sc = legLen / .42;
      part(i + 6, -.09, ly, .24, fl, 0, 0, 0, -.2 * sc, 0, .08, .42 * sc, .08);
      part(i + 7, .09, ly, .24, fr, 0, 0, 0, -.2 * sc, 0, .08, .42 * sc, .08);
      part(i + 8, -.09, ly, -.24, bl, 0, 0, 0, -.2 * sc, 0, .08, .42 * sc, .08);
      part(i + 9, .09, ly, -.24, br, 0, 0, 0, -.2 * sc, 0, .08, .42 * sc, .08);
      part(i + 10, 0, .6, -.32, d.fleeT > 0 ? .6 : -.7, d.wag, 0, 0, 0, -.12, .05, .05, .26);
      part(i + 11, 0, .6, .29, 0, 0, 0, 0, 0, 0, .23, .06, .09);
    }

    /* ---------- crabs ---------- */
    const crabs = [];
    for (let k = 0; k < 8; k++) { const base = alloc(CRAB_PARTS); colorize(base, ['#e0452c', '#c8321c', '#c8321c', '#1a1a1a', '#d23c24', '#d23c24']); crabs.push({ base, active: false }); }
    const shoreOk = z => Math.abs(z) < 100 && !(z > 39 && z < 53) && !(z > -108 && z < -88);
    function crabSpawn(c, P) {
      for (let k = 0; k < 8; k++) {
        const z = U.clamp(P.z + rand(-45, 45), -99, 99), x = rand(136.8, 139.4);
        if (!shoreOk(z) || Math.hypot(x - P.x, z - P.z) < 18) continue;
        Object.assign(c, { active: true, x, z, h: rand(0, 6.3), state: 'idle', t: rand(0, 3), gx: x, gz: z, sink: 0, hideT: 0, leg: 0 }); return;
      }
    }
    function crabUpdate(c, dt, P) {
      c.t -= dt;
      const dh = Math.hypot(P.x - c.x, P.z - c.z), scared = !o.vehicles.driving ? dh < 3.2 : dh < 8;
      if (c.state === 'hide') {
        c.sink = Math.min(1, c.sink + dt * 2.5);
        if ((c.hideT -= dt) <= 0 && dh > 6) c.state = 'idle';
        return;
      }
      c.sink = Math.max(0, c.sink - dt * 1.5);
      if (scared && c.state !== 'run') {
        if (chance(.45)) { c.state = 'hide'; c.hideT = rand(6, 11); return; }
        const a = Math.atan2(c.x - P.x, c.z - P.z); c.gx = U.clamp(c.x + Math.sin(a) * 4, 136.3, 139.8); c.gz = c.z + Math.cos(a) * 4; c.state = 'run';
      }
      if (c.state === 'idle' && c.t <= 0) { c.t = rand(2, 6); if (chance(.6)) { c.gx = U.clamp(c.x + rand(-1.5, 1.5), 136.3, 139.8); c.gz = c.z + rand(-2, 2); c.state = 'walk'; } }
      if (c.state === 'walk' || c.state === 'run') {
        const dx = c.gx - c.x, dz = c.gz - c.z, d = Math.hypot(dx, dz);
        if (d < .05 || !shoreOk(c.gz)) { c.state = 'idle'; c.t = rand(1, 4); return; }
        const sp = c.state === 'run' ? 2.6 : .7;
        c.h += U.angDiff(c.h, Math.atan2(dx, dz) + Math.PI / 2) * Math.min(1, dt * 6);   // sideways, as crabs do
        c.x += dx / d * Math.min(d, sp * dt); c.z += dz / d * Math.min(d, sp * dt); c.leg += dt * (c.state === 'run' ? 30 : 16);
      }
    }
    function crabWrite(c) {
      const i = c.base, y = .02 - c.sink * .14, lg = Math.sin(c.leg) * .35, claw = Math.sin(c.leg * .3 + c.base) * .15;
      root(c.x, y, c.z, c.h, 0, 0, 1);
      part(i, 0, 0, 0, 0, 0, 0, 0, .07, 0, .24, .08, .17);
      part(i + 1, -.12, .07, .08, 0, claw, 0, -.03, 0, .06, .08, .06, .1);
      part(i + 2, .12, .07, .08, 0, -claw, 0, .03, 0, .06, .08, .06, .1);
      part(i + 3, 0, .11, .07, 0, 0, 0, 0, .015, 0, .11, .035, .02);
      part(i + 4, -.12, .05, 0, 0, 0, lg, -.07, 0, 0, .15, .02, .15);
      part(i + 5, .12, .05, 0, 0, 0, -lg, .07, 0, 0, .15, .02, .15);
    }

    /* ---------- dolphins ---------- */
    const pod = { ang: rand(0, 6.3), cx: 222, cz: 8, r: 40, dir: 1, dolphins: [] };
    for (let k = 0; k < 3; k++) {
      const base = alloc(DOLPHIN_PARTS); colorize(base, ['#6f8fa8', '#6a8aa3', '#c9d6e0', '#5a7690', '#5a7690', '#5f7f98']);
      pod.dolphins.push({ base, k, jumpT: rand(1, 6), jump: -1, x: 0, y: -.5, z: 0, h: 0, pitch: 0, splashed: 0 });
    }
    function podUpdate(dt, P) {
      pod.ang += pod.dir * 4.2 / pod.r * dt;
      const cx = pod.cx + Math.sin(pod.ang) * pod.r, cz = pod.cz + Math.cos(pod.ang) * pod.r, h = pod.ang + pod.dir * Math.PI / 2;
      const fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h), near = Math.hypot(P.x - cx, P.z - cz) < 80;
      for (const d of pod.dolphins) {
        const off = (d.k - 1) * 2.4, back = (d.k % 2) * 1.8;
        const bx = cx + rx * off - fx * back, bz = cz + rz * off - fz * back;
        d.h = h;
        if (d.jump < 0) {
          // cruising just under the surface: the fin cuts the water now and then
          d.x = bx; d.z = bz; d.pitch = 0; d.y = -.62 + Math.max(0, Math.sin(clock * 1.3 + d.k * 2)) * .3;
          if ((d.jumpT -= dt) <= 0) { d.jump = 0; d.splashed = 0; }
        } else {
          d.jump += dt / 1.25;
          const t = Math.min(1, d.jump), dur = 1.25, v = 5.5;
          d.x = bx + fx * (t - .5) * v * dur * .4; d.z = bz + fz * (t - .5) * v * dur * .4;
          d.y = -.9 + 9.2 * t * (1 - t);
          d.pitch = -Math.atan2(9.2 * (1 - 2 * t) / dur, v);
          if (d.splashed === 0 && t > .1) { d.splashed = 1; if (near) { P.fx.splash(d.x, .05, d.z, .35); if (Math.hypot(P.x - d.x, P.z - d.z) < 60) o.audio.splashAt([d.x, .2, d.z]); } }
          if (d.splashed === 1 && t > .88) { d.splashed = 2; if (near) { P.fx.splash(d.x, .05, d.z, .5); if (Math.hypot(P.x - d.x, P.z - d.z) < 60) o.audio.splashAt([d.x, .2, d.z]); } }
          if (t >= 1) { d.jump = -1; d.jumpT = rand(2.5, 9); }
        }
      }
    }
    function dolphinWrite(d) {
      const i = d.base;
      root(d.x, d.y, d.z, d.h, d.pitch, 0, 1);
      part(i, 0, 0, 0, 0, 0, 0, 0, 0, 0, .42, .4, 1.6);
      part(i + 1, 0, 0, 0, 0, 0, 0, 0, .04, .78, .34, .32, .38);
      part(i + 2, 0, 0, 0, 0, 0, 0, 0, -.06, 1.08, .14, .11, .36);
      part(i + 3, 0, .18, -.15, -.5, 0, 0, 0, .14, 0, .05, .32, .26);
      part(i + 4, 0, 0, -.8, 0, 0, 0, 0, 0, -.2, .72, .05, .22);
      part(i + 5, 0, -.12, .35, 0, 0, 0, 0, 0, 0, .72, .04, .16);
    }

    /* ---------- runtime ---------- */
    let frameNo = 0;
    const api = {
      scare(x, z, r) { noises.push({ x, z, r: Math.max(r, 18), t: clock }); },
      update(dt, P, limits) {
        clock += dt; frameNo++;
        for (let k = noises.length - 1; k >= 0; k--) if (clock - noises[k].t > .4) noises.splice(k, 1);
        for (const f of flocks) if (f.feedT > 0) f.feedT -= dt;
        const dangers = o.vehicles.dangers();
        for (const b of birds) {
          const d = Math.hypot(b.x - P.x, b.z - P.z);
          if (d > 170) { if (!b.hidden) { hideAll(b.base, BIRD_PARTS); b.hidden = true; } if (b.soar) { b.ang += b.dir * b.K.fly / b.r * dt; } continue; }
          b.hidden = false;
          birdUpdate(b, dt, P, dangers);
          if (d < 60 || (frameNo + b.base) % 2 === 0) birdWrite(b);
        }
        if ((dogPopT -= dt) <= 0) { dogPopT = 1.5; dogPopulate(P, limits); }
        for (const d of dogs) if (d.active) { dogUpdate(d, dt, P, dangers); dogWrite(d); }
        leashWrite();
        // crabs only along the city beach, while the hero is somewhere near it
        const beach = P.x > 95 && P.x < 175 && Math.abs(P.z) < 115;
        for (const c of crabs) {
          if (!beach) { if (c.active) { c.active = false; hideAll(c.base, CRAB_PARTS); } continue; }
          if (!c.active || Math.hypot(c.x - P.x, c.z - P.z) > 60) crabSpawn(c, P);
          if (!c.active) continue;
          crabUpdate(c, dt, P);
          if (c.sink >= 1) hideAll(c.base, CRAB_PARTS); else crabWrite(c);
        }
        podUpdate(dt, P);
        const podNear = Math.hypot(P.x - pod.cx, P.z - pod.cz) < 170;
        for (const d of pod.dolphins) { if (podNear) dolphinWrite(d); else hideAll(d.base, DOLPHIN_PARTS); }
        mesh.instanceMatrix.needsUpdate = true;
      },
      // with F: pet a dog, feed the pigeons
      interactions(P) {
        const out = [];
        if (o.vehicles.driving || P.dead) return out;
        let best = null, bd = 1.7;
        for (const d of dogs) if (d.active && d.fleeT <= 0 && !(d.owner && d.owner.fightT > 0)) { const dd = Math.hypot(d.x - P.x, d.z - P.z); if (dd < bd) { bd = dd; best = d; } }
        if (best) {
          const d = best;
          out.push({ x: d.x, z: d.z, y: d.y, r: 1.8, short: 'ПОГЛАДИТЬ', label: () => 'Погладить собаку',
            use: () => {
              d.petT = 3; d.sitT = Math.max(d.sitT, 2); d.speed = 0; o.audio.happyDog([d.x, .6, d.z]);
              o.flash(pick(['Хороший пёс!', 'Кто тут хороший мальчик?', 'Собака довольна', 'Хвост так и ходит!']) + (P.hp < 100 ? ' +5 здоровья' : ''), 2);
              P.hp = Math.min(100, P.hp + 5);
              if (d.owner) o.say(d.owner, pick(['Его зовут ' + d.name + '!', 'Он вас любит!', 'Осторожно, оближет!', d.name + ', сидеть!']));
            } });
        }
        for (const f of flocks) {
          const n = f.birds.filter(b => b.state === 'ground').length;
          if (n >= 3 && Math.hypot(f.x - P.x, f.z - P.z) < f.r + 4) {
            out.push({ x: f.x, z: f.z, y: P.y, r: f.r + 3, short: 'КОРМИТЬ', label: () => f.feedT > 0 ? null : 'Покормить голубей',
              use: () => {
                f.feedT = 18; f.fx = P.x + Math.sin(P.heading) * 1.2; f.fz = P.z + Math.cos(P.heading) * 1.2;
                for (const b of f.birds) if (b.state === 'ground') { [b.gx, b.gz] = groundPoint(b); b.walkT = rand(2, 4); }
                o.flash('Вы крошите булку — голуби слетаются', 2.2);
              } });
            break;
          }
        }
        return out;
      },
      get dogs() { return dogs.filter(d => d.active); },
      birds, crabs, pod
    };
    return api;
  };
})(window.NB);
