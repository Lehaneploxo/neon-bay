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
    let shotPending = false, prevRecoil = 0;
    let ws = null, me = null, retry = 1000, sendT = 0, lookKey = '', pc = 0, prevPunch = 0, online = 0, clockOff = null;
    const others = new Map();   // id -> remote player
    const proj = new THREE.Vector3();
    // the shared city (server/world.js): who owns which home and business, and when the shared loot is ready again
    const owners = { home: {}, biz: {} }, timers = {}, listeners = {}, waiting = new Map();
    let rid = 0;
    const emit = (type, m) => { for (const f of listeners[type] || []) try { f(m); } catch (e) { console.error(e); } };
    const srvNow = () => (NB.online && NB.online.now ? NB.online.now() : Date.now());
    // a question to the server, answered by a message with the same rid (null: no connection / no answer)
    function request(m, ms) {
      return new Promise(res => {
        if (!ws || ws.readyState !== 1 || !me) return res(null);
        m.rid = ++rid; waiting.set(m.rid, res); send(m);
        setTimeout(() => { if (waiting.delete(m.rid)) res(null); }, ms || 6000);
      });
    }
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
        case 'welcome': me = m; online = m.online; renderOnline(); emit('welcome', m); break;
        case 'owners': owners.home = m.home || {}; owners.biz = m.biz || {}; Object.assign(timers, m.timers || {}); emit('owners', m); break;
        case 'own': if (m.nick) owners[m.kind][m.id] = m.nick; else delete owners[m.kind][m.id]; emit('own', m); break;
        case 'timer': timers[m.key] = m.readyAt; emit('timer', m); break;
        case 'own_sync': emit('own_sync', m); break;
        case 'biz_income': emit('biz_income', m); break;
        case 'role': case 'ents': case 'ent_req': case 'ent_res': emit(m.t, m); break;
        case 'hit': onHit(m); break;
        case 'ko_you': if (o.star) o.star(); o.flash('Вы вырубили игрока ' + m.nick + '! Полиция это видела', 3); break;
        case 'ko_drop': if (o.loseCash) o.loseCash(m.n); setTimeout(() => o.flash('Вас вырубил ' + m.nick + ' — из кармана выпало ' + fmtM(m.n), 4), 3800); break;
        case 'ko_safe': setTimeout(() => o.flash('Вас вырубил ' + m.nick + (m.why === 'safe' ? '. Здесь безопасное место — деньги не выпали' : m.why === 'newbie' ? '. Вы новичок — деньги не выпали' : '. Деньги не выпали: он уже обирал вас недавно'), 4), 3800); break;
        case 'cash': addCash(m); break;
        case 'cars': for (const c of m.list) applyCar(c.id, c); break;
        case 'car_take': if (!me || m.by !== me.id) applyCar(m.id, { gone: true }); break;
        case 'car_drop': if (!me || m.by !== me.id) applyCar(m.id, m); break;
        case 'car_busy': { const c = findCar(m.id); if (c && o.vehicles.driving === c && o.kickOut) { o.kickOut(); o.flash('Эту машину уже забрал другой игрок', 2.6); } if (c) o.vehicles.dropRemote(c); break; }
        case 'cash_gone': dropCashPile(m); break;
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
        default: if (m.rid && waiting.has(m.rid)) { const f = waiting.get(m.rid); waiting.delete(m.rid); f(m); } else if (api.onMessage) api.onMessage(m);
      }
    }

    /* ---------- the city's cars, the same for everybody ----------
       Parked cars are the same in every game (vehicles.js: pid). Whoever gets into one tells the server, and it's
       gone from its place for everybody else (they see it driving under that player); left somewhere, it stands
       there for everybody. A player's own bought cars are shown to the others where they stand, locked. */
    let carN = 0;
    const findCar = id => o.vehicles.cars.find(c => c.sid === id || (!c.sid && c.pid === id));
    function applyCar(id, e) {
      const c = findCar(id);
      if (e.gone) { if (c && o.vehicles.driving !== c && !c.owned) o.vehicles.dropRemote(c); return; }
      if (e.owner && me && e.owner === me.nick) return;   // my own cars: autos.js keeps them
      if (c && o.vehicles.driving === c) return;
      if (c && c.model.id === e.m) { c.x = e.x; c.z = e.z; c.h = e.h; if (e.y != null) c.y = e.y; c.vx = c.vz = 0; c.color = e.c || c.color; c.parked = true; c.lockedBy = e.owner || null; return; }
      if (c) o.vehicles.dropRemote(c);
      const n = o.vehicles.spawnParked(e.m, e.x, e.z, e.h, e.c, e.a);
      if (n) { n.sid = id; n.lockedBy = e.owner || null; if (e.y != null && n.model.heli) n.y = e.y; }
    }
    const carId = car => car.sid || car.pid || (car.sid = 'c' + (me ? me.id : 0) + '_' + Date.now().toString(36) + (++carN));
    function carMsg(car, owner) { return { id: carId(car), m: car.model.id, c: car.color, a: car.accent, x: +car.x.toFixed(2), y: +car.y.toFixed(2), z: +car.z.toFixed(2), h: +car.h.toFixed(3), owner: owner || '' }; }

    /* ---------- fights between players ---------- */
    const fmtM = n => '$' + Math.round(n).toLocaleString('ru-RU');
    let lastHit = null, invulnT = 0;
    function onHit(m) {
      if (invulnT > 0 || o.player.dead) return;
      lastHit = { id: m.from, nick: m.nick, t: performance.now() };
      if (o.hurt) o.hurt(m.d, m.x, m.z);
    }
    // a bullet from the hero: the first other player along the ray (a standing cylinder each), not in a car, not down
    function remoteHit(ox, oy, oz, dx, dy, dz, maxT) {
      let best = null;
      for (const r of others.values()) {
        const s = r.snaps[r.snaps.length - 1]; if (!s || s.car || (s.f & 8)) continue;
        const av = r.av, fx = ox - av.x, fz = oz - av.z, a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - .14;
        const disc = b * b - 4 * a * c; if (a < 1e-8 || disc < 0) continue;
        const tp = (-b - Math.sqrt(disc)) / (2 * a), y = oy + dy * tp;
        if (tp > 0 && tp < maxT && y > av.y && y < av.y + 1.85 && (!best || tp < best.t)) best = { t: tp, id: r.id, head: y > av.y + 1.55 };
      }
      return best;
    }
    // a punch: the nearest other player in front of the hero within reach
    function remoteNear(px, pz, fx, fz, reach) {
      let best = null, bd = reach;
      for (const r of others.values()) {
        const s = r.snaps[r.snaps.length - 1]; if (!s || s.car || (s.f & 8)) continue;
        const av = r.av, dx = av.x - px, dz = av.z - pz, d = Math.hypot(dx, dz);
        if (d < bd && Math.abs(av.y - o.player.y) < 1.5 && (dx * fx + dz * fz) / (d || 1) > .25) { bd = d; best = { id: r.id, x: av.x, y: av.y, z: av.z }; }
      }
      return best;
    }
    // shared piles of cash (a knocked-out player's): walk over one to grab it, the server says who was first
    const piles = new Map(), pileGeo = new THREE.BoxGeometry(.36, .1, .2), pileMat = new THREE.MeshBasicMaterial({ color: 0x6bff8a }),
      beamGeo = new THREE.CylinderGeometry(.35, .35, 2.6, 12, 1, true), beamMat = new THREE.MeshBasicMaterial({ color: 0x6bff8a, transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    function addCash(m) {
      if (piles.has(m.id)) return;
      const g = new THREE.Group();
      for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(pileGeo, pileMat); b.position.set((k - 1) * .12, .1 + k * .1, (k % 2) * .05); b.rotation.y = k * .5; g.add(b); }
      const beam = new THREE.Mesh(beamGeo, beamMat); beam.position.y = 1.3; g.add(beam);
      g.position.set(m.x, m.y + .05, m.z); o.scene.add(g);
      piles.set(m.id, { id: m.id, x: m.x, y: m.y, z: m.z, n: m.n, room: m.room || '', g, asked: 0 });
    }
    function dropCashPile(m) {
      const c = piles.get(m.id); if (!c) return;
      o.scene.remove(c.g); piles.delete(m.id);
      if (me && m.by === me.id) { if (o.addCash) o.addCash(m.n); o.flash('Подобрали ' + fmtM(m.n) + ' — выпало из кармана после драки', 2.6); }
    }
    function updatePiles(dt) {
      const P = o.player, room = roomKey(), t = performance.now();
      for (const c of piles.values()) {
        c.g.rotation.y += dt * 2;
        if (c.room !== room || P.dead || o.vehicles.driving) continue;
        if (Math.hypot(P.x - c.x, P.z - c.z) < 1.3 && Math.abs(P.y - c.y) < 1.6 && t - c.asked > 1500) { c.asked = t; send({ t: 'pick', id: c.id }); }
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
          av.aimT = s.f & 1 ? .5 : 0; av.aimPitch = 0; av.chute = s.f & 128 ? 1 : 0;
          if (r.pc >= 0 && s.pc > r.pc) av.punch();
          if (s.f & 64 && (r.shotT = (r.shotT || 0) - dt) <= 0) { r.shotT = .12; av.fired(); if (o.audio && o.audio.shot) o.audio.shot(s.w, [s.x, s.y + 1.4, s.z]); }
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
      if (shotPending) { f |= 64; shotPending = false; }
      if (P.chute) f |= 128;   // fired since the last message
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
      get me() { return me; },
      others,
      send,
      onMessage: null,
      request,
      remoteHit, remoteNear,
      // a shared car: someone (me, or a thief in my game) took it from where it stood / left it here
      carEntered(car) { if (car.owned) { car.sid = 'o' + car.owned; } if (car.sid || car.pid) send({ t: 'car_take', id: carId(car) }); else carId(car); },
      carLeft(car) { if (car.owned) car.sid = 'o' + car.owned; send(Object.assign({ t: 'car_drop' }, carMsg(car, car.owned && me ? me.nick : ''))); },
      // my own bought car: where it stands (on connect, after buying, out of the garage) / gone into the garage
      ownedHere(car) { car.sid = 'o' + car.owned; send(Object.assign({ t: 'car_drop' }, carMsg(car, me ? me.nick : ''))); },
      ownedGone(uid) { send({ t: 'car_take', id: 'o' + uid }); },
      hitRemote(id, d, k) { send({ t: 'hit', id, d: Math.round(d), k }); },
      // the hero was knocked out: if another player did it (in the last few seconds), the server decides about the cash
      died() {
        if (lastHit && performance.now() - lastHit.t < 6000) send({ t: 'ko', by: lastHit.id, money: o.progress.money, safe: !!(o.safe && o.safe()) });
        lastHit = null;
      },
      // back on your feet: half a minute nobody can hurt you
      respawned() { invulnT = 30; lastHit = null; },
      get invulnerable() { return invulnT > 0; },
      on(type, f) { (listeners[type] || (listeners[type] = [])).push(f); },
      get guest() { return !me || !!me.guest; },
      // homes and businesses: whose is it (a nick), is it mine, can I buy it right now (a reason if not)
      owner: (kind, id) => owners[kind][id] || null,
      isMine: (kind, id) => !!me && !me.guest && owners[kind][id] === me.nick,
      cantBuy(kind, id) {
        if (!me) return 'Нет связи с сервером';
        if (me.guest) return 'Нужен аккаунт: войдите в главном меню';
        const n = owners[kind][id]; if (n && n !== me.nick) return 'Владелец: ' + n;
        return '';
      },
      claim: (kind, id) => request({ t: 'own_claim', kind, id }).then(r => !!(r && r.ok)),
      free(kind, id) { send({ t: 'own_free', kind, id }); if (me && owners[kind][id] === me.nick) delete owners[kind][id]; },
      sync(kind, ids) { send({ t: 'own_sync', kind, ids }); },
      // a purchase in a business: its owner gets half
      spent(bizId, n) { if (bizId && n > 0) send({ t: 'biz_spend', id: bizId, n: Math.floor(n) }); },
      // shared loot: how long until it's back (0: ready); claim it — true if it's yours, false if someone was first,
      // null when the server can't be reached (the caller falls back to the old per-player rule)
      lootLeft: key => Math.max(0, (timers[key] || 0) - srvNow()),
      loot: key => (!me ? Promise.resolve(null) : request({ t: 'claim', key }).then(r => r ? (r.ok ? true : (r.readyAt && (timers[key] = r.readyAt), false)) : null)),
      update(dt) {
        if ((sendT += dt * 1000) >= SEND_MS) { sendT = 0; if (me) sendState(); }
        if (invulnT > 0) invulnT -= dt;
        if (o.player.recoil > prevRecoil + .3) shotPending = true;
        prevRecoil = o.player.recoil;
        updateOthers(dt); updatePiles(dt);
      },
      // the others on the minimap
      markers() { const out = []; for (const r of others.values()) if (r.snaps.length) { const s = r.snaps[r.snaps.length - 1]; out.push({ x: s.car ? s.car[3] : s.x, z: s.car ? s.car[5] : s.z }); } return out; }
    };
    NB.net = api;
    connect();
    return api;
  };
})(window.NB);
