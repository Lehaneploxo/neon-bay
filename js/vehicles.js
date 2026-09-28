// Cars in the world: parked cars, AI traffic on the road grid, the car the hero drives,
// arcade driving physics, collisions and dents, and warnings for people in the way.
(function (NB) {
  'use strict';
  const { U } = NB;
  const rand = U.rand, pick = a => a[(Math.random() * a.length) | 0], chance = p => Math.random() < p;
  const LANE = 2.6, PARK = 4.9, STOP = 8.5;
  const SPRAY_COLORS = ['#e8202a', '#f5f5f0', '#141418', '#ffd23d', '#ff4fa3', '#2a6fe8', '#3fe6e0', '#8cff6b', '#9b5cff', '#ff8a3d', '#2e8a4a', '#a0c4e8'];

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

    // headlight beams: a soft cone painted on the road ahead of every car that has a driver, only after dark
    const beamTex = U.canvasTex(64, 128, (g, w, h) => {
      for (let y = 0; y < h; y++) {
        const t = y / h, half = w * (.16 + .34 * t), a = Math.pow(1 - t, 1.6) * .95;
        const gr = g.createLinearGradient(w / 2 - half, 0, w / 2 + half, 0);
        gr.addColorStop(0, 'rgba(255,240,205,0)'); gr.addColorStop(.5, `rgba(255,240,205,${a})`); gr.addColorStop(1, 'rgba(255,240,205,0)');
        g.fillStyle = gr; g.fillRect(w / 2 - half, y, half * 2, 1);
      }
    }, false);
    const beamGeo = new THREE.PlaneGeometry(4.2, 11).rotateX(-Math.PI / 2).translate(0, 0, 5.5);
    const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    let night = 0;

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
      car.beam = new THREE.Mesh(beamGeo, beamMat); car.beam.position.set(0, .07, model.l / 2 - .1); car.beam.visible = false; car.root.add(car.beam);
      car.root.rotation.y = h;
      car.y = model.boat ? .05 - model.draft : model.heli ? floorAt(x, z, 999) : floorAt(x, z, 1);
      if (model.heli) {   // main rotor (two long blades) and tail rotor, spun in update()
        const bm = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
        car.rotor = new THREE.Group(); car.rotor.position.set(0, 2.72, 0);
        for (const a of [0, Math.PI / 2]) { const bl = new THREE.Mesh(new THREE.BoxGeometry(10.5, .05, .32), bm); bl.rotation.y = a; car.rotor.add(bl); }
        car.tailRotor = new THREE.Group(); car.tailRotor.position.set(.14, 2.0, -5.45);
        for (const a of [0, Math.PI / 2]) { const bl = new THREE.Mesh(new THREE.BoxGeometry(.04, 1.5, .14), bm); bl.rotation.x = a; car.tailRotor.add(bl); }
        car.body.add(car.rotor, car.tailRotor); car.spool = 0; car.vy = 0;
      }
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
      releaseLock(car); car.gone = true;
      scene.remove(car.root); car.geo.dispose();
      cars.splice(cars.indexOf(car), 1);
    }
    function floorAt(x, z, fromY) {
      let f = NB.water.floorAt(x, z);   // a car driven into the sea rolls down the sea bed
      for (const b of col.query(x - .5, z - .5, x + .5, z + .5, tmp)) {
        if (b.maxY > fromY + (b.ramp ? 2.5 : .45)) continue;   // at speed a car lags the bridge ramp; the road still holds it
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

    /* ---------- boats: slide on the water, stay in the sea ---------- */
    // deep enough open sea at (x, z) for a hull of this draft
    const navigable = (x, z, draft) => { const W = NB.water.at(x, z); return !!W && W.name === 'sea' && W.surface() - NB.water.floorAt(x, z) > draft + .35; };
    function boatPhysics(car, dt, ctl) {
      const pf = car.model.perf, fx = Math.sin(car.h), fz = Math.cos(car.h), rx = -Math.cos(car.h), rz = Math.sin(car.h);
      let vF = car.vx * fx + car.vz * fz, vR = car.vx * rx + car.vz * rz;
      const t = ctl.throttle, top = pf.top;
      if (t > 0) { if (vF < -.5) vF += pf.brake * t * dt; else vF += pf.accel * t * (1 - Math.min(1, Math.max(0, vF) / top) ** 2) * dt; }
      else if (t < 0) { if (vF > .5) vF -= pf.brake * -t * dt; else if (vF > -5) vF -= pf.accel * .35 * -t * dt; }
      vF -= vF * .22 * dt + Math.sign(vF) * Math.min(Math.abs(vF), (t === 0 ? 1.2 : .3) * dt);   // water drag
      car.steer = U.damp(car.steer, ctl.steer * pf.steer, 5, dt);
      // a boat turns by its rudder: it needs some speed, and the stern swings out
      const yaw = -Math.sign(vF) * Math.min(1, Math.abs(vF) / 6) * car.steer * (1.6 - .7 * Math.min(1, Math.abs(vF) / top));
      vR *= Math.exp(-pf.grip * dt);
      vR += yaw * Math.abs(vF) * .05 * dt * 10;
      car.yawRate = yaw; car.slip = Math.abs(vR);
      car.vx = fx * vF + rx * vR; car.vz = fz * vF + rz * vR;
      car.h += yaw * dt;
      const ox = car.x, oz = car.z;
      car.x += car.vx * dt; car.z += car.vz * dt;
      // running aground: the bow or the middle leaves deep water
      const bx = car.x + Math.sin(car.h) * car.model.l * .45, bz = car.z + Math.cos(car.h) * car.model.l * .45;
      if (!navigable(bx, bz, car.model.draft) || !navigable(car.x, car.z, car.model.draft)) {
        car.x = ox; car.z = oz;
        const s = Math.hypot(car.vx, car.vz); if (s > 3) impact(car, s * .6, bx, bz, -Math.sin(car.h), -Math.cos(car.h));
        car.vx *= -.2; car.vz *= -.2;
      }
      car.accel = (vF - (car.lastVF || 0)) / Math.max(dt, 1e-3); car.lastVF = vF;
      collideStatic(car);
    }
    // foam left behind a moving boat
    const wakeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .5, depthWrite: false });
    const wakes = [];
    for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), wakeMat.clone()); m.visible = false; m.life = 0; scene.add(m); wakes.push(m); }
    let wakeHead = 0;
    function wake(x, z, w, h) {
      const m = wakes[wakeHead]; wakeHead = (wakeHead + 1) % wakes.length;
      m.position.set(x, .07, z); m.rotation.y = h; m.scale.set(w, 1, 1.2); m.life = 1.8; m.w = w; m.visible = true;
    }

    /* ---------- driving physics (hero's car and loose cars) ---------- */
    /* ---------- helicopter: spool up, hover, fly, land on anything ---------- */
    // the ground under a helicopter: roofs, the road, or the water surface
    const heliGround = car => { const f = floorAt(car.x, car.z, car.y + .3), W = NB.water.at(car.x, car.z); return W ? Math.max(f, W.surface() + .1) : f; };
    function heliPhysics(car, dt, ctl) {
      const pf = car.model.perf, piloted = car.driver === 'player';
      car.spool = U.damp(car.spool, piloted ? 1 : 0, piloted ? .9 : .5, dt);
      const lift = car.spool > .75, ground = heliGround(car), air = car.y > ground + .25;
      // vertical: holds its height by itself, climbs or sinks on request, drops when the rotor stops
      const vyT = !lift ? (air ? -9 : 0) : ctl.up ? 7 : ctl.down ? -6 : 0;
      car.vy = U.damp(car.vy, vyT, 2.2, dt); car.y += car.vy * dt;
      if (car.y < ground) { if (car.vy < -6) impact(car, -car.vy * 1.5, car.x, car.z, 0, 1); car.y = ground; car.vy = 0; }
      if (car.y > 260) { car.y = 260; car.vy = Math.min(0, car.vy); }
      // horizontal: flies forward and back, turns on the spot, slides a little
      const fx = Math.sin(car.h), fz = Math.cos(car.h), rx = -Math.cos(car.h), rz = Math.sin(car.h);
      let vF = car.vx * fx + car.vz * fz, vR = car.vx * rx + car.vz * rz;
      if (air && lift) { vF += (ctl.throttle * pf.accel - vF * .28) * dt; vR *= Math.exp(-1.2 * dt); }
      else { vF *= Math.exp(-5 * dt); vR *= Math.exp(-5 * dt); }
      vF = U.clamp(vF, -8, pf.top);
      const yaw = lift && (air || Math.abs(ctl.steer) > .1) ? -ctl.steer * pf.steer : 0;
      car.yawRate = U.damp(car.yawRate || 0, yaw, 4, dt); car.h += car.yawRate * dt;
      car.vx = fx * vF + rx * vR; car.vz = fz * vF + rz * vR;
      car.x += car.vx * dt; car.z += car.vz * dt;
      car.accel = (vF - (car.lastVF || 0)) / Math.max(dt, 1e-3); car.lastVF = vF;
      collideStatic(car);
    }

    function physics(car, dt, ctl) {
      if (car.model.boat) return boatPhysics(car, dt, ctl);
      if (car.model.heli) return heliPhysics(car, dt, ctl);
      const pf = car.model.perf;
      // deep water floods the engine: no power, heavy drag, and the car is written off
      const W = NB.water.at(car.x, car.z);
      if (W && W.surface() - car.y > .8) {
        if (!car.flooded) { car.flooded = true; if (car.driver === 'player' && opts.onFlood) opts.onFlood(car); }
        ctl = { throttle: 0, steer: ctl.steer * .2, handbrake: false };
        car.vx *= Math.exp(-2.5 * dt); car.vz *= Math.exp(-2.5 * dt); car.damage = Math.max(car.damage, 120);
      }
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
          if (b.ramp || b.maxY <= car.y + .45 || b.minY >= car.y + 1.6) continue;
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
        if (a.ghostT > 0 || b.ghostT > 0 || Math.abs(a.y - b.y) > 2) continue;   // a helicopter overhead doesn't touch the cars below
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
    /* ---------- the road network: the city grid, the bridge and Palm Island's streets ---------- */
    // junctions (nodes) joined by streets (edges); traffic keeps right, a lane's width from the centre line
    const NET = { nodes: [], edges: [] };
    const addNode = (x, z) => { NET.nodes.push({ x, z, id: NET.nodes.length, nb: [] }); return NET.nodes.length - 1; };
    const addEdge = (a, b, lane, bridge) => {
      const A = NET.nodes[a], B = NET.nodes[b], e = { a, b, lane: lane || LANE, bridge: !!bridge, len: Math.hypot(B.x - A.x, B.z - A.z) };
      NET.edges.push(e); A.nb.push({ n: b, e }); B.nb.push({ n: a, e });
    };
    const GN = ROADS.length, gridNode = [];
    for (let i = 0; i < GN; i++) for (let j = 0; j < GN; j++) gridNode[i * GN + j] = addNode(ROADS[i], ROADS[j]);
    for (let i = 0; i < GN; i++) for (let j = 0; j < GN; j++) { if (i + 1 < GN) addEdge(gridNode[i * GN + j], gridNode[(i + 1) * GN + j]); if (j + 1 < GN) addEdge(gridNode[i * GN + j], gridNode[i * GN + j + 1]); }
    const IR = world.island && world.island.roads;
    if (IR) {
      const base = NET.nodes.length;
      for (const [x, z] of IR.nodes) addNode(x, z);
      for (const [a, b] of IR.links) addEdge(base + a, base + b, IR.lane);
      const [cx, cz] = IR.bridge.city, from = NET.nodes.find(n => n.x === cx && n.z === cz);
      if (from) addEdge(from.id, base + IR.bridge.island, LANE, true);
    }
    // shortest distances between all junctions, for the police and the ambulances finding their way
    const NN = NET.nodes.length, DIST = [];
    for (let i = 0; i < NN; i++) { DIST.push(new Float32Array(NN).fill(1e9)); DIST[i][i] = 0; }
    for (const e of NET.edges) { DIST[e.a][e.b] = DIST[e.b][e.a] = e.len; }
    for (let k = 0; k < NN; k++) for (let i = 0; i < NN; i++) for (let j = 0; j < NN; j++) if (DIST[i][k] + DIST[k][j] < DIST[i][j]) DIST[i][j] = DIST[i][k] + DIST[k][j];
    const unit = (A, B) => { const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };
    const laneOff = (d, lane) => [-d[1] * lane, d[0] * lane];
    // the edge nearest a point: the edge, the distance to it, and the point on it
    function nearestEdge(x, z) {
      let best = null, bd = Infinity;
      for (const e of NET.edges) {
        const A = NET.nodes[e.a], B = NET.nodes[e.b], dx = B.x - A.x, dz = B.z - A.z;
        const t = U.clamp(((x - A.x) * dx + (z - A.z) * dz) / (dx * dx + dz * dz), 0, 1), d = Math.hypot(A.x + dx * t - x, A.z + dz * t - z);
        if (d < bd) { bd = d; best = e; }
      }
      return { e: best, d: bd };
    }
    function releaseLock(car) { if (car.ai && car.ai.lock != null && locks.get(car.ai.lock) === car) locks.delete(car.ai.lock); if (car.ai) car.ai.lock = null; }
    function extend(ai) {
      const N = NET.nodes[ai.node], F = NET.nodes[ai.from], din = unit(F, N), key = N.id;
      const opts2 = N.nb.filter(o => o.n !== ai.from), dotOf = o => { const d = unit(N, NET.nodes[o.n]); return d[0] * din[0] + d[1] * din[1]; };
      const ahead = opts2.find(o => dotOf(o) > .95);
      // straight on half the time; a dead end means turning round
      const nx = ahead && chance(.5) ? ahead : opts2.length ? pick(opts2) : N.nb.find(o => o.n === ai.from);
      const M = NET.nodes[nx.n], dout = unit(N, M), straight = dout[0] * din[0] + dout[1] * din[1] > .95;
      const [ox, oz] = laneOff(din, ai.edge.lane), [px, pz] = laneOff(dout, nx.e.lane);
      const p0 = [N.x - din[0] * STOP + ox, N.z - din[1] * STOP + oz];
      const p2 = [N.x + dout[0] * STOP + px, N.z + dout[1] * STOP + pz];
      const p1 = straight ? [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2] : [N.x + ox + px, N.z + oz + pz];
      const last = ai.pts[ai.pts.length - 1]; last.lock = key;
      for (let k = 1; k <= 6; k++) {
        const t = k / 6, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
        ai.pts.push({ x: a * p0[0] + b * p1[0] + c * p2[0], z: a * p0[1] + b * p1[1] + c * p2[1], curve: !straight, unlock: k === 6 ? key : null });
      }
      ai.from = ai.node; ai.node = nx.n; ai.edge = nx.e;
      const [lx, lz] = laneOff(dout, nx.e.lane);
      ai.pts.push({ x: M.x - dout[0] * STOP + lx, z: M.z - dout[1] * STOP + lz });
    }
    function spawnTraffic(px, pz, fx, fz, near, model, minD, maxD) {
      const R = (maxD || 130) + 40;
      const near2 = NET.edges.filter(e => { if (e.bridge) return false; const A = NET.nodes[e.a], B = NET.nodes[e.b]; return Math.hypot((A.x + B.x) / 2 - px, (A.z + B.z) / 2 - pz) < R + e.len / 2; });
      if (!near2.length) return null;
      for (let tries = 0; tries < 12; tries++) {
        const e = pick(near2), fwdDir = chance(.5), a = fwdDir ? e.a : e.b, b = fwdDir ? e.b : e.a, A = NET.nodes[a], B = NET.nodes[b], d = unit(A, B);
        const [ox, oz] = laneOff(d, e.lane), t = rand(.1, .8);
        const ax = A.x + d[0] * STOP + ox, az = A.z + d[1] * STOP + oz;
        const bx = B.x - d[0] * STOP + ox, bz = B.z - d[1] * STOP + oz;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t, dist = Math.hypot(x - px, z - pz);
        if (dist > (maxD || 130) || dist < (minD || (near ? 15 : 45))) continue;
        if (!near && dist < 85 && ((x - px) * fx + (z - pz) * fz) / dist > .1) continue;
        if (cars.some(c => Math.hypot(c.x - x, c.z - z) < 12)) continue;
        const car = makeCar(model || pickModel(), x, z, Math.atan2(d[0], d[1]));
        car.driver = 'npc'; car.driverMesh.visible = true;
        car.ai = { node: b, from: a, edge: e, pts: [{ x, z }, { x: bx, z: bz }], k: 0, t: 0, v: rand(6, 9), cruise: rand(9, 13), lock: null, waitT: 0, honkT: 0, shock: 0 };
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
      if (!skipCars) for (const o of cars) if (o !== car && Math.abs(o.y - car.y) < 2) test(o.x, o.z, o.model.w / 2, o.driver === 'player');
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
    // nothing is parked in the way of the spray shop's door
    const sr = world.spray && world.spray.keepClear, clear = (x, z) => !sr || x < sr.x0 || x > sr.x1 || z < sr.z0 || z > sr.z1;
    for (const L of ROADS) for (let s = 0; s < ROADS.length - 1; s++) {
      const a = ROADS[s] + 12, b = ROADS[s + 1] - 12;
      for (const side of [-1, 1]) for (let t = a; t < b; t += rand(6.5, 9)) {
        if (!chance(.2)) continue;
        // road running along z at x = L
        if (!(L === -100 && side < 0)) makeCar(pickModel(), L + side * PARK, t, side < 0 ? 0 : Math.PI);
        if (chance(.5)) continue;
        if (!((L === 100 || L === -100) && side * L > 0) && clear(t, L + side * PARK)) makeCar(pickModel(), t, L + side * PARK, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
    {
      const lot = world.layout.blocks.find(b => b.type === 'parking');
      if (lot) {
        const lx0 = lot.bx0 + 3, lx1 = lot.bx1 - 3, rows = [lot.bz0 + 3 + 5.5, lot.bz1 - 3 - 5.5];
        for (const zz of rows) for (let x = lx0 + 2.5; x < lx1 - 1; x += 3) if (chance(.45) && clear(x, zz)) makeCar(pickModel(), x, zz, chance(.5) ? 0 : Math.PI);
      }
    }
    if (world.station) for (const [x, z, h] of world.station.parking) makeCar(byId.police, x, z, h);
    if (world.hospital) for (const [x, z, h] of world.hospital.parking) makeCar(byId.ambulance, x, z, h);
    if (world.island) for (const p of world.island.parking) makeCar(byId[p.id] || pickModel(), p.x, p.z, p.h);   // cars parked on Palm Island
    for (const c of cars) c.parked = true;

    /* ---------- police pursuit ---------- */

    // next junction to drive to, moving along the road grid towards (tx, tz)
    // the next junction to drive to on the way to (tx, tz), along the road network
    function nextGridPoint(x, z, tx, tz) {
      const c = nearestEdge(x, z), g = nearestEdge(tx, tz);
      if (c.e === g.e) return [tx, tz];
      const toGoal = k => Math.min(DIST[k][g.e.a] + Math.hypot(NET.nodes[g.e.a].x - tx, NET.nodes[g.e.a].z - tz), DIST[k][g.e.b] + Math.hypot(NET.nodes[g.e.b].x - tx, NET.nodes[g.e.b].z - tz));
      if (c.d > 9) { let bn = NET.nodes[0], bd = Infinity; for (const n of NET.nodes) { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; bn = n; } } return [bn.x, bn.z]; }
      // head for whichever end of this street is on the shorter way; once there, the next junction after it
      let k = null, kc = Infinity;
      for (const e of [c.e.a, c.e.b]) { const n = NET.nodes[e], cost = Math.hypot(n.x - x, n.z - z) + toGoal(e); if (cost < kc) { kc = cost; k = e; } }
      const K = NET.nodes[k];
      if (Math.hypot(K.x - x, K.z - z) > 7) return [K.x, K.z];
      if (k === g.e.a || k === g.e.b) return [tx, tz];
      let bn = null, bc = Infinity;
      for (const o of K.nb) { const cost = o.e.len + toGoal(o.n); if (cost < bc) { bc = cost; bn = NET.nodes[o.n]; } }
      return bn ? [bn.x, bn.z] : [tx, tz];
    }
    // the police station: units leave from the street in front of it and come back there
    const UNITS = [0, 1, 2, 3, 4, 5], RESPONSE = 2, NEXT_UNIT = 5;
    const D = { wantedT: 0, cd: 0 };
    const HQ = world.station ? { x: ROADS.find(r => r > world.station.cx) || ROADS[0], z: world.station.cz } : { x: ROADS[1], z: 0 };
    function dispatchUnit(t) {
      const north = t.z > HQ.z, x = HQ.x + (north ? -LANE : LANE), z = HQ.z;
      if (cars.some(c => Math.hypot(c.x - x, c.z - z) < 7)) return null;
      const car = makeCar(byId.police, x, z, north ? 0 : Math.PI);
      startPursuit(car); car.unit = true; car.crew = 2;
      return car;
    }
    function goHome(c) {
      c.sirenOn = false; c.returning = true; c.driver = 'cop'; c.driverMesh.visible = true; c.parked = false; c.awake = true;
      c.goto = { x: HQ.x + LANE, z: HQ.z, speed: 12, arrived: false };
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
      station: HQ,
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
        if (car.model.heli) {
          // only once it's down; step out onto whatever it landed on
          if (car.y > heliGround(car) + .6) return false;
          let bx = 0, bz = 0, by = -Infinity;
          for (const side of [-1, 1]) { const x = car.x + rx * side * (car.model.w / 2 + .9), z = car.z + rz * side * (car.model.w / 2 + .9), f = player.floorAt(x, z, car.y + .6); if (f > by) { by = f; bx = x; bz = z; } }
          player.place(bx, bz, car.h); player.y = by;
          car.driver = null; car.driverMesh.visible = false; driving = null; car.parked = false;
          audio.door(); if (audio.rotor) audio.rotor(0, 1);
          return true;
        }
        if (car.model.boat) {
          // step off onto the pier or the yacht platform if there is one alongside, otherwise into the water
          let best = null, bf = -Infinity;
          for (const side of [-1, 1]) {
            const x = car.x + rx * side * (car.model.w / 2 + .7), z = car.z + rz * side * (car.model.w / 2 + .7), f = player.floorAt(x, z, 1.2);
            if (f > bf) { bf = f; best = [x, z]; }
          }
          player.place(best[0], best[1], car.h);
          car.driver = null; car.driverMesh.visible = false; driving = null; car.parked = false;
          audio.door(); audio.engineOn(false);
          return true;
        }
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
          const v = Math.hypot(c.vx, c.vz); if (v < 2.2 || c.y > 3) continue;
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
          // new patrol cars only join the traffic while nobody is wanted (otherwise they'd appear out of thin air mid-chase)
          if (patrols < (lim.patrols || 0) && !((ctx.police || {}).wanted > 0)) spawnTraffic(player.x, player.z, fx, fz, first, byId.police);
          // wanted: patrol cars close by join in; the rest are sent out from the police station one after another,
          // one car (two officers) per star; a car lost on the way is replaced after a while
          const tgt = ctx.target || player;
          if (pol.wanted > 0) {
            D.wantedT += 1;
            for (const c of cars) if (c.police && (c.ai || c.returning) && Math.hypot(c.x - tgt.x, c.z - tgt.z) < 90) { c.returning = false; c.goto = null; startPursuit(c); }
            const units = cars.filter(c => c.police && (c.pursuit || c.exited)).length, need = UNITS[Math.min(5, pol.wanted)];
            D.cd -= 1;
            if (units < need && D.wantedT >= RESPONSE && D.cd <= 0 && dispatchUnit(tgt)) D.cd = NEXT_UNIT;
          } else {
            D.wantedT = 0; D.cd = 0;
            // it's over: cars drive back to the station; a car whose crew is out waits for them to get back in
            for (const c of cars) {
              if (!c.police) continue;
              if (c.pursuit) { c.pursuit = null; goHome(c); }
              else if (c.exited && c.driver !== 'player') { c.waitT = (c.waitT || 0) + 1; if ((c.crew || 0) <= 0 || c.waitT > 25) { c.exited = false; goHome(c); } }
            }
          }
          for (const c of cars.slice()) if (c.returning && (!c.visible && Math.hypot(c.x - player.x, c.z - player.z) > 120 || (c.goto && c.goto.arrived && Math.hypot(c.x - HQ.x, c.z - HQ.z) < 15))) removeCar(c);
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
            const ctl = { throttle: input.throttle, steer: input.move.x, handbrake: input.handbrake, up: input.handbrake, down: input.horn || input.sprint };
            physics(c, dt, ctl);
          } else if (c.awake && d < 90) {
            physics(c, dt, { throttle: 0, steer: 0, handbrake: true });
            if (Math.hypot(c.vx, c.vz) < .05) { c.vx = c.vz = 0; c.awake = false; }
          }
          c.beam.visible = night > .05 && !!c.driver && c.visible;
          if (!c.visible) { if (!c.model.heli && !c.model.boat && (c.pursuit || c.goto)) { const fy = floorAt(c.x, c.z, c.y); if (fy <= c.y + 1.5) c.y = fy; } continue; }
          // ride height over kerbs, body lean, wheels
          if (c.model.heli) {
            // blades turning, nose down in forward flight, banking into turns; ripples on the water beneath
            if (c !== driving) heliPhysics(c, dt, { throttle: 0, steer: 0 });
            const vH = speedOf(c);
            c.root.position.set(c.x, c.y, c.z); c.root.rotation.y = c.h;
            c.body.rotation.x = U.damp(c.body.rotation.x, U.clamp(vH * .011 + (c.accel || 0) * .01, -.25, .32), 3, dt);
            c.body.rotation.z = U.damp(c.body.rotation.z, U.clamp(-(c.yawRate || 0) * vH * .02, -.35, .35), 3, dt);
            c.rotor.rotation.y += c.spool * dt * 28; c.tailRotor.rotation.x += c.spool * dt * 45;
            const W = NB.water.at(c.x, c.z);
            if (W && c.spool > .5 && c.y - W.surface() < 9 && d < 90) { c.wakeT = (c.wakeT || 0) - dt; if (c.wakeT <= 0) { c.wakeT = .18; wake(c.x + (Math.random() - .5) * 3, c.z + (Math.random() - .5) * 3, 3.5 * (1 - (c.y - W.surface()) / 12), Math.random() * 6); } }
            continue;
          }
          if (c.model.boat) {
            // bob on the swell, lift the bow with speed, lean into turns, leave a wake
            const tt = performance.now() / 1000, vB = speedOf(c), wave = Math.sin(tt * 1.7 + c.x * .3 + c.z * .2);
            c.y = .05 - c.model.draft + wave * .05 + Math.min(.12, Math.abs(vB) * .004);
            c.root.position.set(c.x, c.y, c.z); c.root.rotation.y = c.h;
            c.body.rotation.x = U.damp(c.body.rotation.x, -U.clamp(vB * .007, -.03, .16) + Math.sin(tt * 1.3 + c.z) * .02, 3, dt);
            c.body.rotation.z = U.damp(c.body.rotation.z, U.clamp(c.yawRate * vB * .03, -.22, .22) + wave * .025, 4, dt);
            if (Math.abs(vB) > 2.5 && d < 90) { c.wakeT = (c.wakeT || 0) - dt; if (c.wakeT <= 0) { c.wakeT = .06; wake(c.x - Math.sin(c.h) * c.model.l * .5, c.z - Math.cos(c.h) * c.model.l * .5, c.model.w * (.9 + Math.min(1.5, Math.abs(vB) / 12)), c.h); } }
            continue;
          }
          const fy = floorAt(c.x, c.z, c.y);
          c.y = fy > c.y + 1.5 ? c.y : U.damp(c.y, fy, fy > c.y ? 26 : 14, dt);
          c.root.position.set(c.x, c.y, c.z); c.root.rotation.y = c.h;
          const vF = speedOf(c);
          c.body.rotation.z = U.damp(c.body.rotation.z, U.clamp(-c.yawRate * vF * .006, -.07, .07), 6, dt);
          c.body.rotation.x = U.damp(c.body.rotation.x, U.clamp(-(c.accel || 0) * .004, -.04, .04), 6, dt);
          if (d < 60) {
            c.spin += vF / c.model.r * dt;
            for (const w of c.wheels) { w.w.rotation.x = c.spin; if (w.front) w.g.rotation.y = c.steer; }
          }
          // smoke when badly damaged
          if (c.damage > 90 && d < 70 && !c.flooded) {
            c.smokeT -= dt;
            if (c.smokeT <= 0) { c.smokeT = c.damage > 150 ? .06 : .14; const [fx, fz] = fwd(c); puff(c.x + fx * (c.model.l / 2 - .8), c.y + 1.1, c.z + fz * (c.model.l / 2 - .8), c.damage > 150); }
          }
        }
        collideCars();
        for (const m of wakes) if (m.visible) { m.life -= dt; const f = 1 - m.life / 1.8; m.scale.set(m.w * (1 + f * 2.2), 1, 1.2 + f); m.material.opacity = Math.max(0, (1 - f) * .45); if (m.life <= 0) m.visible = false; }
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
        if (driving && driving.model.heli) { if (audio.rotor) audio.rotor(driving.spool, 1 + Math.abs(speedOf(driving)) / 60 + Math.max(0, driving.vy) * .02); }
        else if (driving && !driving.flooded) {
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
      setNight(n) { night = n; beamMat.opacity = n * .5; },
      // a car kept in the hero's garage, put back where it was parked
      spawnParked(id, x, z, h, color, accent) {
        const model = byId[id]; if (!model) return null;
        const car = makeCar(model, x, z, h); car.parked = true; car.garage = true;
        if (color) car.color = color; if (accent) car.accent = accent; paint(car);
        return car;
      },
      // the spray shop: a fresh coat of paint (police and ambulance keep their livery), dents and smoke gone
      respray(car) {
        if (!car.model.police && !car.model.ems) {
          const pal = car.model.palette.length > 2 ? car.model.palette : SPRAY_COLORS;
          let c = car.color; for (let k = 0; k < 8 && c === car.color; k++) c = pick(pal);
          car.color = c; car.accent = pick(car.model.accent);
        }
        car.damage = 0; car.flooded = false; car.smokeT = 0;
        car.geo.attributes.position.array.set(car.model.geo.attributes.position.array); car.geo.attributes.position.needsUpdate = true;
        paint(car);
      },
      speedKmh() { return driving ? Math.abs(speedOf(driving)) * 3.6 : 0; },
      // height above whatever is beneath the helicopter being flown
      heliAlt() { return driving && driving.model.heli ? Math.max(0, driving.y - heliGround(driving)) : null; }
    };
    return api;
  };
})(window.NB);
