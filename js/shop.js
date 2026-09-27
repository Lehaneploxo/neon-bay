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
    const shop = world.gunShop;   // the door leads into the Ammo Bay interior; the counter in there opens this
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
      // the clerk won't sell to someone the police are after
      canServe() {
        if (o.police.wanted > 0) { o.flash('Продавец: «Уходите, за вами полиция!»', 2.2); o.audio.deny(); return false; }
        return true;
      },
      open() { $('shopNote').textContent = 'Оружие продаётся с патронами. Повторная покупка — только патроны.'; render(); },
      buy,
      place: shop
    };
  };
})(window.NB);
