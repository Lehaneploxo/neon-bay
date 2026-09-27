// Gun shop. A glowing circle in front of the shop with the AMMO sign; step into it on foot and the
// counter opens: buy weapons (each comes with ammo), top up ammo for guns you own, or buy body armour.
// The shop won't serve you while the police are after you.
(function (NB) {
  'use strict';
  const $ = id => document.getElementById(id);
  const ITEMS = [
    { id: 'bat', name: 'Бита', desc: 'Ближний бой — бьёт почти вдвое сильнее кулака', price: 80 },
    { id: 'pistol', name: 'Пистолет', desc: 'Точный и надёжный', price: 250, ammo: 36, ammoPrice: 45 },
    { id: 'smg', name: 'Узи', desc: 'Автоматический огонь, быстро тратит патроны', price: 700, ammo: 90, ammoPrice: 90 },
    { id: 'shotgun', name: 'Дробовик', desc: 'Сносит всё вблизи', price: 900, ammo: 16, ammoPrice: 60 },
    { id: 'rifle', name: 'Винтовка', desc: 'Автомат: мощно, точно и далеко', price: 1600, ammo: 60, ammoPrice: 140 },
    { id: 'armor', name: 'Бронежилет', desc: 'Принимает урон на себя, 100 единиц', price: 250 }
  ];

  NB.createShop = function (scene, world, o) {
    const shop = world.gunShop;
    let armed = true;
    // the trigger circle and a short beam, orange like the shop's neon
    const mark = new THREE.Group();
    if (shop) {
      const add = (geo, opacity) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); mark.add(m); return m; };
      add(new THREE.RingGeometry(.75, .95, 32).rotateX(-Math.PI / 2).translate(0, .03, 0), .9);
      add(new THREE.CircleGeometry(.75, 32).rotateX(-Math.PI / 2).translate(0, .02, 0), .18);
      add(new THREE.CylinderGeometry(.85, .85, 1.6, 24, 1, true).translate(0, .8, 0), .12);
      mark.position.set(shop.x, shop.y, shop.z); scene.add(mark);
    }
    const list = $('shopList');

    function row(it) {
      const inv = o.combat.inv, money = o.getMoney();
      const w = NB.WEAPONS[it.id];
      let label, cost, owned = false, full = false;
      if (it.id === 'armor') { full = o.getArmor() >= 100; cost = it.price; label = full ? 'Надет' : 'Купить'; }
      else if (w.melee) { owned = inv[it.id] > 0; cost = it.price; label = owned ? 'Есть' : 'Купить'; }
      else if (inv[it.id] > 0) { owned = true; cost = it.ammoPrice; label = 'Патроны +' + it.ammo; }
      else { cost = it.price; label = 'Купить'; }
      const status = it.id === 'armor' ? 'Броня: ' + Math.round(o.getArmor()) : w.melee ? (owned ? 'В руках' : '') : owned ? 'Патронов: ' + inv[it.id] : '+' + it.ammo + ' патронов в комплекте';
      const disabled = full || (w && w.melee && owned);
      return `<div class="item${owned ? ' owned' : ''}">
        <div class="info"><b>${it.name}</b><span>${it.desc}</span>${status ? `<em>${status}</em>` : ''}</div>
        <button type="button" class="buy" data-id="${it.id}" ${disabled ? 'disabled' : ''} aria-disabled="${disabled || money < cost}">${label}${disabled ? '' : ` · $${cost}`}</button>
      </div>`;
    }
    function render() {
      $('shopMoney').textContent = '$' + o.getMoney().toLocaleString('ru-RU');
      list.innerHTML = ITEMS.map(row).join('');
    }
    list.addEventListener('click', e => {
      const b = e.target.closest('.buy'); if (!b || b.disabled) return;
      buy(b.dataset.id);
    });
    function buy(id) {
      const it = ITEMS.find(i => i.id === id), inv = o.combat.inv;
      const refill = !!it.ammo && inv[id] > 0, cost = refill ? it.ammoPrice : it.price;
      if (o.getMoney() < cost) { o.audio.deny(); $('shopNote').textContent = 'Не хватает $' + (cost - o.getMoney()) + '. Заработайте на такси.'; return; }
      if (id === 'armor') o.setArmor(100);
      else o.combat.give(id, it.ammo || 0);
      o.spend(cost);   // after the item is in the inventory, so the save includes it
      o.audio.cash(false);
      $('shopNote').textContent = refill ? it.name + ': +' + it.ammo + ' патронов' : it.name + ' — ваше!';
      render();
    }

    return {
      // true when the hero just stepped into the circle and the counter should open
      update(player, onFoot) {
        if (!shop) return false;
        const t = performance.now() / 1000;
        mark.children[2].material.opacity = .1 + Math.sin(t * 3) * .04;
        const d = Math.hypot(player.x - shop.x, player.z - shop.z);
        if (d > 1.8) armed = true;
        if (!armed || !onFoot || d > .95) return false;
        armed = false;
        if (o.police.wanted > 0) { o.flash('Продавец: «Уходите, за вами полиция!»', 2.2); o.audio.deny(); return false; }
        return true;
      },
      open() { $('shopNote').textContent = 'Оружие продаётся с патронами. Повторная покупка — только патроны.'; render(); },
      buy,
      place: shop
    };
  };
})(window.NB);
