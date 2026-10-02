'use strict';
// The live world: every player connected over a WebSocket at /ws. Each one sends where they are about ten
// times a second (position, heading, what they're doing, the car they're in); the server passes it on to
// the players near them (same building, or within VIEW metres outdoors), with nick and clothes the first
// time they meet. Plus the common chat: one for the whole server, the last CHAT_HISTORY lines are shown
// to whoever comes in. Guests (no account) are seen as «Гость NNNN» but can't write in the chat.
const { WebSocketServer } = require('ws');

const VIEW = 260;              // metres: how far outdoors you see other players
const TICK_MS = 100;           // snapshots out, 10 a second
const CHAT_HISTORY = 40, CHAT_MAX_LEN = 200;
const MAX_MSGS_PER_SEC = 40;
// fights between players (decided with the user, 2026-10-01): a knocked-out player drops 0.5% of their cash
// (at most $10 000) in a pile anyone can grab for 60 s; the same attacker gets a drop from the same victim
// once per 30 minutes; nothing drops from guests, from accounts younger than 2 hours, or in safe places
// (the spawn beach, the hospital, your own home — the victim's game says where it is)
const KO_SHARE = .005, KO_CAP = 10000, KO_PAIR_MS = 30 * 60 * 1000, NEWBIE_MS = 2 * 3600 * 1000, CASH_LIFE_MS = 60000;

function attach(httpServer, o) {
  // o: { verifyToken(token) -> accountId|null, store, origins: [RegExp], world (shared state, optional) }
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 16 * 1024 });
  const players = new Map();   // id -> player
  const chat = [];
  let nextId = 1, cashId = 0;
  const koPairs = new Map(), cash = new Map();
  // the city's cars that moved: id -> { gone } (taken from its place, being driven) or { m, c, a, x, y, z, h, owner, at } (left here)
  const cars = new Map();
  const CARS_MAX = 300, CAR_LEFT_MS = 40 * 60 * 1000;

  const send = (p, m) => { if (p.ws.readyState === 1) p.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };
  const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const info = p => ({ t: 'pi', id: p.id, nick: p.nick, guest: p.guest, look: p.look, outfit: p.outfit });
  const broadcast = m => { const s = JSON.stringify(m); for (const q of players.values()) if (q.ready) send(q, s); };

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin;
    if (origin && !o.origins.some(re => re.test(origin))) { ws.close(4003, 'origin'); return; }
    const p = { id: nextId++, ws, ready: false, nick: '', guest: true, accountId: 0, look: null, outfit: 'own',
      s: null, room: '', known: new Set(), msgs: 0, win: 0, alive: true };
    ws.on('pong', () => { p.alive = true; });
    ws.on('message', raw => {
      const now = Date.now();
      if (now - p.win > 1000) { p.win = now; p.msgs = 0; }
      if (++p.msgs > MAX_MSGS_PER_SEC) return;
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      onMessage(p, m).catch(e => console.error('[ws]', m.t, e.message));
    });
    ws.on('close', () => leave(p));
    ws.on('error', () => {});
  });

  async function onMessage(p, m) {
    if (m.t === 'hello') {
      if (p.ready) return;
      const id = m.token ? o.verifyToken(m.token) : null, acc = id ? await o.store.byId(id) : null;
      if (acc) {
        // the same account in another tab or phone: the old connection goes
        for (const q of players.values()) if (q.accountId === acc.id) { send(q, { t: 'kicked' }); try { q.ws.close(4004, 'kicked'); } catch (e) {} leave(q); }
        p.nick = acc.nick; p.guest = false; p.accountId = acc.id; p.createdAt = acc.created_at ? new Date(acc.created_at).getTime() : 0;
      } else {
        const n = String(m.guest || '').replace(/\D/g, '').slice(0, 4) || String(1000 + Math.floor(Math.random() * 9000));
        p.nick = 'Гость ' + n; p.guest = true;
      }
      p.look = sanitizeLook(m.look); p.outfit = str(m.outfit, 12) || 'own';
      p.ready = true; players.set(p.id, p);
      send(p, { t: 'welcome', id: p.id, nick: p.nick, guest: p.guest, online: players.size });
      send(p, { t: 'chat_history', list: chat });
      for (const [id, c] of cash) send(p, { t: 'cash', id, x: c.x, y: c.y, z: c.z, n: c.n, room: c.room });
      send(p, { t: 'cars', list: [...cars].map(([id, c]) => Object.assign({ id }, c)) });
      if (o.world) o.world.joined(p, send).catch(e => console.error('[world] join', e.message));
      console.log('[ws] +' + p.nick + ' (online ' + players.size + ')');
      return;
    }
    if (!p.ready) return;
    switch (m.t) {
      case 'st': {   // where I am: [x, y, z, heading, flags, weapon, room, car]
        const c = m.c;
        p.s = { x: num(m.x, -5000, 5000), y: num(m.y, -200, 2000), z: num(m.z, -5000, 5000), h: num(m.h, -10, 10), f: num(m.f, 0, 1e6) | 0, w: str(m.w, 10), pc: num(m.pc, 0, 1e9) | 0,
          car: c && typeof c === 'object' ? { m: str(c.m, 16), c: str(c.c, 9), a: str(c.a, 9), x: num(c.x, -5000, 5000), y: num(c.y, -200, 2000), z: num(c.z, -5000, 5000), h: num(c.h, -10, 10), p: num(c.p, -3, 3), b: num(c.b, -3, 3), v: num(c.v, -200, 200), s: c.s ? 1 : 0 } : null };
        p.room = str(m.r, 40);
        break;
      }
      case 'look': {
        p.look = sanitizeLook(m.look); p.outfit = str(m.outfit, 12) || 'own';
        const s = JSON.stringify(info(p));
        for (const q of players.values()) if (q !== p && q.known.has(p.id)) send(q, s);
        break;
      }
      case 'chat': {
        if (p.guest) { send(p, { t: 'chat_denied' }); break; }
        const text = String(m.m || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
        if (!text) break;
        if (Date.now() - (p.chatT || 0) < 800) break;   // no machine-gun messages
        p.chatT = Date.now();
        const entry = { u: p.nick, m: text, id: p.id };
        chat.push(entry); if (chat.length > CHAT_HISTORY) chat.shift();
        broadcast({ t: 'chat', ...entry });
        break;
      }
      case 'hit': {   // my shot or punch landed on another player: they take the damage in their own game
        const q = players.get(m.id), now = Date.now();
        if (!q || q === p || !q.s || !p.s || q.room !== p.room) break;
        if (now - (p.hitWin || 0) > 1000) { p.hitWin = now; p.hits = 0; }
        if (++p.hits > 15) break;
        const melee = m.k === 'melee', d = Math.max(0, Math.min(melee ? 80 : 150, Math.round(+m.d || 0)));
        if (!d || Math.hypot(q.s.x - p.s.x, q.s.z - p.s.z) > (melee ? 5 : 110)) break;
        send(q, { t: 'hit', from: p.id, nick: p.nick, d, k: melee ? 'melee' : 'gun', x: p.s.x, z: p.s.z });
        break;
      }
      case 'ko': {    // I was knocked out by m.by: maybe some of my cash falls out
        const a = players.get(m.by), now = Date.now();
        if (!a || a === p || !p.s) break;
        send(a, { t: 'ko_you', nick: p.nick });
        const key = (a.accountId || 'g' + a.id) + '>' + (p.accountId || 'g' + p.id);
        const why = m.safe ? 'safe' : p.guest || (p.createdAt && now - p.createdAt < NEWBIE_MS) ? 'newbie' : (koPairs.get(key) || 0) > now ? 'pair' : '';
        if (why) { send(p, { t: 'ko_safe', why, nick: a.nick }); break; }
        const n = Math.min(KO_CAP, Math.floor(Math.max(0, +m.money || 0) * KO_SHARE));
        if (n < 1) break;
        koPairs.set(key, now + KO_PAIR_MS);
        send(p, { t: 'ko_drop', n, nick: a.nick });
        const id = ++cashId, c = { x: p.s.x, y: p.s.y, z: p.s.z, n, room: p.room, until: now + CASH_LIFE_MS };
        cash.set(id, c);
        broadcast({ t: 'cash', id, x: c.x, y: c.y, z: c.z, n, room: c.room });
        break;
      }
      case 'car_take': {   // I got into a shared car: it's no longer where it stood
        const id = str(m.id, 40); if (!id) break;
        const cur = cars.get(id);
        if (cur && cur.by && cur.by !== p.id && players.has(cur.by)) { send(p, { t: 'car_busy', id }); break; }
        cars.set(id, { gone: true, by: p.id, at: Date.now() }); p.carId = id;
        broadcast({ t: 'car_take', id, by: p.id });
        break;
      }
      case 'car_drop': {   // I left it here
        const id = str(m.id, 40); if (!id) break;
        const c = { m: str(m.m, 16), c: str(m.c, 16), a: str(m.a, 16), x: num(m.x, -5000, 5000), y: num(m.y, -50, 500), z: num(m.z, -5000, 5000), h: num(m.h, -10, 10), owner: str(m.owner, 20) || '', at: Date.now() };
        cars.delete(id); cars.set(id, c); if (p.carId === id) p.carId = null;
        while (cars.size > CARS_MAX) { const old = [...cars].find(([, v]) => !v.owner && !v.gone); if (!old) break; cars.delete(old[0]); broadcast({ t: 'car_take', id: old[0] }); }
        broadcast(Object.assign({ t: 'car_drop', id, by: p.id }, c));
        break;
      }
      case 'pick': {  // grabbing a pile of cash: whoever asks first
        const c = cash.get(m.id);
        if (!c || !p.s || p.room !== c.room || Math.hypot(p.s.x - c.x, p.s.z - c.z) > 4) break;
        cash.delete(m.id);
        broadcast({ t: 'cash_gone', id: m.id, by: p.id, nick: p.nick, n: c.n });
        break;
      }
      default:
        if (o.world) await o.world.message(p, m, send, players);
    }
  }

  function leave(p) {
    if (!players.has(p.id) || players.get(p.id) !== p) return;
    players.delete(p.id);
    for (const q of players.values()) if (q.known.delete(p.id)) send(q, { t: 'gone', id: p.id });
    // gone while driving a shared car: it stays where they last were
    if (p.carId && p.s && p.s.car) { const c = p.s.car, e = { m: c.m, c: c.c, a: c.a, x: c.x, y: c.y, z: c.z, h: c.h, owner: '', at: Date.now() }; cars.set(p.carId, e); broadcast(Object.assign({ t: 'car_drop', id: p.carId }, e)); }
    for (const [id, c] of cars) if (c.by === p.id && c.gone) c.by = 0;
    if (o.world) o.world.left(p);
    console.log('[ws] -' + p.nick + ' (online ' + players.size + ')');
  }

  // who sees whom: same building (room) — anywhere in it; outdoors — within VIEW metres
  const sees = (a, b) => a.s && b.s && a.room === b.room && (a.room || Math.hypot(a.s.x - b.s.x, a.s.z - b.s.z) < VIEW);
  setInterval(() => {
    const t = Date.now();
    for (const p of players.values()) {
      const list = [];
      for (const q of players.values()) {
        if (q === p) continue;
        if (sees(p, q)) {
          if (!p.known.has(q.id)) { p.known.add(q.id); send(p, info(q)); }
          const s = q.s, c = s.car;
          list.push([q.id, +s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2), +s.h.toFixed(3), s.f, s.w, s.pc,
            c ? [c.m, c.c, c.a, +c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2), +c.h.toFixed(3), +c.p.toFixed(3), +c.b.toFixed(3), +c.v.toFixed(1), c.s] : 0]);
        } else if (p.known.delete(q.id)) send(p, { t: 'gone', id: q.id });
      }
      send(p, { t: 'ps', time: t, n: players.size, list });
    }
    for (const [id, c] of cash) if (c.until < t) { cash.delete(id); broadcast({ t: 'cash_gone', id, by: 0 }); }
    for (const [k, until] of koPairs) if (until < t) koPairs.delete(k);
    for (const [id, c] of cars) if (!c.gone && !c.owner && t - c.at > CAR_LEFT_MS && id[0] !== 'p') { cars.delete(id); broadcast({ t: 'car_take', id }); }   // a car someone brought and left, after a while
  }, TICK_MS).unref();
  // dead connections (a phone that lost the network) are dropped after half a minute
  setInterval(() => {
    for (const p of players.values()) { if (!p.alive) { try { p.ws.terminate(); } catch (e) {} leave(p); continue; } p.alive = false; try { p.ws.ping(); } catch (e) {} }
  }, 30000).unref();

  return { players, send, broadcast };
}

// clothes: slot -> key, short strings only
function sanitizeLook(l) {
  const out = {};
  if (l && typeof l === 'object') for (const k of Object.keys(l).slice(0, 12)) if (/^[a-z]{2,10}$/.test(k) && typeof l[k] === 'string') out[k] = l[k].slice(0, 20);
  return out;
}

module.exports = { attach };
