// Ambulance service. When someone near the hero is lying dead or injured, an ambulance
// drives in with its siren on, two paramedics get out, work on the patient and get them
// back on their feet, then climb back in and the ambulance drives off to the hospital.
(function (NB) {
  'use strict';
  const { U } = NB;
  const THANKS = ['Спасибо, доктор!', 'Я жив?!', 'Ох, голова…', 'Спасибо вам!', 'Где я?'];
  const MEDIC = ['Пульс есть!', 'Держись, приятель!', 'Разряд!', 'Дышит!'];

  NB.createEMS = function (world, o) {
    const { ROADS } = world.layout;
    const units = [];
    let scanT = 1;
    const nearestIdx = v => { let bi = 0; for (let i = 1; i < ROADS.length; i++) if (Math.abs(ROADS[i] - v) < Math.abs(ROADS[bi] - v)) bi = i; return bi; };
    // a stopping point at the kerb of the road nearest the patient
    function kerbPoint(x, z) {
      const i = nearestIdx(x), j = nearestIdx(z);
      if (Math.abs(x - ROADS[i]) < Math.abs(z - ROADS[j])) return [ROADS[i] + (x >= ROADS[i] ? 3.4 : -3.4), U.clamp(z, -103, 103)];
      return [U.clamp(x, -103, 103), ROADS[j] + (z >= ROADS[j] ? 3.4 : -3.4)];
    }
    const alive = p => p && o.crowd.people.includes(p) && !p.dead;
    function releaseMedics(u) { for (const m of u.medics) if (alive(m)) o.crowd.releaseMedic(m); u.medics = []; }
    function leave(u) {
      if (u.patient && u.patient.ems === u) u.patient.ems = null;
      u.state = 'leave'; u.t = 0; u.car.sirenOn = false;
      const h = world.hospital;
      if (h) o.vehicles.driveTo(u.car, h.parking[0][0] - 6, h.parking[0][1] + 2, 11);
    }
    // the patient lies with feet at (p.x, p.z) and head towards where the blow came from
    function sides(p) {
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading), cx = p.x - fx * .9, cz = p.z - fz * .9, sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
      return [[cx + sx * .75, cz + sz * .75, Math.atan2(-sx, -sz)], [cx - sx * .75, cz - sz * .75, Math.atan2(sx, sz)]];
    }

    return {
      units,
      update(dt, player, camYaw, maxUnits) {
        // dispatch: the nearest person waiting for help gets the next free ambulance
        scanT -= dt;
        if (scanT <= 0) {
          scanT = .8;
          if (units.length < maxUnits) {
            let best = null, bd = 100;
            for (const p of o.crowd.people) {
              if (!(p.dead || p.down) || p.ems || p.fallT < 2) continue;
              const d = Math.hypot(p.x - player.x, p.z - player.z); if (d < bd) { bd = d; best = p; }
            }
            if (best) {
              const car = o.vehicles.spawnService('ambulance', player.x, player.z, -Math.sin(camYaw), -Math.cos(camYaw), 55, 120);
              if (car) {
                const [tx, tz] = kerbPoint(best.x, best.z);
                o.vehicles.driveTo(car, tx, tz, 14); car.sirenOn = true;
                const u = { car, patient: best, state: 'drive', t: 0, medics: [] };
                best.ems = u; units.push(u);
                if (o.onDispatch) o.onDispatch(u);
              }
            }
          }
        }
        for (const u of units.slice()) {
          u.t += dt;
          const car = u.car, p = u.patient;
          // the hero took the ambulance: the crew goes back to normal life
          if (!o.vehicles.cars.includes(car) || car.driver === 'player') {
            releaseMedics(u); if (p && p.ems === u) p.ems = null;
            units.splice(units.indexOf(u), 1); continue;
          }
          const patientOk = p && o.crowd.people.includes(p) && (p.dead || p.down);
          switch (u.state) {
            case 'drive':
              if (!patientOk) { leave(u); break; }
              if (car.goto && car.goto.arrived) {
                car.goto = null; car.vx = car.vz = 0;
                const rx = -Math.cos(car.h), rz = Math.sin(car.h);
                const spots = sides(p);
                for (let k = 0; k < 2; k++) {
                  const s = k ? 1 : -1, m = o.crowd.spawnMedic(car.x + rx * s * 1.4 - Math.sin(car.h) * 1.5, car.z + rz * s * 1.4 - Math.cos(car.h) * 1.5);
                  if (m) { m.medic.goal = [spots[k][0], spots[k][1]]; m.medic.face = spots[k][2]; u.medics.push(m); }
                }
                u.state = 'approach'; u.t = 0;
              } else if (u.t > 75) leave(u);
              break;
            case 'approach':
              if (!patientOk || u.medics.some(m => !alive(m))) { releaseMedics(u); leave(u); break; }
              if (u.medics.every(m => m.medic.arrived) || u.t > 25) {
                for (const m of u.medics) m.medic.kneel = true;
                u.state = 'treat'; u.t = 0;
                if (o.say && u.medics[0]) o.say(u.medics[0], MEDIC[(Math.random() * MEDIC.length) | 0]);
              }
              break;
            case 'treat':
              if (!patientOk || u.medics.some(m => !alive(m))) { releaseMedics(u); leave(u); break; }
              if (u.t > 5) {
                o.crowd.revive(p, 70);
                if (o.say) o.say(p, THANKS[(Math.random() * THANKS.length) | 0]);
                if (o.onRevive) o.onRevive(p);
                for (const m of u.medics) { m.medic.kneel = false; m.medic.goal = [car.x - Math.sin(car.h) * 3, car.z - Math.cos(car.h) * 3]; m.medic.face = null; }
                u.state = 'return'; u.t = 0;
              }
              break;
            case 'return':
              if (u.medics.every(m => !alive(m) || m.medic.arrived) || u.t > 20) {
                for (const m of u.medics) o.crowd.despawnPerson(m);
                u.medics = []; leave(u);
              }
              break;
            case 'leave': {
              const d = Math.hypot(car.x - player.x, car.z - player.z);
              if ((d > 95 && !car.visible) || d > 140 || (car.goto && car.goto.arrived && d > 40)) { o.vehicles.remove(car); units.splice(units.indexOf(u), 1); }
              break;
            }
          }
        }
      }
    };
  };
})(window.NB);
