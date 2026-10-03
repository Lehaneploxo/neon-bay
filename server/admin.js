'use strict';
// The owner's page: /admin on this server (admin.html), signed in with a game account that is on the admin list
// (GTA_ADMINS in Railway, nicks separated by commas; by default the owner's own). One POST /api/admin with
// { token, a: action, … }:
//   online                   who is in the game now (where, connection, money)
//   find {q}                 accounts by nick (empty: the richest)
//   acct {id}                one account: money, bans, homes and businesses, what was bought, the money log
//   bad                      refused money (the game asked for money it couldn't have earned)
//   money {id, n, why}       give (n > 0) or take (n < 0);  setmoney {id, n}
//   rollback {id, row}       the money back to what it was just before that log line
//   ban {id, minutes, reason} (0 minutes: for ever) · unban · mute {id, minutes} · unmute · kick {id}
//   revoke {kind, item}      take a home or business away (free again, no refund)
//   announce {text}          a line in everybody's chat from the server
const fs = require('fs'), path = require('path');
const DEFAULT_ADMINS = ['lehaneploxo', 'leha_neploxo'];
const FOREVER = 100 * 365 * 24 * 3600 * 1000;

function attach(app, o) {
  // o: route(name, fn, needAuth), fail(res, status, code, text), store (getter), wallet, world, rt (realtime), dir
  const admins = () => (process.env.GTA_ADMINS ? process.env.GTA_ADMINS.split(',') : DEFAULT_ADMINS).map(s => s.trim().toLowerCase()).filter(Boolean);
  const isAdmin = acc => admins().includes(String(acc.nick).toLowerCase());
  const page = path.join(o.dir, 'admin.html');
  app.get('/admin', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.type('html').send(fs.readFileSync(page, 'utf8')); });

  const live = id => o.rt.byAccount(id);
  const S = () => o.store;
  async function account(id) {
    const a = await S().byId(id); if (!a) return null;
    return { id: a.id, nick: a.nick, created: a.created_at ? new Date(a.created_at).getTime() : 0, seen: a.last_seen ? new Date(a.last_seen).getTime() : 0,
      banned: +a.banned_until || 0, reason: a.ban_reason || '', muted: +a.muted_until || 0 };
  }
  // after the admin changed someone's money: their game gets the new balance at once
  function pushMoney(id, money, note) {
    const p = live(id); if (!p || money == null) return;
    o.rt.sendMoney(p, money);
    if (note) o.rt.send(p, { t: 'admin_note', text: note });
  }

  o.route('admin', async (req, res, b) => {
    if (!isAdmin(req.acc)) return o.fail(res, 403, 'not_admin', 'Нет доступа');
    const id = Math.floor(+b.id) || 0, now = Date.now();
    switch (b.a) {
      case 'me': return res.json({ nick: req.acc.nick });
      case 'online': {
        const list = [];
        for (const p of o.rt.players.values()) {
          if (!p.ready) continue;
          list.push({ pid: p.id, acc: p.accountId || 0, nick: p.nick, guest: p.guest, x: p.s ? Math.round(p.s.x) : null, z: p.s ? Math.round(p.s.z) : null, room: p.room || '',
            car: p.s && p.s.car ? p.s.car.m : '', rtt: p.rtt == null ? null : Math.round(p.rtt), host: !!(p.group && p.group === p.id), group: p.group || 0,
            since: p.joinedAt || 0, money: p.accountId ? await o.wallet.money(p.accountId) : null, muted: p.mutedUntil > now ? p.mutedUntil : 0 });
        }
        return res.json({ list, now });
      }
      case 'find': {
        const list = await S().findAccounts(String(b.q || '').trim().slice(0, 20), 60);
        for (const r of list) r.online = !!live(r.id);
        return res.json({ list });
      }
      case 'acct': {
        const a = await account(id); if (!a) return o.fail(res, 404, 'none', 'Нет такого аккаунта');
        a.money = await o.wallet.money(id); a.online = !!live(id);
        a.owned = await S().ownedBy(id); a.assets = await S().assets(id); a.log = await S().logOf(id, 200);
        return res.json(a);
      }
      case 'bad': return res.json({ list: await S().logBad(150) });
      case 'money': case 'setmoney': {
        const n = Math.floor(+b.n); if (!isFinite(n)) return o.fail(res, 400, 'bad', 'Неверная сумма');
        if (!(await account(id))) return o.fail(res, 404, 'none', 'Нет такого аккаунта');
        const why = 'Админ: ' + (String(b.why || '').trim().slice(0, 60) || (b.a === 'setmoney' ? 'установил сумму' : n > 0 ? 'выдал' : 'забрал'));
        // (the money comes over from the save the first time the player comes in after the update: until then there's nothing to change)
        if ((await o.wallet.money(id)) == null) return o.fail(res, 409, 'no_wallet', 'Игрок ещё не заходил в игру после обновления — его деньги пока в сохранении');
        const money = b.a === 'setmoney' ? await o.wallet.set(id, n, why) : await o.wallet.change(id, n, why, 'admin');
        pushMoney(id, money, b.a === 'setmoney' ? null : n > 0 ? 'Администратор выдал вам $' + n.toLocaleString('ru-RU') : 'Администратор забрал у вас $' + (-n).toLocaleString('ru-RU'));
        return res.json({ money });
      }
      case 'rollback': {
        const row = await S().logRow(id, Math.floor(+b.row)); if (!row) return o.fail(res, 404, 'none', 'Нет такой строки');
        if ((await o.wallet.money(id)) == null) return o.fail(res, 409, 'no_wallet', 'Нет денег на сервере');
        const target = row.ok ? row.bal - row.delta : row.bal;   // just before that change
        const money = await o.wallet.set(id, target, 'Админ: откат к записи #' + row.id);
        pushMoney(id, money, 'Администратор откатил ваши деньги');
        return res.json({ money });
      }
      case 'ban': case 'unban': case 'mute': case 'unmute': {
        if (!(await account(id))) return o.fail(res, 404, 'none', 'Нет такого аккаунта');
        const mins = Math.max(0, Math.floor(+b.minutes || 0)), until = b.a.startsWith('un') ? 0 : now + (mins ? mins * 60000 : FOREVER);
        if (b.a === 'ban' || b.a === 'unban') {
          await S().setFlags(id, { banned_until: until, ban_reason: until ? String(b.reason || '').trim().slice(0, 120) : null });
          const p = live(id); if (p && until) { o.rt.send(p, { t: 'banned', until, reason: String(b.reason || '').slice(0, 120) }); o.rt.kick(p, 'ban'); }
        } else {
          await S().setFlags(id, { muted_until: until });
          const p = live(id); if (p) { p.mutedUntil = until; o.rt.send(p, { t: 'admin_note', text: until ? 'Администратор запретил вам писать в чат' + (mins ? ' на ' + mins + ' мин' : '') : 'Вам снова можно писать в чат' }); }
        }
        return res.json({ ok: true, until });
      }
      case 'kick': {
        const p = live(id); if (!p) return o.fail(res, 404, 'none', 'Игрок не в игре');
        o.rt.kick(p, 'admin');
        return res.json({ ok: true });
      }
      case 'revoke': {
        const acc = await o.world.revoke(String(b.kind), String(b.item));
        if (!acc) return o.fail(res, 404, 'none', 'У этого никого нет владельца');
        o.rt.broadcast({ t: 'own', kind: String(b.kind), id: String(b.item), nick: null, revoked: acc });
        const p = live(acc); if (p) o.rt.send(p, { t: 'admin_note', text: 'Администратор забрал у вас ' + (b.kind === 'biz' ? 'бизнес' : 'жильё') });
        return res.json({ ok: true });
      }
      case 'announce': {
        const text = String(b.text || '').replace(/\s+/g, ' ').trim(); if (!text) return o.fail(res, 400, 'bad', 'Пустое сообщение');
        o.rt.announce(text);
        return res.json({ ok: true });
      }
      default: return o.fail(res, 400, 'bad', 'Неизвестное действие');
    }
  }, true);
}
module.exports = { attach };
