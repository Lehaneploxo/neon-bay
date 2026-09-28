// Taxi job. Get into a yellow Downtown Cab and the shift starts: a fare appears at the kerb waving
// at you (yellow marker), stop next to them and they get in, then drive them to the yellow beacon
// before the meter runs out. The route is drawn on the minimap. Fast, smooth rides pay tips,
// fares in a row pay a streak bonus, and crashes into things upset the passenger.
(function (NB) {
  'use strict';
  const { U } = NB;
  const rand = U.rand, pick = a => a[(Math.random() * a.length) | 0];
  const HELLO = ['Поехали, шеф!', 'Жми, опаздываю!', 'Добрый вечер!', 'Только без лихачества!', 'Мне срочно!', 'Прокатимся?'];
  const THANKS = ['Спасибо, шеф!', 'Вот это скорость!', 'Сдачи не надо!', 'Отличная поездка!', 'Ещё увидимся!'];
  const LATE = ['Ну наконец-то…', 'Пешком было бы быстрее!', 'Я опоздал из-за вас!'];
  const HIT = ['Эй, полегче!', 'Смотри на дорогу!', 'Мы так не доедем!', 'Ай! Аккуратнее!'];
  const SCARED = ['Выпустите меня!', 'Я в этом не участвую!', 'Остановите машину!'];

  NB.createTaxi = function (scene, world, o) {
    const { ROADS, blocks } = world.layout, N = ROADS.length;
    const S = { on: false, car: null, phase: 'idle', p: null, look: null, pick: null, dest: null, waitT: 0, boardT: 0,
      timer: 0, limit: 0, base: 0, hits: 0, hitT: 0, streak: 0, earned: 0, rides: 0, route: [], routeLen: 0, routeT: 0, late: false };

    /* ---------- markers ---------- */
    const Y = 0xffd84f;
    const glass = () => new THREE.MeshBasicMaterial({ color: Y, transparent: true, opacity: .26, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const fareMark = new THREE.Group();
    fareMark.add(new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 3.4, 16, 1, true).translate(0, 1.7, 0), glass()));
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(.3, .55, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: Y, fog: false }));
    fareMark.add(arrow); fareMark.visible = false; scene.add(fareMark);
    const destMark = new THREE.Group();
    destMark.add(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 9, 28, 1, true).translate(0, 4.5, 0), glass()));
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.75, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: Y, transparent: true, opacity: .8, fog: false, depthWrite: false }));
    ring.position.y = .08; destMark.add(ring); destMark.visible = false; scene.add(destMark);
    // the passenger on the back seat, dressed like the person who got in
    const seatMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    let rider = null;
    function seatPassenger(car, look) {
      removeRider();
      const c = h => new THREE.Color(h || '#888888'), M = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
      const geo = NB.mergeParts([
        [new THREE.BoxGeometry(.4, .5, .24), M(0, .25, 0), c(look.col.torso)],
        [new THREE.BoxGeometry(.22, .25, .23), M(0, .66, 0), c(look.col.head)],
        [new THREE.BoxGeometry(.235, .07, .245), M(0, .79, 0), c(look.col.hairTop)]]);
      rider = new THREE.Mesh(geo, seatMat);
      const s = car.model.seat; rider.position.set(-s[0], s[1], s[2] - 1.05);
      car.body.add(rider);
    }
    function removeRider() { if (rider) { rider.parent && rider.parent.remove(rider); rider.geometry.dispose(); rider = null; } }

    /* ---------- places at the kerb ---------- */
    // a spot on the sidewalk facing a road, and where a car should stop next to it
    const islandStreets = o.vehicles.islandStreets ? o.vehicles.islandStreets() : [];
    const col = world.col, clearAt = (x, z) => !NB.water.at(x, z) && !col.query(x - .5, z - .5, x + .5, z + .5, []).some(b => b.maxY > .9 && x > b.minX - .4 && x < b.maxX + .4 && z > b.minZ - .4 && z < b.maxZ + .4);
    function islandSpot() {
      for (let k = 0; k < 12; k++) {
        const [x0, z0, x1, z1] = islandStreets[(Math.random() * islandStreets.length) | 0], t = rand(.2, .8), L = Math.hypot(x1 - x0, z1 - z0) || 1, s = Math.random() < .5 ? 1 : -1;
        const nx = -(z1 - z0) / L * s, nz = (x1 - x0) / L * s, mx = x0 + (x1 - x0) * t, mz = z0 + (z1 - z0) * t;
        const x = mx + nx * 6.6, z = mz + nz * 6.6;
        if (clearAt(x, z)) return { x, z, face: Math.atan2(-nx, -nz), cx: mx + nx * 3, cz: mz + nz * 3 };
      }
      return null;
    }
    const onIsland = x => x > 300;
    // a spot at the kerb: in the city, or on the island when asked (or when the cab is over there)
    function kerbSpotNear(island) { return island && islandStreets.length ? islandSpot() || kerbSpot() : kerbSpot(); }
    function kerbSpot() {
      const b = blocks[(Math.random() * blocks.length) | 0], side = (Math.random() * 4) | 0, t = rand(.22, .78);
      let x, z, nx = 0, nz = 0;
      if (side === 0) { x = b.bx0 + 1.5; z = b.bz0 + (b.bz1 - b.bz0) * t; nx = -1; }
      else if (side === 1) { x = b.bx1 - 1.5; z = b.bz0 + (b.bz1 - b.bz0) * t; nx = 1; }
      else if (side === 2) { z = b.bz0 + 1.5; x = b.bx0 + (b.bx1 - b.bx0) * t; nz = -1; }
      else { z = b.bz1 - 1.5; x = b.bx0 + (b.bx1 - b.bx0) * t; nz = 1; }
      return { x, z, face: Math.atan2(nx, nz), cx: x + nx * 4.5, cz: z + nz * 4.5 };
    }

    /* ---------- routes on the road grid (Dijkstra over the junctions) ---------- */
    function project(x, z) {
      let bi = 0, bj = 0;
      for (let i = 1; i < N; i++) { if (Math.abs(x - ROADS[i]) < Math.abs(x - ROADS[bi])) bi = i; if (Math.abs(z - ROADS[i]) < Math.abs(z - ROADS[bj])) bj = i; }
      if (Math.abs(x - ROADS[bi]) <= Math.abs(z - ROADS[bj])) {
        const zz = U.clamp(z, ROADS[0], ROADS[N - 1]); let j = 0; while (j < N - 2 && ROADS[j + 1] <= zz) j++;
        return { x: ROADS[bi], z: zz, ends: [bi * N + j, bi * N + j + 1] };
      }
      const xx = U.clamp(x, ROADS[0], ROADS[N - 1]); let i = 0; while (i < N - 2 && ROADS[i + 1] <= xx) i++;
      return { x: xx, z: ROADS[bj], ends: [i * N + bj, (i + 1) * N + bj] };
    }
    function route(ax, az, bx, bz) {
      if (o.vehicles.route) return o.vehicles.route(ax, az, bx, bz);
      const A = project(ax, az), B = project(bx, bz), IA = N * N, IB = N * N + 1, n = N * N + 2;
      const pos = k => (k === IA ? [A.x, A.z] : k === IB ? [B.x, B.z] : [ROADS[(k / N) | 0], ROADS[k % N]]);
      const edges = k => {
        const out = [];
        if (k === IA) { out.push(...A.ends); if (A.ends[0] === B.ends[0] && A.ends[1] === B.ends[1]) out.push(IB); return out; }
        if (k === IB) return out;
        const i = (k / N) | 0, j = k % N;
        if (i > 0) out.push(k - N); if (i < N - 1) out.push(k + N); if (j > 0) out.push(k - 1); if (j < N - 1) out.push(k + 1);
        if (B.ends.includes(k)) out.push(IB);
        return out;
      };
      const dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
      dist[IA] = 0;
      for (;;) {
        let u = -1; for (let k = 0; k < n; k++) if (!done[k] && dist[k] < Infinity && (u < 0 || dist[k] < dist[u])) u = k;
        if (u < 0 || u === IB) break;
        done[u] = true; const pu = pos(u);
        for (const v of edges(u)) { const pv = pos(v), d = dist[u] + Math.abs(pv[0] - pu[0]) + Math.abs(pv[1] - pu[1]); if (d < dist[v]) { dist[v] = d; prev[v] = u; } }
      }
      const pts = [[bx, bz]];
      for (let k = IB; k >= 0; k = prev[k]) pts.push(pos(k));
      pts.push([ax, az]); pts.reverse();
      let len = 0; for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      return { pts, len };
    }

    /* ---------- the shift ---------- */
    const speed = car => Math.hypot(car.vx, car.vz);
    const sideDoor = (car, out) => { const rx = -Math.cos(car.h), rz = Math.sin(car.h), k = car.model.w / 2 + (out || .7); return [car.x + rx * k, car.z + rz * k, Math.atan2(rx, rz)]; };
    const fareOk = p => p && o.crowd.people.includes(p) && !p.dead && !p.down && p.fare && p.fleeT <= 0 && p.fightT <= 0;

    function start(car) {
      Object.assign(S, { on: true, car, phase: 'seek', waitT: 1.5, streak: 0, earned: 0, rides: 0, p: null, look: null, dest: null, route: [] });
      o.flash('Смена таксиста началась: пассажир машет рукой у жёлтой метки', 4);
    }
    function dropPassenger(text, flee) {
      if (!S.look || !S.car) return;
      const [x, z, h] = sideDoor(S.car);
      const p = o.crowd.dropOff(x, z, h, S.look, text);
      if (p && flee) { p.fleeT = rand(5, 8); p.fleeX = S.car.x; p.fleeZ = S.car.z; }
      S.look = null; removeRider(); o.audio.door();
    }
    function loseFare() { if (S.p) o.crowd.releaseFare(S.p); S.p = null; }
    function end() {
      if (S.phase === 'ride') dropPassenger('Ну и сервис!');
      loseFare();
      if (S.rides) o.flash('Смена окончена · поездок: ' + S.rides + ' · заработано $' + S.earned, 3.5);
      else o.flash('Смена таксиста окончена', 2);
      Object.assign(S, { on: false, car: null, phase: 'idle', dest: null, route: [] });
      fareMark.visible = destMark.visible = false;
    }
    function toSeek(wait) { S.phase = 'seek'; S.waitT = wait; S.dest = null; S.route = []; destMark.visible = false; fareMark.visible = false; }

    function spawnFare(car) {
      const fx = Math.sin(car.h), fz = Math.cos(car.h);
      let best = null, bs = Infinity;
      for (let k = 0; k < 30; k++) {
        const s = kerbSpotNear(onIsland(car.x)), dx = s.x - car.x, dz = s.z - car.z, d = Math.hypot(dx, dz);
        if (d < 30 || d > 85) continue;
        const score = d - 25 * (dx * fx + dz * fz) / d;
        if (score < bs) { bs = score; best = s; }
      }
      if (!best) return false;
      const p = o.crowd.spawnFare(best.x, best.z, best.face);
      if (!p) return false;
      S.p = p; S.pick = best; S.phase = 'pickup';
      return true;
    }
    function pickDestination() {
      if (islandStreets.length && Math.random() < .3) {
        const s = kerbSpotNear(!onIsland(S.car.x));
        if (s) { const r = route(S.car.x, S.car.z, s.cx, s.cz); S.far = true; return { s, len: r.len }; }
      }
      S.far = false;
      let best = null, bd = Infinity;
      for (let k = 0; k < 40; k++) {
        const s = kerbSpotNear(onIsland(S.car.x)), r = route(S.car.x, S.car.z, s.cx, s.cz);
        const miss = r.len < 140 ? 140 - r.len : r.len > 330 ? r.len - 330 : 0;
        if (miss < bd) { bd = miss; best = { s, len: r.len }; if (!miss) break; }
      }
      return best;
    }
    function board() {
      const p = S.p;
      S.look = p.look; o.crowd.despawnPerson(p); S.p = null;
      seatPassenger(S.car, S.look); o.audio.door();
      const d = pickDestination();
      S.dest = d.s; S.base = Math.round(12 + d.len * .2); S.limit = S.timer = Math.round(14 + d.len / 8);
      S.hits = 0; S.late = false; S.phase = 'ride';
      fareMark.visible = false; destMark.visible = true; destMark.position.set(d.s.cx, 0, d.s.cz);
      o.flash('«' + pick(HELLO) + '» — везите в район «' + world.districtAt(d.s.x, d.s.z) + '»' + (S.far ? ' · дальняя поездка через мост!' : ''), 3.5);
    }
    function arrive() {
      const mood = Math.max(.4, 1 - S.hits * .12);
      const tip = S.late ? 0 : Math.round(S.timer * .6), bonus = S.late ? 0 : Math.min(S.streak, 6) * 5;
      const pay = Math.round(S.base * mood * (S.late ? .5 : 1)) + tip + bonus;
      S.streak = S.late ? 0 : S.streak + 1; S.rides++; S.earned += pay;
      dropPassenger(S.late ? pick(LATE) : pick(THANKS));
      o.audio.fare();
      o.onPay(pay, S.late ? 'Опоздание — половина тарифа' : (tip ? 'Чаевые $' + tip : '') + (bonus ? (tip ? ' · ' : '') + 'серия ×' + S.streak : ''));
      toSeek(2.5);
    }

    function update(dt) {
      const car = o.vehicles.driving, inCab = !!car && car.model.id === 'cab';
      if (S.on && car !== S.car) end();
      if (!S.on) { if (inCab) start(car); else return; }
      const wanted = o.police.wanted > 0, v = speed(car), t = performance.now() / 1000;
      if (S.hitT > 0) S.hitT -= dt;
      switch (S.phase) {
        case 'seek':
          if (wanted) break;
          if ((S.waitT -= dt) <= 0) { if (!spawnFare(car)) S.waitT = 1; }
          break;
        case 'pickup': case 'board': {
          const p = S.p;
          if (!fareOk(p) || wanted) { loseFare(); toSeek(3); if (!wanted) o.flash('Пассажир передумал', 1.8); break; }
          const d = Math.hypot(p.x - car.x, p.z - car.z);
          if (d > 140) { loseFare(); toSeek(1); break; }
          if (S.phase === 'pickup') {
            p.fare.hail = d < 70; p.fare.goal = null; p.fare.face = S.pick.face;
            if (d < 7.5 && v < 2.5) { S.phase = 'board'; S.boardT = 0; p.fare.hail = false; }
          } else {
            const [dx, dz] = sideDoor(car, .45);
            p.fare.goal = [dx, dz]; p.fare.face = null; S.boardT += dt;
            if (v > 3.5 || d > 12) { S.phase = 'pickup'; p.fare.goal = null; }
            else if (p.fare.arrived || S.boardT > 4.5) { board(); break; }
          }
          fareMark.visible = true; fareMark.position.set(p.x, p.y + 1.1 * p.look.hs, p.z);
          arrow.position.y = 1.35 + Math.sin(t * 4) * .12; arrow.rotation.y = t * 2;
          break;
        }
        case 'ride': {
          S.timer -= dt;
          if (S.timer <= 0 && !S.late) { S.late = true; o.flash('Время вышло — заплатят только половину', 2.4); }
          if (wanted) {
            if (v < 3) { dropPassenger(pick(SCARED), true); S.streak = 0; toSeek(4); o.flash('Пассажир сбежал — с полицией на хвосте не возят', 2.6); }
            break;
          }
          if (Math.hypot(S.dest.cx - car.x, S.dest.cz - car.z) < 8 && v < 2.5) { arrive(); break; }
          ring.material.opacity = .55 + Math.sin(t * 5) * .25;
          break;
        }
      }
      // keep the minimap route fresh
      S.routeT -= dt;
      if (S.routeT <= 0) {
        S.routeT = .4;
        const tgt = S.phase === 'ride' ? [S.dest.cx, S.dest.cz] : S.p ? [S.pick.cx, S.pick.cz] : null;
        if (tgt) { const r = route(car.x, car.z, tgt[0], tgt[1]); S.route = r.pts; S.routeLen = r.len; } else S.route = [];
      }
    }

    return {
      update,
      get active() { return S.on; },
      // what the HUD panel should say
      get hud() {
        if (!S.on) return null;
        const clock = s => { s = Math.max(0, Math.ceil(s)); return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0'); };
        if (S.phase === 'seek') return { text: o.police.wanted > 0 ? 'Пассажиры не сядут, пока вас ищет полиция' : 'Ищем пассажира…', time: '', warn: o.police.wanted > 0 };
        if (S.phase === 'pickup' || S.phase === 'board') return { text: S.phase === 'board' ? 'Пассажир садится…' : 'Заберите пассажира · ' + Math.round(S.routeLen / 10) * 10 + ' м', time: '', warn: false };
        return { text: 'До места ' + Math.max(10, Math.round(S.routeLen / 10) * 10) + ' м · $' + S.base, time: S.late ? 'опоздание' : clock(S.timer), warn: S.late || S.timer < 10 };
      },
      get route() { return S.route; },
      get markers() {
        const out = [];
        if (S.p && (S.phase === 'pickup' || S.phase === 'board')) out.push({ x: S.p.x, z: S.p.z, kind: 'fare' });
        if (S.phase === 'ride' && S.dest) out.push({ x: S.dest.cx, z: S.dest.cz, kind: 'dest' });
        return out;
      },
      // the hero's cab hit something hard while carrying a fare
      onImpact(strength) {
        if (S.phase !== 'ride' || strength < 4 || S.hitT > 0) return;
        S.hits++; S.hitT = 1.5;
        o.flash('Пассажир: «' + pick(HIT) + '»', 1.6);
      },
      findRoute: route
    };
  };
})(window.NB);
