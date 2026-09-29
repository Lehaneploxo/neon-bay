// Bodyguards from the security agency: up to five big men in black suits with pistols. They walk with the hero
// in a loose formation and see off anyone who goes for him (fists against fists, pistols against guns; the
// fighting itself is in npc.js). They get into the car with him (the ones who fit are seen in the seats) and
// out again when he stops. Knocked down, a guard gets up again after a few seconds; shot dead, he's gone.
// Wounds never heal: not in the car, not after a knockout, not after a reload (each one's health is saved).
(function (NB) {
  'use strict';
  const MAX = 5, HP = 320, PRICE = 1000;

  NB.createGuards = function (o) {
    // o: crowd, vehicles, player, flash(text, sec), say(person, text), progress
    const hired = [];               // { p: the person on foot (null while riding), hp, downT }
    let riding = null, seats = [];
    // the seated passenger: a black suit, a white shirt, a shaved head and dark glasses
    const M4 = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
    const seatGeo = NB.mergeParts([
      [new THREE.BoxGeometry(.46, .5, .26), M4(0, .25, 0), new THREE.Color('#15151a')],
      [new THREE.BoxGeometry(.08, .3, .02), M4(0, .32, .135), new THREE.Color('#e8e8e8')],
      [new THREE.BoxGeometry(.23, .26, .24), M4(0, .66, 0), new THREE.Color('#b98a64')],
      [new THREE.BoxGeometry(.2, .05, .02), M4(0, .7, .125), new THREE.Color('#0a0a0e')]]);
    const seatMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const LINES = { hire: ['Я с вами, босс.', 'Работаем.', 'Никто вас не тронет.', 'Прикрою.'], die: 'Телохранитель погиб' };

    function place(h, x, z, k, n) {
      const p = o.crowd.spawnGuard(x, z, o.player.heading, h.hp, k, n);
      if (p) { h.p = p; h.downT = 0; }
      return p;
    }
    // spots round the hero (or round a car) to put guards down at
    function around(x, z, heading, k, n, r) {
      const a = heading + Math.PI + (k - (n - 1) / 2) * .7;
      return [x + Math.sin(a) * r, z + Math.cos(a) * r];
    }
    function hire() {
      if (hired.length >= MAX) return false;
      const h = { p: null, hp: HP, downT: 0 };
      hired.push(h);
      if (!riding) {
        const [x, z] = around(o.player.x, o.player.z, o.player.heading, hired.length - 1, hired.length, 2.2);
        const p = place(h, x, z, hired.length - 1, hired.length);
        if (p) o.say(p, LINES.hire[(Math.random() * LINES.hire.length) | 0]);
      }
      save();
      return true;
    }
    function dismiss() {
      for (const h of hired) if (h.p) o.crowd.removeGuard(h.p);
      hired.length = 0; clearSeats(); save();
    }
    const hpList = () => hired.map(h => Math.max(1, Math.round(h.p && !h.p.dead ? (h.p.down ? h.hp : h.p.hp) : h.hp)));
    const save = () => { o.progress.guards = hpList(); };
    function clearSeats() { for (const m of seats) if (m.parent) m.parent.remove(m); seats = []; }
    // into the car: everyone gets in (the first ones are seen in the passenger seats)
    function board(car) {
      for (const h of hired) if (h.p) { h.hp = Math.max(1, h.p.down ? h.hp : h.p.hp); o.crowd.removeGuard(h.p); h.p = null; }
      clearSeats();
      const m = car.model;
      if (m.bike || m.heli || m.id === 'jetski') return;
      const [sx, sy, sz] = m.seat;
      const pos = [[-sx, sy, sz], [sx, sy, sz - 1.05], [-sx, sy, sz - 1.05]];
      for (let k = 0; k < Math.min(hired.length, pos.length); k++) { const s = new THREE.Mesh(seatGeo, seatMat); s.position.set(...pos[k]); car.body.add(s); seats.push(s); }
    }
    // out of the car: beside it, on both sides
    function alight(car) {
      clearSeats();
      const n = hired.length;
      hired.forEach((h, k) => {
        const side = k % 2 ? 1 : -1, back = ((k / 2) | 0) * 1.4 - .6;
        const rx = -Math.cos(car.h), rz = Math.sin(car.h), fx = Math.sin(car.h), fz = Math.cos(car.h);
        const off = car.model.w / 2 + .9;
        place(h, car.x + rx * side * off - fx * back, car.z + rz * side * off - fz * back, k, n);
      });
    }

    function update(dt) {
      const car = o.vehicles.driving;
      if (car && riding !== car) { if (riding) clearSeats(); riding = car; board(car); return; }
      if (!car && riding) { const c = riding; riding = null; alight(c); return; }
      if (riding) return;
      let changed = false;
      for (let k = hired.length - 1; k >= 0; k--) {
        const h = hired[k], p = h.p;
        if (!p || !o.crowd.people.includes(p)) {
          // lost somewhere (the hero went inside, or was taken to hospital): back at his side
          const [x, z] = around(o.player.x, o.player.z, o.player.heading, k, hired.length, 2.5);
          place(h, x, z, k, hired.length); continue;
        }
        if (p.dead) { hired.splice(k, 1); o.crowd.releaseGuard(p); o.flash(LINES.die + (hired.length ? ' · осталось ' + hired.length : ''), 2.4); changed = true; continue; }
        // knocked out: back on his feet with the little he had left, no more
        if (p.down) { h.downT += dt; if (h.downT > 7) { o.crowd.revive(p, Math.max(1, h.hp)); h.downT = 0; o.say(p, 'Я ещё держусь, босс.'); } }
        else if (p.hp !== h.hp) { h.hp = p.hp; changed = true; }
      }
      if (changed) save();
      hired.forEach((h, k) => { if (h.p && h.p.bodyguard) { h.p.bodyguard.idx = k; h.p.bodyguard.of = hired.length; } });
    }
    // after a load: the guards come back with the hero, each as wounded as he was (an old save kept only a count)
    function restore(saved) {
      const list = Array.isArray(saved) ? saved : Array.from({ length: saved | 0 }, () => HP);
      for (const hp of list.slice(0, MAX)) { hire(); const h = hired[hired.length - 1]; h.hp = Math.max(1, Math.min(HP, hp | 0)); if (h.p) h.p.hp = h.hp; }
      save();
    }

    return { hire, dismiss, update, restore, MAX, PRICE, get list() { return hpList(); }, get count() { return hired.length; }, get riding() { return !!riding; } };
  };
})(window.NB);
