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
      car.driverMesh = new THREE.Mesh(model.bike ? NB.riderGeo : NB.driverGeo, matMain); car.driverMesh.position.set(...model.seat); car.driverMesh.visible = false; car.body.add(car.driverMesh);
      car.wheels = model.wheels.map(([wx, wz, front]) => {
        const g = new THREE.Group(); g.position.set(wx, model.r, wz);
        const w = new THREE.Mesh(model.wheelGeo, matWheel); g.add(w); car.root.add(g);
        return { g, w, front };
      });
      car.beam = new THREE.Mesh(beamGeo, beamMat); car.beam.position.set(0, .07, model.l / 2 - .1); car.beam.visible = false; car.root.add(car.beam);
      car.root.rotation.y = h;
      car.y = model.boat ? .05 - model.draft : model.jet ? floorAt(x, z, 2) : model.heli ? floorAt(x, z, 999) : floorAt(x, z, 1);   // (the jet stands inside its hangar, not on the roof)
      if (model.jet) {   // afterburner flames behind the two engines, longer with more throttle
        car.rotor = new THREE.Group(); car.tailRotor = new THREE.Group(); car.spool = 0; car.vy = 0; car.spd = 0; car.pitch = 0; car.bank = 0;
        const fm = new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false });
        car.flames = [-.7, .7].map(x => { const f = new THREE.Mesh(new THREE.ConeGeometry(.32, 1, 10).rotateX(-Math.PI / 2).translate(0, 0, -.5), fm); f.position.set(x, 1.4, -6.4); f.scale.set(1, 1, .01); car.body.add(f); return f; });
      } else if (model.heli) {   // main rotor (two long blades) and tail rotor, spun in update()
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

    /* ---------- standing on cars ----------
       Each model's top surface, sampled once from its body: a grid of heights over the footprint (the bonnet,
       the roof, the boot). The hero can jump onto a car and stand on it, and rides along when it moves. */
    const tops = new Map(), RC = new THREE.Raycaster(), DOWNV = new THREE.Vector3(0, -1, 0), RO = new THREE.Vector3();
    const NA = 12, NC = 5;
    function topMap(model) {
      let m = tops.get(model.id); if (m) return m;
      const mesh = new THREE.Mesh(model.geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld(true);
      m = new Float32Array(NA * NC);
      for (let i = 0; i < NA; i++) for (let j = 0; j < NC; j++) {
        RO.set((j + .5) / NC * model.w - model.w / 2, 20, (i + .5) / NA * model.l - model.l / 2);
        RC.set(RO, DOWNV); const hit = RC.intersectObject(mesh, false)[0];
        m[i * NC + j] = hit ? hit.point.y : 0;
      }
      mesh.material.dispose(); tops.set(model.id, m); return m;
    }
    const standable = c => !c.model.boat && !c.model.heli && !c.model.jet && !c.flooded;
    // the height of a car's top over a world point, or null if the point isn't over the car
    function carTop(c, x, z) {
      const [fx, fz] = fwd(c), [rx, rz] = right(c), dx = x - c.x, dz = z - c.z, L = c.model.l, Wd = c.model.w;
      const t = dx * fx + dz * fz, s = -(dx * rx + dz * rz);   // along the car, and across it (model x is to the car's left)
      if (Math.abs(t) > L / 2 || Math.abs(s) > Wd / 2) return null;
      const i = Math.min(NA - 1, ((t + L / 2) / L * NA) | 0), j = Math.min(NC - 1, ((s + Wd / 2) / Wd * NC) | 0);
      return c.y + topMap(c.model)[i * NC + j];
    }

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
    function impact(car, strength, px, pz, nx, nz, other) {
      if (strength >= 2.5 && (car.driver === 'player' || (other && other.driver === 'player'))) car.blame = true;
      if (strength < 2.5) return;
      if (car.hitT > 0 && strength < 8) return;
      car.hitT = .25;
      // police cars and ambulances nudging each other (or a kerb) through a jam don't wreck themselves; the hero's car and guns do
      const service = (car.pursuit || car.goto) && car.driver !== 'player' && !(other && other.driver === 'player');
      car.damage += strength * 2.2 * (service ? .15 : 1) * (car.model.armor || 1);
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
      const pf = car.model.perf, piloted = car.driver === 'player' || !!car.copHeli;
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

    // the fighter: ГАЗ is thrust (afterburner), ТОРМОЗ the air brake, the stick banks and turns, ВВЕРХ / ВНИЗ pull the
    // nose up or push it down. It takes off at 140 km/h, tops out over 600 km/h, stalls if it gets too slow in the air,
    // and hitting the ground hard (or nose first) is the end of it
    const JET_TAKEOFF = 40, JET_STALL = 30;
    function jetPhysics(car, dt, ctl) {
      const pf = car.model.perf, piloted = car.driver === 'player';
      if (car.wreck) { const g = heliGround(car); car.spd = 0; car.vx = car.vz = 0; car.vy -= 20 * dt; car.y += car.vy * dt; if (car.y < g) { car.y = g; car.vy = 0; } return; }   // a wreck just falls
      car.spool = U.damp(car.spool, piloted ? 1 : 0, piloted ? 1.2 : .6, dt);
      const ground = heliGround(car), air = car.y > ground + .4, thr = car.spool > .6 ? ctl.throttle : 0;
      // speed: thrust, air brake, drag; climbing costs speed and diving gains it
      if (thr > 0) car.spd += pf.accel * thr * (1 - Math.min(1, car.spd / pf.top) ** 3) * dt;
      else if (thr < 0) car.spd -= (air ? pf.brake * .6 : pf.brake) * -thr * dt;
      else if (air) car.spd -= car.spd * .015 * dt;
      else car.spd -= Math.sign(car.spd) * Math.min(Math.abs(car.spd), 5 * dt);   // rolling to a stop on the runway
      if (air) car.spd -= Math.sin(car.pitch) * 9.8 * dt;
      car.spd = U.clamp(car.spd, air ? 0 : -3, pf.top * 1.08);
      // nose: up or down on request; on the runway it stays level until there's speed to fly; too slow in the air, it drops
      let want = ctl.up ? .55 : ctl.down ? -.6 : 0;
      if (!air) want = ctl.up && car.spd >= JET_TAKEOFF ? .3 : 0;
      if (air && car.spd < JET_STALL) want = -.7;
      car.pitch = U.damp(car.pitch, want, air ? 1.8 : 3, dt);
      // turning: banks into it in the air, steers the nose wheel on the ground
      car.bank = U.damp(car.bank, air ? ctl.steer * 1.05 : 0, 3, dt);
      const yaw = air ? -ctl.steer * pf.steer * (.55 + Math.min(1, car.spd / 80) * .45) : -ctl.steer * .9 * Math.min(1, Math.abs(car.spd) / 6);
      car.yawRate = U.damp(car.yawRate || 0, yaw, 3, dt); car.h += car.yawRate * dt;
      // the edge of the map: the autopilot banks it round and back over the islands
      const WB = world.bounds, M = 150, sx = Math.sin(car.h), sz = Math.cos(car.h);
      if (WB && air && ((car.x < WB.x0 + M && sx < .2) || (car.x > WB.x1 - M && sx > -.2) || (car.z < WB.z0 + M && sz < .2) || (car.z > WB.z1 - M && sz > -.2))) {
        const home = Math.atan2((WB.x0 + WB.x1) / 2 - car.x, (WB.z0 + WB.z1) / 2 - car.z), d = U.angDiff(car.h, home);
        car.h += U.clamp(d * 2, -1, 1) * 2.2 * dt; car.bank = U.damp(car.bank, -Math.sign(d) * .9, 3, dt);
        if (!car.edgeWarn && car.driver === 'player' && opts.onJetEdge) opts.onJetEdge(); car.edgeWarn = true;
      } else car.edgeWarn = false;
      const cp = Math.cos(car.pitch), fx = Math.sin(car.h), fz = Math.cos(car.h);
      car.vx = fx * car.spd * cp; car.vz = fz * car.spd * cp; car.vy = Math.sin(car.pitch) * car.spd;
      if (!air && car.pitch <= .05) car.vy = Math.min(0, car.vy);
      if (!air && !(car.spd >= JET_TAKEOFF && ctl.up)) car.vy = Math.min(car.vy, 0);
      car.x += car.vx * dt; car.z += car.vz * dt; car.y += car.vy * dt;
      if (air && car.spd < 55) car.y -= (55 - car.spd) / 55 * 7 * dt;   // slow, it sinks: brake to come down for a landing
      if (car.y > 600) { car.y = 600; car.pitch = Math.min(car.pitch, 0); }
      // touching down: gently is a landing, hard or nose first is a crash
      if (car.y < ground) {
        const hard = car.vy < -9 || car.pitch < -.25;
        car.y = ground; car.vy = 0; if (car.pitch < 0) car.pitch = 0;
        if (hard && air && !car.wreck) { car.spd = 0; explode(car); }
      }
      car.accel = 0; car.lastVF = car.spd;
      if (WB) { car.x = U.clamp(car.x, WB.x0 + 30, WB.x1 - 30); car.z = U.clamp(car.z, WB.z0 + 30, WB.z1 - 30); }   // never into the wall at the edge of the world
      const before = [car.x, car.z]; collideStatic(car);
      if (Math.hypot(car.x - before[0], car.z - before[1]) > .05 && car.spd > 25 && !car.wreck) { car.spd = 0; explode(car); }   // into a building at speed
    }

    function physics(car, dt, ctl) {
      if (car.model.boat) return boatPhysics(car, dt, ctl);
      if (car.model.jet) return jetPhysics(car, dt, ctl);
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
      const wet = car.driver === 'player' && opts.slip ? 1 - opts.slip() : 1;   // rain on the road
      const grip = (ctl.handbrake ? 1.1 : pf.grip * (Math.abs(vR) > 6 ? .6 : 1)) * wet;
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
            impact(a, -vn, px, pz, -nx, -nz, b); impact(b, -vn, px, pz, nx, nz, a);
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
    for (const IR of [world.island && world.island.roads, world.north && world.north.roads, world.bay && world.bay.roads]) {
      if (!IR) continue;
      const base = NET.nodes.length;
      for (const [x, z] of IR.nodes) addNode(x, z);
      for (const [a, b] of IR.links) { addEdge(base + a, base + b, IR.lane); if (!IR.north) NET.edges[NET.edges.length - 1].island = true; }
      if (IR.bridge) {
        const [cx, cz] = IR.bridge.city, from = NET.nodes.find(n => n.x === cx && n.z === cz);
        if (from) { addEdge(from.id, base + IR.bridge.island, LANE, !IR.north); if (IR.north) NET.edges[NET.edges.length - 1].narrow = true; }   // the North Side bridge is short and low: traffic can start on it
      }
      // Bayview's two low bridges, from junctions on the North Side and on Palm Island
      for (const br of IR.bridges || []) { const from = NET.nodes.find(n => Math.abs(n.x - br.from[0]) < .01 && Math.abs(n.z - br.from[1]) < .01); if (from) { addEdge(from.id, base + br.to, LANE); NET.edges[NET.edges.length - 1].narrow = true; } }
    }
    // shortest distances between all junctions, for the police and the ambulances finding their way
    const NN = NET.nodes.length, DIST = [], HOP = [];
    for (let i = 0; i < NN; i++) { DIST.push(new Float32Array(NN).fill(1e9)); DIST[i][i] = 0; HOP.push(new Int16Array(NN).fill(-1)); HOP[i][i] = i; }
    for (const e of NET.edges) { DIST[e.a][e.b] = DIST[e.b][e.a] = e.len; HOP[e.a][e.b] = e.b; HOP[e.b][e.a] = e.a; }
    for (let k = 0; k < NN; k++) for (let i = 0; i < NN; i++) for (let j = 0; j < NN; j++) if (DIST[i][k] + DIST[k][j] < DIST[i][j]) { DIST[i][j] = DIST[i][k] + DIST[k][j]; HOP[i][j] = HOP[i][k]; }
    const unit = (A, B) => { const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };
    const laneOff = (d, lane) => [-d[1] * lane, d[0] * lane];
    // the edge nearest a point: the edge, the distance to it, and the point on it
    function nearestEdge(x, z) {
      let best = null, bd = Infinity;
      for (const e of NET.edges) {
        const A = NET.nodes[e.a], B = NET.nodes[e.b], dx = B.x - A.x, dz = B.z - A.z;
        const t = U.clamp(((x - A.x) * dx + (z - A.z) * dz) / (dx * dx + dz * dz), 0, 1), d = Math.hypot(A.x + dx * t - x, A.z + dz * t - z);
        if (d < bd) { bd = d; best = { e, px: A.x + dx * t, pz: A.z + dz * t }; }
      }
      return { e: best.e, d: bd, px: best.px, pz: best.pz };
    }
    // the shortest way along the streets from (ax, az) to (bx, bz): points to draw and its length
    function route(ax, az, bx, bz) {
      const A = nearestEdge(ax, az), B = nearestEdge(bx, bz), pts = [[ax, az], [A.px, A.pz]];
      if (A.e !== B.e) {
        let best = null, bc = Infinity;
        for (const i of [A.e.a, A.e.b]) for (const j of [B.e.a, B.e.b]) {
          const I = NET.nodes[i], J = NET.nodes[j], c = Math.hypot(I.x - A.px, I.z - A.pz) + DIST[i][j] + Math.hypot(J.x - B.px, J.z - B.pz);
          if (c < bc) { bc = c; best = [i, j]; }
        }
        for (let k = best[0], n = 0; k >= 0 && n < NN; n++) { pts.push([NET.nodes[k].x, NET.nodes[k].z]); if (k === best[1]) break; k = HOP[k][best[1]]; }
      }
      pts.push([B.px, B.pz], [bx, bz]);
      let len = 0; for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      return { pts, len };
    }
    // where a car stops at the kerb nearest (x, z): on the road, a few metres off the centre line on that side
    function kerbPoint(x, z, off) {
      const n = nearestEdge(x, z), dx = x - n.px, dz = z - n.pz, L = Math.hypot(dx, dz) || 1;
      return [n.px + dx / L * (off || 3.4), n.pz + dz / L * (off || 3.4)];
    }
    // a service vehicle leaving its base: on the road at (ex, ez), in the lane heading towards (tx, tz)
    function spawnDepot(id, ex, ez, tx, tz) {
      const n = nearestEdge(ex, ez), A = NET.nodes[n.e.a], B = NET.nodes[n.e.b];
      let d = unit(A, B); if ((tx - n.px) * d[0] + (tz - n.pz) * d[1] < 0) d = [-d[0], -d[1]];
      const [ox, oz] = laneOff(d, n.e.lane), x = n.px + ox, z = n.pz + oz;
      if (cars.some(c => Math.hypot(c.x - x, c.z - z) < (c.parked && !c.awake ? 2.4 : 7))) return null;   // traffic in the way, or a car parked right there
      const car = makeCar(byId[id], x, z, Math.atan2(d[0], d[1]));
      car.parked = false; car.awake = true; car.driver = byId[id].police ? 'cop' : 'ems'; car.driverMesh.visible = true;
      return car;
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
    const keep = [world.spray, world.fireStation].filter(Boolean).map(o => o.keepClear), clear = (x, z) => keep.every(r => x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1);
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
    if (world.military) for (const p of world.military.parking) { const c = makeCar(byId[p.id], p.x, p.z, p.h); c.parked = true; }   // Base Omega's jeeps, trucks, tank and helicopter
    if (world.bay) for (const p of world.bay.parking) makeCar(byId[p.id] || pickModel(), p.x, p.z, p.h);   // Bayview: driveways, car parks, taxis at the airport
    if (world.north) for (const p of world.north.parking) { const c = makeCar(byId[p.id] || pickModel(), p.x, p.z, p.h); c.damage = Math.random() * 80; paint(c); }   // old bangers on the North Side
    // a Gelendwagen at the kerb outside the villa, a Porta Panamo outside Hotel OCEAN (whatever was parked there moves off)
    for (const [id, x, z, h] of [['gwagon', 104.9, 88, Math.PI], ['panamo', 95.1, -27, 0], ['vento', 104.9, 82.5, Math.PI], ['vespino', 95.1, -21.5, 0], ['hog', 95.1, -33, 0]]) {
      for (const c of cars.slice()) if (Math.hypot(c.x - x, c.z - z) < 5) removeCar(c);
      makeCar(byId[id], x, z, h);
    }
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
      let bn = null, bc = Infinity, be = null;
      for (const o of K.nb) { const cost = o.e.len + toGoal(o.n); if (cost < bc) { bc = cost; bn = NET.nodes[o.n]; be = o.e; } }
      if (!bn) return [tx, tz];
      // onto a narrow bridge: first line up on its centre line at the entrance (and slow down for it)
      if (be.narrow) { const d = unit(K, bn), g = [K.x + d[0] * 16, K.z + d[1] * 16]; g.gate = true; return g; }
      return [bn.x, bn.z];
    }
    // the police station: units leave from the street in front of it and come back there
    // cars on the case per star; seconds between two cars leaving the station. The station sends them as a
    // wave: losses aren't replaced one by one, but once the whole wave is gone (the officers dead, the cars
    // lost) a fresh wave for the current stars leaves WAVE seconds later
    const UNITS = [0, 1, 2, 4, 6, 8], NEXT_UNIT = [0, 5, 5, 3, 3, 3], RESPONSE = 2, WAVE = 60;
    const D = { wantedT: 0, cd: 0, sent: 0, waveT: 0 };
    let heat = 0;   // the current wanted level, for how hard the cars drive
    const HQ = world.station ? { x: ROADS.find(r => r > world.station.cx) || ROADS[0], z: world.station.cz } : { x: ROADS[1], z: 0 };
    function dispatchUnit(t) {
      const car = spawnDepot('police', HQ.x, HQ.z, t.x, t.z);
      if (!car) return null;
      startPursuit(car); car.unit = true; car.crew = 2;
      return car;
    }
    // 5 stars: a police helicopter takes off from the station roof, circles over the hero and keeps a spotlight on them
    let copHeli = null;
    const spotCone = new THREE.Mesh(new THREE.CylinderGeometry(.35, 4.2, 1, 20, 1, true).translate(0, -.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: .15, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const spotDisc = new THREE.Mesh(new THREE.CircleGeometry(4.2, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    spotCone.visible = spotDisc.visible = false; spotCone.frustumCulled = false; scene.add(spotCone, spotDisc);
    const DOWN = new THREE.Vector3(0, -1, 0), BEAM = new THREE.Vector3();
    function launchHeli() {
      const st = world.station; if (!st) return;
      const car = makeCar(byId.heli, st.cx, st.cz, Math.PI / 2);
      car.color = '#1c2a4a'; car.accent = '#f5f5f0'; paint(car);
      car.copHeli = { ang: Math.random() * 6, sx: st.cx, sz: st.cz, leaving: false };
      car.driver = 'cop'; car.driverMesh.visible = true; car.parked = false; car.awake = true;
      copHeli = car;
    }
    function heliAI(c, dt, tgt) {
      const H = c.copHeli, st = world.station || { cx: 0, cz: 0 };
      let tx, tz;
      if (H.leaving) { tx = st.cx; tz = st.cz; }
      else { H.ang += dt * .22; tx = tgt.x + Math.sin(H.ang) * 24; tz = tgt.z + Math.cos(H.ang) * 24; }
      const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz), diff = U.angDiff(c.h, Math.atan2(dx, dz));
      // above the downtown roofs; held up by something taller (the tower): climb over it
      const held = Math.hypot(c.vx, c.vz) < 2 && dist > 30 && Math.abs(diff) < .5;
      H.climb = held ? Math.min(4, (H.climb || 0) + dt) : Math.max(0, (H.climb || 0) - dt * .25);
      const alt = Math.max(heliGround(c) + 26, H.leaving ? 75 : 62) + (H.climb > 1 ? 100 : 0);
      let throttle = dist > 6 ? U.clamp(dist / 25, .25, 1) : 0; if (Math.abs(diff) > 1) throttle *= .3;
      heliPhysics(c, dt, { throttle, steer: U.clamp(-diff * 1.8, -1, 1), up: c.y < alt - 1.5, down: c.y > alt + 1.5 });
      // the spotlight trails the hero a little
      H.sx = U.damp(H.sx, tgt.x, 2.5, dt); H.sz = U.damp(H.sz, tgt.z, 2.5, dt);
      if (H.leaving && (dist < 10 || (!c.visible && Math.hypot(c.x - tgt.x, c.z - tgt.z) > 200))) { removeCar(c); copHeli = null; }
    }
    function spotUpdate(P) {
      const c = copHeli, on = !!c && !c.copHeli.leaving && c.spool > .8;
      spotCone.visible = spotDisc.visible = on; if (!on) return;
      const H = c.copHeli, gy = floorAt(H.sx, H.sz, (P.y || 0) + 1) + .05;
      spotDisc.position.set(H.sx, gy, H.sz);
      BEAM.set(H.sx - c.x, gy - (c.y + .6), H.sz - c.z); const L = BEAM.length();
      spotCone.position.set(c.x, c.y + .6, c.z); spotCone.scale.set(1, L, 1); spotCone.quaternion.setFromUnitVectors(DOWN, BEAM.normalize());
      spotCone.material.opacity = .06 + night * .16; spotDisc.material.opacity = .12 + night * .3;
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
      const inCar = !tgt.onFoot, tsp = Math.hypot(tgt.vx || 0, tgt.vz || 0), vF = speedOf(car);
      // 4-5 stars: one car races ahead of the hero and swings across the road
      if (P.role === 'block' && inCar) {
        if (P.blockT > 0) {
          P.blockT -= dt;
          const spin = P.blockT > 4.3;
          physics(car, dt, { throttle: spin ? .4 : vF > .5 ? -1 : 0, steer: spin ? P.blockSide : 0, handbrake: true });
          if (P.blockT <= 0) P.role = null;
          return;
        }
        const ahead = tsp > 1 ? ((car.x - tgt.x) * tgt.vx + (car.z - tgt.z) * tgt.vz) / tsp : 0;
        const side = tsp > 1 ? Math.abs((car.x - tgt.x) * tgt.vz - (car.z - tgt.z) * tgt.vx) / tsp : 99;
        if (tsp > 6 && ahead > 7 && ahead < 35 && side < 5) { P.blockT = 5; P.blockSide = Math.random() < .5 ? 1 : -1; return; }
        if (P.los && dist < 60) { ax = tgt.x + tgt.vx * 2.5; az = tgt.z + tgt.vz * 2.5; }
      } else if (inCar && P.los && dist < 30 && heat >= 3) {
        // 3+ stars: aim for where the hero's car is about to be, and hit it
        const k = Math.min(.8, dist / 20); ax = tgt.x + (tgt.vx || 0) * k; az = tgt.z + (tgt.vz || 0) * k;
      }
      const want = Math.atan2(ax - car.x, az - car.z), diff = U.angDiff(car.h, want);
      let throttle = 1, steer = U.clamp(-diff * 2.2, -1, 1);
      // fewer stars: sit on the hero's tail without ramming
      if (inCar && heat < 3 && P.los && dist < 11) throttle = vF > tsp + 1 ? -.4 : .35;
      if (tgt.onFoot && P.los && dist < 15) {
        throttle = vF > 1 ? -1 : 0;
        if (Math.abs(vF) < 1.5) { P.exitT += dt; if (P.exitT > .5 && opts.onCopsExit) { opts.onCopsExit(car); car.pursuit = null; car.driver = null; car.driverMesh.visible = false; car.parked = true; car.exited = true; return; } }
      } else if (Math.abs(diff) > 1.3 && vF > 9) throttle = -.7;
      else if (P.wp && P.wp.gate && Math.hypot(P.wp[0] - car.x, P.wp[1] - car.z) < 35 && vF > 10) throttle = -.6;   // lining up for the narrow bridge
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

    /* ---------- fire and explosions ---------- */
    // a car smashed or shot up badly enough catches fire; if nobody puts it out it blows up after a few seconds,
    // hurting everyone near it, throwing cars about (which may catch fire in turn) and leaving a burnt-out wreck
    const BURN_AT = 200, BURN_TIME = 8;
    const flameTex = U.canvasTex(64, 64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,245,200,1)'); gr.addColorStop(.35, 'rgba(255,170,60,.9)'); gr.addColorStop(.7, 'rgba(230,70,20,.45)'); gr.addColorStop(1, 'rgba(160,30,10,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }, false);
    const flames = [];
    for (let i = 0; i < 70; i++) { const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); f.visible = false; f.life = 0; scene.add(f); flames.push(f); }
    let flameHead = 0;
    function flame(x, y, z, size, life, vy) {
      const f = flames[flameHead]; flameHead = (flameHead + 1) % flames.length;
      f.position.set(x, y, z); f.life = f.max = life; f.size = size; f.vy = vy; f.visible = true; f.scale.set(size, size, 1); f.material.opacity = 1;
    }
    const scorch = [];
    const scorchMat = new THREE.MeshBasicMaterial({ color: 0x0c0a0a, transparent: true, opacity: .55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    function blast(x, y, z, blame) {
      for (let k = 0; k < 14; k++) flame(x + (Math.random() - .5) * 3, y + .8 + Math.random() * 2.2, z + (Math.random() - .5) * 3, 2.5 + Math.random() * 3, .6 + Math.random() * .5, 2 + Math.random() * 3);
      for (let k = 0; k < 8; k++) puff(x + (Math.random() - .5) * 3, y + 1.5 + Math.random() * 2, z + (Math.random() - .5) * 3, true);
      if (scorch.length > 12) scene.remove(scorch.shift());
      const sc = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20).rotateX(-Math.PI / 2), scorchMat); sc.position.set(x, floorAt(x, z, y + .5) + .03, z); scene.add(sc); scorch.push(sc);
      audio.explosion([x, y + 1, z]);
      for (const c of cars) {
        if (c === driving || c.model.heli && c.y > y + 4) continue;
        const dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz); if (d > 9) continue;
        const k = 1 - d / 9;
        if (c.ai) c.ai.shock = 2.5; else if (d > .01) { c.vx += dx / d * 9 * k; c.vz += dz / d * 9 * k; c.awake = true; }
        c.damage += 160 * k; if (blame) c.blame = true; paint(c);
      }
      if (opts.onExplode) opts.onExplode(x, y, z, blame, null);
    }
    function explode(car) {
      const x = car.x, z = car.z, y = car.y, blame = !!car.blame;
      car.wreck = true; car.burnT = 0; car.wreckFireT = 30; car.damage = Math.max(car.damage, 300); car.sirenOn = false;
      if (car.ai) { releaseLock(car); car.ai = null; }
      car.pursuit = null; car.goto = null; car.exited = false; car.returning = false; car.parked = false; car.awake = true;
      if (car !== driving) { car.driver = null; car.driverMesh.visible = false; }
      car.color = '#1c1917'; car.accent = '#141210'; paint(car);
      car.hop = 1; car.vx += (Math.random() - .5) * 3; car.vz += (Math.random() - .5) * 3;
      // the fireball
      for (let k = 0; k < 16; k++) flame(x + (Math.random() - .5) * 3, y + .8 + Math.random() * 2.2, z + (Math.random() - .5) * 3, 2.5 + Math.random() * 3, .6 + Math.random() * .5, 2 + Math.random() * 3);
      for (let k = 0; k < 10; k++) puff(x + (Math.random() - .5) * 3, y + 1.5 + Math.random() * 2, z + (Math.random() - .5) * 3, true);
      if (scorch.length > 12) scene.remove(scorch.shift());
      const sc = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20).rotateX(-Math.PI / 2), scorchMat); sc.position.set(x, floorAt(x, z, y + .5) + .03, z); scene.add(sc); scorch.push(sc);
      audio.explosion([x, y + 1, z]);
      // the blast: other cars are shoved and damaged
      for (const c of cars) {
        if (c === car || c.model.heli && c.y > y + 4) continue;
        const dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz); if (d > 9 || d < .01) continue;
        const k = 1 - d / 9;
        if (c.ai) { c.ai.shock = 2.5; } else { c.vx += dx / d * 9 * k; c.vz += dz / d * 9 * k; c.awake = true; }
        c.damage += 130 * k; if (blame) c.blame = true; paint(c);
      }
      if (opts.onExplode) opts.onExplode(x, y, z, blame, car);
    }
    function fireStep(dt, player) {
      for (const c of cars) {
        if (c.model.heli || c.model.boat || c.flooded) continue;
        if (!c.wreck && !c.burnT && c.damage >= BURN_AT) { c.burnT = BURN_TIME; if (c === driving && opts.onCarFire) opts.onCarFire(c); }
        if (c.burnT > 0) { c.burnT -= dt; if (c.burnT <= 0) { c.burnT = 0; explode(c); } }
        if (c.wreckFireT > 0) c.wreckFireT -= dt;
        if (c.hop > 0) c.hop = Math.max(0, c.hop - dt * 1.6);
        const burning = c.burnT > 0 || c.wreckFireT > 0;
        if (!burning || !c.visible) continue;
        const d = Math.hypot(c.x - player.x, c.z - player.z); if (d > 90) continue;
        c.flameT = (c.flameT || 0) - dt;
        if (c.flameT <= 0) {
          const [fx, fz] = fwd(c), big = c.wreck ? Math.max(.4, c.wreckFireT / 30) : .5 + (1 - c.burnT / BURN_TIME) * .8;
          const ex = c.wreck ? 0 : c.model.l / 2 - .9;
          c.flameT = .05;
          flame(c.x + fx * ex + (Math.random() - .5) * c.model.w * .7, c.y + .9 + Math.random() * .4, c.z + fz * ex + (Math.random() - .5) * 1.2, 1.1 * big + Math.random() * .6, .5 + Math.random() * .3, 1.6);
          if (Math.random() < .35) puff(c.x + fx * ex, c.y + 1.6, c.z + fz * ex, true);
        }
      }
      for (const f of flames) if (f.visible) {
        f.life -= dt; f.position.y += f.vy * dt; const k = f.life / f.max;
        f.scale.set(f.size * (1.2 - k * .4), f.size * (1.3 - k * .3), 1); f.material.opacity = Math.max(0, k);
        if (f.life <= 0) f.visible = false;
      }
    }

    /* ---------- public ---------- */
    let popT = 0, first = true, driving = null;
    const api = {
      cars,
      // the highest car top under a point that's no higher than maxY: { y, car } or null
      topAt(x, z, maxY) {
        let best = null;
        for (const c of cars) {
          if (!standable(c) || Math.abs(c.x - x) > 4 || Math.abs(c.z - z) > 4) continue;
          const y = carTop(c, x, z);
          if (y != null && y - c.y > .25 && y <= maxY && (!best || y > best.y)) best = { y, car: c };
        }
        return best;
      },
      get driving() { return driving; },
      station: HQ,
      get heli() { return copHeli; },
      nearest(player) {
        let best = null, bd = Infinity;
        for (const c of cars) {
          if (c.wreck) continue;
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
          if (car.y > heliGround(car) + .6 && !force) return false;   // (a crash throws you out wherever it happens)
          let bx = 0, bz = 0, by = -Infinity;
          for (const side of [-1, 1]) { const x = car.x + rx * side * (car.model.w / 2 + .9), z = car.z + rz * side * (car.model.w / 2 + .9), f = player.floorAt(x, z, car.y + .6); if (f > by) { by = f; bx = x; bz = z; } }
          player.place(bx, bz, car.h); player.y = by;
          car.driver = null; car.driverMesh.visible = false; driving = null; car.parked = false;
          audio.door(); if (audio.rotor) audio.rotor(0, 1); if (car.model.jet) audio.engineOn(false);
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
        for (const c of cars) { c.px = c.x; c.pz = c.z; c.ph = c.h; c.py = c.y; }   // where each car was: the hero standing on one rides along
        // population: keep traffic around the hero, drop far away cars
        popT -= dt;
        if (popT <= 0) {
          popT = 1;
          const lim = limits();
          for (const c of cars.slice()) {
            const d = Math.hypot(c.x - player.x, c.z - player.z);
            if (c.ai && d > 150) removeCar(c);
            else if (!c.ai && !c.parked && c !== driving && !c.pursuit && !c.goto && !c.copHeli && !c.autopilot && d > 170 && cars.length > 70) removeCar(c);   // units on their way stay
            else if (c.wreck && !c.visible && d > 110) removeCar(c);
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
            // a unit still on the case: a car chasing with its crew inside, or one whose officers got out and one of them is still standing
            const onCase = c => c.police && c !== driving && !c.wreck && !c.flooded && (c.pursuit || (c.exited && people.some(p => p.unit === c && !p.dead && !p.down)));
            const w = Math.min(5, pol.wanted), units = cars.filter(onCase).length, need = UNITS[w];
            D.cd -= 1;
            if (D.waveT > 0) { if ((D.waveT -= 1) <= 0) D.sent = 0; }                                    // the next wave is on its way
            else if (units === 0 && D.sent > 0) { D.waveT = WAVE; if (opts.onWaveDown) opts.onWaveDown(WAVE); }   // the whole wave is down
            if (D.waveT <= 0 && D.sent < need && D.wantedT >= RESPONSE && D.cd <= 0 && dispatchUnit(tgt)) { D.cd = NEXT_UNIT[w]; D.sent++; }
            if (w >= 4 && !tgt.onFoot && !cars.some(c => c.pursuit && c.pursuit.role === 'block')) {
              const c = cars.find(c => c.pursuit && c.pursuit.los && Math.hypot(c.x - tgt.x, c.z - tgt.z) < 60);
              if (c) c.pursuit.role = 'block';
            }
            if (w >= 5 && !copHeli && D.wantedT >= RESPONSE + 3) launchHeli();
          } else {
            D.wantedT = 0; D.cd = 0; D.sent = 0; D.waveT = 0;
            // it's over: cars drive back to the station; a car whose crew is out waits for them to get back in
            for (const c of cars) {
              if (!c.police) continue;
              if (c.pursuit) { c.pursuit = null; goHome(c); }
              else if (c.exited && c.driver !== 'player') { c.waitT = (c.waitT || 0) + 1; if ((c.crew || 0) <= 0 || c.waitT > 25) { c.exited = false; goHome(c); } }
            }
          }
          if (copHeli && pol.wanted < 5) copHeli.copHeli.leaving = true;
          for (const c of cars.slice()) if (c.returning && (!c.visible && Math.hypot(c.x - player.x, c.z - player.z) > 120 || (c.goto && c.goto.arrived && Math.hypot(c.x - HQ.x, c.z - HQ.z) < 15))) removeCar(c);
          first = false;
          for (const c of cars) { const d = Math.hypot(c.x - player.x, c.z - player.z); c.visible = d < lim.carRange; c.root.visible = c.visible; }
        }
        for (const c of cars) {
          c.hitT -= dt; if (c.heroHitT > 0) c.heroHitT -= dt; if (c.ghostT > 0) c.ghostT -= dt;
          const d = Math.hypot(c.x - player.x, c.z - player.z);
          if (c.copHeli) heliAI(c, dt, ctx.target || player);
          else if (c.ai) updateAI(c, dt, people, player);
          else if (c.pursuit) pursuitStep(c, dt, ctx.target || player);
          else if (c.goto && c !== driving) gotoStep(c, dt);
          else if (c === driving) {
            const ctl = { throttle: input.throttle, steer: input.move.x, handbrake: input.handbrake, up: input.handbrake, down: input.horn || input.sprint };
            physics(c, dt, ctl);
          } else if (c.autopilot) physics(c, dt, c.autopilot(dt, c));
          else if (c.awake && d < 90) {
            physics(c, dt, { throttle: 0, steer: 0, handbrake: true });
            if (Math.hypot(c.vx, c.vz) < .05) { c.vx = c.vz = 0; c.awake = false; }
          }
          c.beam.visible = night > .05 && !!c.driver && c.visible;
          if (!c.visible) { if (!c.model.heli && !c.model.boat && (c.pursuit || c.goto)) { const fy = floorAt(c.x, c.z, c.y); if (fy <= c.y + 1.5) c.y = fy; } continue; }
          // ride height over kerbs, body lean, wheels
          if (c.model.heli) {
            // blades turning, nose down in forward flight, banking into turns; ripples on the water beneath
            if (c.model.jet) {
              if (c !== driving) jetPhysics(c, dt, { throttle: 0, steer: 0 });
              c.root.position.set(c.x, c.y, c.z); c.root.rotation.y = c.h;
              c.body.rotation.x = -c.pitch; c.body.rotation.z = c.bank;
              const burn = c === driving ? Math.max(0, input.throttle) : 0, len = c.spool > .3 ? .4 + burn * 2.2 + Math.random() * .3 * (burn + .2) : .01;
              for (const f of c.flames) { f.scale.set(1, 1, len); f.material.opacity = .5 + burn * .45; }
              continue;
            }
            if (c !== driving && !c.copHeli) heliPhysics(c, dt, { throttle: 0, steer: 0 });
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
          const hop = c.hop > 0 ? Math.sin(c.hop * Math.PI) * 1.6 : 0;
          c.root.position.set(c.x, c.y + hop, c.z); c.root.rotation.y = c.h;
          const vF = speedOf(c);
          // a motorbike leans into the turn (and stands upright when it stops); a car just rolls a little
          if (c.model.bike) c.body.rotation.z = U.damp(c.body.rotation.z, U.clamp(c.yawRate * vF * .05, -.6, .6), 5, dt);
          else c.body.rotation.z = U.damp(c.body.rotation.z, U.clamp(-c.yawRate * vF * .006, -.07, .07), 6, dt);
          c.body.rotation.x = U.damp(c.body.rotation.x, U.clamp(-(c.accel || 0) * .004, -.04, .04), 6, dt);
          if (c.rockT > 0) { c.rockT -= dt; const s = Math.sin(performance.now() / 1000 * 13); c.body.rotation.z = s * .045; c.body.position.y = Math.abs(s) * .035; } else if (c.body.position.y) c.body.position.y = 0;
          if (d < 60) {
            c.spin += vF / c.model.r * dt;
            for (const w of c.wheels) { w.w.rotation.x = c.spin; if (w.front) w.g.rotation.y = c.steer; }
          }
          // smoke when badly damaged
          if (c.damage > 90 && d < 70 && !c.flooded && !c.burnT && !c.wreck) {
            c.smokeT -= dt;
            if (c.smokeT <= 0) { c.smokeT = c.damage > 150 ? .06 : .14; const [fx, fz] = fwd(c); puff(c.x + fx * (c.model.l / 2 - .8), c.y + 1.1, c.z + fz * (c.model.l / 2 - .8), c.damage > 150); }
          }
        }
        collideCars();
        fireStep(dt, player);
        // a police car or an ambulance that ended up in the sea is out of the job (the station sends another)
        for (const c of cars) if (c.flooded && (c.pursuit || c.goto) && c !== driving) { c.pursuit = null; c.goto = null; c.sirenOn = false; c.driver = null; c.driverMesh.visible = false; c.returning = false; c.exited = false; c.parked = false; }
        heat = (ctx.police || { wanted: 0 }).wanted;
        spotUpdate(ctx.target || player);
        for (const m of wakes) if (m.visible) { m.life -= dt; const f = 1 - m.life / 1.8; m.scale.set(m.w * (1 + f * 2.2), 1, 1.2 + f); m.material.opacity = Math.max(0, (1 - f) * .45); if (m.life <= 0) m.visible = false; }
        // the hero on foot is shoved out of the way by cars
        if (!driving) for (const c of cars) {
          if (Math.abs(c.x - player.x) > 5 || Math.abs(c.z - player.z) > 5) continue;
          for (const [cx, cz, r] of circles(c)) {
            const dx = player.x - cx, dz = player.z - cz, d = Math.hypot(dx, dz), min = r + .34;
            if (d < min && d > 1e-4) {
              if (standable(c)) { const k = Math.min(d, r * .8) / d, top = carTop(c, cx + dx * k, cz + dz * k); if (top != null && player.y >= top - .3) continue; }
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
          if (on && (c.pursuit || c.goto || c.coastGuard)) sirens.push([Math.hypot(c.x - player.x, c.z - player.z), c]);
        }
        sirens.sort((a, b) => a[0] - b[0]);
        audio.sirens(sirens.slice(0, 2).filter(s => s[0] < 110).map(s => [s[1].x, 1.4, s[1].z]));
        // sound for the hero's car
        if (driving && driving.model.jet) audio.engine(.35 + Math.min(1, Math.abs(driving.spd) / driving.model.perf.top) * .65, Math.max(.3, input.throttle), 'jet');
        else if (driving && driving.model.heli) { if (audio.rotor) audio.rotor(driving.spool, 1 + Math.abs(speedOf(driving)) / 60 + Math.max(0, driving.vy) * .02); }
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
        car.blame = true;
        car.damage += dmg * .35 * (car.model.armor || 1); paint(car);
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
      route, kerbPoint, spawnDepot,
      // island streets, for taxi fares over there: [x0, z0, x1, z1] centre lines
      islandStreets() { return NET.edges.filter(e => e.island).map(e => [NET.nodes[e.a].x, NET.nodes[e.a].z, NET.nodes[e.b].x, NET.nodes[e.b].z]); },
      // fires the fire brigade should go to: burning cars and burning wrecks
      fires() { return cars.filter(c => (c.burnT > 0 || c.wreckFireT > 3) && !c.model.heli); },
      extinguish(c) { if (c.burnT > 0) { c.burnT = 0; c.damage = BURN_AT - 40; paint(c); } c.wreckFireT = 0; },
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
      blast,
      heliAlt() { return driving && driving.model.heli ? Math.max(0, driving.y - heliGround(driving)) : null; }
    };
    return api;
  };
})(window.NB);
