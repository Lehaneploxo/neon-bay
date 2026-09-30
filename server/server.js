'use strict';
// LEHA NEPLOXO WORLD — game server. The game itself is static (GitHub Pages, shown at gameleha.xyz);
// this server keeps the players: accounts (nick + password), the saved progress of each one, and the
// one clock everybody's city runs on. A separate Railway service, so a restart here never touches the
// TikTok games on donation-race. Tables are prefixed gta_ and live in the same Postgres.
//
// Every request is a POST with a text/plain JSON body (the token rides inside it): such requests need
// no CORS preflight and still work from navigator.sendBeacon / fetch keepalive when the page closes.
const express = require('express');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const PORT = process.env.PORT || 3100;
const ORIGINS = [/^https:\/\/(www\.)?gameleha\.xyz$/, /^https:\/\/lehaneploxo\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const NICK_RE = /^[A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9_]{3,16}$/;
const RESERVED = ['admin', 'administrator', 'moderator', 'support', 'system', 'bot', 'gm', 'leha', 'leha_neploxo', 'lehaneploxo', 'админ', 'модератор', 'поддержка', 'бот'];
const TOKEN_TTL_MS = 180 * 24 * 3600 * 1000;   // stay signed in for half a year
const SAVE_MAX = 96 * 1024;                     // a save is a few KB; anything this big is junk

/* ---------- storage: Postgres in production, a JSON file for local development ---------- */
class PgStore {
  constructor(url) {
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString: url, ssl: url.includes('.railway.internal') ? false : { rejectUnauthorized: false }, max: 5 });
  }
  async init() {
    const q = s => this.pool.query(s);
    await q(`CREATE TABLE IF NOT EXISTS gta_accounts (
      id SERIAL PRIMARY KEY, nick TEXT NOT NULL, nick_lower TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ)`);
    await q(`CREATE TABLE IF NOT EXISTS gta_saves (
      account_id INTEGER PRIMARY KEY REFERENCES gta_accounts(id) ON DELETE CASCADE,
      data JSONB NOT NULL, t BIGINT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS gta_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  }
  async meta(key, fallback) {
    await this.pool.query('INSERT INTO gta_meta(key,value) VALUES($1,$2) ON CONFLICT (key) DO NOTHING', [key, fallback]);
    return (await this.pool.query('SELECT value FROM gta_meta WHERE key=$1', [key])).rows[0].value;
  }
  async createAccount(nick, hash) {
    try { return (await this.pool.query('INSERT INTO gta_accounts(nick,nick_lower,pass_hash) VALUES($1,$2,$3) RETURNING id', [nick, nick.toLowerCase(), hash])).rows[0].id; }
    catch (e) { if (e.code === '23505') throw new Error('taken'); throw e; }
  }
  async byNick(nick) { return (await this.pool.query('SELECT * FROM gta_accounts WHERE nick_lower=$1', [nick.toLowerCase()])).rows[0] || null; }
  async byId(id) { return (await this.pool.query('SELECT * FROM gta_accounts WHERE id=$1', [id])).rows[0] || null; }
  async load(id) {
    const r = (await this.pool.query('SELECT data, t FROM gta_saves WHERE account_id=$1', [id])).rows[0];
    return r ? { data: r.data, t: +r.t } : null;
  }
  async save(id, data, t) {
    await this.pool.query(`INSERT INTO gta_saves(account_id,data,t) VALUES($1,$2,$3)
      ON CONFLICT (account_id) DO UPDATE SET data=$2, t=$3, updated_at=now()`, [id, data, t]);
    await this.pool.query('UPDATE gta_accounts SET last_seen=now() WHERE id=$1', [id]);
  }
}

class FileStore {
  constructor(file) { this.file = file; this.db = { accounts: [], saves: {}, meta: {} }; }
  async init() { try { this.db = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) {} }
  flush() { fs.writeFileSync(this.file, JSON.stringify(this.db)); }
  async meta(key, fallback) { if (!(key in this.db.meta)) { this.db.meta[key] = fallback; this.flush(); } return this.db.meta[key]; }
  async createAccount(nick, hash) {
    if (this.db.accounts.some(a => a.nick_lower === nick.toLowerCase())) throw new Error('taken');
    const id = this.db.accounts.length + 1;
    this.db.accounts.push({ id, nick, nick_lower: nick.toLowerCase(), pass_hash: hash }); this.flush();
    return id;
  }
  async byNick(nick) { return this.db.accounts.find(a => a.nick_lower === nick.toLowerCase()) || null; }
  async byId(id) { return this.db.accounts.find(a => a.id === id) || null; }
  async load(id) { return this.db.saves[id] || null; }
  async save(id, data, t) { this.db.saves[id] = { data, t }; this.flush(); }
}

/* ---------- passwords and tokens ---------- */
let secret = '';
async function hashPass(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + (await scrypt(pw, salt, 32)).toString('hex');
}
async function checkPass(pw, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const h = await scrypt(pw, Buffer.from(saltHex, 'hex'), 32), want = Buffer.from(hashHex, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
function signToken(id) {
  const payload = id + '.' + (Date.now() + TOKEN_TTL_MS);
  return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}
function verifyToken(token) {
  const p = String(token || '').split('.');
  if (p.length !== 3) return null;
  const a = Buffer.from(crypto.createHmac('sha256', secret).update(p[0] + '.' + p[1]).digest('base64url')), b = Buffer.from(p[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b) || +p[1] < Date.now()) return null;
  return +p[0] || null;
}

// a guard against password guessing: at most `limit` tries a minute from one address
const tries = new Map();
function tooMany(ip, limit) {
  const now = Date.now(), arr = (tries.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); tries.set(ip, arr);
  return arr.length > limit;
}
setInterval(() => { const now = Date.now(); for (const [ip, a] of tries) if (!a.some(t => now - t < 60000)) tries.delete(ip); }, 120000).unref();

/* ---------- http ---------- */
let store = null;
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ORIGINS.some(re => re.test(o))) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'POST, GET'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.status(204).end(); }
  next();
});

app.get('/', (req, res) => res.type('text').send('LEHA NEPLOXO WORLD server'));
app.get('/health', (req, res) => res.json({ ok: !!store }));
// the shared clock: the game counts one game minute per real second from this
app.all('/api/time', (req, res) => res.json({ now: Date.now() }));

const body = express.text({ type: () => true, limit: SAVE_MAX + 4096 });
const fail = (res, status, code, error) => res.status(status).json({ code, error });
function route(name, fn, needAuth) {
  app.post('/api/' + name, body, async (req, res) => {
    if (!store) return fail(res, 503, 'starting', 'Сервер запускается, попробуйте через минуту');
    let b; try { b = JSON.parse(req.body || '{}'); } catch (e) { return fail(res, 400, 'bad_json', 'Неверный запрос'); }
    if (!b || typeof b !== 'object') return fail(res, 400, 'bad_json', 'Неверный запрос');
    try {
      if (needAuth) {
        const id = verifyToken(b.token), acc = id && await store.byId(id);
        if (!acc) return fail(res, 401, 'need_login', 'Нужно войти заново');
        req.acc = acc;
      }
      await fn(req, res, b);
    } catch (e) { console.error('[api]', name, e.message); fail(res, 500, 'server_error', 'Ошибка сервера'); }
  });
}

route('register', async (req, res, { nick, pass }) => {
  if (tooMany(req.ip, 10)) return fail(res, 429, 'too_many', 'Слишком много попыток, подождите минуту');
  if (typeof nick !== 'string' || !NICK_RE.test(nick)) return fail(res, 400, 'nick_bad', 'Ник: 3–16 символов, только буквы, цифры и _');
  if (RESERVED.includes(nick.toLowerCase())) return fail(res, 400, 'nick_reserved', 'Этот ник занят');
  if (typeof pass !== 'string' || pass.length < 6 || pass.length > 64) return fail(res, 400, 'pass_bad', 'Пароль: от 6 до 64 символов');
  let id;
  try { id = await store.createAccount(nick, await hashPass(pass)); }
  catch (e) { if (e.message === 'taken') return fail(res, 409, 'nick_taken', 'Этот ник уже занят'); throw e; }
  res.json({ token: signToken(id), nick, save: null });
});

route('login', async (req, res, { nick, pass }) => {
  if (tooMany(req.ip, 20)) return fail(res, 429, 'too_many', 'Слишком много попыток, подождите минуту');
  const acc = typeof nick === 'string' && typeof pass === 'string' ? await store.byNick(nick) : null;
  if (!acc || !(await checkPass(pass, acc.pass_hash))) return fail(res, 401, 'bad_creds', 'Неверный ник или пароль');
  res.json({ token: signToken(acc.id), nick: acc.nick, save: await store.load(acc.id) });
});

route('load', async (req, res) => {
  res.json({ nick: req.acc.nick, save: await store.load(req.acc.id), now: Date.now() });
}, true);

route('save', async (req, res, { data, t }) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(res, 400, 'bad_save', 'Неверное сохранение');
  if (JSON.stringify(data).length > SAVE_MAX) return fail(res, 413, 'too_big', 'Сохранение слишком большое');
  t = Number.isFinite(+t) ? Math.min(+t, Date.now()) : Date.now();
  // an older copy (a second tab or phone that was left open) never overwrites a newer one
  const cur = await store.load(req.acc.id);
  if (cur && cur.t > t) return res.json({ ok: false, stale: true, t: cur.t });
  await store.save(req.acc.id, data, t);
  res.json({ ok: true, t });
}, true);

async function start() {
  const s = process.env.DATABASE_URL ? new PgStore(process.env.DATABASE_URL) : new FileStore(path.join(__dirname, '.dev_db.json'));
  if (!process.env.DATABASE_URL) console.warn('[db] DATABASE_URL не задан — аккаунты в server/.dev_db.json (только для разработки)');
  await s.init();
  secret = process.env.GTA_SECRET || await s.meta('secret', crypto.randomBytes(32).toString('hex'));
  store = s;
  console.log('[db] ready');
}
app.listen(PORT, () => console.log(`[server] LEHA NEPLOXO WORLD on :${PORT}`));
(function boot(delay) {
  start().catch(e => { console.error('[db] init failed:', e.message, '— retry in', delay / 1000, 's'); setTimeout(() => boot(Math.min(delay * 2, 60000)), delay); });
})(2000);
