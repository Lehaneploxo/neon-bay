// The owner's stream mode: only the owner's game (the 👑 admin) has it. A row in the admin panel starts any of the
// big events by hand (to try them out) and switches the stream on: the game then listens to the owner's TikTok LIVE
// through the TikTok games' server (gameleha.xyz, the same feed as the other stream games) and a gift starts an
// event in this game only — nobody else in the city sees it.
//   Fireworks — the zombie apocalypse (waits its turn like the other big events).
//   Money Gun — the war (waits its turn like the other big events).
//   Galaxy — the alien invasion (waits its turn like the other big events).
//   Meteor Shower — five minutes of meteors round the hero (waits its turn like the other big events).
//   Finger Heart — one meteor (a combo of n — n meteors, one after another).
//   Coral — the tsunami (a combo of n — n waves, one after another).
//   Crown — a tornado, three crowns — three of them, each for its own five minutes, alongside anything else.
//   Roses, by how many come in one combo: 1–19 — that many police officers on foot run up to fight the hero with
//   their fists (brawlers.js); 20+ — the real police chase with patrol cars and gunfire: 20 — 2 stars, 50 — 3,
//   100 — 4 (roadblocks), 200 — 5 (the helicopter).
//   Doughnut — a bodyguard with the viewer's nick (guards.js gift) who stays until he's shot dead.
//   TikTok — one passer-by with the viewer's nick runs up to fight the hero (a combo of n — n of them).
//   Any gift not listed here does nothing.
// Only real gifts count (the server's demo bots are ignored). Different events all run at the same time (a war,
// aliens and zombies together); only a second one of the same kind waits in the queue until the first is over.
// While the stream is switched on, the police give stars only for robberies (police.js calm).
(function (NB) {
  'use strict';
  const FEED = 'wss://gameleha.xyz/';
  const ROSE_CHASE = [[200, 5], [100, 4], [50, 3], [20, 2]];   // roses in one combo → stars
  // the bar on the screen while the stream is on: the gift's own picture (img/gifts) and what it does
  const BAR = [['rose', 'Коп', 1], ['tiktok', 'Драчун', 1], ['heart', 'Метеорит', 5], ['donut', 'Охранник', 30], ['crown', 'Торнадо', 100],
    ['coral', 'Цунами', 499], ['moneygun', 'Война', 500], ['galaxy', 'Пришельцы', 1000], ['fireworks', 'Зомби', 1088], ['shower', 'Метеор. дождь', 3000]];
  const BIG = ['tsunami', 'war', 'aliens', 'shower', 'zombies'];

  NB.createStream = function (o) {
    // o: events { meteor, tsunami, war, aliens }, brawlers, police, guards, flash(text, sec), closeAdmin(), onMode(on)
    const E = o.events;
    const $ = id => document.getElementById(id);
    const run = {
      meteor: n => E.meteor.drop(n), shower: n => E.meteor.shower(n), tsunami: n => E.tsunami.launch(n), war: n => E.war.start(n), aliens: n => E.aliens.start(n), zombies: n => E.zombies.start(n), tornado: n => E.tornado.start(n)
    };
    const busy = k => k === 'meteor' ? E.meteor.busy : k === 'shower' ? E.meteor.showerBusy : k === 'tornado' ? false : E[k].busy;
    const queue = [];   // [kind, nick]

    // the buttons to try an event by hand
    for (const b of document.querySelectorAll('#streamBar [data-ev]')) b.addEventListener('click', () => {
      o.closeAdmin();
      const k = b.dataset.ev;
      if (k === 'cop') { roses('Тестовый_зритель', 1); return; }
      if (k === 'tornado') { E.tornado.start(''); return; }
      if (k === 'guard') { o.guards.gift('Тестовый_зритель'); return; }
      if (k === 'civ') { o.brawlers.add('civ', 'Тестовый_зритель', 1); return; }
      if (k === 'cop20') { setTimeout(() => roses('Тестовый_зритель', 20), 150); return; }
      setTimeout(() => { if (busy(k)) o.flash('Это событие уже идёт', 2.5); else run[k](''); }, 150);
    });

    /* ---------- the stream ---------- */
    let ws = null, on = false, live = false, retryT = null;
    const nickBox = $('streamNick'), btn = $('streamBtn'), st = $('streamState');
    nickBox.value = localStorage.getItem('nb_stream_user') || 'lehaneploxo';
    const bar = $('giftBar');
    $('status').appendChild(bar);   // in the left column, under the money
    for (const [img, what] of BAR) {
      const d = document.createElement('div');
      d.innerHTML = '<img alt="" src="img/gifts/' + img + '.webp"><b></b>';
      d.children[1].textContent = what;
      bar.appendChild(d);
    }
    function show(text) { bar.hidden = !on; st.textContent = text; btn.textContent = on ? '⏹ Выключить стрим' : '🔴 Включить стрим'; btn.classList.toggle('on', on); o.onMode(on); }
    function connect() {
      const nick = nickBox.value.replace(/^@/, '').trim();
      if (!nick) { show('Впишите ник TikTok'); on = false; return; }
      localStorage.setItem('nb_stream_user', nick);
      try { ws = new WebSocket(FEED + '?username=' + encodeURIComponent(nick)); } catch (e) { ws = null; }
      if (!ws) { show('Не удалось подключиться'); return; }
      show('Подключение…');
      ws.onmessage = ev => {
        let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
        if (d.type === 'status') {
          if (d.mode === 'error') { show(d.message || 'Ошибка'); stop(); return; }
          const was = live; live = d.mode === 'tiktok';
          show(live ? '🔴 В эфире: подарки работают' : 'Ждём эфир @' + nick + '…');
          if (live && !was) o.flash('🔴 Стрим подключён — подарки вызывают события', 4);
          return;
        }
        if (d.type === 'arena_gift' && live) gift(d.username || 'зритель', Number(d.coins) || 0, d.giftName);
      };
      ws.onclose = () => { ws = null; live = false; if (on) { show('Связь потеряна, переподключение…'); retryT = setTimeout(connect, 4000); } };
    }
    function stop() { on = false; live = false; clearTimeout(retryT); if (ws) { const w = ws; ws = null; w.onclose = null; w.close(); } show('Стрим выключен'); }
    btn.addEventListener('click', () => { if (on) stop(); else { on = true; connect(); } });
    show('Стрим выключен');

    function gift(nick, coins, name) {
      // gifts with their own event (the server sends a whole combo at once: coins = price × count)
      if (/^rose$/i.test(String(name || '').trim())) { roses(nick, Math.max(1, coins)); return; }
      if (/^crown$/i.test(String(name || '').trim())) { E.tornado.start(nick, Math.max(1, Math.round(coins / 100))); return; }
      if (/^(doughnut|donut)$/i.test(String(name || '').trim())) { for (let i = 0; i < Math.max(1, Math.round(coins / 30)); i++) o.guards.gift(nick); return; }
      if (/^tiktok$/i.test(String(name || '').trim())) { o.brawlers.add('civ', nick, Math.max(1, coins)); return; }
      if (/^finger ?heart$/i.test(String(name || '').trim())) { for (let i = 0; i < Math.max(1, Math.round(coins / 5)); i++) event('meteor', '☄ метеорит', nick); return; }
      if (/^meteor ?shower$/i.test(String(name || '').trim())) { for (let i = 0; i < Math.max(1, Math.round(coins / 3000)); i++) event('shower', '☄☄ метеоритный дождь', nick); return; }
      if (/^fireworks?$/i.test(String(name || '').trim())) { for (let i = 0; i < Math.max(1, Math.round(coins / 1088)); i++) event('zombies', '🧟 зомби-апокалипсис', nick); return; }
      if (/^money ?gun$/i.test(String(name || '').trim())) { for (let i = 0; i < Math.max(1, Math.round(coins / 500)); i++) event('war', '⚔ войну', nick); return; }
      if (/^galaxy$/i.test(String(name || '').trim())) { for (let i = 0; i < Math.max(1, Math.round(coins / 1000)); i++) event('aliens', '🛸 пришельцев', nick); return; }
      if (/^coral$/i.test(String(name || '').trim())) { for (let i = 0; i < Math.max(1, Math.round(coins / 499)); i++) event('tsunami', '🌊 цунами', nick); return; }
      // any other gift does nothing
    }
    // an event now, or in the queue when one of the same kind is on
    function event(kind, label, nick) {
      if (busy(kind) || queue.some(q => q[0] === kind)) { queue.push([kind, nick]); o.flash('🎁 @' + nick + ' вызвал ' + label + ' — в очереди (' + queue.filter(q => q[0] === kind).length + ')', 3); }
      else if (!run[kind](nick)) queue.push([kind, nick]);   // indoors: it waits until the hero is out on the street
    }
    function roses(nick, n) {
      const t = ROSE_CHASE.find(t => n >= t[0]);
      if (!t) { o.brawlers.add('cop', nick, n); return; }
      o.police.giftChase(t[1]);
      o.flash('🚨 @' + nick + ' прислал ' + n + ' роз — за тобой выехал наряд! ' + '★'.repeat(t[1]), 4);
    }
    // the queue: the first waiting one of each kind goes as soon as the one before it is over
    setInterval(() => {
      const seen = new Set();
      for (let i = 0; i < queue.length; i++) {
        const [k, nick] = queue[i];
        if (seen.has(k)) continue; seen.add(k);
        if (!busy(k) && run[k](nick)) { queue.splice(i, 1); i--; }
      }
    }, 3000);

    return { get live() { return live; }, get queue() { return queue.length; }, test: gift };
  };
})(window.NB);
