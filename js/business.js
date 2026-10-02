// Player businesses. Every shop, café, boutique, gun shop and entertainment place in the city can be bought
// at the «NEPLOXO Бизнес» desk in the lobby of NEPLOXO TOWER. One owner per business on the whole server
// (server/world.js); the owner's nick is on its door. Whatever other players spend inside it, half goes to
// the owner — straight away if they're in the game, or waiting for them when they come back; the other half
// is the business's own expenses. Sold back at the desk for half its price.
(function (NB) {
  'use strict';
  const fmt = n => '$' + Math.round(n).toLocaleString('ru-RU');
  // the interiors that are businesses of their own (place id -> business)
  const PLACES = {
    ammo: { name: 'Ammo Bay', where: 'Даунтаун', price: 300000 },
    diner: { name: 'Закусочная', where: 'Даунтаун', price: 150000 },
    arcade: { name: 'Зал игровых автоматов', where: 'Даунтаун', price: 200000 },
    casino: { name: 'Казино', where: 'Даунтаун', price: 1500000 },
    hotel: { name: 'Отель OCEAN', where: 'Пляж Not Bad', price: 900000 },
    fashion: { name: 'Бутик NOT BAD Fashion', where: 'Бульвар Not Bad', price: 350000 },
    strip: { name: 'NOT BAD GIRLS', where: 'Район 21', price: 600000 },
    boxing: { name: 'NOT BAD BOXING', where: 'Норт-Сайд', price: 200000 },
    gym: { name: 'NEPLOXO GYM', where: 'Норт-Сайд', price: 180000 }
  };
  // the shops from shops.js: a price by what they are
  const SHOP_PRICE = { lobster: 250000, sushi: 150000, coco: 90000, luxe: 450000, mall: 200000, guns: 250000, market: 80000, clothes: 120000, food: 60000 };
  const NOT_SALES = /^(Аренда|Штраф|Лечение|Покупка виллы|Возврат)/;   // money that leaves you inside but isn't a purchase there

  NB.createBusiness = function (o) {
    // o: places, shops, fronts (entrances made in main), progress, money { add, spend }, ui, flash, audio, save
    const P = o.progress;
    if (!P.biz || typeof P.biz !== 'object') P.biz = {};
    const N = () => NB.net;
    const LIST = [];
    for (const id in PLACES) if (o.places.byId(id)) LIST.push(Object.assign({ id, place: id }, PLACES[id]));
    for (const s of o.shops.shops) LIST.push({ id: s.id, name: s.name, where: s.sub, price: SHOP_PRICE[s.menu] || SHOP_PRICE[s.stock] || SHOP_PRICE[s.kind] || 80000, shop: s });
    const BY = {}; for (const b of LIST) BY[b.id] = b;
    const owner = b => (N() ? N().owner('biz', b.id) : null);
    const mine = b => !!P.biz[b.id];

    // which business the hero is standing in right now
    function here() {
      const pl = o.places.current; if (!pl) return null;
      if (pl.info && pl.info.biz) return BY[pl.info.biz] || null;
      return PLACES[pl.id] && BY[pl.id] || null;
    }
    // a purchase inside: half of it to the owner (the server skips your own business)
    function spent(n, note) {
      const b = here(); if (!b || !(n > 0) || NOT_SALES.test(note || '')) return;
      if (N()) N().spent(b.id, n);
    }

    function buy(b) {
      P.biz[b.id] = { price: b.price, t: Date.now() }; o.save(); o.audio.fare();
      N().claim('biz', b.id).then(ok => {
        if (ok || !P.biz[b.id]) return;
        delete P.biz[b.id]; o.money.add(b.price, 'Возврат: ' + b.name); o.save();
        o.flash(b.name + ': кто-то купил чуть раньше вас — деньги вернули', 4);
      });
      return 'Поздравляем! ' + b.name + ' — ваш бизнес. Половина того, что тратят в нём другие игроки, — ваша';
    }
    let earned = {};
    function office() {
      if (N() && N().connected && !N().guest) N().request({ t: 'biz_stats' }).then(r => { if (r && r.earned) earned = r.earned; });
      o.ui.menu({ eyebrow: 'NEPLOXO TOWER · лобби', title: 'NEPLOXO Бизнес', items: () => {
        const rows = [{ name: 'Как это работает', desc: 'Купите заведение — и половина того, что в нём тратят другие игроки, будет приходить вам, даже когда вас нет в игре. Вторая половина — расходы заведения. Продать можно здесь же за половину цены', price: 0, disabled: 'Понятно', buy: () => '' }];
        const sorted = LIST.slice().sort((a, b) => (mine(b) - mine(a)) || a.price - b.price);
        for (const b of sorted) {
          if (mine(b)) { rows.push({ name: '★ ' + b.name, desc: 'Ваш бизнес · ' + b.where + (earned[b.id] ? ' · заработал ' + fmt(earned[b.id]) : '') + ' · продать за ' + fmt((P.biz[b.id].price || b.price) / 2), price: -Math.round((P.biz[b.id].price || b.price) / 2), label: 'Продать', buy: () => sellOnce(b) }); continue; }
          const who = owner(b), why = who ? 'Владелец: ' + who : N() ? N().cantBuy('biz', b.id) : 'Нет связи с сервером';
          rows.push({ name: b.name, desc: b.where + (who ? ' · владелец ' + who : ' · свободен'), price: why ? 0 : b.price, label: 'Купить', disabled: why, buy: () => buy(b) });
        }
        return rows;
      } });
    }
    // sold back: the menu row pays the half price itself (a negative price)
    const sellOnce = b => { const back = Math.round((P.biz[b.id].price || b.price) / 2); delete P.biz[b.id]; if (N()) N().free('biz', b.id); o.save(); return 'Продано за ' + fmt(back); };

    // the desk in the tower lobby
    const tower = o.places.byId('tower');
    if (tower) { const d = tower.P(0, 4.6); tower.interactions.push({ x: d.x, z: d.z, r: 2, short: 'БИЗНЕС', label: () => 'NEPLOXO Бизнес: купить заведение', use: office }); }

    // owner's nick on the doors
    const hint = b => { const w = owner(b); return w ? (mine(b) ? 'ВАШ БИЗНЕС' : 'ВЛАДЕЛЕЦ: ' + w) : undefined; };
    for (const b of LIST) {
      const e = b.shop ? b.shop.entrance : o.fronts[b.place];
      if (e) e.hintFn = () => hint(b);
    }

    // income: added to the cash; a few small sums in a row are told about together
    let incT = 0, incSum = 0, incName = '';
    function hook() {
      N().on('biz_income', m => {
        const b = BY[m.id], name = b ? b.name : m.id;
        o.money.add(m.n, 'Бизнес: ' + name);
        if (m.away) { o.flash('Пока вас не было, ' + name + ' заработал ' + fmt(m.n), 4); return; }
        incSum += m.n; incName = incSum === m.n ? name : 'ваши бизнесы'; if (incT <= 0) incT = 4;
      });
      // sync: what the save owns, what the server says
      N().on('owners', () => { if (!N().guest) N().sync('biz', Object.keys(P.biz)); });
      N().on('own_sync', m => {
        if (m.kind !== 'biz') return;
        for (const id of m.lost) { const r = P.biz[id], b = BY[id]; if (!r) continue; delete P.biz[id]; o.money.add(r.price || (b && b.price) || 0, 'Возврат: ' + (b ? b.name : id)); o.flash((b ? b.name : id) + ' принадлежит другому игроку — деньги вернули', 4); }
        for (const id of m.mine) if (BY[id] && !P.biz[id]) P.biz[id] = { price: BY[id].price, t: Date.now() };
        o.save();
      });
    }
    let hooked = false;
    return {
      list: LIST, here, spent,
      update(dt) {
        if (!hooked && N()) { hooked = true; hook(); }
        if (incT > 0 && (incT -= dt) <= 0 && incSum) { o.flash('💼 ' + incName + ': +' + fmt(incSum) + ' от покупок других игроков', 3); incSum = 0; }
      }
    };
  };
})(window.NB);
