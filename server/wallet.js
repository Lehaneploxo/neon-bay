'use strict';
// Money is the server's. A signed-in player's cash lives in gta_accounts.money, not in the save: the game
// tells the server every change ('$' messages: [seq, amount, why, asset, business]) and the server checks
// each one before it counts.
//  - spending is always fine (never below zero);
//  - earning must fit a rule for its kind (wage, job bonus, cash picked up, taxi fare, prize, …): at most so much
//    at once and so much an hour (a bucket that refills at the honest top rate); casino and lottery wins need a
//    stake just paid; the islet's million needs the chest just claimed on the server;
//  - selling or refunding a home, business or car (an `asset` tag) can't bring back more than was paid for it:
//    every purchase with a tag is written down (gta_assets) and a sale takes the entry away;
//  - money handed out by the server itself (cash piles after a fight, business income, the admin) goes straight in.
// What doesn't fit is refused, written to the log as refused (the admin page shows it) and the game gets the
// true balance back. Every change is logged with the balance after it, so the admin can roll a player back.
const H = 3600 * 1000;
// [name, why matches, most at once, $ an hour (refill), most saved up (bucket size)]
const RULES = [
  ['wage', /^Зарплата/, 130, 130 * 60, 130 * 15],
  ['bonus', /^(Задержание|Помощь пострадавшему|Пожар потушен|Задержан угонщик|Вернули украденное)$/, 500, 15000, 4000],
  ['pickup', /^Подобрано$/, 700, 15000, 7000],
  ['till', /^Касса$/, 420, 5000, 2500],
  ['taxi', /такси|Чаевые|серия|Опоздание/, 900, 9000, 3000],
  ['prize', /^(Приз тира|Бокс|Приз NEON RACER)$/, 5000, 15000, 7000],
  ['blood', /^Сдать кровь$/, 25, 300, 50],
  ['tropic', /^Клад$/, 10000, 25000, 10000],
  // need: a stake paid within `ms`, the win at most `x` times it (the stake is used up)
  ['casino', /^(Выигрыш|Джекпот!|Рулетка)$/, 20000, 80000, 60000, { re: /^Ставка$/, ms: 120000, x: 200 }],
  ['lottery', /^Лотерея$/, 5000, 20000, 10000, { re: /./, eq: 20, ms: 30000, x: 250 }],
  // grant: the shared loot just claimed on the server by this account
  ['islet', /^Тайный клад$/, 1000000, 0, 0, null, 'chest']
];
const MAX = 1e12;
const TAG_RE = /^(home|biz|car):[A-Za-z0-9_]{1,40}$/;

function create(o) {
  // o.store (getter), o.log(msg)
  const S = () => o.store;
  // accountId -> { money, seq: {sid: n}, buckets, stakes, grants, chain }; kept while the server runs, so leaving
  // and coming back doesn't refill the hourly buckets
  const cache = new Map();
  let pending = [];          // log rows to write
  setInterval(flushLog, 2000).unref();
  async function flushLog() { if (!pending.length || !S()) return; const rows = pending; pending = []; try { await S().log(rows); } catch (e) { console.error('[wallet] log', e.message); } }
  const log = (acc, delta, why, bal, ok, src) => pending.push({ acc, t: Date.now(), delta, why: String(why).slice(0, 80), bal, ok, src: src || '' });

  async function state(acc) {
    let w = cache.get(acc);
    if (w) return w;
    const r = await S().wallet(acc);
    if (cache.get(acc)) return cache.get(acc);
    let seq = {}; try { seq = JSON.parse(r && r.seq || '{}') || {}; } catch (e) {}
    w = { money: r ? r.money : null, seq, buckets: {}, stakes: [], grants: {}, chain: Promise.resolve() };
    cache.set(acc, w);
    return w;
  }
  // one change at a time per account
  function serial(acc, fn) {
    return state(acc).then(w => { const run = w.chain.then(() => fn(w)); w.chain = run.catch(() => {}); return run; });
  }
  const save = (acc, w) => S().setWallet(acc, w.money, JSON.stringify(w.seq));
  function bucket(w, rule, now) {
    const [name, , , rate, cap] = rule;
    let b = w.buckets[name];
    if (!b) b = w.buckets[name] = { v: cap, t: now };
    b.v = Math.min(cap, b.v + (now - b.t) * rate / H); b.t = now;
    return b;
  }

  // one earning: true if it counts
  async function earnOk(acc, w, n, why, tag, now) {
    if (tag) {
      if (!TAG_RE.test(tag)) return false;
      const row = await S().assetPeek(acc, tag);
      if (!row || n > row.price) return false;
      await S().assetDel(row.id);
      return true;
    }
    const rule = RULES.find(r => r[1].test(why));
    if (!rule || n > rule[2]) return false;
    const need = rule[5], grant = rule[6];
    if (grant) { const g = w.grants[grant]; if (!g || now - g > 10 * 60 * 1000) return false; delete w.grants[grant]; return true; }
    let stake = null;
    if (need) {
      stake = w.stakes.find(s => !s.used && now - s.t < need.ms && need.re.test(s.why) && (!need.eq || s.n === need.eq) && n <= s.n * need.x);
      if (!stake) return false;
    }
    const b = bucket(w, rule, now);
    if (n > b.v) return false;
    b.v -= n; if (stake) stake.used = true;
    return true;
  }

  return {
    RULES,
    // the balance (null: this account's money hasn't come over from its save yet)
    async money(acc) { return (await state(acc)).money; },
    // the balance and how far a game session's changes are counted, taken together (after anything still running)
    snap: (acc, sid) => serial(acc, async w => ({ money: w.money, s: (sid && w.seq[sid]) || 0 })),
    // the first time: the money and what was bought come from the save (trusted once, as before)
    init(acc, money, assets) {
      return serial(acc, async w => {
        if (w.money != null) return w.money;
        w.money = Math.max(0, Math.min(MAX, Math.floor(+money || 0)));
        for (const a of (Array.isArray(assets) ? assets : []).slice(0, 300)) if (Array.isArray(a) && TAG_RE.test(a[0]) && +a[1] > 0) await S().assetAdd(acc, a[0], Math.min(MAX, Math.floor(+a[1])));
        await save(acc, w); log(acc, w.money, 'Деньги из сохранения', w.money, true, 'init');
        return w.money;
      });
    },
    // the game's changes: [[seq, n, why, tag, biz], …]; returns { money, seq, rej: [[seq, n, why]], biz: [[id, n]] }
    apply(acc, sid, ops) {
      return serial(acc, async w => {
        const out = { rej: [], biz: [] };
        if (w.money == null) { out.money = null; return out; }
        sid = String(sid || '').slice(0, 16);
        let last = w.seq[sid] || 0;
        const now = Date.now();
        for (const op of (Array.isArray(ops) ? ops : []).slice(0, 200)) {
          if (!Array.isArray(op)) continue;
          const seq = Math.floor(+op[0]), n = Math.floor(+op[1]), why = String(op[2] || '').slice(0, 80), tag = op[3] ? String(op[3]).slice(0, 50) : '', biz = op[4] ? String(op[4]).slice(0, 40) : '';
          if (!(seq > last)) continue;   // already counted (sent again after a reconnect)
          last = seq;
          if (!n || !isFinite(n) || Math.abs(n) > MAX) continue;
          if (n < 0) {   // spending
            const d = Math.min(-n, w.money);
            if (d <= 0) { log(acc, n, why, w.money, false, 'spend'); out.rej.push([seq, n, why]); continue; }
            w.money -= d; log(acc, -d, why, w.money, true, tag ? 'buy' : '');
            if (tag && TAG_RE.test(tag)) await S().assetAdd(acc, tag, d);
            w.stakes.push({ n: d, why, t: now }); if (w.stakes.length > 30) w.stakes.shift();
            if (biz) out.biz.push([biz, d, why]);
            continue;
          }
          if (await earnOk(acc, w, n, why, tag, now)) { w.money = Math.min(MAX, w.money + n); log(acc, n, why, w.money, true, tag ? 'sell' : ''); }
          else { log(acc, n, why, w.money, false, tag ? 'sell' : ''); out.rej.push([seq, n, why]); }
        }
        w.seq[sid] = last;
        // only the newest few game sessions are remembered
        const keys = Object.keys(w.seq); if (keys.length > 6) for (const k of keys.slice(0, keys.length - 6)) delete w.seq[k];
        await save(acc, w);
        out.money = w.money; out.seq = last;
        return out;
      });
    },
    // the server's own payments and takings (cash piles, business income, the admin): n > 0 in, n < 0 out
    change(acc, n, why, src) {
      return serial(acc, async w => {
        if (w.money == null) return null;
        n = Math.floor(n);
        if (n < 0) n = -Math.min(-n, w.money);
        if (!n) return w.money;
        w.money = Math.min(MAX, w.money + n);
        log(acc, n, why, w.money, true, src || 'server');
        await save(acc, w);
        return w.money;
      });
    },
    set(acc, money, why) {
      return serial(acc, async w => {
        const before = w.money == null ? 0 : w.money;
        w.money = Math.max(0, Math.min(MAX, Math.floor(money)));
        log(acc, w.money - before, why, w.money, true, 'admin');
        await save(acc, w);
        return w.money;
      });
    },
    // shared loot claimed by this account (world.js): the payout that goes with it may follow
    grant(acc, key) { state(acc).then(w => { w.grants[key] = Date.now(); }).catch(() => {}); },
    flush: flushLog
  };
}
module.exports = { create, RULES };
