// One city for everybody. Players close together (the same building, or within ~240 m outdoors) form a group on
// the server; the one who has been in the game longest runs the city for the whole group: its traffic and
// passers-by are made round every member (npc.js / vehicles.js: focus) and sent out a few times a second.
// The others don't make their own; they draw those cars and people where that game says they are.
// Every game also sends out what only it runs: its police units on a chase, its bodyguards.
// A punch or a bullet on someone another game runs, an arrest, help for the injured, getting into a car another
// game drives: the request goes to that game, which does it, and everybody sees the result.
(function (NB) {
  'use strict';
  const { U } = NB;
  const SEND_MS = 160;          // our cars and people, about six times a second
  const RANGE = 200;            // ...the ones within this of another member of the group
  const GONE_MS = 1500;         // not heard of for this long: gone
  const r2 = v => Math.round(v * 100) / 100;

  NB.createSync = function (o) {
    // o: net, crowd, vehicles, player, places, police, flash, enterCar(car), money
    const N = o.net, V = o.vehicles, C = o.crowd;
    let host = null, members = [], sendT = 0, nid = 0;
    const mirrorCars = new Map(), mirrorPeople = new Map();   // 'owner:id' -> { e, t, ... }
    const me = () => (N.me ? N.me.id : 0);
    // this game runs the city: alone, offline, or the group's host
    const runs = () => !host || host === me() || members.length < 2;

    N.on('role', m => {
      const was = runs();
      host = m.host; members = m.members || [];
      if (was && !runs()) {   // someone else runs the city now: our own traffic and passers-by give way to theirs
        V.clearAmbient(); C.clearAmbient(); if (o.onRuns) o.onRuns(false);
      } else if (!was && runs()) takeOver();
    });
    // the city is ours now (the old host left, or our connection is the better one): fill it straight away
    function takeOver() { if (V.refill) V.refill(); if (C.refill) C.refill(); if (o.onRuns) o.onRuns(true); }
    N.on('welcome', () => { const was = runs(); host = null; members = []; if (!was) takeOver(); });

    /* ---------- out: what this game runs, for the others ---------- */
    const ownCar = c => !c.remote && !c.mirror && !c.wreck && c !== V.driving && !c.owned && !c.sid && !(c.parked && !c.awake) &&
      (c.ai || c.pursuit || c.goto || c.returning || c.copHeli || c.autopilot || (c.driver && c.driver !== 'player'));
    const ownPerson = p => !p.mirror && !p.puppet;
    function others() { const out = []; for (const r of N.others.values()) if (members.includes(r.id)) out.push(r.av); return out; }
    function near(x, z, pts) { for (const q of pts) if (Math.abs(q.x - x) < RANGE && Math.abs(q.z - z) < RANGE) return true; return false; }
    function send() {
      const pts = others(); if (!pts.length) return;
      const cars = [], ppl = [];
      for (const c of V.cars) {
        if (!ownCar(c) || !near(c.x, c.z, pts)) continue;
        if (!c.nid) c.nid = ++nid;
        const f = (c.sirenOn ? 1 : 0) | (c.driver ? 2 : 0) | (c.burnT > 0 || c.wreckFireT > 0 ? 4 : 0);
        cars.push([c.nid, c.model.id, c.color, c.accent, r2(c.x), r2(c.y), r2(c.z), r2(c.h), r2(c.vx * Math.sin(c.h) + c.vz * Math.cos(c.h)), f]);
        if (cars.length >= 100) break;
      }
      for (const p of C.people) {
        if (!ownPerson(p) || !near(p.x, p.z, pts)) continue;
        if (!p.nid) p.nid = ++nid;
        const f = (p.dead ? 1 : 0) | (p.down ? 2 : 0) | (p.suspect ? 4 : 0) | (p.running ? 8 : 0);
        ppl.push([p.nid, p.look.type, p.look.seed, r2(p.x), r2(p.y), r2(p.z), r2(p.heading), p.anim, f]);
        if (ppl.length >= 150) break;
      }
      N.send({ t: 'ents', c: cars, p: ppl });
    }

    /* ---------- in: what other games run ---------- */
    N.on('ents', m => {
      if (!members.includes(m.o)) return;   // only from my group
      const t = performance.now();
      for (const e of m.c) {
        const k = m.o + ':' + e[0];
        let r = mirrorCars.get(k);
        if (!r || !V.cars.includes(r.car) || r.car.model.id !== e[1]) {
          if (r && V.cars.includes(r.car)) V.dropRemote(r.car);
          const car = V.remoteCar(e[1], e[2], e[3]); if (!car) continue;
          car.mirror = { owner: m.o, id: e[0] }; car.x = e[4]; car.y = e[5]; car.z = e[6]; car.h = e[7];
          r = { car }; mirrorCars.set(k, r);
        }
        r.e = e; r.t = t;
        const c = r.car; c.driverMesh.visible = !!(e[9] & 2); if (c.police || c.ems) c.sirenOn = !!(e[9] & 1);
      }
      for (const e of m.p) {
        const k = m.o + ':' + e[0];
        let r = mirrorPeople.get(k);
        if (!r || !C.people.includes(r.p)) {
          const p = C.spawnMirror(e[1], e[2], e[3], e[5], e[6]); if (!p) continue;
          p.mirrorOf = { owner: m.o, id: e[0] }; p.y = e[4];
          r = { p }; mirrorPeople.set(k, r);
        }
        const p = r.p, f = e[8];
        r.e = e; r.t = t;
        p.suspect = !!(f & 4);
        if (f & 1 || f & 2) { if (!p.dead && !p.down) { p.dead = !!(f & 1); p.down = !(f & 1); p.fallT = 0; p.deadT = 0; p.anim = 'dead'; } }
        else if (p.dead || p.down) { p.dead = false; p.down = false; p.fallT = 0; p.anim = 'idle'; }
        if (!p.dead && !p.down) p.puppet.anim = e[7] === 'aimwalk' ? 'walk' : e[7];
        p.running = !!(f & 8);
      }
    });
    // each frame: glide towards where the other game says they are
    function draw(dt) {
      const t = performance.now(), k = 1 - Math.exp(-10 * dt);
      for (const [key, r] of mirrorCars) {
        if (t - r.t > GONE_MS || !V.cars.includes(r.car)) { if (V.cars.includes(r.car)) V.dropRemote(r.car); mirrorCars.delete(key); continue; }
        const c = r.car, e = r.e;
        if (Math.hypot(e[4] - c.x, e[6] - c.z) > 15) { c.x = e[4]; c.z = e[6]; c.y = e[5]; c.h = e[7]; }
        c.x += (e[4] - c.x) * k; c.y += (e[5] - c.y) * k; c.z += (e[6] - c.z) * k; c.h += U.angDiff(c.h, e[7]) * k;
        c.rSpeed = e[8]; c.rPitch = 0; c.rBank = 0;
      }
      for (const [key, r] of mirrorPeople) {
        const p = r.p;
        if (t - r.t > GONE_MS || !C.people.includes(p)) { if (C.people.includes(p)) C.despawnPerson(p); mirrorPeople.delete(key); continue; }
        const e = r.e, px = p.x, pz = p.z;
        if (Math.hypot(e[3] - p.x, e[5] - p.z) > 8) { p.x = e[3]; p.z = e[5]; }
        p.x += (e[3] - p.x) * k; p.z += (e[5] - p.z) * k; p.y += (e[4] - p.y) * k; p.heading += U.angDiff(p.heading, e[6]) * k;
        p.speed = U.damp(p.speed || 0, dt > 0 ? Math.hypot(p.x - px, p.z - pz) / dt : 0, 8, dt);
      }
    }
    function clearMirrors() {
      for (const r of mirrorCars.values()) if (V.cars.includes(r.car)) V.dropRemote(r.car);
      for (const r of mirrorPeople.values()) if (C.people.includes(r.p)) C.despawnPerson(r.p);
      mirrorCars.clear(); mirrorPeople.clear();
    }

    /* ---------- requests: about someone else's car or person / about ours ---------- */
    const req = (owner, k, id, extra) => N.send(Object.assign({ t: 'ent_req', to: owner, k, id }, extra || {}));
    let pendingTake = null;
    N.on('ent_req', m => {
      if (m.k === 'take') {
        const c = V.cars.find(c => c.nid === m.id && !c.mirror);
        if (!c || c === V.driving) return N.send({ t: 'ent_res', to: m.from, k: 'take', id: m.id, ok: false });
        if (c.driver === 'npc' || c.ai) C.ejectDriver(c.x - Math.cos(c.h) * 1.4, c.z + Math.sin(c.h) * 1.4, c.h);
        const car = { m: c.model.id, c: c.color, a: c.accent, x: c.x, y: c.y, z: c.z, h: c.h, d: c.damage };
        V.dropRemote(c);
        N.send({ t: 'ent_res', to: m.from, k: 'take', id: m.id, ok: true, car });
        return;
      }
      const p = C.people.find(p => p.nid === m.id && !p.mirror); if (!p) return;
      if (m.k === 'hit') C.damage(p, m.d, { byPlayer: false, kind: m.kind || 'melee', x: m.x, z: m.z });
      else if (m.k === 'arrest') { p.suspect = false; setTimeout(() => C.despawnPerson(p), 900); }
      else if (m.k === 'revive') C.revive(p, 60);
    });
    N.on('ent_res', m => {
      if (m.k !== 'take' || !pendingTake || pendingTake.id !== m.id) return;
      const pt = pendingTake; pendingTake = null;
      if (!m.ok || !m.car) { o.flash('Не получилось — машина уехала', 1.6); return; }
      const e = m.car, car = V.spawnParked(e.m, e.x, e.z, e.h, e.c, e.a); if (!car) return;
      car.parked = false; car.damage = e.d || 0;
      for (const [key, r] of mirrorCars) if (r.car === pt.car) { if (V.cars.includes(r.car)) V.dropRemote(r.car); mirrorCars.delete(key); }
      o.enterCar(car, true);
    });

    const api = {
      get runsCity() { return runs(); },
      get host() { return host; },
      // the other members of my group, while this game runs the city: traffic and people are made round them too
      focus() { if (!runs()) return []; return others().map(a => ({ x: a.x, z: a.z })); },
      // the game asks: shall it make its own passers-by and traffic?
      ambient() { return runs(); },
      // a hit on someone another game runs: tell that game
      hitMirror(p, dmg, src) { const m = p.mirrorOf; if (m) req(m.owner, 'hit', m.id, { d: Math.round(dmg), kind: src && src.kind }); },
      arrest(p) { const m = p.mirrorOf; if (m) req(m.owner, 'arrest', m.id); },
      revive(p) { const m = p.mirrorOf; if (m) req(m.owner, 'revive', m.id); },
      // getting into a car another game drives: ask for it (the answer puts the hero in)
      take(car) { const m = car.mirror; if (!m || pendingTake) return; pendingTake = { id: m.id, car }; req(m.owner, 'take', m.id); setTimeout(() => { if (pendingTake && pendingTake.car === car) pendingTake = null; }, 3000); },
      update(dt) {
        if (!N.connected) { if (mirrorCars.size || mirrorPeople.size) clearMirrors(); if (!runs()) { host = null; members = []; takeOver(); } host = null; members = []; return; }
        if ((sendT += dt * 1000) >= SEND_MS) { sendT = 0; if (members.length > 1) send(); }
        draw(dt);
      }
    };
    NB.sync = api;
    return api;
  };
})(window.NB);
