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
const RESERVED = ['admin', 'administrator', 'moderator', 'support', 'system', 'bot', 'gm', 'leha', 'админ', 'модератор', 'поддержка', 'бот'];
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
    // the shared city: who owns which home and which business (one owner each), and what a business earned while its owner was away
    await q(`CREATE TABLE IF NOT EXISTS gta_owners (
      kind TEXT NOT NULL, item TEXT NOT NULL, account_id INTEGER NOT NULL REFERENCES gta_accounts(id) ON DELETE CASCADE, nick TEXT NOT NULL,
      pending BIGINT NOT NULL DEFAULT 0, earned BIGINT NOT NULL DEFAULT 0, t BIGINT NOT NULL, PRIMARY KEY (kind, item))`);
    // the money lives here, not in the save (wallet.js); bans and mutes (admin.js)
    for (const c of ['money BIGINT', 'money_seq TEXT', 'banned_until BIGINT NOT NULL DEFAULT 0', 'ban_reason TEXT', 'muted_until BIGINT NOT NULL DEFAULT 0'])
      await q('ALTER TABLE gta_accounts ADD COLUMN IF NOT EXISTS ' + c);
    // what was paid for homes, businesses and cars: selling one back can't bring more than was paid
    await q(`CREATE TABLE IF NOT EXISTS gta_assets (id SERIAL PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES gta_accounts(id) ON DELETE CASCADE,
      tag TEXT NOT NULL, price BIGINT NOT NULL, t BIGINT NOT NULL)`);
    await q('CREATE INDEX IF NOT EXISTS gta_assets_acc ON gta_assets(account_id, tag)');
    // every change of money: for the admin page (where it came from, roll back to a moment)
    await q(`CREATE TABLE IF NOT EXISTS gta_money_log (id BIGSERIAL PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES gta_accounts(id) ON DELETE CASCADE,
      t BIGINT NOT NULL, delta BIGINT NOT NULL, why TEXT NOT NULL, bal BIGINT NOT NULL, ok BOOLEAN NOT NULL, src TEXT NOT NULL DEFAULT '')`);
    await q('CREATE INDEX IF NOT EXISTS gta_money_log_acc ON gta_money_log(account_id, id)');
    await q('CREATE INDEX IF NOT EXISTS gta_money_log_bad ON gta_money_log(id) WHERE NOT ok');
    await this.pool.query('DELETE FROM gta_money_log WHERE t < $1', [Date.now() - 60 * 24 * 3600 * 1000]);
  }
  async wallet(id) { const r = (await this.pool.query('SELECT money, money_seq FROM gta_accounts WHERE id=$1', [id])).rows[0]; return r ? { money: r.money == null ? null : +r.money, seq: r.money_seq } : null; }
  async setWallet(id, money, seq) { await this.pool.query('UPDATE gta_accounts SET money=$2, money_seq=$3 WHERE id=$1', [id, money, seq]); }
  async assetAdd(id, tag, price) { await this.pool.query('INSERT INTO gta_assets(account_id,tag,price,t) VALUES($1,$2,$3,$4)', [id, tag, price, Date.now()]); }
  async assetPeek(id, tag) { const r = (await this.pool.query('SELECT id, price FROM gta_assets WHERE account_id=$1 AND tag=$2 ORDER BY id DESC LIMIT 1', [id, tag])).rows[0]; return r ? { id: r.id, price: +r.price } : null; }
  async assetDel(rowId) { await this.pool.query('DELETE FROM gta_assets WHERE id=$1', [rowId]); }
  async assets(id) { return (await this.pool.query('SELECT tag, price, t FROM gta_assets WHERE account_id=$1 ORDER BY id', [id])).rows.map(r => ({ tag: r.tag, price: +r.price, t: +r.t })); }
  async log(rows) {
    if (!rows.length) return;
    const v = [], a = [];
    rows.forEach((r, i) => { const k = i * 7; v.push(`($${k + 1},$${k + 2},$${k + 3},$${k + 4},$${k + 5},$${k + 6},$${k + 7})`); a.push(r.acc, r.t, r.delta, r.why, r.bal, r.ok, r.src || ''); });
    await this.pool.query('INSERT INTO gta_money_log(account_id,t,delta,why,bal,ok,src) VALUES ' + v.join(','), a);
  }
  async logOf(id, limit) { return (await this.pool.query('SELECT id, t, delta, why, bal, ok, src FROM gta_money_log WHERE account_id=$1 ORDER BY id DESC LIMIT $2', [id, limit])).rows.map(r => ({ id: +r.id, t: +r.t, delta: +r.delta, why: r.why, bal: +r.bal, ok: r.ok, src: r.src })); }
  async logRow(id, rowId) { const r = (await this.pool.query('SELECT id, t, delta, bal, ok FROM gta_money_log WHERE account_id=$1 AND id=$2', [id, rowId])).rows[0]; return r ? { id: +r.id, t: +r.t, delta: +r.delta, bal: +r.bal, ok: r.ok } : null; }
  async logBad(limit) { return (await this.pool.query('SELECT l.id, l.account_id, a.nick, l.t, l.delta, l.why, l.bal FROM gta_money_log l JOIN gta_accounts a ON a.id=l.account_id WHERE NOT l.ok ORDER BY l.id DESC LIMIT $1', [limit])).rows.map(r => ({ id: +r.id, acc: r.account_id, nick: r.nick, t: +r.t, delta: +r.delta, why: r.why, bal: +r.bal })); }
  async findAccounts(q, limit) {
    const r = await this.pool.query(`SELECT id, nick, money, created_at, last_seen, banned_until, ban_reason, muted_until FROM gta_accounts
      WHERE ($1 = '' OR nick_lower LIKE '%' || $1 || '%') ORDER BY ${q ? 'nick_lower' : 'COALESCE(money,0) DESC'} LIMIT $2`, [q.toLowerCase(), limit]);
    return r.rows.map(acctRow);
  }
  async setFlags(id, f) {
    if ('banned_until' in f) await this.pool.query('UPDATE gta_accounts SET banned_until=$2, ban_reason=$3 WHERE id=$1', [id, f.banned_until, f.ban_reason || null]);
    if ('muted_until' in f) await this.pool.query('UPDATE gta_accounts SET muted_until=$2 WHERE id=$1', [id, f.muted_until]);
  }
  async ownedBy(id) { return (await this.pool.query('SELECT kind, item FROM gta_owners WHERE account_id=$1', [id])).rows; }
  async releaseAny(kind, item) { const r = (await this.pool.query('DELETE FROM gta_owners WHERE kind=$1 AND item=$2 RETURNING account_id', [kind, item])).rows[0]; return r ? r.account_id : null; }
  async meta(key, fallback) {
    await this.pool.query('INSERT INTO gta_meta(key,value) VALUES($1,$2) ON CONFLICT (key) DO NOTHING', [key, fallback]);
    return (await this.pool.query('SELECT value FROM gta_meta WHERE key=$1', [key])).rows[0].value;
  }
  async setMeta(key, value) { await this.pool.query('INSERT INTO gta_meta(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [key, value]); }
  async owners(kind) { return (await this.pool.query('SELECT item, account_id, nick, pending, earned FROM gta_owners WHERE kind=$1', [kind])).rows.map(r => ({ item: r.item, accountId: r.account_id, nick: r.nick, pending: +r.pending, earned: +r.earned })); }
  // true if it was free and is now this account's
  async claim(kind, item, accountId, nick) { return (await this.pool.query('INSERT INTO gta_owners(kind,item,account_id,nick,t) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING item', [kind, item, accountId, nick, Date.now()])).rowCount === 1; }
  async release(kind, item, accountId) { return (await this.pool.query('DELETE FROM gta_owners WHERE kind=$1 AND item=$2 AND account_id=$3', [kind, item, accountId])).rowCount === 1; }
  async addPending(kind, item, n) { await this.pool.query('UPDATE gta_owners SET pending=pending+$3, earned=earned+$3 WHERE kind=$1 AND item=$2', [kind, item, n]); }
  async takePending(kind, accountId) { return (await this.pool.query('WITH p AS (SELECT item, pending FROM gta_owners WHERE kind=$1 AND account_id=$2 AND pending>0 FOR UPDATE) UPDATE gta_owners o SET pending=0 FROM p WHERE o.kind=$1 AND o.item=p.item RETURNING o.item, p.pending', [kind, accountId])).rows.map(r => ({ item: r.item, n: +r.pending })); }
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
  async setMeta(key, value) { this.db.meta[key] = value; this.flush(); }
  own() { return this.db.owners || (this.db.owners = {}); }
  async owners(kind) { return Object.entries(this.own()).filter(([k]) => k.startsWith(kind + ':')).map(([k, r]) => ({ item: k.slice(kind.length + 1), ...r })); }
  async claim(kind, item, accountId, nick) { const k = kind + ':' + item; if (this.own()[k]) return false; this.own()[k] = { accountId, nick, pending: 0, earned: 0 }; this.flush(); return true; }
  async release(kind, item, accountId) { const k = kind + ':' + item, r = this.own()[k]; if (!r || r.accountId !== accountId) return false; delete this.own()[k]; this.flush(); return true; }
  async addPending(kind, item, n) { const r = this.own()[kind + ':' + item]; if (r) { r.pending += n; r.earned += n; this.flush(); } }
  async takePending(kind, accountId) { const out = []; for (const [k, r] of Object.entries(this.own())) if (k.startsWith(kind + ':') && r.accountId === accountId && r.pending > 0) { out.push({ item: k.slice(kind.length + 1), n: r.pending }); r.pending = 0; } this.flush(); return out; }
  async createAccount(nick, hash) {
    if (this.db.accounts.some(a => a.nick_lower === nick.toLowerCase())) throw new Error('taken');
    const id = this.db.accounts.length + 1;
    this.db.accounts.push({ id, nick, nick_lower: nick.toLowerCase(), pass_hash: hash, created_at: new Date().toISOString() }); this.flush();
    return id;
  }
  async byNick(nick) { return this.db.accounts.find(a => a.nick_lower === nick.toLowerCase()) || null; }
  async byId(id) { return this.db.accounts.find(a => a.id === id) || null; }
  async load(id) { return this.db.saves[id] || null; }
  async save(id, data, t) { this.db.saves[id] = { data, t }; const a = this.acc(id); if (a) a.last_seen = new Date().toISOString(); this.flush(); }
  acc(id) { return this.db.accounts.find(a => a.id === id); }
  async wallet(id) { const a = this.acc(id); return a ? { money: a.money == null ? null : a.money, seq: a.money_seq || null } : null; }
  async setWallet(id, money, seq) { const a = this.acc(id); if (a) { a.money = money; a.money_seq = seq; this.flush(); } }
  A() { return this.db.assets || (this.db.assets = []); }
  async assetAdd(id, tag, price) { this.db.assetN = (this.db.assetN || 0) + 1; this.A().push({ id: this.db.assetN, acc: id, tag, price, t: Date.now() }); this.flush(); }
  async assetPeek(id, tag) { const r = this.A().filter(x => x.acc === id && x.tag === tag).pop(); return r ? { id: r.id, price: r.price } : null; }
  async assetDel(rowId) { this.db.assets = this.A().filter(x => x.id !== rowId); this.flush(); }
  async assets(id) { return this.A().filter(x => x.acc === id).map(r => ({ tag: r.tag, price: r.price, t: r.t })); }
  L() { return this.db.mlog || (this.db.mlog = []); }
  async log(rows) { for (const r of rows) { this.db.mlogN = (this.db.mlogN || 0) + 1; this.L().push(Object.assign({ id: this.db.mlogN }, r)); } if (this.L().length > 5000) this.L().splice(0, this.L().length - 5000); this.flush(); }
  async logOf(id, limit) { return this.L().filter(r => r.acc === id).slice(-limit).reverse().map(r => ({ id: r.id, t: r.t, delta: r.delta, why: r.why, bal: r.bal, ok: r.ok, src: r.src })); }
  async logRow(id, rowId) { const r = this.L().find(r => r.acc === id && r.id === rowId); return r ? { id: r.id, t: r.t, delta: r.delta, bal: r.bal, ok: r.ok } : null; }
  async logBad(limit) { return this.L().filter(r => !r.ok).slice(-limit).reverse().map(r => ({ id: r.id, acc: r.acc, nick: (this.acc(r.acc) || {}).nick, t: r.t, delta: r.delta, why: r.why, bal: r.bal })); }
  async findAccounts(q, limit) { q = q.toLowerCase(); return this.db.accounts.filter(a => !q || a.nick_lower.includes(q)).sort((a, b) => q ? a.nick_lower.localeCompare(b.nick_lower) : (b.money || 0) - (a.money || 0)).slice(0, limit).map(acctRow); }
  async setFlags(id, f) { const a = this.acc(id); if (a) { Object.assign(a, f); this.flush(); } }
  async ownedBy(id) { return Object.entries(this.own()).filter(([, r]) => r.accountId === id).map(([k]) => ({ kind: k.split(':')[0], item: k.slice(k.indexOf(':') + 1) })); }
  async releaseAny(kind, item) { const k = kind + ':' + item, r = this.own()[k]; if (!r) return null; delete this.own()[k]; this.flush(); return r.accountId; }
}
const acctRow = a => ({ id: a.id, nick: a.nick, money: a.money == null ? null : +a.money, created: a.created_at ? new Date(a.created_at).getTime() : 0, seen: a.last_seen ? new Date(a.last_seen).getTime() : 0,
  banned: +a.banned_until || 0, reason: a.ban_reason || '', muted: +a.muted_until || 0 });

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
const banned = acc => +acc.banned_until > Date.now();
const banText = acc => 'Аккаунт заблокирован' + (+acc.banned_until > Date.now() + 50 * 365 * 24 * 3600 * 1000 ? ' навсегда' : ' до ' + new Date(+acc.banned_until).toLocaleString('ru-RU', { timeZone: 'Europe/Kiev' })) + (acc.ban_reason ? '. Причина: ' + acc.ban_reason : '');
// the save as the game gets it: with the money the server keeps (wallet.js), not what the game wrote
async function withMoney(id, save) {
  if (!save) return save;
  const money = await wallet.money(id);
  return money == null ? save : { data: Object.assign({}, save.data, { money }), t: save.t };
}
function route(name, fn, needAuth) {
  app.post('/api/' + name, body, async (req, res) => {
    if (!store) return fail(res, 503, 'starting', 'Сервер запускается, попробуйте через минуту');
    let b; try { b = JSON.parse(req.body || '{}'); } catch (e) { return fail(res, 400, 'bad_json', 'Неверный запрос'); }
    if (!b || typeof b !== 'object') return fail(res, 400, 'bad_json', 'Неверный запрос');
    try {
      if (needAuth) {
        const id = verifyToken(b.token), acc = id && await store.byId(id);
        if (!acc) return fail(res, 401, 'need_login', 'Нужно войти заново');
        if (banned(acc)) return fail(res, 403, 'banned', banText(acc));
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
  if (banned(acc)) return fail(res, 403, 'banned', banText(acc));
  res.json({ token: signToken(acc.id), nick: acc.nick, save: await withMoney(acc.id, await store.load(acc.id)) });
});

route('load', async (req, res) => {
  res.json({ nick: req.acc.nick, save: await withMoney(req.acc.id, await store.load(req.acc.id)), now: Date.now() });
}, true);

route('save', async (req, res, { data, t }) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(res, 400, 'bad_save', 'Неверное сохранение');
  if (JSON.stringify(data).length > SAVE_MAX) return fail(res, 413, 'too_big', 'Сохранение слишком большое');
  t = Number.isFinite(+t) ? Math.min(+t, Date.now()) : Date.now();
  // an older copy (a second tab or phone that was left open) never overwrites a newer one
  const cur = await store.load(req.acc.id);
  if (cur && cur.t > t) return res.json({ ok: false, stale: true, t: cur.t });
  const money = await wallet.money(req.acc.id);
  if (money != null) data.money = money;   // the money is the server's
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
// the game itself (the repo root, next to this folder) at /game/ — gameleha.xyz shows it from here
const GAME_DIR = path.join(__dirname, '..');
if (fs.existsSync(path.join(GAME_DIR, 'index.html'))) {
  app.use('/game', (req, res, next) => {
    if (/^\/(server|node_modules)(\/|$)/.test(req.path) || /(^|\/)\./.test(req.path)) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-cache');   // revalidated every time (ETag); gameleha.xyz caches in front of it
    next();
  }, express.static(GAME_DIR, { dotfiles: 'deny', index: 'index.html', cacheControl: false }));
}

const httpServer = app.listen(PORT, () => console.log(`[server] LEHA NEPLOXO WORLD on :${PORT}`));
// the live world: players see each other, the chat (realtime.js), the shared city (world.js)
const wallet = require('./wallet').create({ get store() { return store; } });
const world = require('./world').create({ get store() { return store; }, wallet });
const rt = require('./realtime').attach(httpServer, { verifyToken, origins: ORIGINS, world, wallet, store: { byId: id => (store ? store.byId(id) : null) } });
// the owner's page: players, money, bans (admin.js)
require('./admin').attach(app, { route, fail, get store() { return store; }, wallet, world, rt, dir: __dirname });
(function boot(delay) {
  start().catch(e => { console.error('[db] init failed:', e.message, '— retry in', delay / 1000, 's'); setTimeout(() => boot(Math.min(delay * 2, 60000)), delay); });
})(2000);
