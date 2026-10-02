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

function attach(httpServer, o) {
  // o: { verifyToken(token) -> accountId|null, store, origins: [RegExp], world (shared state, optional) }
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 16 * 1024 });
  const players = new Map();   // id -> player
  const chat = [];
  let nextId = 1;

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
        p.nick = acc.nick; p.guest = false; p.accountId = acc.id;
      } else {
        const n = String(m.guest || '').replace(/\D/g, '').slice(0, 4) || String(1000 + Math.floor(Math.random() * 9000));
        p.nick = 'Гость ' + n; p.guest = true;
      }
      p.look = sanitizeLook(m.look); p.outfit = str(m.outfit, 12) || 'own';
      p.ready = true; players.set(p.id, p);
      send(p, { t: 'welcome', id: p.id, nick: p.nick, guest: p.guest, online: players.size });
      send(p, { t: 'chat_history', list: chat });
      if (o.world) o.world.joined(p, send);
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
      default:
        if (o.world) await o.world.message(p, m, send, players);
    }
  }

  function leave(p) {
    if (!players.has(p.id) || players.get(p.id) !== p) return;
    players.delete(p.id);
    for (const q of players.values()) if (q.known.delete(p.id)) send(q, { t: 'gone', id: p.id });
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
