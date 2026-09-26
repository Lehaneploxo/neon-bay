// Cars in the world: parked cars, AI traffic on the road grid, the car the hero drives,
// arcade driving physics, collisions and dents, and warnings for people in the way.
(function (NB) {
  'use strict';
  const { U } = NB;
  const rand = U.rand, pick = a => a[(Math.random() * a.length) | 0], chance = p => Math.random() < p;
  const DIRV = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const LANE = 2.6, PARK = 4.9, STOP = 8.5;

  NB.createVehicles = function (scene, world, opts) {
    const { ROADS } = world.layout, col = world.col, tmp = [];
    const MODELS = NB.CAR_MODELS, byId = {}; MODELS.forEach(m => { byId[m.id] = m; });
    const matMain = new THREE.MeshLambertMaterial({ vertexColors: true });
    const matLights = new THREE.MeshBasicMaterial({ vertexColors: true });
    const matWheel = new THREE.MeshLambertMaterial({ vertexColors: true });
    const cars = [];
    const audio = opts.audio;
    const pickModel = () => { let r = Math.random(); for (const id in NB.CAR_WEIGHTS) { if ((r -= NB.CAR_WEIGHTS[id]) <= 0) return byId[id]; } return byId.meridian; };
    // lights share each model's geometry but need their own mesh: split the light-coloured quads out once
    for (const m of MODELS) {
      const c = m.geo.attributes.color.array, p = m.geo.attributes.position.array, n = m.geo.attributes.normal.array;
      const lp = [], ln = [], lc = [];
      for (let i = 0; i < c.length; i += 9) { // per triangle
        const r = c[i], g = c[i + 1], b = c[i + 2];
        const isLight = (r > .99 && g > .9 && b > .8 && !(r === 1 && g === 1 && b === 1)) || (r > .99 && g < .2 && b < .25);
        if (isLight) for (let k = 0; k < 9; k++) { lp.push(p[i + k]); ln.push(n[i + k]); lc.push(c[i + k]); p[i + k] = 0; } // moved out of the lit mesh
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(ln, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
      g.computeBoundingSphere(); m.lightGeo = g; m.geo.attributes.position.needsUpdate = true;
    }

    /* ---------- a car ---------- */
    const tc = new THREE.Color();
    function makeCar(model, x, z, h) {
      const car = { model, x, z, y: 0, h, vx: 0, vz: 0, steer: 0, yawRate: 0, spin: 0, damage: 0, ai: null, driver: null, awake: false, smokeT: 0, hitT: 0, visible: true };
      car.color = pick(model.palette); car.accent = pick(model.accent);
      car.root = new THREE.Group(); car.body = new THREE.Group(); car.root.add(car.body);
      car.geo = model.geo.clone();
      paint(car);
      car.mesh = new THREE.Mesh(car.geo, matMain); car.mesh.castShadow = true; car.body.add(car.mesh);
      car.body.add(new THREE.Mesh(model.lightGeo, matLights));
      car.driverMesh = new THREE.Mesh(NB.driverGeo, matMain); car.driverMesh.position.set(...model.seat); car.driverMesh.visible = false; car.body.add(car.driverMesh);
      car.wheels = model.wheels.map(([wx, wz, front]) => {
        const g = new THREE.Group(); g.position.set(wx, model.r, wz);
        const w = new THREE.Mesh(model.wheelGeo, matWheel); g.add(w); car.root.add(g);
        return { g, w, front };
      });
      car.root.rotation.y = h;
      car.y = floorAt(x, z, 1);
      car.root.position.set(x, car.y, z);
      if (model.bar) {
        car.police = !!model.police; car.ems = !!model.ems; car.sirenOn = false;
        const mk = hex => { const m = new THREE.Mesh(new THREE.BoxGeometry(.5, .14, .3), new THREE.MeshBasicMaterial({ color: hex })); m.position.y = model.barY || 1.52; m.position.z = model.barZ != null ? model.barZ : -.25; car.body.add(m); return m; };
        car.barR = mk(model.bar[0]); car.barR.position.x = .32; car.barB = mk(model.bar[1]); car.barB.position.x = -.32;
      }
      scene.add(car.root);
      cars.push(car);
      return car;
    }
    function paint(car) {
      const c = car.geo.attributes.color.array, dmg = Math.min(1, car.damage / 140);
      const dirty = (hexs, out) => { tc.set(NB.CAR_FIXED[hexs] || hexs); tc.lerp(new THREE.Color('#3a3230'), dmg * .45); return tc; };
      for (const key of ['body', 'accent']) {
        const cc = dirty(key === 'body' ? car.color : car.accent);
        for (const [a, b] of car.model.ranges[key]) for (let i = a; i < b; i++) { c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b; }
      }
      car.geo.attributes.color.needsUpdate = true;
    }
    function removeCar(car) {
      releaseLock(car);
      scene.remove(car.root); car.geo.dispose();
      cars.splice(cars.indexOf(car), 1);
    }
    function floorAt(x, z, fromY) {
      let f = 0;
      for (const b of col.query(x - .5, z - .5, x + .5, z + .5, tmp)) {
        if (b.maxY > fromY + .45) continue;
        if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > f) f = b.maxY;
      }
      return f;
    }
    const fwd = car => [Math.sin(car.h), Math.cos(car.h)];
    const right = car => [-Math.cos(car.h), Math.sin(car.h)];
    function circles(car) {
      const [fx, fz] = fwd(car), r = car.model.w / 2, off = car.model.l / 2 - r, out = [];
      const n = car.model.l > 6 ? 5 : 3;
      for (let i = 0; i < n; i++) { const t = -off + (2 * off) * i / (n - 1); out.push([car.x + fx * t, car.z + fz * t, r, t]); }
      return out;
    }
    const speedOf = car => car.vx * Math.sin(car.h) + car.vz * Math.cos(car.h);

    /* ---------- dents ---------- */
    function dent(car, wx, wz, nx, nz, amount) {
      const c = Math.cos(car.h), s = Math.sin(car.h);
      const lx = (wx - car.x) * c - (wz - car.z) * s, lz = (wx - car.x) * s + (wz - car.z) * c;
      const lnx = nx * c - nz * s, lnz = nx * s + nz * c;
      const p = car.geo.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        const d = Math.hypot(p[i] - lx, p[i + 2] - lz);
        if (d < 1.1) { const f = amount * (1 - d / 1.1); p[i] += lnx * f; p[i + 2] += lnz * f; p[i + 1] -= f * .25; }
      }
      car.geo.attributes.position.needsUpdate = true;
    }
    function impact(car, strength, px, pz, nx, nz) {
      if (strength < 2.5) return;
      if (car.hitT > 0 && strength < 8) return;
      car.hitT = .25;
      car.damage += strength * 2.2;
      dent(car, px, pz, nx, nz, Math.min(.16, strength * .012));
      paint(car);
      if (car.driver === 'player') { audio.impact(strength); if (opts.onImpact) opts.onImpact(strength); }
      else audio.impact(strength * .5, [car.x, .5, car.z]);
    }

    /* ---------- driving physics (hero's car and loose cars) ---------- */
    function physics(car, dt, ctl) {
      const pf = car.model.perf;
      const fx = Math.sin(car.h), fz = Math.cos(car.h), rx = -Math.cos(car.h), rz = Math.sin(car.h);
      let vF = car.vx * fx + car.vz * fz, vR = car.vx * rx + car.vz * rz;
      const t = ctl.throttle, top = pf.top;
      if (t > 0) { if (vF < -.5) vF += pf.brake * t * dt; else vF += pf.accel * t * (1 - Math.min(1, Math.max(0, vF) / top) ** 2) * dt; }
      else if (t < 0) { if (vF > .5) vF -= pf.brake * -t * dt; else if (vF > -9) vF -= pf.accel * .55 * -t * dt; }
      const roll = Math.min(Math.abs(vF), (t === 0 ? 2.2 : .6) * dt);
      vF -= Math.sign(vF) * roll + vF * .04 * dt;
      if (ctl.handbrake) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 6 * dt);
      const steerMax = pf.steer * (1 - .62 * Math.min(1, Math.abs(vF) / top));
      car.steer = U.damp(car.steer, ctl.steer * steerMax, 7, dt);
      let yaw = -vF / car.model.wheelbase * Math.tan(car.steer);
      if (ctl.handbrake) yaw *= 1.35;
      const grip = ctl.handbrake ? 1.1 : pf.grip * (Math.abs(vR) > 6 ? .6 : 1);
      vR *= Math.exp(-grip * dt);
      car.yawRate = yaw;
      car.slip = Math.abs(vR);
      car.vx = fx * vF + rx * vR; car.vz = fz * vF + rz * vR;
      car.h += yaw * dt;
      car.x += car.vx * dt; car.z += car.vz * dt;
      car.accel = (vF - (car.lastVF || 0)) / Math.max(dt, 1e-3); car.lastVF = vF;
      collideStatic(car);
    }
    function collideStatic(car) {
      for (const [cx, cz, r, t] of circles(car)) {
        for (const b of col.query(cx - r - .5, cz - r - .5, cx + r + .5, cz + r + .5, tmp)) {
          if (b.maxY <= car.y + .45 || b.minY >= car.y + 1.6) continue;
          const qx = U.clamp(cx, b.minX, b.maxX), qz = U.clamp(cz, b.minZ, b.maxZ);
          const dx = cx - qx, dz = cz - qz, d = Math.hypot(dx, dz);
          if (d >= r || d < 1e-5) continue;
          const nx = dx / d, nz = dz / d, pen = r - d;
          car.x += nx * pen; car.z += nz * pen;
          const vn = car.vx * nx + car.vz * nz;
          if (vn < 0) {
            car.vx -= 1.3 * vn * nx; car.vz -= 1.3 * vn * nz;
            car.vx *= .85; car.vz *= .85;
            car.h += (t * (-Math.sin(car.h) * nz + Math.cos(car.h) * nx)) * vn * .012;
            impact(car, -vn, qx, qz, nx, nz);
          }
        }
      }
    }
    function collideCars() {
      for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const reach = (a.model.l + b.model.l) / 2;
        if (Math.abs(a.x - b.x) > reach || Math.abs(a.z - b.z) > reach) continue;
        if (a.ghostT > 0 || b.ghostT > 0) continue;
        const aMove = !a.ai && (a.awake || a.driver === 'player'), bMove = !b.ai && (b.awake || b.driver === 'player');
        if (!aMove && !bMove) continue;
        for (const ca of circles(a)) for (const cb of circles(b)) {
          const dx = cb[0] - ca[0], dz = cb[1] - ca[1], d = Math.hypot(dx, dz), min = ca[2] + cb[2] - .15;
          if (d >= min || d < 1e-4) continue;
          const nx = dx / d, nz = dz / d, pen = min - d;
          // a kinematic traffic car is immovable; a parked car wakes up and gets shoved
          const wa = b.ai ? 1 : a.ai ? 0 : .5, wb = 1 - wa;
          if (!a.ai) { a.x -= nx * pen * wa; a.z -= nz * pen * wa; }
          if (!b.ai) { b.x += nx * pen * wb; b.z += nz * pen * wb; }
          const rv = (b.ai ? b.aiVX : b.vx) - (a.ai ? a.aiVX : a.vx), rvz = (b.ai ? b.aiVZ : b.vz) - (a.ai ? a.aiVZ : a.vz);
          const vn = rv * nx + rvz * nz;
          if (vn < 0) {
            const jimp = -vn * 1.25;
            if (!a.ai) { a.vx -= nx * jimp * wa; a.vz -= nz * jimp * wa; a.awake = true; }
            if (!b.ai) { b.vx += nx * jimp * wb; b.vz += nz * jimp * wb; b.awake = true; }
            const px = (ca[0] + cb[0]) / 2, pz = (ca[1] + cb[1]) / 2;
            impact(a, -vn, px, pz, -nx, -nz); impact(b, -vn, px, pz, nx, nz);
            if (a.ai) a.ai.shock = 1.5; if (b.ai) b.ai.shock = 1.5;
          }
        }
      }
    }

    /* ---------- AI traffic on the road grid ---------- */
    const locks = new Map();
    const valid = (i, j) => i >= 0 && i < ROADS.length && j >= 0 && j < ROADS.length;
    const laneOff = d => [-DIRV[d][1] * LANE, DIRV[d][0] * LANE];
    function releaseLock(car) { if (car.ai && car.ai.lock != null && locks.get(car.ai.lock) === car) locks.delete(car.ai.lock); if (car.ai) car.ai.lock = null; }
    function extend(ai) {
      const back = (ai.d + 2) % 4, opts2 = [];
      for (let d = 0; d < 4; d++) if (d !== back && valid(ai.i + DIRV[d][0], ai.j + DIRV[d][1])) opts2.push(d);
      const straight = opts2.includes(ai.d) && chance(.5);
      const dout = straight ? ai.d : (opts2.length ? pick(opts2) : back);
      const Bx = ROADS[ai.i], Bz = ROADS[ai.j], key = ai.i * 10 + ai.j;
      const [ox, oz] = laneOff(ai.d), [px, pz] = laneOff(dout);
      const p0 = [Bx - DIRV[ai.d][0] * STOP + ox, Bz - DIRV[ai.d][1] * STOP + oz];
      const p2 = [Bx + DIRV[dout][0] * STOP + px, Bz + DIRV[dout][1] * STOP + pz];
      const p1 = dout === ai.d ? [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2] : [Bx + ox + px, Bz + oz + pz];
      const last = ai.pts[ai.pts.length - 1]; last.lock = key;
      for (let k = 1; k <= 6; k++) {
        const t = k / 6, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
        ai.pts.push({ x: a * p0[0] + b * p1[0] + c * p2[0], z: a * p0[1] + b * p1[1] + c * p2[1], curve: dout !== ai.d, unlock: k === 6 ? key : null });
      }
      ai.i += DIRV[dout][0]; ai.j += DIRV[dout][1]; ai.d = dout;
      const [nx, nz] = laneOff(dout);
      ai.pts.push({ x: ROADS[ai.i] - DIRV[dout][0] * STOP + nx, z: ROADS[ai.j] - DIRV[dout][1] * STOP + nz });
    }
    function spawnTraffic(px, pz, fx, fz, near, model, minD, maxD) {
      for (let tries = 0; tries < 10; tries++) {
        const i = (Math.random() * ROADS.length) | 0, j = (Math.random() * ROADS.length) | 0, d = (Math.random() * 4) | 0;
        if (!valid(i + DIRV[d][0], j + DIRV[d][1])) continue;
        const [ox, oz] = laneOff(d), t = rand(.1, .8);
        const ax = ROADS[i] + DIRV[d][0] * STOP + ox, az = ROADS[j] + DIRV[d][1] * STOP + oz;
        const bx = ROADS[i + DIRV[d][0]] - DIRV[d][0] * STOP + ox, bz = ROADS[j + DIRV[d][1]] - DIRV[d][1] * STOP + oz;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t, dist = Math.hypot(x - px, z - pz);
        if (dist > (maxD || 130) || dist < (minD || (near ? 15 : 45))) continue;
        if (!near && dist < 85 && ((x - px) * fx + (z - pz) * fz) / dist > .1) continue;
        if (cars.some(c => Math.hypot(c.x - x, c.z - z) < 12)) continue;
        const car = makeCar(model || pickModel(), x, z, Math.atan2(DIRV[d][0], DIRV[d][1]));
        car.driver = 'npc'; car.driverMesh.visible = true;
        car.ai = { i: i + DIRV[d][0], j: j + DIRV[d][1], d, pts: [{ x, z }, { x: bx, z: bz }], k: 0, t: 0, v: rand(6, 9), cruise: rand(9, 13), lock: null, waitT: 0, honkT: 0, shock: 0 };
        car.aiVX = 0; car.aiVZ = 0;
        return car;
      }
      return null;
    }
    function obstacleAhead(car, fx, fz, people, player, skipCars) {
      const rx = -fz, rz = fx, look = 6 + car.ai.v * 1.6;
      let best = Infinity, isHero = false;
      const test = (x, z, halfW, hero) => {
        const dx = x - car.x, dz = z - car.z, a = dx * fx + dz * fz;
        if (a <= 0 || a > look + car.model.l / 2) return;
        if (Math.abs(dx * rx + dz * rz) < 1.1 + halfW) { if (a < best) { best = a; isHero = hero; } }
      };
      if (!skipCars) for (const o of cars) if (o !== car) test(o.x, o.z, o.model.w / 2, o.driver === 'player');
      for (const p of people) if (!p.spot || p.spot.kind === 'talk') test(p.x, p.z, .3, false);
      if (!player.inCar) test(player.x, player.z, .35, true);
      return [best - car.model.l / 2, isHero];
    }
    function updateAI(car, dt, people, player) {
      const ai = car.ai;
      if (ai.k >= ai.pts.length - 3) extend(ai);
      const a = ai.pts[ai.k], b = ai.pts[ai.k + 1];
      const sx = b.x - a.x, sz = b.z - a.z, segL = Math.hypot(sx, sz) || 1, fx = sx / segL, fz = sz / segL;
      // speed target: cruise, slow in turns, stop for obstacles and busy junctions
      let target = b.curve ? 5.5 : ai.cruise;
      // after waiting a long time for another car, nudge through (two cars can block each other at a junction)
      if (ai.ignoreT > 0) ai.ignoreT -= dt;
      const [gap, hero] = obstacleAhead(car, Math.sin(car.h), Math.cos(car.h), people, player, ai.ignoreT > 0);
      if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - 2.2) * 1.2));
      let lockPt = null, distToLock = 0, acc = segL - ai.t;
      for (let k = ai.k + 1; k < Math.min(ai.pts.length, ai.k + 4); k++) {
        if (ai.pts[k].lock != null && ai.lock !== ai.pts[k].lock) { lockPt = ai.pts[k]; distToLock = acc; break; }
        if (k + 1 < ai.pts.length) acc += Math.hypot(ai.pts[k + 1].x - ai.pts[k].x, ai.pts[k + 1].z - ai.pts[k].z);
      }
      if (lockPt) {
        const owner = locks.get(lockPt.lock);
        if (distToLock < 1.2 && (!owner || owner === car || !cars.includes(owner))) { locks.set(lockPt.lock, car); ai.lock = lockPt.lock; }
        else if (owner && owner !== car && cars.includes(owner)) target = Math.min(target, Math.max(0, (distToLock - .8) * 1.3));
      }
      if (ai.shock > 0) { ai.shock -= dt; target = 0; }
      ai.v += U.clamp(target - ai.v, -9 * dt, 3.2 * dt);
      if (ai.v < .3 && (hero || ai.shock > 0)) {
        ai.waitT += dt;
        if (ai.waitT > 1.2 && (ai.honkT -= dt) <= 0) { audio.horn([car.x, 1, car.z]); ai.honkT = rand(2, 4); }
      } else { ai.waitT = 0; ai.honkT = 0; }
      if (ai.v < .3 && !hero) { ai.stuckT = (ai.stuckT || 0) + dt; if (ai.stuckT > 6) { ai.stuckT = 0; ai.ignoreT = 2; } } else ai.stuckT = 0;
      // advance along the polyline
      let ds = ai.v * dt;
      while (ds > 0 && ai.k < ai.pts.length - 1) {
        const p = ai.pts[ai.k], q = ai.pts[ai.k + 1], L = Math.hypot(q.x - p.x, q.z - p.z);
        if (ai.t + ds < L) { ai.t += ds; ds = 0; }
        else { ds -= L - ai.t; ai.k++; ai.t = 0; if (ai.pts[ai.k].unlock != null) { if (locks.get(ai.pts[ai.k].unlock) === car) locks.delete(ai.pts[ai.k].unlock); ai.lock = null; } }
      }
      if (ai.k > 8) { ai.pts.splice(0, ai.k - 1); ai.k = 1; }
      const p = ai.pts[ai.k], q = ai.pts[ai.k + 1], L = Math.hypot(q.x - p.x, q.z - p.z) || 1, f = ai.t / L;
      const nx = p.x + (q.x - p.x) * f, nz = p.z + (q.z - p.z) * f;
      car.aiVX = (nx - car.x) / Math.max(dt, 1e-3); car.aiVZ = (nz - car.z) / Math.max(dt, 1e-3);
      car.x = nx; car.z = nz;
      const want = Math.atan2(q.x - p.x, q.z - p.z), dh = U.angDiff(car.h, want);
      car.h += dh * Math.min(1, dt * 6);
      car.steer = U.clamp(dh * 2, -.5, .5);
      car.vx = Math.sin(car.h) * ai.v; car.vz = Math.cos(car.h) * ai.v;
      car.yawRate = 0; car.slip = 0; car.accel = 0;
    }

    /* ---------- parked cars along the kerbs and in the car park ---------- */
    for (const L of ROADS) for (let s = 0; s < ROADS.length - 1; s++) {
      const a = ROADS[s] + 12, b = ROADS[s + 1] - 12;
      for (const side of [-1, 1]) for (let t = a; t < b; t += rand(6.5, 9)) {
        if (!chance(.2)) continue;
        // road running along z at x = L
        if (!(L === -100 && side < 0)) makeCar(pickModel(), L + side * PARK, t, side < 0 ? 0 : Math.PI);
        if (chance(.5)) continue;
        if (!((L === 100 || L === -100) && side * L > 0)) makeCar(pickModel(), t, L + side * PARK, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
    {
      const lot = world.layout.blocks.find(b => b.type === 'parking');
      if (lot) {
        const lx0 = lot.bx0 + 3, lx1 = lot.bx1 - 3, rows = [lot.bz0 + 3 + 5.5, lot.bz1 - 3 - 5.5];
        for (const zz of rows) for (let x = lx0 + 2.5; x < lx1 - 1; x += 3) if (chance(.45)) makeCar(pickModel(), x, zz, chance(.5) ? 0 : Math.PI);
      }
    }
    if (world.station) for (const [x, z, h] of world.station.parking) makeCar(byId.police, x, z, h);
    if (world.hospital) for (const [x, z, h] of world.hospital.parking) makeCar(byId.ambulance, x, z, h);
    for (const c of cars) c.parked = true;

    /* ---------- police pursuit ---------- */
    const nearestIdx = v => { let bi = 0; for (let i = 1; i < ROADS.length; i++) if (Math.abs(ROADS[i] - v) < Math.abs(ROADS[bi] - v)) bi = i; return bi; };
    // next junction to drive to, moving along the road grid towards (tx, tz)
    function nextGridPoint(x, z, tx, tz) {
      const ci = nearestIdx(x), cj = nearestIdx(z), ti = nearestIdx(tx), tj = nearestIdx(tz);
      const onX = Math.abs(x - ROADS[ci]) < 7, onZ = Math.abs(z - ROADS[cj]) < 7;
      if (onX && onZ) {
        if (ci === ti && cj === tj) return [tx, tz];
        let ni = ci, nj = cj;
        if (ti !== ci && (Math.abs(ti - ci) >= Math.abs(tj - cj) || tj === cj)) ni += Math.sign(ti - ci); else nj += Math.sign(tj - cj);
        return [ROADS[ni], ROADS[nj]];
      }
      if (onX) { let lo = 0; while (lo < ROADS.length - 2 && ROADS[lo + 1] <= z) lo++; const j = tz > z ? lo + 1 : lo; return [ROADS[ci], ROADS[j]]; }
      if (onZ) { let lo = 0; while (lo < ROADS.length - 2 && ROADS[lo + 1] <= x) lo++; const i = tx > x ? lo + 1 : lo; return [ROADS[i], ROADS[cj]]; }
      return [ROADS[ci], ROADS[cj]];
    }
    function startPursuit(car) {
      if (car.ai) { const v = car.ai.v; releaseLock(car); car.ai = null; car.vx = Math.sin(car.h) * v; car.vz = Math.cos(car.h) * v; }
      car.pursuit = { wp: null, los: false, losT: 0, stuckT: 0, revT: 0, exitT: 0 };
      car.parked = false; car.awake = true; car.sirenOn = true; car.driver = 'cop'; car.driverMesh.visible = true;
    }
    // a service car that has not moved for a while stops colliding with other cars for a moment, which breaks jams
    function unjam(car, S, dt, wantsToMove) {
      S.moveT = (S.moveT || 0) + dt;
      if (S.moveT > 3) { if (wantsToMove && S.mx != null && Math.hypot(car.x - S.mx, car.z - S.mz) < 1.2) car.ghostT = 2.5; S.moveT = 0; S.mx = car.x; S.mz = car.z; }
    }
    // drive to a point on the road grid and stop there (ambulances)
    function gotoStep(car, dt) {
      const G = car.goto, dx = G.x - car.x, dz = G.z - car.z, dist = Math.hypot(dx, dz) || .001;
      G.losT = (G.losT || 0) - dt;
      if (G.losT <= 0) { G.losT = .4; G.los = dist < 45 && col.raycast(car.x, 1.1, car.z, dx / dist, 0, dz / dist, dist) >= dist - .6; }
      let ax = G.x, az = G.z;
      if (!G.los || dist > 35) {
        if (!G.wp || Math.hypot(G.wp[0] - car.x, G.wp[1] - car.z) < 6 || (G.wpT -= dt) <= 0) { G.wp = nextGridPoint(car.x, car.z, G.x, G.z); G.wpT = 4; }
        ax = G.wp[0]; az = G.wp[1];
      }
      const want = Math.atan2(ax - car.x, az - car.z), diff = U.angDiff(car.h, want), vF = speedOf(car);
      let target = Math.min(G.speed || 13, Math.max(2, dist * .9));
      if (Math.abs(diff) > 1) target = Math.min(target, 5);
      let throttle = vF < target ? 1 : vF > target + 1.5 ? -.7 : .15, steer = U.clamp(-diff * 2.2, -1, 1);
      G.arrived = dist < 3 && Math.abs(vF) < .8;
      if (dist < 3) { throttle = vF > .3 ? -1 : 0; steer = 0; }
      if (G.revT > 0) { G.revT -= dt; throttle = -1; steer = -steer; }
      else if (Math.abs(vF) < 1 && throttle > 0 && dist > 3) { G.stuckT = (G.stuckT || 0) + dt; if (G.stuckT > 1.5) { G.revT = 1.1; G.stuckT = 0; } }
      else G.stuckT = 0;
      unjam(car, G, dt, dist > 3);
      physics(car, dt, { throttle, steer, handbrake: dist < 3 });
    }
    function pursuitStep(car, dt, tgt) {
      const P = car.pursuit, dx = tgt.x - car.x, dz = tgt.z - car.z, dist = Math.hypot(dx, dz) || .001;
      P.losT -= dt;
      if (P.losT <= 0) { P.losT = .3; P.los = dist < 70 && col.raycast(car.x, 1.1, car.z, dx / dist, 0, dz / dist, dist) >= dist - .6; }
      let ax = tgt.x + (tgt.vx || 0) * .4, az = tgt.z + (tgt.vz || 0) * .4;
      if (!P.los || dist > 45) {
        if (!P.wp || Math.hypot(P.wp[0] - car.x, P.wp[1] - car.z) < 6 || (P.wpT -= dt) <= 0) { P.wp = nextGridPoint(car.x, car.z, tgt.x, tgt.z); P.wpT = 4; }
        ax = P.wp[0]; az = P.wp[1];
      } else P.wp = null;
      const want = Math.atan2(ax - car.x, az - car.z), diff = U.angDiff(car.h, want);
      const vF = speedOf(car);
      let throttle = 1, steer = U.clamp(-diff * 2.2, -1, 1);
      if (tgt.onFoot && P.los && dist < 15) {
        throttle = vF > 1 ? -1 : 0;
        if (Math.abs(vF) < 1.5) { P.exitT += dt; if (P.exitT > .5 && opts.onCopsExit) { opts.onCopsExit(car); car.pursuit = null; car.driver = null; car.driverMesh.visible = false; car.parked = true; car.exited = true; return; } }
      } else if (Math.abs(diff) > 1.3 && vF > 9) throttle = -.7;
      else if (Math.abs(diff) > 1) throttle = .45;
      if (P.revT > 0) { P.revT -= dt; throttle = -1; steer = -steer; }
      else if (Math.abs(vF) < 1.2 && throttle > 0) { P.stuckT += dt; if (P.stuckT > 1.3) { P.revT = 1.1; P.stuckT = 0; } }
      else P.stuckT = 0;
      unjam(car, P, dt, !(tgt.onFoot && P.los && dist < 15));
      physics(car, dt, { throttle, steer, handbrake: false });
    }

    /* ---------- smoke from wrecked engines ---------- */
    const smokeTex = NB.U.canvasTex(64, 64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(90,85,90,.9)'); gr.addColorStop(1, 'rgba(90,85,90,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }, false);
    const puffs = [];
    for (let i = 0; i < 36; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false })); s.visible = false; s.life = 0; scene.add(s); puffs.push(s); }
    let puffHead = 0;
    function puff(x, y, z, dark) {
      const s = puffs[puffHead]; puffHead = (puffHead + 1) % puffs.length;
      s.position.set(x + rand(-.2, .2), y, z + rand(-.2, .2)); s.life = 1.6; s.visible = true; s.scale.set(.6, .6, 1);
      s.material.color.setScalar(dark ? .35 : .8);
    }

    /* ---------- public ---------- */
    let popT = 0, first = true, driving = null;
    const api = {
      cars,
      get driving() { return driving; },
      nearest(player) {
        let best = null, bd = Infinity;
        for (const c of cars) {
          const dx = player.x - c.x, dz = player.z - c.z, [fx, fz] = fwd(c);
          const a = Math.abs(dx * fx + dz * fz), b = Math.abs(dx * fz - dz * fx);
          if (a < c.model.l / 2 + .6 && b < c.model.w / 2 + 1.4) { const d = Math.hypot(dx, dz); if (d < bd) { bd = d; best = c; } }
        }
        return best;
      },
      enter(car, player) {
        let ejected = null;
        if (car.ai) {
          const [rx, rz] = right(car);
          ejected = { x: car.x - rx * (car.model.w / 2 + .7), z: car.z - rz * (car.model.w / 2 + .7), h: car.h };
          const v = car.ai.v; releaseLock(car); car.ai = null; car.vx = Math.sin(car.h) * v; car.vz = Math.cos(car.h) * v;
        }
        if (car.goto) {
          const [rx, rz] = right(car);
          ejected = { x: car.x - rx * (car.model.w / 2 + .7), z: car.z - rz * (car.model.w / 2 + .7), h: car.h };
          car.goto = null; car.sirenOn = false;
        }
        if (car.pursuit) {
          const [rx, rz] = right(car);
          ejected = { x: car.x - rx * (car.model.w / 2 + .7), z: car.z - rz * (car.model.w / 2 + .7), h: car.h, cop: true };
          car.pursuit = null;
        }
        if (car.barR) car.sirenOn = false;
        car.exited = false;
        car.driver = 'player'; car.parked = false; car.awake = true; car.driverMesh.visible = true;
        driving = car; audio.door(); audio.engineOn(true);
        return ejected;
      },
      exit(player, force) {
        const car = driving; if (!car) return false;
        if (!force && Math.abs(speedOf(car)) > 4) return false;
        const [rx, rz] = right(car);
        // door on the driver's (left) side, or the other side if that is blocked
        for (const side of [-1, 1]) {
          const x = car.x + rx * side * (car.model.w / 2 + .6), z = car.z + rz * side * (car.model.w / 2 + .6);
          if (!col.query(x - .4, z - .4, x + .4, z + .4, tmp).some(b => b.maxY > car.y + .45 && x > b.minX - .35 && x < b.maxX + .35 && z > b.minZ - .35 && z < b.maxZ + .35)) {
            player.place(x, z, car.h); break;
          }
        }
        car.driver = null; car.driverMesh.visible = false; driving = null;
        audio.door(); audio.engineOn(false);
        return true;
      },
      // cars that people should get out of the way of
      dangers() {
        const out = [];
        for (const c of cars) {
          const v = Math.hypot(c.vx, c.vz); if (v < 2.2) continue;
          const [fx, fz] = [c.vx / v, c.vz / v];
          out.push({ x: c.x, z: c.z, fx, fz, hl: c.model.l / 2, hw: c.model.w / 2, speed: v, player: c.driver === 'player' });
        }
        return out;
      },
      update(dt, ctx) {
        const { player, input, people, camYaw, limits } = ctx;
        // population: keep traffic around the hero, drop far away cars
        popT -= dt;
        if (popT <= 0) {
          popT = 1;
          const lim = limits();
          for (const c of cars.slice()) {
            const d = Math.hypot(c.x - player.x, c.z - player.z);
            if (c.ai && d > 150) removeCar(c);
            else if (!c.ai && !c.parked && c !== driving && d > 170 && cars.length > 70) removeCar(c);
          }
          const traffic = cars.filter(c => c.ai).length;
          const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
          for (let k = 0; k < (first ? lim.traffic : 2) && traffic + k < lim.traffic; k++) spawnTraffic(player.x, player.z, fx, fz, first);
          const pol = ctx.police || { wanted: 0 };
          const patrols = cars.filter(c => c.police && c.ai).length;
          if (patrols < (lim.patrols || 0)) spawnTraffic(player.x, player.z, fx, fz, first, byId.police);
          // wanted: patrol cars nearby join in, extra cars come from out of view
          if (pol.wanted > 0) {
            for (const c of cars) if (c.police && c.ai && Math.hypot(c.x - player.x, c.z - player.z) < 90) startPursuit(c);
            const chasing = cars.filter(c => c.pursuit).length, need = [0, 0, 2, 3, 3, 4][pol.wanted];
            if (chasing < need) { const c = spawnTraffic(player.x, player.z, fx, fz, false, byId.police, 60, 125); if (c) startPursuit(c); }
          } else {
            for (const c of cars.slice()) if (c.police && (c.pursuit || c.exited) && c.visible === false) removeCar(c);
            for (const c of cars) if (c.pursuit) { c.pursuit = null; c.sirenOn = false; c.parked = true; c.driver = null; }
          }
          first = false;
          for (const c of cars) { const d = Math.hypot(c.x - player.x, c.z - player.z); c.visible = d < lim.carRange; c.root.visible = c.visible; }
        }
        for (const c of cars) {
          c.hitT -= dt; if (c.heroHitT > 0) c.heroHitT -= dt; if (c.ghostT > 0) c.ghostT -= dt;
          const d = Math.hypot(c.x - player.x, c.z - player.z);
          if (c.ai) updateAI(c, dt, people, player);
          else if (c.pursuit) pursuitStep(c, dt, ctx.target || player);
          else if (c.goto && c !== driving) gotoStep(c, dt);
          else if (c === driving) {
            const ctl = { throttle: input.throttle, steer: input.move.x, handbrake: input.handbrake };
            physics(c, dt, ctl);
          } else if (c.awake && d < 90) {
            physics(c, dt, { throttle: 0, steer: 0, handbrake: true });
            if (Math.hypot(c.vx, c.vz) < .05) { c.vx = c.vz = 0; c.awake = false; }
          }
          // ride height over kerbs, body lean, wheels
          if (!c.visible) continue;
          const fy = floorAt(c.x, c.z, c.y);
          c.y = U.damp(c.y, fy, 14, dt);
          c.root.position.set(c.x, c.y, c.z); c.root.rotation.y = c.h;
          const vF = speedOf(c);
          c.body.rotation.z = U.damp(c.body.rotation.z, U.clamp(-c.yawRate * vF * .006, -.07, .07), 6, dt);
          c.body.rotation.x = U.damp(c.body.rotation.x, U.clamp(-(c.accel || 0) * .004, -.04, .04), 6, dt);
          if (d < 60) {
            c.spin += vF / c.model.r * dt;
            for (const w of c.wheels) { w.w.rotation.x = c.spin; if (w.front) w.g.rotation.y = c.steer; }
          }
          // smoke when badly damaged
          if (c.damage > 90 && d < 70) {
            c.smokeT -= dt;
            if (c.smokeT <= 0) { c.smokeT = c.damage > 150 ? .06 : .14; const [fx, fz] = fwd(c); puff(c.x + fx * (c.model.l / 2 - .8), c.y + 1.1, c.z + fz * (c.model.l / 2 - .8), c.damage > 150); }
          }
        }
        collideCars();
        // the hero on foot is shoved out of the way by cars
        if (!driving) for (const c of cars) {
          if (Math.abs(c.x - player.x) > 5 || Math.abs(c.z - player.z) > 5) continue;
          for (const [cx, cz, r] of circles(c)) {
            const dx = player.x - cx, dz = player.z - cz, d = Math.hypot(dx, dz), min = r + .34;
            if (d < min && d > 1e-4) {
              player.x += dx / d * (min - d); player.z += dz / d * (min - d);
              const v = c.ai ? c.ai.v : Math.hypot(c.vx, c.vz);
              if (v > 5 && opts.onHeroHit && (c.heroHitT || 0) <= 0) { c.heroHitT = 1; opts.onHeroHit(v, c); }
            }
          }
        }
        for (const s of puffs) if (s.visible) { s.life -= dt; s.position.y += dt * 1.3; const k = 1 + (1.6 - s.life) * 1.4; s.scale.set(k, k, 1); s.material.opacity = Math.max(0, s.life / 1.6) * .8; if (s.life <= 0) s.visible = false; }
        const tt = performance.now() / 1000, sirens = [];
        for (const c of cars) if (c.barR && c.visible) {
          const on = c.sirenOn, ph = Math.sin(tt * 13) > 0, bar = c.model.bar;
          c.barR.visible = !on || ph; c.barB.visible = !on || !ph;
          c.barR.material.color.setHex(on ? bar[0] : 0x441018); c.barB.material.color.setHex(on ? bar[1] : 0x202436);
          if (on && (c.pursuit || c.goto)) sirens.push([Math.hypot(c.x - player.x, c.z - player.z), c]);
        }
        sirens.sort((a, b) => a[0] - b[0]);
        audio.sirens(sirens.slice(0, 2).filter(s => s[0] < 110).map(s => [s[1].x, 1.4, s[1].z]));
        // sound for the hero's car
        if (driving) {
          const v = Math.abs(speedOf(driving)), top = driving.model.perf.top;
          const gears = [0, .22, .42, .62, .82, 1.01], rel = v / top;
          let g = 1; while (g < gears.length - 1 && rel > gears[g]) g++;
          const rpm = U.clamp((rel - gears[g - 1]) / (gears[g] - gears[g - 1]), 0, 1) * .8 + .2;
          audio.engine(rpm, Math.abs(input.throttle), driving.model.id);
          audio.skid(U.clamp(((driving.slip || 0) - 2.5) / 5, 0, 1) + (input.handbrake && v > 5 ? .4 : 0));
          if (input.horn && !api.hornHeld) audio.horn(null);
          api.hornHeld = input.horn;
        }
      },
      hitTest(ox, oy, oz, dx, dy, dz, maxT) {
        let best = maxT, hit = null;
        const a = dx * dx + dz * dz; if (a < 1e-8) return null;
        for (const c of cars) {
          if (!c.visible || Math.abs(c.x - ox) > maxT + 6 || Math.abs(c.z - oz) > maxT + 6) continue;
          for (const [cx, cz, r] of circles(c)) {
            const fx = ox - cx, fz = oz - cz, b = 2 * (fx * dx + fz * dz), cc = fx * fx + fz * fz - r * r * .9;
            const disc = b * b - 4 * a * cc; if (disc < 0) continue;
            const t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0 || t >= best) continue;
            const y = oy + dy * t; if (y < c.y + .2 || y > c.y + 1.45) continue;
            best = t; hit = c;
          }
        }
        return hit ? { t: best, car: hit } : null;
      },
      bulletHit(car, dmg, x, z, nx, nz) {
        car.damage += dmg * .35; paint(car);
        if (Math.random() < .4) dent(car, x, z, nx, nz, .03);
        if (car.ai) car.ai.shock = Math.max(car.ai.shock, 1.2);
      },
      // an emergency vehicle that appears out of sight and drives to where it is needed
      spawnService(id, px, pz, fx, fz, minD, maxD) {
        const car = spawnTraffic(px, pz, fx, fz, false, byId[id], minD, maxD);
        if (!car) return null;
        const v = car.ai.v; releaseLock(car); car.ai = null; car.vx = Math.sin(car.h) * v; car.vz = Math.cos(car.h) * v;
        car.parked = false; car.awake = true; car.driver = 'ems'; car.driverMesh.visible = true;
        return car;
      },
      driveTo(car, x, z, speed) { car.goto = { x, z, speed, arrived: false }; car.parked = false; car.awake = true; },
      remove(car) { if (cars.includes(car)) removeCar(car); },
      speedKmh() { return driving ? Math.abs(speedOf(driving)) * 3.6 : 0; }
    };
    return api;
  };
})(window.NB);
