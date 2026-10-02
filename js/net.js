// The live world: the other players. A WebSocket to the game server (server/realtime.js): ten times a second
// we tell it where the hero is and what they're doing, and get back everybody near us. Each of them is drawn
// as a full hero model (their own clothes, uniform, gun, swimming, punching) with their nick over the head,
// or as the car they're driving; their movement is smoothed by drawing them a moment in the past.
// Plus the common chat: the 💬 button (T or Enter on a keyboard), the last lines float on the screen for a
// few seconds and over the speaker's head. Guests (no account) are seen as «Гость NNNN», reading only.
(function (NB) {
  'use strict';
  const { U } = NB;
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const WS_URL = LOCAL ? 'ws://localhost:3100/ws' : 'wss://neploxo-server-production.up.railway.app/ws';
  const DELAY = 160;          // ms: others are drawn this far in the past, between two snapshots
  const SEND_MS = 100;        // our state, ten times a second
  const TAG_RANGE = 70;       // nicks over heads up to this far
  const $ = id => document.getElementById(id);
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lerp = (a, b, t) => a + (b - a) * t, angLerp = (a, b, t) => a + U.angDiff(a, b) * t;

  NB.createNet = function (o) {
    // o: scene, col, camera, player, vehicles, places, progress, input, audio, flash, playing() -> bool, lock()
    let ws = null, me = null, retry = 1000, sendT = 0, lookKey = '', pc = 0, prevPunch = 0, online = 0, clockOff = null;
    const others = new Map();   // id -> remote player
    const proj = new THREE.Vector3();
    if (!get('nb_guest')) put('nb_guest', String(1000 + Math.floor(Math.random() * 9000)));

    /* ---------- the connection ---------- */
    function connect() {
      try { ws = new WebSocket(WS_URL); } catch (e) { return later(); }
      ws.onopen = () => {
        retry = 1000;
        ws.send(JSON.stringify({ t: 'hello', token: get('nb_token'), guest: get('nb_guest'), look: o.progress.look, outfit: outfit() }));
        lookKey = lookSig();
      };
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (er) { return; } onMessage(m); };
      ws.onclose = ev => { ws = null; me = null; clearAll(); if (ev.code !== 4004) later(); else o.flash('Вы зашли в игру с другого устройства — здесь онлайн отключён', 5); };
      ws.onerror = () => {};
    }
    function later() { setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); }
    const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
    const outfit = () => o.player.outfit || 'own';
    const lookSig = () => outfit() + JSON.stringify(o.progress.look || {});

    function onMessage(m) {
      switch (m.t) {
        case 'welcome': me = m; online = m.online; renderOnline(); break;
        case 'pi': { const r = others.get(m.id) || add(m.id); r.nick = m.nick; r.guest = m.guest; dress(r, m.look, m.outfit); r.tag.firstChild.textContent = m.nick; r.tag.classList.toggle('guest', !!m.guest); break; }
        case 'ps': {
          const now = performance.now();
          if (clockOff == null || Math.abs(m.time - now - clockOff) > 1000) clockOff = m.time - now; else clockOff += (m.time - now - clockOff) * .05;
          online = m.n; renderOnline();
          for (const s of m.list) {
            const r = others.get(s[0]); if (!r) continue;   // its 'pi' comes first
            r.snaps.push({ t: m.time, x: s[1], y: s[2], z: s[3], h: s[4], f: s[5], w: s[6], pc: s[7], car: s[8] || null });
            if (r.snaps.length > 30) r.snaps.splice(0, r.snaps.length - 30);
          }
          break;
        }
        case 'gone': remove(m.id); break;
        case 'chat_history': chatLog.innerHTML = ''; for (const c of m.list) logLine(c.u, c.m); break;
        case 'chat': onChat(m); break;
        case 'chat_denied': note('Писать в чат могут только игроки с аккаунтом — войдите в главном меню'); break;
        case 'kicked': break;
        default: if (api.onMessage) api.onMessage(m);
      }
    }

    /* ---------- the other players ---------- */
    function add(id) {
      const av = new NB.Player(o.scene, o.col, { remote: true });
      av.hp = 100; av.setLook({});
      const tag = document.createElement('div'); tag.className = 'ntag'; tag.innerHTML = '<b></b><i hidden></i>'; tag.hidden = true; $('names').appendChild(tag);
      const r = { id, av, tag, snaps: [], nick: '', car: null, carKey: '', pc: -1, sayT: 0, lx: 0, lz: 0 };
      others.set(id, r);
      return r;
    }
    function dress(r, look, of) { if (of && of !== 'own') r.av.setOutfit(of); else r.av.setLook(look || {}); }
    function remove(id) {
      const r = others.get(id); if (!r) return;
      o.scene.remove(r.av.m.root); o.scene.remove(r.av.blob); r.tag.remove();
      if (r.car) o.vehicles.dropRemote(r.car);
      others.delete(id);
    }
    function clearAll() { for (const id of [...others.keys()]) remove(id); }

    // where a remote player is right now: between the two snapshots around (now - DELAY)
    function sample(r, t) {
      const S = r.snaps; if (!S.length) return null;
      if (t <= S[0].t) return S[0];
      for (let i = S.length - 1; i > 0; i--) {
        const a = S[i - 1], b = S[i];
        if (t >= a.t && t <= b.t) {
          const k = (t - a.t) / Math.max(1, b.t - a.t);
          const out = { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), h: angLerp(a.h, b.h, k), f: b.f, w: b.w, pc: b.pc, car: null };
          if (a.car && b.car && a.car[0] === b.car[0]) {
            const A = a.car, B = b.car;
            out.car = [B[0], B[1], B[2], lerp(A[3], B[3], k), lerp(A[4], B[4], k), lerp(A[5], B[5], k), angLerp(A[6], B[6], k), lerp(A[7], B[7], k), lerp(A[8], B[8], k), lerp(A[9], B[9], k), B[10]];
          } else out.car = b.car;
          return out;
        }
      }
      return S[S.length - 1];   // nothing newer yet: hold the last known place
    }
    function updateOthers(dt) {
      const t = performance.now() + (clockOff || 0) - DELAY;
      for (const r of others.values()) {
        const s = sample(r, t); if (!s) continue;
        const av = r.av, m = av.m;
        if (s.car) {
          // driving: the car carries them; the body is hidden
          const key = s.car[0] + s.car[1] + s.car[2];
          if (r.car && r.carKey !== key) { o.vehicles.dropRemote(r.car); r.car = null; }
          if (!r.car) { r.car = o.vehicles.remoteCar(s.car[0], s.car[1], s.car[2]); r.carKey = key; }
          if (r.car) {
            const c = r.car; c.x = s.car[3]; c.y = s.car[4]; c.z = s.car[5]; c.h = s.car[6]; c.rPitch = s.car[7]; c.rBank = s.car[8]; c.rSpeed = s.car[9];
            if (c.police || c.ems) c.sirenOn = !!s.car[10];
          }
          m.root.visible = false; av.blob.visible = false;
          av.x = s.car[3]; av.y = s.car[4]; av.z = s.car[5];
        } else {
          if (r.car) { o.vehicles.dropRemote(r.car); r.car = null; }
          m.root.visible = true;
          const sp = dt > 0 ? Math.min(12, Math.hypot(s.x - r.lx, s.z - r.lz) / dt) : 0;
          r.lx = s.x; r.lz = s.z;
          av.x = s.x; av.y = s.y; av.z = s.z; av.heading = s.h;
          av.swim = !!(s.f & 2); av.onGround = !(s.f & 4); av.air = s.f & 4 ? .3 : 0;
          if (av.weapon !== s.w && NB.WEAPONS && NB.WEAPONS[s.w]) av.setWeapon(s.w);
          av.aimT = s.f & 1 ? .5 : 0; av.aimPitch = 0;
          if (r.pc >= 0 && s.pc > r.pc) av.punch();
          r.pc = s.pc;
          if (av.punchT > 0) av.punchT -= dt;
          av.speedEst = U.damp(av.speedEst || 0, sp, 8, dt);
          av.animate(dt, av.speedEst);
          if (s.f & 8) { m.root.rotation.x = -Math.PI / 2; m.root.position.y = s.y + .2; }
          else if (!av.swim) m.root.rotation.x = 0;
        }
        // the nick (and what they just said) over the head
        const d = Math.hypot(av.x - o.player.x, av.z - o.player.z);
        if (d > TAG_RANGE && !(r.sayT > 0)) { r.tag.hidden = true; continue; }
        proj.set(av.x, av.y + (r.car ? r.car.model.h || 2.2 : 2.15), av.z).project(o.camera);
        if (proj.z > 1) { r.tag.hidden = true; continue; }
        r.tag.hidden = false;
        r.tag.style.transform = 'translate(' + ((proj.x + 1) / 2 * innerWidth).toFixed(0) + 'px,' + ((1 - proj.y) / 2 * innerHeight).toFixed(0) + 'px) translate(-50%,-100%)';
        r.tag.style.opacity = d > TAG_RANGE * .7 ? Math.max(.25, 1 - (d - TAG_RANGE * .7) / (TAG_RANGE * .3)).toFixed(2) : '1';
        if (r.sayT > 0 && (r.sayT -= dt) <= 0) r.tag.lastChild.hidden = true;
      }
    }

    /* ---------- our own state, ten times a second ---------- */
    function roomKey() {
      const pl = o.places.current; if (!pl) return '';
      const d = pl.door, k = pl.info && (pl.info.room || pl.info.name);
      return pl.id + (pl.shared || pl.manyDoors ? '@' + (d ? Math.round(d.x) + ',' + Math.round(d.z) : '') + (k ? '#' + k : '') : '');
    }
    function sendState() {
      const P = o.player, drv = o.vehicles.driving;
      if (P.punchT > prevPunch + .05) pc++;
      prevPunch = P.punchT;
      let f = 0;
      if (P.aimT > 0 && P.weapon !== 'fists' && P.weapon !== 'bat') f |= 1;
      if (P.swim) f |= 2;
      if (!P.onGround && P.air > .08) f |= 4;
      if (P.dead) f |= 8;
      const st = { t: 'st', x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), h: +P.heading.toFixed(3), f, w: P.weapon, pc, r: roomKey() };
      if (drv) st.c = { m: drv.model.id, c: drv.color, a: drv.accent, x: +drv.x.toFixed(2), y: +drv.y.toFixed(2), z: +drv.z.toFixed(2), h: +drv.h.toFixed(3), p: +drv.body.rotation.x.toFixed(3), b: +drv.body.rotation.z.toFixed(3),
        v: +(drv.vx * Math.sin(drv.h) + drv.vz * Math.cos(drv.h)).toFixed(1), s: drv.sirenOn ? 1 : 0 };
      send(st);
      const lk = lookSig();
      if (lk !== lookKey) { lookKey = lk; send({ t: 'look', look: o.progress.look, outfit: outfit() }); }
    }

    /* ---------- the chat ---------- */
    const chatLog = $('chatLog'), feed = $('chatFeed');
    let chatting = false, unread = 0;
    function logLine(u, m) {
      const row = document.createElement('div'); row.className = 'cm';
      row.innerHTML = '<b>' + esc(u) + ':</b> ' + esc(m);
      chatLog.appendChild(row);
      while (chatLog.children.length > 80) chatLog.firstChild.remove();
      chatLog.scrollTop = chatLog.scrollHeight;
    }
    function onChat(m) {
      logLine(m.u, m.m);
      if (!chatting) { unread++; renderBadge(); }
      // the line floats on the screen for a few seconds
      const el = document.createElement('div'); el.className = 'cf'; el.innerHTML = '<b>' + esc(m.u) + ':</b> ' + esc(m.m);
      feed.appendChild(el); while (feed.children.length > 4) feed.firstChild.remove();
      setTimeout(() => el.classList.add('out'), 6000); setTimeout(() => el.remove(), 7000);
      // and over the speaker's head
      const r = others.get(m.id);
      if (r) { r.tag.lastChild.textContent = m.m.length > 60 ? m.m.slice(0, 58) + '…' : m.m; r.tag.lastChild.hidden = false; r.sayT = 6; }
      if (o.audio && o.audio.chat) o.audio.chat();
    }
    function renderBadge() { const b = $('chatBadge'); b.hidden = !unread; b.textContent = unread > 9 ? '9+' : String(unread); }
    function renderOnline() { $('chatOnline').textContent = 'онлайн: ' + (online || 1); $('btnChat').title = 'Чат · онлайн ' + (online || 1); }
    function note(t) { $('chatNote').textContent = t || ''; }
    function openChat() {
      if (chatting) return;
      chatting = true; unread = 0; renderBadge(); note(me && me.guest ? 'Вы гость: читать можно, писать — после входа в аккаунт (главное меню)' : '');
      o.input.reset(); if (document.pointerLockElement) document.exitPointerLock();
      $('chat').hidden = false; chatLog.scrollTop = chatLog.scrollHeight;
      setTimeout(() => $('chatInput').focus(), 30);
    }
    function closeChat() {
      if (!chatting) return;
      chatting = false; $('chat').hidden = true; $('chatInput').blur(); o.input.reset();
      if (o.playing() && !o.input.touch) o.lock();
    }
    $('btnChat').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); openChat(); });
    $('chatClose').addEventListener('click', closeChat);
    $('chatForm').addEventListener('submit', e => {
      e.preventDefault();
      const v = $('chatInput').value.trim(); if (!v) return;
      if (!ws || ws.readyState !== 1) { note('Нет связи с сервером, пробую подключиться…'); return; }
      if (me && me.guest) { note('Писать в чат могут только игроки с аккаунтом — войдите в главном меню'); return; }
      send({ t: 'chat', m: v }); $('chatInput').value = ''; note('');
    });
    addEventListener('keydown', e => {
      if (chatting) { if (e.code === 'Escape') { e.preventDefault(); closeChat(); } return; }
      if (!o.playing()) return;
      if ((e.code === 'KeyT' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); openChat(); }
    });

    const api = {
      get chatting() { return chatting; },
      get online() { return online; },
      get nick() { return me ? me.nick : null; },
      get connected() { return !!me; },
      others,
      send,
      onMessage: null,
      update(dt) {
        if ((sendT += dt * 1000) >= SEND_MS) { sendT = 0; if (me) sendState(); }
        updateOthers(dt);
      },
      // the others on the minimap
      markers() { const out = []; for (const r of others.values()) if (r.snaps.length) { const s = r.snaps[r.snaps.length - 1]; out.push({ x: s.car ? s.car[3] : s.x, z: s.car ? s.car[5] : s.z }); } return out; }
    };
    connect();
    return api;
  };
})(window.NB);
