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
//   Tsar (the crown, «Корона» in the app) — a tornado, three crowns — three of them, each for its own five minutes, alongside anything else.
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
  // the strip along the bottom while the stream is on: the gift's own picture (img/gifts) and what it does
  const BAR = [['rose', 'Коп', 1], ['tiktok', 'Драчун', 1], ['heart', 'Метеорит', 5], ['donut', 'Охранник', 30], ['crown', 'Торнадо', 100],
    ['coral', 'Цунами', 499], ['moneygun', 'Война', 500], ['galaxy', 'Пришельцы', 1000], ['fireworks', 'Зомби', 1088], ['shower', 'Метеоры', 3000]];
  // the gifts, by their exact names in TikTok's own gift catalogue (webcast gift/list, checked 2026-10-14; the gift's
  // id there in the comment): [price in coins, what it starts, how it's called on screen]
  const GIFTS = {
    'Rose': [1, 'roses'],                                        // 5655
    'TikTok': [1, 'tiktok'],                                     // 5269
    'Finger Heart': [5, 'meteor', '☄ метеорит'],                 // 5487
    'Doughnut': [30, 'guard'],                                   // 5879
    'Tsar': [100, 'tornado'],                                    // 5524 — the crown («Корона» in the Russian app)
    'Coral': [499, 'tsunami', '🌊 цунами'],                       // 5731
    'Money Gun': [500, 'war', '⚔ войну'],                        // 7168
    'Galaxy': [1000, 'aliens', '🛸 пришельцев'],                  // 11046
    'Fireworks': [1088, 'zombies', '🧟 зомби-апокалипсис'],       // 6090
    'Meteor Shower': [3000, 'shower', '☄☄ метеоритный дождь']    // 6563
  };
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
    for (const [img, what] of BAR) {
      const d = document.createElement('div');
      d.innerHTML = '<img alt="" src="img/gifts/' + img + '.webp"><b></b>';
      d.children[1].textContent = what;
      bar.appendChild(d);
    }
    function show(text) { bar.hidden = !on; document.body.classList.toggle('streaming', on); st.textContent = text; btn.textContent = on ? '⏹ Выключить стрим' : '🔴 Включить стрим'; btn.classList.toggle('on', on); o.onMode(on); }
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
      // the server sends a whole combo at once: coins = price × count
      const G = GIFTS[String(name || '').trim()]; if (!G) return;   // any other gift does nothing
      const n = Math.max(1, Math.round(coins / G[0]));
      if (G[1] === 'roses') roses(nick, n);
      else if (G[1] === 'tiktok') o.brawlers.add('civ', nick, n);
      else if (G[1] === 'guard') for (let i = 0; i < n; i++) o.guards.gift(nick);
      else if (G[1] === 'tornado') E.tornado.start(nick, n);
      else for (let i = 0; i < n; i++) event(G[1], G[2], nick);
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
