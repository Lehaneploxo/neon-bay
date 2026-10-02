// Your own cars. NEPLOXO MOTORS (places.js) sells exclusive cars that never turn up in the traffic; a bought
// car is yours for good: it stays wherever you leave it (saved with the game, put back on load), and if it's
// wrecked or sinks, the tow truck brings it back to the dealership's lot, good as new.
// Home garages: at the door of a home you own there is a garage — leave any car you came in, take it out
// later (a car you bought stays yours in there too). Room for 1 car in a studio, 2 at a flat, 3 at a house,
// 5 at the mansion. (The beach villa keeps its own two-car garage you drive into.)
(function (NB) {
  'use strict';
  const fmt = n => '$' + Math.round(n).toLocaleString('ru-RU');
  const MAX_OWNED = 12, ROOM = { studio: 1, flat: 2, house: 3, mansion: 5 };
  const COLOR_NAME = { '#1a3fa8': 'синий', '#141418': 'чёрный', '#f5f5f0': 'белый', '#c9a227': 'золотой', '#ff4fa3': 'розовый', '#8a1f2a': 'бордовый', '#8cff6b': 'кислотно-зелёный',
    '#ffd23d': 'жёлтый', '#ff8a1e': 'оранжевый', '#e8202a': 'красный', '#c28bff': 'сиреневый', '#3a1a3a': 'баклажан', '#1c2a4a': 'тёмно-синий', '#6a1e2a': 'вишнёвый',
    '#2a6fe8': 'голубой', '#5a6a4a': 'хаки', '#8a8f98': 'серебристый', '#3fe6e0': 'бирюзовый' };
  const kmh = m => Math.round(m.perf.top * 3.6 * .9);

  // a car model as a still mesh (the stands in the showroom): the body painted, wheels in place
  function showMesh(model, color, accent) {
    const g = new THREE.Group(), geo = model.geo.clone(), c = geo.attributes.color.array, col = new THREE.Color();
    for (const [key, hex] of [['body', color], ['accent', accent]]) {
      col.set(NB.CAR_FIXED[hex] || hex);
      for (const [a, b] of model.ranges[key]) for (let i = a; i < b; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    }
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    g.add(new THREE.Mesh(geo, mat));
    for (const [wx, wz] of model.wheels) { const w = new THREE.Mesh(model.wheelGeo, mat); w.position.set(wx, model.r, wz); g.add(w); }
    return g;
  }

  NB.createAutos = function (o) {
    // o: vehicles, places, shops, player, progress, money { spend, add }, ui, flash, audio, save, scene
    const P = o.progress, V = o.vehicles;
    if (!Array.isArray(P.cars)) P.cars = [];
    if (!P.garages || typeof P.garages !== 'object') P.garages = {};
    const byId = {}; for (const m of NB.CAR_MODELS) byId[m.id] = m;
    const EXCL = NB.CAR_MODELS.filter(m => m.exclusive);
    const D = o.places.dealer;
    const live = new Map();   // uid -> car in the world
    let lastCar = null, checkT = 0, hooked = false;

    /* ---------- cars you own, out in the city ---------- */
    function spawnOwned(r) {
      if (!byId[r.id]) return null;
      const c = V.spawnParked(r.id, r.x, r.z, r.h, r.c, r.a); if (!c) return null;
      c.owned = r.u; c.sid = 'o' + r.u; live.set(r.u, c);
      if (NB.net) NB.net.ownedHere(c);   // the other players see it standing here
      return c;
    }
    P.cars = P.cars.filter(r => byId[r.id] && r.u);
    for (const r of P.cars) spawnOwned(r);
    const nameOf = id => (byId[id] ? byId[id].name : id);
    // a free bay on the dealership's lot
    function freeBay() {
      for (const b of D.bays) if (!V.cars.some(c => Math.hypot(c.x - b.x, c.z - b.z) < 2.2)) return b;
      return D.bays[0];
    }
    // where things are now (the save asks just before writing)
    function snapshot() {
      for (const r of P.cars) {
        const c = live.get(r.u); if (!c || c.gone) continue;
        r.x = +c.x.toFixed(2); r.z = +c.z.toFixed(2); r.h = +c.h.toFixed(3); r.c = c.color; r.a = c.accent;
      }
    }
    // wrecked, sunk or lost: back at the dealership, repaired (once the hero isn't looking)
    function recover(r, c, why) {
      if (c && V.cars.includes(c)) V.dropRemote(c);
      live.delete(r.u);   // (spawnOwned below tells the others where it is now)
      const b = freeBay(); r.x = b.x; r.z = b.z; r.h = b.h;
      spawnOwned(r);
      o.flash(why + ' Эвакуатор отвёз ' + nameOf(r.id) + ' на парковку NEPLOXO MOTORS — как новую', 4.5);
      o.save();
    }

    /* ---------- the showroom ---------- */
    if (D) {
      const pl = D.place;
      EXCL.forEach((m, i) => {
        const s = pl.stands[i]; if (!s) return;
        s.model = m; s.group = showMesh(m, m.palette[0], m.accent[0]);
        s.group.position.set(s.x, .3, s.z); o.scene.add(s.group);
      });
      const buyMenu = m => o.ui.menu({ eyebrow: 'NEPLOXO MOTORS · ' + m.kind, title: m.name, items: () => {
        const rows = [{ name: 'Характеристики', desc: 'До ' + kmh(m) + ' км/ч · разгон ' + m.perf.accel + '/20 · ' + (m.bike ? 'мотоцикл' : 'автомобиль') + '. Только в этом салоне, в городе таких нет. Машина ваша навсегда: стоит там, где оставили', price: 0, disabled: fmt(m.price), buy: () => '' }];
        const full = P.cars.length + Object.values(P.garages).reduce((n, l) => n + l.length, 0) >= MAX_OWNED;
        for (const color of m.palette) rows.push({ name: 'Купить · цвет: ' + (COLOR_NAME[color] || color), desc: m.name + ' в цвете «' + (COLOR_NAME[color] || color) + '»', price: full ? 0 : m.price, label: 'Купить', disabled: full ? 'У вас уже ' + MAX_OWNED + ' машин' : '', buy: () => purchase(m, color) });
        return rows;
      } });
      function purchase(m, color) {
        const b = freeBay(), r = { u: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), id: m.id, c: color, a: m.accent[0], x: b.x, z: b.z, h: b.h };
        P.cars.push(r); spawnOwned(r); o.save(); o.audio.fare();
        o.flash(m.name + ' — ваш! Он ждёт на парковке «ВЫДАЧА АВТО» за салоном', 5);
        return 'Поздравляем с покупкой! Машина за салоном, на парковке выдачи';
      }
      // selling back: half the price for an exclusive one, a little for anything else you own
      const sellMenu = () => o.ui.menu({ eyebrow: 'NEPLOXO MOTORS', title: 'Продать машину', items: () => {
        const rows = [];
        for (const r of P.cars) { const m = byId[r.id], back = Math.round((m.price || 20000) / 2); rows.push({ name: m.name, desc: 'На улице · ' + (COLOR_NAME[r.c] || r.c), price: -back, label: 'Продать', buy: () => { const c = live.get(r.u); if (c && V.driving === c) return 'Сначала выйдите из машины'; if (c) V.dropRemote(c); live.delete(r.u); P.cars.splice(P.cars.indexOf(r), 1); o.save(); return 'Продано'; } }); }
        for (const id in P.garages) for (const g of P.garages[id]) if (g.u && byId[g.id]) { const m = byId[g.id], back = Math.round((m.price || 20000) / 2); rows.push({ name: m.name, desc: 'В гараже', price: -back, label: 'Продать', buy: () => { P.garages[id].splice(P.garages[id].indexOf(g), 1); o.save(); return 'Продано'; } }); }
        if (!rows.length) rows.push({ name: 'Нечего продавать', desc: 'Здесь выкупают машины, купленные в NEPLOXO MOTORS', price: 0, disabled: 'Пусто', buy: () => '' });
        return rows;
      } });
      pl.interactions.push({ ...pl.P(12, -4.1), r: 1.8, short: 'ПРОДАТЬ', label: () => 'Менеджер: продать свою машину', use: sellMenu });
      for (const s of pl.stands) if (s.model) {
        const p = pl.P(s.lx, s.lz - 3.5);
        pl.interactions.push({ x: p.x, z: p.z, r: 2, short: 'КУПИТЬ', label: () => s.model.name + ' · ' + fmt(s.model.price), use: () => buyMenu(s.model) });
      }
    }

    /* ---------- home garages ---------- */
    const parkable = c => c && !c.gone && V.cars.includes(c) && !c.wreck && !c.remote && !c.model.boat && !c.model.heli && !c.model.tracks;
    function spot(h) {
      const d = h.door, x = d.x + d.nx * 4.6, z = d.z + d.nz * 4.6;
      return { x, z, h: Math.atan2(d.nz, -d.nx) };
    }
    function garageMenu(h) {
      const room = ROOM[h.tier] || 2;
      o.ui.menu({ eyebrow: 'Гараж · ' + h.name, title: 'Гараж на ' + room + (room === 1 ? ' машину' : room < 5 ? ' машины' : ' машин'), items: () => {
        const list = P.garages[h.id] || (P.garages[h.id] = []), rows = [];
        // the car you came in, or else any car standing right by the door (not one driving past)
        let c = parkable(lastCar) && V.driving !== lastCar && Math.hypot(lastCar.x - h.door.x, lastCar.z - h.door.z) < 25 ? lastCar : null;
        if (!c) { let bd = 12; for (const k of V.cars) { const d = Math.hypot(k.x - h.door.x, k.z - h.door.z); if (d < bd && !k.ai && parkable(k) && V.driving !== k && !k.pursuit && !k.goto) { bd = d; c = k; } } }
        const near = !!c;
        rows.push(near ? { name: 'Поставить: ' + c.model.name, desc: 'Машина, на которой вы приехали. В гараже она сохранится', price: 0, label: 'В гараж', disabled: list.length >= room ? 'Гараж полон' : '', buy: () => store(h, c) }
          : { name: 'Поставить машину', desc: 'Подъезжайте к двери и выходите из машины — потом сюда', price: 0, disabled: 'Нет машины рядом', buy: () => '' });
        list.forEach((g, i) => rows.push({ name: 'Выгнать: ' + nameOf(g.id), desc: (g.u ? 'Ваша, из NEPLOXO MOTORS · ' : '') + (COLOR_NAME[g.c] || ''), price: 0, label: 'Выгнать', buy: () => takeOut(h, i) }));
        return rows;
      } });
    }
    function store(h, c) {
      const list = P.garages[h.id] || (P.garages[h.id] = []);
      const g = { id: c.model.id, c: c.color, a: c.accent, u: c.owned || null };
      if (c.owned) { const r = P.cars.find(x => x.u === c.owned); if (r) P.cars.splice(P.cars.indexOf(r), 1); live.delete(c.owned); if (NB.net) NB.net.ownedGone(c.owned); }
      else if (NB.net && (c.sid || c.pid)) NB.net.carEntered(c);   // a city car into the garage: gone from the street for everybody
      V.dropRemote(c); if (lastCar === c) lastCar = null;
      list.push(g); o.save();
      return nameOf(g.id) + ' в гараже';
    }
    function takeOut(h, i) {
      const list = P.garages[h.id], g = list[i]; if (!g) return '';
      const s = spot(h);
      if (V.cars.some(c => Math.hypot(c.x - s.x, c.z - s.z) < 3)) return 'Перед дверью стоит машина — место занято';
      list.splice(i, 1);
      if (g.u) { const r = { u: g.u, id: g.id, c: g.c, a: g.a, x: s.x, z: s.z, h: s.h }; P.cars.push(r); lastCar = spawnOwned(r); }
      else { lastCar = V.spawnParked(g.id, s.x, s.z, s.h, g.c, g.a); if (NB.net && lastCar) NB.net.carLeft(lastCar); }
      o.save();
      return nameOf(g.id) + ' ждёт у двери';
    }

    return {
      snapshot,
      // the garage door of a home you own, when you stand by it
      interactions() {
        if (o.places.current || V.driving) return [];
        const out = [], p = o.player;
        for (const h of o.shops.ownedHomes()) {
          const d = h.door; if (!d || Math.hypot(p.x - d.x, p.z - d.z) > 4) continue;
          out.push({ x: d.x + d.nx * 1.2, z: d.z + d.nz * 1.2, y: d.y, r: 2.4, short: 'ГАРАЖ', label: () => 'Гараж: ' + h.name, use: () => garageMenu(h) });
        }
        return out;
      },
      update(dt) {
        if (!hooked && NB.net) { hooked = true; NB.net.on('welcome', () => { for (const c of live.values()) if (V.cars.includes(c) && V.driving !== c) NB.net.ownedHere(c); }); }
        if (V.driving) lastCar = V.driving;
        if ((checkT -= dt) > 0) return; checkT = 2;
        const p = o.player;
        for (const r of P.cars.slice()) {
          const c = live.get(r.u);
          if (!c || c.gone || !V.cars.includes(c)) { recover(r, null, 'Ваша машина пропала.'); continue; }
          if (V.driving === c) continue;
          const far = Math.hypot(c.x - p.x, c.z - p.z) > 60;
          if ((c.wreck || c.flooded) && far) recover(r, c, c.flooded ? 'Ваша машина утонула.' : 'Ваша машина разбита.');
        }
      },
      // for the minimap: your cars
      markers() { const out = []; for (const c of live.values()) if (V.cars.includes(c) && V.driving !== c) out.push({ x: c.x, z: c.z }); return out; }
    };
  };
})(window.NB);
