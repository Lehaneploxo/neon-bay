// Screens that open inside places: menus (diner, hospital, tiki bar), the wardrobe, the casino's slot
// machine and roulette, and NEON RACER, the arcade cabinet game. While one is open the city waits.
(function (NB) {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  NB.createUI = function (o) {
    // o: money { get, spend(n, note) -> bool, add(n, note) }, audio, progress, save(), setOutfit(id), onOpen(), onClose()
    let open = null;   // what is showing: 'panel' | 'racer'
    const panel = $('panel'), body = $('panelBody');
    const fmt = n => '$' + Math.round(n).toLocaleString('ru-RU');
    function show(eyebrow, title) {
      $('panelEyebrow').textContent = eyebrow; $('panelTitle').textContent = title; $('panelNote').textContent = '';
      panel.hidden = false; open = 'panel'; refreshMoney(); o.onOpen();
    }
    function refreshMoney() { $('panelMoney').textContent = fmt(o.money.get()); }
    function note(t) { $('panelNote').textContent = t || ''; }
    function close() {
      if (!open) return;
      if (open === 'racer') stopRacer();
      panel.hidden = true; $('arcadeScreen').hidden = true; body.innerHTML = ''; open = null; spinning = false;
      o.save(); o.onClose();
    }
    $('panelClose').addEventListener('click', close);
    addEventListener('keydown', e => { if (open && e.code === 'Escape') { e.preventDefault(); close(); } });

    /* ---------- menus: a list of things to buy ---------- */
    function menu(m) {
      show(m.eyebrow, m.title);
      const render = () => {
        const items = m.items(), money = o.money.get();
        body.innerHTML = '<div class="plist">' + items.map((it, i) => {
          const price = it.price || 0, cant = !it.disabled && price > money;
          const label = it.disabled ? esc(it.disabled) : price > 0 ? esc(it.label || 'Купить') + ' · ' + fmt(price) : price < 0 ? 'Получить ' + fmt(-price) : esc(it.label || 'Выбрать');
          return `<div class="item${it.current ? ' owned' : ''}"><div class="info"><b>${esc(it.name)}</b>${it.desc ? `<span>${esc(it.desc)}</span>` : ''}</div>
            <button type="button" class="buy" data-i="${i}" ${it.disabled ? 'disabled' : ''} aria-disabled="${cant}">${label}</button></div>`;
        }).join('') + '</div>';
        refreshMoney();
      };
      body.onclick = e => {
        const b = e.target.closest('.buy'); if (!b || b.disabled) return;
        const it = m.items()[+b.dataset.i]; if (!it || it.disabled) return;
        const price = it.price || 0;
        if (price > 0 && !o.money.spend(price, m.title)) { note('Не хватает ' + fmt(price - o.money.get())); return; }
        const msg = it.buy(); if (price < 0) o.money.add(-price, m.title);
        note(msg || ''); render();
      };
      render();
    }
    /* ---------- clothes: bought piece by piece, worn in any combination ---------- */
    const SLOT_NAME = { top: 'Верх', pants: 'Низ', shoes: 'Обувь', hat: 'Шляпа', glasses: 'Очки', chain: 'Цепь', watch: 'Часы' };
    const owns = (slot, k) => o.progress.wear.includes(slot + ':' + k);
    const wearing = (slot, k) => o.progress.outfit !== 'cop' && o.progress.look[slot] === k;
    const piece = (slot, k) => {
      const it = NB.CLOTHES[slot][k], own = owns(slot, k), on = wearing(slot, k), bare = k === 'none';
      return { name: it.name, desc: bare ? '' : own ? 'Уже ваше · ' + SLOT_NAME[slot] : SLOT_NAME[slot], price: own ? 0 : it.price || 0,
        label: own ? (bare ? 'Снять' : 'Надеть') : 'Купить и надеть', current: on, disabled: on ? (bare ? 'Выбрано' : 'Надето') : '',
        buy: () => { if (!own) o.progress.wear.push(slot + ':' + k); o.wear(slot, k); return bare ? 'Сняли' : own ? 'Переоделись' : 'Отличный выбор! Теперь это ваше'; } };
    };
    const catalog = slot => Object.keys(NB.CLOTHES[slot]).filter(k => !NB.CLOTHES[slot][k].hidden).sort((a, b) => (NB.CLOTHES[slot][a].price || 0) - (NB.CLOTHES[slot][b].price || 0));
    // one department of the boutique
    function clothes(slot) {
      const s = NB.SLOTS.find(x => x.id === slot) || NB.SLOTS[0];
      menu({ eyebrow: 'Бутик NOT BAD Fashion', title: s.name, items: () => catalog(s.id).map(k => piece(s.id, k)) });
    }
    function jewels() {
      menu({ eyebrow: 'Бутик NOT BAD Fashion', title: 'Цепи и часы', items: () => catalog('chain').map(k => piece('chain', k)).concat(catalog('watch').map(k => piece('watch', k))) });
    }
    // the women's line: on show, for the heroines to come
    function womens() {
      const F = NB.CLOTHES_F, NAME = { top: 'Топы', bottom: 'Юбки и брюки', dress: 'Платья', shoes: 'Обувь', hat: 'Шляпы', glasses: 'Очки' };
      menu({ eyebrow: 'Бутик NOT BAD Fashion', title: 'Женская коллекция', items: () => Object.keys(F).flatMap(g => Object.keys(F[g]).map(k => ({
        name: F[g][k].name, desc: NAME[g] + ' · ' + fmt(F[g][k].price), price: 0, disabled: 'Скоро — для героинь', buy: () => '' }))) });
    }
    // the fitting room (and the villa's wardrobe): everything you own, to mix and match
    function wardrobe() {
      menu({ eyebrow: 'Гардероб', title: 'Ваша одежда', items: () => NB.SLOTS.flatMap(s => catalog(s.id).filter(k => owns(s.id, k)).map(k => piece(s.id, k))) });
    }

    // Shield Security: hire bodyguards, one at a time, up to five; or let them all go
    function security(g) {
      menu({ eyebrow: 'Охранное агентство', title: 'Shield Security', items: () => [
        { name: 'Телохранитель', desc: 'Крепкий парень в чёрном костюме, с пистолетом. Ходит с вами везде, садится с вами в машину, дерётся и стреляет за вас — пока жив. С вами сейчас: ' + g.count + ' из ' + g.MAX,
          price: g.count >= g.MAX ? 0 : g.PRICE, label: 'Нанять', disabled: g.count >= g.MAX ? 'Команда в сборе' : '',
          buy: () => { g.hire(); return g.count === 1 ? 'Телохранитель с вами' : 'Теперь с вами ' + g.count + ' телохранителей'; } },
        { name: 'Отпустить охрану', desc: 'Деньги не возвращаются', price: 0, label: 'Отпустить всех', disabled: g.count ? '' : 'Охраны нет',
          buy: () => { g.dismiss(); return 'Охрана свободна'; } }
      ] });
    }

    /* ---------- casino: slot machine ---------- */
    const SYM = [
      { s: '7', c: '#ff3b4f', w: 1, x3: 200 }, { s: 'BAR', c: '#f5f0e6', w: 2, x3: 50 }, { s: '★', c: '#ffd84f', w: 3, x3: 20 },
      { s: '♦', c: '#3fe6e0', w: 4, x3: 10 }, { s: '♥', c: '#ff7eb6', w: 5, x3: 6 }, { s: '●', c: '#8cff6b', w: 6, x3: 4 }];
    const TOTAL_W = SYM.reduce((a, s) => a + s.w, 0);
    const roll = () => { let r = Math.random() * TOTAL_W; for (const s of SYM) if ((r -= s.w) < 0) return s; return SYM[SYM.length - 1]; };
    let spinning = false;
    function slots() {
      show('Казино', 'Игровой автомат');
      let bet = 10;
      body.innerHTML = `<div class="slots"><div class="reels">${[0, 1, 2].map(i => `<div class="reel" id="reel${i}"><span>7</span></div>`).join('')}</div>
        <div class="row bets" role="group" aria-label="Ставка">${[10, 25, 50, 100].map(b => `<button type="button" class="chip" data-bet="${b}" aria-pressed="${b === bet}">$${b}</button>`).join('')}</div>
        <button type="button" class="btn spin" id="spinBtn">Крутить</button>
        <div class="pay">${SYM.map(s => `<span><b style="color:${s.c}">${s.s}${s.s}${s.s}</b> ×${s.x3}</span>`).join('')}<span><b style="color:#8cff6b">●●</b> ×1.5</span><span>любые две одинаковые ×1</span></div></div>`;
      const setReel = (i, s) => { const r = $('reel' + i); r.firstChild.textContent = s.s; r.style.color = s.c; };
      [0, 1, 2].forEach(i => setReel(i, SYM[i]));
      body.onclick = e => {
        const c = e.target.closest('.chip'); if (c && !spinning) { bet = +c.dataset.bet; body.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.bet === bet))); return; }
        if (!e.target.closest('#spinBtn') || spinning) return;
        if (!o.money.spend(bet, 'Ставка')) { note('Не хватает денег на ставку'); o.audio.deny(); return; }
        refreshMoney(); note(''); spinning = true;
        const res = [roll(), roll(), roll()], t0 = performance.now();
        const tickReels = () => {
          if (!spinning || open !== 'panel') return;
          const el = performance.now() - t0; let done = 0;
          for (let i = 0; i < 3; i++) { if (el < 700 + i * 450) setReel(i, SYM[(Math.random() * SYM.length) | 0]); else { setReel(i, res[i]); done++; } }
          o.audio.tick();
          if (done < 3) { setTimeout(tickReels, 70); return; }
          spinning = false;
          const [a, b, c] = res; let mult = 0;
          if (a === b && b === c) mult = a.x3;
          else { const pair = a === b ? a : b === c ? b : a === c ? a : null; if (pair) mult = pair.s === '●' ? 1.5 : 1; }
          const win = Math.round(bet * mult);
          if (win > 0) { o.money.add(win, mult >= 4 ? 'Джекпот!' : 'Выигрыш'); note(mult >= 4 ? 'Три в ряд! Выигрыш ' + fmt(win) : 'Выигрыш ' + fmt(win)); }
          else note('Не повезло. Ещё разок?');
          refreshMoney();
        };
        tickReels();
      };
    }

    /* ---------- casino: roulette ---------- */
    const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
    const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
    const BETS = { red: ['Красное', n => RED.has(n), 2], black: ['Чёрное', n => n > 0 && !RED.has(n), 2], even: ['Чётное', n => n > 0 && n % 2 === 0, 2], odd: ['Нечётное', n => n % 2 === 1, 2], low: ['1–18', n => n >= 1 && n <= 18, 2], high: ['19–36', n => n >= 19, 2], num: ['Число', null, 36] };
    function roulette() {
      show('Казино', 'Рулетка');
      let bet = 50, kind = 'red', num = 21, angle = 0;
      body.innerHTML = `<div class="roulette"><canvas id="wheelCv" width="260" height="260" aria-label="Колесо рулетки"></canvas>
        <div class="rside"><div class="row bets">${Object.keys(BETS).map(k => `<button type="button" class="chip kind" data-kind="${k}" aria-pressed="${k === kind}">${BETS[k][0]}</button>`).join('')}</div>
        <label class="row numrow">Число <input id="rNum" type="number" min="0" max="36" value="${num}"></label>
        <div class="row bets">${[10, 50, 100, 500].map(b => `<button type="button" class="chip amt" data-bet="${b}" aria-pressed="${b === bet}">$${b}</button>`).join('')}</div>
        <button type="button" class="btn spin" id="rSpin">Крутить</button><div class="note">Цвет, чёт/нечет и половины платят ×2, число — ×36. Зеро забирает всё, кроме ставки на 0.</div></div></div>`;
      const cv = $('wheelCv'), g = cv.getContext('2d');
      function draw(a, ball, ballR) {
        const R = 124, cx = 130, cy = 130, n = WHEEL.length, seg = Math.PI * 2 / n;
        g.clearRect(0, 0, 260, 260);
        g.fillStyle = '#5a2a1a'; g.beginPath(); g.arc(cx, cy, R + 4, 0, 7); g.fill();
        for (let i = 0; i < n; i++) {
          const v = WHEEL[i], a0 = a + i * seg - Math.PI / 2 - seg / 2;
          g.fillStyle = v === 0 ? '#1f8a3a' : RED.has(v) ? '#c81e2a' : '#141418';
          g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a0 + seg); g.closePath(); g.fill();
          g.save(); g.translate(cx, cy); g.rotate(a0 + seg / 2); g.fillStyle = '#fff'; g.font = 'bold 11px Rubik, Arial'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(v, R - 6, 0); g.restore();
        }
        g.fillStyle = '#3a1a10'; g.beginPath(); g.arc(cx, cy, R * .58, 0, 7); g.fill();
        g.fillStyle = '#d9c070'; g.beginPath(); g.arc(cx, cy, 14, 0, 7); g.fill();
        if (ball != null) { g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 8; g.beginPath(); g.arc(cx + Math.cos(ball) * ballR, cy + Math.sin(ball) * ballR, 6, 0, 7); g.fill(); g.shadowBlur = 0; }
        g.fillStyle = '#ffd84f'; g.beginPath(); g.moveTo(cx - 9, 0); g.lineTo(cx + 9, 0); g.lineTo(cx, 14); g.closePath(); g.fill();   // the pointer: the winning pocket stops under it
      }
      draw(0);
      body.onclick = e => {
        if (spinning) return;
        const k = e.target.closest('.kind'); if (k) { kind = k.dataset.kind; body.querySelectorAll('.kind').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === kind))); return; }
        const a = e.target.closest('.amt'); if (a) { bet = +a.dataset.bet; body.querySelectorAll('.amt').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.bet === bet))); return; }
        if (!e.target.closest('#rSpin')) return;
        num = Math.max(0, Math.min(36, Math.round(+$('rNum').value || 0))); $('rNum').value = num;
        if (!o.money.spend(bet, 'Ставка')) { note('Не хватает денег на ставку'); o.audio.deny(); return; }
        refreshMoney(); spinning = true; note('Ставки сделаны, ставок больше нет…');
        const result = (Math.random() * WHEEL.length) | 0, n = WHEEL.length, seg = Math.PI * 2 / n;
        const a0 = angle, turns = 4 + Math.random() * 2, target = a0 + turns * Math.PI * 2 + ((-result * seg - a0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        const t0 = performance.now(), D = 3600; let lastTick = 0;
        const step = () => {
          if (open !== 'panel') { spinning = false; return; }
          const k = Math.min(1, (performance.now() - t0) / D), e2 = 1 - Math.pow(1 - k, 3);
          angle = a0 + (target - a0) * e2;
          const ballA = -Math.PI / 2 - (1 - e2) * 14, ballR = 118 - e2 * 18;
          draw(angle, ballA, ballR);
          if (k - lastTick > .03 + k * .06) { lastTick = k; o.audio.tick(); }
          if (k < 1) { requestAnimationFrame(step); return; }
          spinning = false;
          const v = WHEEL[result], B = BETS[kind];
          const won = kind === 'num' ? v === num : B[1](v);
          const col = v === 0 ? 'зеро' : RED.has(v) ? 'красное' : 'чёрное';
          if (won) { const win = bet * B[2]; o.money.add(win, 'Рулетка'); note('Выпало ' + v + ' (' + col + '). Вы выиграли ' + fmt(win) + '!'); }
          else note('Выпало ' + v + ' (' + col + '). Ставка проиграна.');
          refreshMoney();
        };
        step();
      };
    }

    /* ---------- arcade: NEON RACER ---------- */
    const cv = $('racerCv'), rg = cv.getContext('2d');
    const RC = { W: 360, H: 560, lanes: 3 };
    let R = null, raf = 0, keys = { l: false, r: false };
    function racer() {
      $('arcadeScreen').hidden = false; open = 'racer'; o.onOpen();
      R = { state: 'title', t: 0 }; loop.last = performance.now(); raf = requestAnimationFrame(loop);
      updateRacerUi();
    }
    function stopRacer() { cancelAnimationFrame(raf); R = null; }
    function updateRacerUi() {
      const ui = $('racerUi'), best = o.progress.records.racer || 0;
      if (R.state === 'play') { ui.hidden = true; return; }
      ui.hidden = false;
      $('racerMsg').innerHTML = R.state === 'title'
        ? `<b>NEON RACER</b><span>Уворачивайтесь от машин, собирайте монеты.<br>Рекорд: ${best}</span>`
        : `<b>ФИНИШ</b><span>Очки: ${R.score}${R.score > best ? ' — рекорд!' : ''}<br>Приз: ${fmt(R.prize)}</span>`;
      $('racerGo').textContent = 'Играть · $5';
    }
    function startRace() {
      if (!o.money.spend(5, 'Жетон')) { $('racerMsg').innerHTML = '<b>НЕТ ДЕНЕГ</b><span>Нужен жетон за $5</span>'; o.audio.deny(); return; }
      R = { state: 'play', t: 0, x: 1, px: 1, speed: 260, dist: 0, coins: 0, cars: [], items: [], spawn: .6, score: 0, prize: 0, stripe: 0 };
      updateRacerUi();
    }
    $('racerGo').addEventListener('click', () => { if (R && R.state !== 'play') startRace(); });
    $('racerExit').addEventListener('click', close);
    const hold = (id, k) => { const el = $(id); el.addEventListener('pointerdown', e => { e.preventDefault(); keys[k] = true; if (R && R.state === 'play') { R.x = Math.max(0, Math.min(2, R.x + (k === 'l' ? -1 : 1))); } }); for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => { keys[k] = false; }); };
    hold('racerL', 'l'); hold('racerR', 'r');
    addEventListener('keydown', e => {
      if (open !== 'racer' || !R) return;
      if (['ArrowLeft', 'KeyA'].includes(e.code) && R.state === 'play' && !e.repeat) R.x = Math.max(0, R.x - 1);
      if (['ArrowRight', 'KeyD'].includes(e.code) && R.state === 'play' && !e.repeat) R.x = Math.min(2, R.x + 1);
      if ((e.code === 'Enter' || e.code === 'Space') && R.state !== 'play') { e.preventDefault(); startRace(); }
    });
    const laneX = l => RC.W / 2 + (l - 1) * 92;
    function loop(now) {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(.05, (now - loop.last) / 1000); loop.last = now;
      if (!R) return;
      R.t += dt;
      if (R.state === 'play') {
        R.speed += dt * 9; R.dist += R.speed * dt; R.stripe = (R.stripe + R.speed * dt) % 60;
        R.px += (R.x - R.px) * Math.min(1, dt * 14);
        R.spawn -= dt;
        if (R.spawn <= 0) {
          R.spawn = Math.max(.32, .95 - R.speed / 1400) * (.7 + Math.random() * .6);
          const lane = (Math.random() * 3) | 0;
          if (Math.random() < .28) R.items.push({ lane, y: -30 });
          else R.cars.push({ lane, y: -70, col: ['#3fe6e0', '#ffd84f', '#8cff6b', '#c28bff', '#ff8a3d'][(Math.random() * 5) | 0], v: .35 + Math.random() * .3 });
        }
        const py = RC.H - 90, pxw = laneX(R.px);
        for (const c of R.cars) { c.y += R.speed * (1 - c.v) * dt; if (Math.abs(laneX(c.lane) - pxw) < 44 && Math.abs(c.y - py) < 62) { crash(); break; } }
        for (const it of R.items) { it.y += R.speed * dt; if (!it.got && Math.abs(laneX(it.lane) - pxw) < 40 && Math.abs(it.y - py) < 40) { it.got = true; R.coins++; o.audio.pickup(); } }
        R.cars = R.cars.filter(c => c.y < RC.H + 80); R.items = R.items.filter(i => i.y < RC.H + 40 && !i.got);
        R.score = Math.floor(R.dist / 10) + R.coins * 50;
      }
      drawRace();
    }
    function crash() {
      o.audio.impact(12);
      R.state = 'over'; R.prize = Math.floor(R.score / 120);
      const best = o.progress.records.racer || 0;
      if (R.prize > 0) o.money.add(R.prize, 'Приз NEON RACER');
      updateRacerUi();
      if (R.score > best) o.progress.records.racer = R.score;
      o.save();
    }
    function car(x, y, col, hero) {
      rg.save(); rg.translate(x, y); rg.shadowColor = col; rg.shadowBlur = 16; rg.fillStyle = col;
      rg.beginPath(); rg.roundRect ? rg.roundRect(-24, -40, 48, 80, 10) : rg.rect(-24, -40, 48, 80); rg.fill();
      rg.shadowBlur = 0; rg.fillStyle = '#1a1030'; rg.fillRect(-17, hero ? -22 : 8, 34, 16);
      rg.fillStyle = hero ? '#fff6d8' : '#ff2a3a'; rg.fillRect(-20, hero ? -40 : 34, 10, 5); rg.fillRect(10, hero ? -40 : 34, 10, 5);
      rg.restore();
    }
    function drawRace() {
      const W = RC.W, H = RC.H;
      const sky = rg.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#1a0a30'); sky.addColorStop(1, '#3a1050');
      rg.fillStyle = sky; rg.fillRect(0, 0, W, H);
      rg.fillStyle = '#231438'; rg.fillRect(W / 2 - 150, 0, 300, H);
      rg.strokeStyle = '#ff4fa3'; rg.lineWidth = 4; rg.shadowColor = '#ff4fa3'; rg.shadowBlur = 12;
      rg.beginPath(); rg.moveTo(W / 2 - 150, 0); rg.lineTo(W / 2 - 150, H); rg.moveTo(W / 2 + 150, 0); rg.lineTo(W / 2 + 150, H); rg.stroke();
      rg.shadowBlur = 0; rg.fillStyle = 'rgba(63,230,224,.7)';
      const off = R && R.stripe || 0;
      for (const lx of [W / 2 - 46, W / 2 + 46]) for (let y = -60 + off; y < H; y += 60) rg.fillRect(lx - 3, y, 6, 30);
      rg.strokeStyle = 'rgba(194,139,255,.18)'; rg.lineWidth = 1;
      for (let y = off % 30; y < H; y += 30) { rg.beginPath(); rg.moveTo(0, y); rg.lineTo(W / 2 - 150, y); rg.moveTo(W / 2 + 150, y); rg.lineTo(W, y); rg.stroke(); }
      if (!R) return;
      if (R.state !== 'title') {
        for (const it of R.items) { rg.fillStyle = '#ffd84f'; rg.shadowColor = '#ffd84f'; rg.shadowBlur = 14; rg.beginPath(); rg.arc(laneX(it.lane), it.y, 13, 0, 7); rg.fill(); rg.shadowBlur = 0; rg.fillStyle = '#8a5a00'; rg.font = 'bold 14px Rubik, Arial'; rg.textAlign = 'center'; rg.textBaseline = 'middle'; rg.fillText('$', laneX(it.lane), it.y + 1); }
        for (const c of R.cars) car(laneX(c.lane), c.y, c.col, false);
        car(laneX(R.px), H - 90, '#ff4fa3', true);
      }
      rg.fillStyle = '#fff'; rg.font = 'bold 18px Rubik, Arial'; rg.textAlign = 'left'; rg.textBaseline = 'top';
      rg.fillText('ОЧКИ ' + (R.score || 0), 12, 12); rg.textAlign = 'right'; rg.fillText('РЕКОРД ' + (o.progress.records.racer || 0), W - 12, 12);
    }

    return { menu, wardrobe, clothes, jewels, womens, security, slots, roulette, racer, close, get open() { return open; } };
  };
})(window.NB);
