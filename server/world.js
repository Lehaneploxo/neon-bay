'use strict';
// The shared city: what is the same for every player on the server.
//  - homes and businesses: each has at most one owner (an account); everybody sees whose it is;
//  - a business pays its owner half of what other players spend in it, straight away if the owner is in
//    the game, or kept until they come back;
//  - once-for-everybody loot: the bank vault (again after 15 minutes), the army crate on Omega (15 minutes),
//    the secret islet's chest (a real day), the free first-aid kit by the hospital (15 minutes). Whoever claims it first gets it; the timers live in the database.
const ID_RE = /^[a-z0-9_]{1,40}$/;
const KINDS = ['home', 'biz'];
const TIMERS = { bank: 15 * 60 * 1000, crate: 15 * 60 * 1000, chest: 24 * 3600 * 1000, medkit: 15 * 60 * 1000 };
const BIZ_SHARE = .5;              // the owner's half; the other half is the business's expenses
const BIZ_MAX_SPEND = 2000000;     // one purchase can't be more than this (junk guard)

function create(o) {
  // o.store: the database (may be null for a moment while the server starts)
  const owners = { home: new Map(), biz: new Map() };   // item -> { accountId, nick, earned }
  let timers = {}, loaded = null;
  const online = new Map();   // accountId -> player
  let broadcastAll = null;

  function load() {
    if (loaded) return loaded;
    loaded = (async () => {
      while (!o.store) await new Promise(r => setTimeout(r, 500));
      for (const k of KINDS) for (const r of await o.store.owners(k)) owners[k].set(r.item, { accountId: r.accountId, nick: r.nick, earned: r.earned });
      try { timers = JSON.parse(await o.store.meta('timers', '{}')) || {}; } catch (e) { timers = {}; }
    })().catch(e => { loaded = null; throw e; });
    return loaded;
  }
  const list = k => { const out = {}; for (const [item, r] of owners[k]) out[item] = r.nick; return out; };
  const saveTimers = () => o.store && o.store.setMeta('timers', JSON.stringify(timers)).catch(e => console.error('[world] timers', e.message));

  async function payOut(p) {
    if (!p.accountId) return;
    for (const { item, n } of await o.store.takePending('biz', p.accountId)) p.send({ t: 'biz_income', id: item, n, away: true });
  }

  return {
    async joined(p, send) {
      p.send = m => send(p, m);
      await load();
      if (p.accountId) online.set(p.accountId, p);
      send(p, { t: 'owners', home: list('home'), biz: list('biz'), timers, now: Date.now() });
      payOut(p).catch(e => console.error('[world] payout', e.message));
    },
    left(p) { if (p.accountId && online.get(p.accountId) === p) online.delete(p.accountId); },
    async message(p, m, send, players) {
      if (!broadcastAll) broadcastAll = msg => { const s = JSON.stringify(msg); for (const q of players.values()) if (q.ready) send(q, s); };
      await load();
      const reply = x => send(p, Object.assign({ rid: m.rid }, x));
      switch (m.t) {
        // buy a home or a business: it's yours if nobody has it
        case 'own_claim': {
          if (!KINDS.includes(m.kind) || !ID_RE.test(String(m.id))) return reply({ t: 'own_claim', ok: false, why: 'bad' });
          if (!p.accountId) return reply({ t: 'own_claim', ok: false, why: 'guest' });
          const cur = owners[m.kind].get(m.id);
          if (cur) return reply({ t: 'own_claim', ok: cur.accountId === p.accountId, why: 'taken', nick: cur.nick });
          // one flat per block: the client says which other ids count as "the same block"
          if (await o.store.claim(m.kind, m.id, p.accountId, p.nick)) {
            owners[m.kind].set(m.id, { accountId: p.accountId, nick: p.nick, earned: 0 });
            reply({ t: 'own_claim', ok: true });
            broadcastAll({ t: 'own', kind: m.kind, id: m.id, nick: p.nick });
          } else reply({ t: 'own_claim', ok: false, why: 'taken' });
          return;
        }
        // sold, or lost for unpaid rent
        case 'own_free': {
          if (!KINDS.includes(m.kind) || !ID_RE.test(String(m.id)) || !p.accountId) return;
          const cur = owners[m.kind].get(m.id);
          if (!cur || cur.accountId !== p.accountId) return;
          if (await o.store.release(m.kind, m.id, p.accountId)) { owners[m.kind].delete(m.id); broadcastAll({ t: 'own', kind: m.kind, id: m.id, nick: null }); }
          return;
        }
        // what this account owned before going online (or as a guest): claim what's still free, say what isn't
        case 'own_sync': {
          if (!p.accountId || !KINDS.includes(m.kind) || !Array.isArray(m.ids)) return;
          const lost = [];
          for (const id of m.ids.slice(0, 50)) {
            if (!ID_RE.test(String(id))) continue;
            const cur = owners[m.kind].get(id);
            if (cur) { if (cur.accountId !== p.accountId) lost.push(id); continue; }
            if (await o.store.claim(m.kind, id, p.accountId, p.nick)) { owners[m.kind].set(id, { accountId: p.accountId, nick: p.nick, earned: 0 }); broadcastAll({ t: 'own', kind: m.kind, id, nick: p.nick }); }
            else lost.push(id);
          }
          // and what the server says is theirs but the save doesn't have (another device): it's theirs
          const mine = [];
          for (const [id, r] of owners[m.kind]) if (r.accountId === p.accountId) mine.push(id);
          send(p, { t: 'own_sync', kind: m.kind, lost, mine });
          return;
        }
        // a purchase in a business: half of it goes to the owner (not for buying in your own)
        case 'biz_spend': {
          if (!ID_RE.test(String(m.id))) return;
          const n = Math.floor(+m.n), cur = owners.biz.get(m.id);
          if (!cur || !(n > 0) || n > BIZ_MAX_SPEND || cur.accountId === p.accountId) return;
          const share = Math.floor(n * BIZ_SHARE); if (share <= 0) return;
          cur.earned += share;
          const q = online.get(cur.accountId);
          await o.store.addPending('biz', m.id, share);
          if (q) { await payOut(q); }
          return;
        }
        // once-for-everybody loot
        case 'claim': {
          const period = TIMERS[m.key]; if (!period) return reply({ t: 'claim', ok: false });
          const now = Date.now();
          if ((timers[m.key] || 0) > now) return reply({ t: 'claim', ok: false, readyAt: timers[m.key] });
          timers[m.key] = now + period; saveTimers();
          reply({ t: 'claim', ok: true, readyAt: timers[m.key] });
          broadcastAll({ t: 'timer', key: m.key, readyAt: timers[m.key], by: p.nick });
          return;
        }
        case 'biz_stats': {
          const out = {};
          for (const [id, r] of owners.biz) if (r.accountId === p.accountId) out[id] = r.earned;
          return reply({ t: 'biz_stats', earned: out });
        }
      }
    }
  };
}
module.exports = { create };
