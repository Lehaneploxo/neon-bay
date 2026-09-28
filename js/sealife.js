// Life on the water. Sailing yachts, motor cruisers and speedboats go round the city and Palm Island
// on their own courses, jet-skis play off the beaches, a couple of boats lie at anchor. They give way to
// each other and to the hero, and sound the horn at a boat in their way. Anyone of them can be taken.
// Wanted on the water from three stars, the coast guard comes out of the marina after the hero's boat.
(function (NB) {
  'use strict';
  const { U } = NB;
  const rand = U.rand, pick = a => a[(Math.random() * a.length) | 0];
  // courses: round the city (crossing under the bridge where it's high), round Palm Island, across the bay
  const COURSES = {
    city: [[190, 20], [196, -50], [160, -78], [160, -132], [60, -148], [-60, -148], [-148, -126], [-152, 0], [-148, 126], [-40, 150], [80, 150], [170, 128], [186, 70]],
    island: [[262, -78], [262, -134], [430, -142], [552, -122], [556, 0], [546, 126], [430, 142], [330, 136], [292, 60], [282, -20]],
    bay: [[205, 60], [300, 64], [305, -40], [205, -60], [220, 0]],
    jetCity: [[150, -85], [162, -70], [150, -55], [160, -10], [150, 15], [160, 30], [148, 5], [158, -40]],
    jetIsle: [[380, -122], [420, -127], [460, -120], [500, -128], [470, -134], [420, -119]]
  };
  // who goes where: model, course, how hard they push, where on the course they start
  const FLEET = [
    ['sailboat', 'city', .75, 0], ['cruiser', 'city', .6, 5], ['speedboat', 'city', .55, 9],
    ['sailboat', 'island', .75, 1], ['cruiser', 'island', .6, 6],
    ['speedboat', 'bay', .6, 0],
    ['jetski', 'jetCity', .7, 0], ['jetski', 'jetIsle', .75, 2]
  ];
  const ANCHORED = [['cruiser', -140, 70, .3], ['sailboat', 250, 108, 1.6], ['sailboat', -150, -60, 2.8]];
  const COAST = { x: 170, z: 34 };   // the coast guard's launches leave from off the marina

  NB.createSeaLife = function (world, o) {
    const V = o.vehicles, boats = [];
    let fleet = [];   // every boat on the water, refreshed each frame
    function launch(id, x, z, h) {
      const c = V.spawnParked(id, x, z, h);
      if (!c) return null;
      c.parked = false; c.garage = false; c.awake = true; c.driver = 'npc'; c.driverMesh.visible = true;
      return c;
    }
    // a boat steering itself along a course: returns the controls for this frame
    function pilot(b) {
      return (dt, c) => {
        const pts = COURSES[b.course], [tx, tz] = pts[b.k], dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
        if (d < 18) b.k = (b.k + 1) % pts.length;
        const diff = U.angDiff(c.h, Math.atan2(dx, dz)), fx = Math.sin(c.h), fz = Math.cos(c.h), sp = Math.hypot(c.vx, c.vz);
        let throttle = b.push * (Math.abs(diff) > 1 ? .5 : 1), steer = U.clamp(-diff * 1.6, -1, 1);
        // give way: something ahead within a boat's length or two
        for (const other of fleet) {
          if (other === c) continue;
          const ox = other.x - c.x, oz = other.z - c.z, od = Math.hypot(ox, oz); if (od > 22 || od < .1) continue;
          const ahead = (ox * fx + oz * fz) / od;
          if (ahead > .6) { throttle = od < 12 ? -.4 : throttle * .3; steer = (ox * fz - oz * fx) > 0 ? .8 : -.8; if (other === V.driving && (b.honkT -= dt) <= 0 && od < 14) { b.honkT = rand(3, 5); o.audio.horn([c.x, 1, c.z]); } }
        }
        // aground or caught on something: back off and try again
        if (sp < .6 && throttle > 0) { b.stuckT += dt; if (b.stuckT > 3) { b.revT = 2; b.stuckT = 0; } } else b.stuckT = 0;
        if (b.revT > 0) { b.revT -= dt; throttle = -.6; steer = -steer; }
        return { throttle, steer, handbrake: false };
      };
    }
    for (const [id, course, push, k] of FLEET) {
      const pts = COURSES[course], [x, z] = pts[k], [nx, nz] = pts[(k + 1) % pts.length];
      const b = { id, course, push, k: (k + 1) % pts.length, honkT: 0, stuckT: 0, revT: 0, car: null };
      b.car = launch(id, x, z, Math.atan2(nx - x, nz - z));
      if (b.car) b.car.autopilot = pilot(b);
      boats.push(b);
    }
    for (const [id, x, z, h] of ANCHORED) { const c = V.spawnParked(id, x, z, h); if (c) { c.garage = false; c.driverMesh.visible = true; } }

    /* ---------- the coast guard ---------- */
    const guards = [];
    function chase(g) {
      return (dt, c) => {
        const P = o.player, tgt = o.target(), home = g.home;
        let tx = tgt.x + (tgt.vx || 0) * .6, tz = tgt.z + (tgt.vz || 0) * .6;
        if (home) { tx = COAST.x; tz = COAST.z; }
        const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz), diff = U.angDiff(c.h, Math.atan2(dx, dz));
        let throttle = home ? (d > 12 ? .6 : 0) : 1, steer = U.clamp(-diff * 1.8, -1, 1);
        if (!home && !o.onWater() && d < 25) throttle = 0;   // the hero went ashore: wait off the beach
        if (Math.abs(diff) > 1.2) throttle *= .5;
        return { throttle, steer, handbrake: false };
      };
    }
    let guardT = 0;
    return {
      boats, guards,
      update(dt) {
        fleet = V.cars.filter(c => c.model.boat);
        // a boat someone took is no longer on its course; a sunk or lost one is replaced out of sight
        for (const b of boats) {
          const c = b.car;
          if (c && (c.driver === 'player' || !V.cars.includes(c))) { if (c.autopilot) c.autopilot = null; b.car = null; b.cool = 30; }
          if (!b.car && (b.cool -= dt) <= 0) {
            const pts = COURSES[b.course], P = o.player;
            let best = -1, bd = 0;
            pts.forEach(([x, z], i) => { const d = Math.hypot(x - P.x, z - P.z); if (d > bd && !V.cars.some(o2 => Math.hypot(o2.x - x, o2.z - z) < 15)) { bd = d; best = i; } });
            if (best >= 0 && bd > 150) { const [x, z] = pts[best], [nx, nz] = pts[(best + 1) % pts.length]; b.k = (best + 1) % pts.length; b.car = launch(b.id, x, z, Math.atan2(nx - x, nz - z)); if (b.car) b.car.autopilot = pilot(b); }
            else b.cool = 5;
          }
        }
        // three stars and more, and the hero in a boat: launches come out, one per star from three
        const w = o.police.wanted, want = o.onBoat() ? Math.max(0, w - 2) : 0;
        for (const g of guards.slice()) {
          const c = g.car;
          if (!V.cars.includes(c) || c.driver === 'player') { if (c.autopilot) c.autopilot = null; guards.splice(guards.indexOf(g), 1); continue; }
          if (w === 0 && !g.home) { g.home = true; c.sirenOn = false; }
          if (g.home && (Math.hypot(c.x - COAST.x, c.z - COAST.z) < 15 || (!c.visible && Math.hypot(c.x - o.player.x, c.z - o.player.z) > 150))) { V.remove(c); guards.splice(guards.indexOf(g), 1); }
        }
        const active = guards.filter(g => !g.home).length;
        if ((guardT -= dt) <= 0 && active < want) {
          guardT = 6;
          if (!V.cars.some(c => Math.hypot(c.x - COAST.x, c.z - COAST.z) < 10)) {
            const c = launch('policeboat', COAST.x, COAST.z, Math.atan2(o.player.x - COAST.x, o.player.z - COAST.z));
            if (c) { c.driver = 'cop'; c.sirenOn = true; c.coastGuard = true; const g = { car: c, home: false }; c.autopilot = chase(g); guards.push(g); if (guards.length === 1) o.flash('Береговая охрана вышла в море!', 2.2); }
          }
        }
        for (const g of guards) if (!g.home && w > 0) g.car.sirenOn = true;
      }
    };
  };
})(window.NB);
