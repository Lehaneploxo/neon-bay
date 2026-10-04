// Side job: pizza delivery. Ask for it at the counter of a pizzeria (Pizza NEPLOXO downtown, «Черепа» in
// District 21): a red Vespino waits at the door, the bag holds 1–3 pizzas for homes around (red beacons,
// the route on the minimap). Stop at the door of each one before the time runs out: fast pays a tip, late pays
// half. An empty bag: ride back to the pizzeria for the next lot. Nobody opens the door while the police are after you.
(function (NB) {
  'use strict';
  const { U } = NB;
  const rand = U.rand, pick = a => a[(Math.random() * a.length) | 0];
  const THANKS = ['Горячая! Спасибо!', 'Вот это скорость!', 'Сдачи не надо!', 'Ммм, пахнет!', 'Наконец-то, умираю с голоду!'];
  const LATE = ['Она же холодная…', 'Час ждали!', 'В следующий раз закажем суши.'];
  const RED = 0xff4f4f;

  NB.createPizza = function (scene, world, o) {
    // o: vehicles, shops, police, player, route(ax, az, bx, bz) -> { pts, len }, flash, onPay(n, note), audio
    const S = { on: false, shop: null, bike: null, bag: [], phase: 'idle', timer: 0, late: false, earned: 0, done: 0, route: [], routeLen: 0, routeT: 0, denyT: 0 };

    /* ---------- beacons: one for every pizza in the bag, one at the pizzeria to come back to ---------- */
    const glass = () => new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: .26, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beacons = [];
    for (let k = 0; k < 4; k++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 7, 22, 1, true).translate(0, 3.5, 0), glass()));
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: .8, fog: false, depthWrite: false }));
      ring.position.y = .08; g.add(ring); g.ring = ring; g.visible = false; scene.add(g); beacons.push(g);
    }

    const pizzerias = () => (NB.SHOP_LIST || []).filter(s => s.menu === 'pizza' && s.door);
    const speed = () => { const c = o.vehicles.driving; return c ? Math.hypot(c.vx, c.vz) : 0; };
    // the homes around a pizzeria: every single home and every block of flats has a door
    function addresses(shop) {
      const out = [], d0 = shop.door;
      for (const h of o.shops.homes.concat(o.shops.blocks)) {
        if (!h.door) continue;
        const d = Math.hypot(h.door.x - d0.x, h.door.z - d0.z);
        out.push({ h, d });
      }
      return out;
    }
    function fillBag() {
      const all = addresses(S.shop);
      let pool = all.filter(a => a.d > 60 && a.d < 380);
      if (pool.length < 3) pool = all.filter(a => a.d > 40 && a.d < 700);
      const n = Math.min(pool.length, 1 + ((Math.random() * 3) | 0));
      S.bag = [];
      let total = 0, x = S.shop.door.x, z = S.shop.door.z;
      for (let k = 0; k < n; k++) {
        const i = (Math.random() * pool.length) | 0, a = pool.splice(i, 1)[0], d = a.h.door;
        const len = o.route(x, z, d.x, d.z).len; total += len; x = d.x; z = d.z;
        S.bag.push({ name: a.h.name, where: a.h.where, x: d.x, z: d.z, y: d.y || 0, pay: Math.round(18 + len * .09) });
      }
      S.timer = Math.round(25 + total / 7); S.late = false; S.phase = 'go';
      o.audio.pickup();
      o.flash('В сумке ' + n + ' ' + (n === 1 ? 'пицца' : 'пиццы') + ' · первая: ' + S.bag[0].name + ', ' + S.bag[0].where, 4);
    }
    // the work scooter at the pizzeria's door (a fresh one if the last is gone or far away)
    function bikeAtDoor() {
      const d = S.shop.door, b = S.bike;
      if (b && o.vehicles.driving === b) return;
      if (b && Math.hypot(b.x - d.x, b.z - d.z) < 40 && !b.dead) return;
      if (b && o.vehicles.driving !== b) o.vehicles.remove(b);
      const sx = -d.nz, sz = d.nx;   // along the pavement
      S.bike = o.vehicles.spawnParked('vespino', d.x + d.nx * 2.6 + sx * 2.5, d.z + d.nz * 2.6 + sz * 2.5, d.heading + Math.PI / 2, '#e8322a', '#f5f0e8');
    }

    function start(shop) {
      Object.assign(S, { on: true, shop, earned: 0, done: 0, route: [] });
      bikeAtDoor(); fillBag();
      o.flash('Подработка началась: красный скутер у входа, адреса — красные метки на карте', 4);
    }
    function end(why) {
      if (!S.on) return;
      if (S.bike && o.vehicles.driving !== S.bike) o.vehicles.remove(S.bike);
      S.bike = null;
      o.flash((why || 'Подработка окончена') + (S.done ? ' · доставлено: ' + S.done + ' · заработано $' + S.earned : ''), 3.5);
      Object.assign(S, { on: false, shop: null, bag: [], phase: 'idle', route: [] });
      for (const b of beacons) b.visible = false;
    }
    function deliver(k) {
      const it = S.bag.splice(k, 1)[0];
      const tip = S.late ? 0 : Math.round(rand(5, 12) + Math.min(30, S.timer * .3));
      const pay = S.late ? Math.round(it.pay / 2) : it.pay + tip;
      S.earned += pay; S.done++;
      o.audio.fare();
      o.onPay(pay, 'Доставка пиццы');
      o.flash('«' + (S.late ? pick(LATE) : pick(THANKS)) + '»' + (tip ? ' · чаевые $' + tip : S.late ? ' · опоздание — половина' : '') + (S.bag.length ? ' · следующая: ' + S.bag[0].name : ' · сумка пуста, назад в пиццерию'), 3.5);
      if (!S.bag.length) S.phase = 'back';
    }

    function update(dt) {
      if (!S.on) return;
      const p = o.player, t = performance.now() / 1000;
      if (p.dead) { end('Подработка сорвалась'); return; }
      const px = p.inCar && o.vehicles.driving ? o.vehicles.driving.x : p.x, pz = p.inCar && o.vehicles.driving ? o.vehicles.driving.z : p.z;
      const slow = !p.inCar || speed() < 3;
      if (S.denyT > 0) S.denyT -= dt;
      if (S.phase === 'go') {
        S.timer -= dt;
        if (S.timer <= 0 && !S.late) { S.late = true; o.flash('Время вышло — пиццы остывают, заплатят половину', 2.6); }
        for (let k = 0; k < S.bag.length; k++) {
          const it = S.bag[k];
          if (Math.hypot(it.x - px, it.z - pz) < 4.5 && slow) {
            if (o.police.wanted > 0) { if (S.denyT <= 0) { S.denyT = 4; o.flash('Клиент не откроет, пока вас ищет полиция', 2.4); } break; }
            deliver(k); break;
          }
        }
      } else if (S.phase === 'back') {
        const d = S.shop.door;
        if (Math.hypot(d.x - px, d.z - pz) < 7 && slow) { bikeAtDoor(); fillBag(); }
      }
      // beacons
      const pts = S.phase === 'back' ? [S.shop.door] : S.bag;
      beacons.forEach((b, k) => {
        const it = pts[k]; b.visible = !!it;
        if (it) { b.position.set(it.x, it.y || 0, it.z); b.ring.material.opacity = .55 + Math.sin(t * 5 + k) * .25; }
      });
      // the route to the nearest address
      if ((S.routeT -= dt) <= 0) {
        S.routeT = .5;
        let best = null, bd = Infinity;
        for (const it of pts) { const d = Math.hypot(it.x - px, it.z - pz); if (d < bd) { bd = d; best = it; } }
        if (best) { const r = o.route(px, pz, best.x, best.z); S.route = r.pts; S.routeLen = r.len; } else S.route = [];
      }
    }

    return NB.pizzaJob = {
      update, start, end,
      get active() { return S.on; },
      at: shop => S.on && S.shop === shop,
      get hud() {
        if (!S.on) return null;
        const clock = s => { s = Math.max(0, Math.ceil(s)); return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0'); };
        if (S.phase === 'back') return { tag: 'ПИЦЦА', text: 'Сумка пуста — назад в пиццерию · ' + Math.round(S.routeLen / 10) * 10 + ' м', time: '', warn: false };
        return { tag: 'ПИЦЦА', text: 'Пицц: ' + S.bag.length + ' · до адреса ' + Math.max(10, Math.round(S.routeLen / 10) * 10) + ' м', time: S.late ? 'остыла' : clock(S.timer), warn: S.late || S.timer < 15 };
      },
      get route() { return S.route; },
      get markers() {
        if (!S.on) return [];
        if (S.phase === 'back') return [{ x: S.shop.door.x, z: S.shop.door.z, kind: 'dest', color: '#ff4f4f' }];
        return S.bag.map(it => ({ x: it.x, z: it.z, kind: 'dest', color: '#ff4f4f' }));
      }
    };
  };
})(window.NB);
