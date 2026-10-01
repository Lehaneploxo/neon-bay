// Online: the account (nick + password), the save kept on the game server, and the shared clock.
// Guests play as before with the save in this browser only. A signed-in player's save also goes to the
// server, so it follows them to any phone or computer; on start the newer of the two copies wins.
(function (NB) {
  'use strict';
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const API = LOCAL ? 'http://localhost:3100/api/' : 'https://neploxo-server-production.up.railway.app/api/';
  const $ = id => document.getElementById(id);
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  let token = get('nb_token'), nick = get('nb_nick'), offset = 0, pending = null, lastPush = 0, pushTimer = 0, replacing = false;

  // every call is a POST with a text/plain body: no CORS preflight, and it also works while the page closes
  function call(name, data, keepalive) {
    return fetch(API + name, { method: 'POST', body: JSON.stringify(data || {}), keepalive: !!keepalive, headers: { 'Content-Type': 'text/plain' } })
      .then(r => r.json().catch(() => ({})).then(j => { if (!r.ok) { const e = new Error(j.error || 'Сервер недоступен'); e.code = j.code; throw e; } return j; }));
  }
  const localSave = () => { try { return JSON.parse(get('nb_save') || 'null'); } catch (e) { return null; } };
  // the server's copy replaces this browser's one; the game reads it on the reload
  function adopt(save) {
    replacing = true;   // the game's own save on leaving the page must not write over this copy
    put('nb_save', JSON.stringify(Object.assign({}, save.data, { _t: save.t })));
    try { sessionStorage.setItem('nb_pulled', String(save.t)); } catch (e) {}
    location.reload();
  }
  function signedIn(t, n) { token = t; nick = n; put('nb_token', t); put('nb_nick', n); render(); }
  function signOut() {
    flush(); token = nick = null; put('nb_token', null); put('nb_nick', null);
    replacing = true; put('nb_save', null);   // the progress stays on the account; this browser starts as a new guest
    location.reload();
  }

  function push(data, urgent) {
    if (!token) return;
    pending = data;
    const wait = 20000 - (Date.now() - lastPush);
    if (urgent || wait <= 0) return flush();
    if (!pushTimer) pushTimer = setTimeout(flush, wait);
  }
  function flush() {
    clearTimeout(pushTimer); pushTimer = 0;
    if (!token || !pending) return;
    const data = pending; pending = null; lastPush = Date.now();
    call('save', { token, data, t: data._t }, true).catch(e => { if (e.code === 'need_login') { token = null; put('nb_token', null); render(); } });
  }

  /* ---------- the account panel in the main menu ---------- */
  let busy = false;
  function render() {
    const panel = $('acct'); if (!panel) return;
    $('acctOut').hidden = !!token; $('acctIn').hidden = !token;
    if (token) { $('acctForm').hidden = true; $('acctNick').textContent = nick || ''; }
  }
  function formError(text) { $('acctErr').textContent = text || ''; }
  function submit(kind) {
    if (busy) return;
    const n = $('acctNickIn').value.trim(), p = $('acctPass').value;
    if (!n || !p) return formError('Введите ник и пароль');
    // a new account: the password twice, so a typo doesn't lock you out
    if (kind === 'register') {
      const p2 = $('acctPass2');
      if (p2.hidden) { p2.hidden = false; $('acctPass').autocomplete = 'new-password'; p2.focus(); return formError('Повторите пароль и нажмите «Создать аккаунт» ещё раз'); }
      if (p2.value !== p) { p2.focus(); return formError('Пароли не совпадают'); }
    }
    busy = true; formError(kind === 'register' ? 'Создаю аккаунт…' : 'Вхожу…');
    call(kind, { nick: n, pass: p }).then(r => {
      signedIn(r.token, r.nick); formError('');
      if (r.save) return adopt(r.save);   // an existing account: its progress replaces the guest's
      const s = localSave();               // a new account keeps what was played here as a guest
      if (s) push(Object.assign({ _t: now() }, s), true);
    }).catch(e => formError(e.message)).then(() => { busy = false; });
  }
  function bindUi() {
    if (!$('acct')) return;
    $('acctOpen').addEventListener('click', () => { $('acctForm').hidden = false; $('acctOpen').hidden = true; $('acctNickIn').focus(); });
    $('acctForm').addEventListener('submit', e => { e.preventDefault(); submit('login'); });
    $('acctReg').addEventListener('click', () => submit('register'));
    // the eye: show what you're typing (both password fields)
    $('acctEye').addEventListener('click', () => {
      const show = $('acctPass').type === 'password';
      for (const id of ['acctPass', 'acctPass2']) $(id).type = show ? 'text' : 'password';
      $('acctEye').classList.toggle('on', show); $('acctEye').setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    });
    $('acctLogout').addEventListener('click', signOut);
    render();
  }

  /* ---------- start: clock and save sync ---------- */
  const now = () => Math.round(Date.now() + offset);
  function syncClock() {
    const t0 = Date.now();
    return call('time').then(r => { const t1 = Date.now(); if (t1 - t0 < 5000) offset = r.now - (t0 + t1) / 2; }).catch(() => {});
  }
  // while the save is being compared, "Play" waits (a few seconds at most; offline the game just starts)
  function syncSave() {
    if (!token) return Promise.resolve();
    const btn = $('playBtn'), label = btn && btn.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Загрузка…'; }
    const done = () => { if (btn) { btn.disabled = false; btn.textContent = label; } };
    const timeout = new Promise(r => setTimeout(r, 6000));
    return Promise.race([timeout, call('load', { token }).then(r => {
      nick = r.nick; put('nb_nick', nick); render();
      const s = localSave(), localT = (s && +s._t) || 0;
      let pulled = 0; try { pulled = +sessionStorage.getItem('nb_pulled') || 0; } catch (e) {}
      if (r.save && r.save.t > localT && r.save.t !== pulled) return adopt(r.save);
      if (s && (!r.save || localT > r.save.t)) push(Object.assign({ _t: localT || now() }, s), true);
    }).catch(e => { if (e.code === 'need_login') { token = null; put('nb_token', null); render(); } })]).then(done, done);
  }

  NB.online = { now, push, flush, get nick() { return token ? nick : null; }, get replacing() { return replacing; } };
  addEventListener('pagehide', flush);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi); else bindUi();
  syncClock();
  syncSave();
})(window.NB);
