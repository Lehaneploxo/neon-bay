// The owner's stream mode: only the owner's game (the 👑 admin) has it. A row in the admin panel starts any of the
// big events by hand (to try them out) and switches the stream on: the game then listens to the owner's TikTok LIVE
// through the TikTok games' server (gameleha.xyz, the same feed as the other stream games) and a gift starts an
// event in this game only — nobody else in the city sees it.
//   (the meteor shower and the zombie apocalypse: only by hand for now, no gift chosen yet)
//   Finger Heart — one meteor (a combo of n — n meteors, one after another).
//   Coral — the tsunami (a combo of n — n waves, one after another).
//   Crown — a tornado, three crowns — three of them, each for its own five minutes, alongside anything else.
//   Roses, by how many come in one combo: 1–19 — that many police officers on foot run up to fight the hero with
//   their fists (brawlers.js); 20+ — the real police chase with patrol cars and gunfire: 20 — 2 stars, 50 — 3,
//   100 — 4 (roadblocks), 200 — 5 (the helicopter).
//   Doughnut — a bodyguard with the viewer's nick (guards.js gift) who stays until he's shot dead.
//   TikTok — one passer-by with the viewer's nick runs up to fight the hero (a combo of n — n of them).
//   any other gift for now by its coins: 500+ coins — the meteor, 1000+ — the tsunami, 1500+ — the war, 2000+ — the alien invasion.
// Only real gifts count (the server's demo bots are ignored). The tsunami, the war and the invasion take turns:
// one that comes while another is on waits in the queue; a meteor can fall at any time.
// While the stream is switched on, the police give stars only for robberies (police.js calm).
(function (NB) {
  'use strict';
  const FEED = 'wss://gameleha.xyz/';
  const TIERS = [[2000, 'aliens', '🛸 пришельцев'], [1500, 'war', '⚔ войну'], [1000, 'tsunami', '🌊 цунами'], [500, 'meteor', '☄ метеорит']];
  const ROSE_CHASE = [[200, 5], [100, 4], [50, 3], [20, 2]];   // roses in one combo → stars
  const BIG = ['tsunami', 'war', 'aliens', 'shower', 'zombies'];

  NB.createStream = function (o) {
    // o: events { meteor, tsunami, war, aliens }, brawlers, police, guards, flash(text, sec), closeAdmin(), onMode(on)
    const E = o.events;
    const $ = id => document.getElementById(id);
    const run = {
      meteor: n => E.meteor.drop(n), shower: n => E.meteor.shower(n), tsunami: n => E.tsunami.launch(n), war: n => E.war.start(n), aliens: n => E.aliens.start(n), zombies: n => E.zombies.start(n), tornado: n => E.tornado.start(n)
    };
    const busy = k => k === 'meteor' ? E.meteor.busy : E.meteor.showerBusy || ['tsunami', 'war', 'aliens', 'zombies'].some(b => E[b].busy);
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
      setTimeout(() => { if (busy(k)) o.flash('Сначала дождитесь конца текущего события', 2.5); else run[k](''); }, 150);
    });

    /* ---------- the stream ---------- */
    let ws = null, on = false, live = false, retryT = null;
    const nickBox = $('streamNick'), btn = $('streamBtn'), st = $('streamState');
    nickBox.value = localStorage.getItem('nb_stream_user') || 'lehaneploxo';
    function show(text) { st.textContent = text; btn.textContent = on ? '⏹ Выключить стрим' : '🔴 Включить стрим'; btn.classList.toggle('on', on); o.onMode(on); }
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
      if (/^coral$/i.test(String(name || '').trim())) { for (let i = 0; i < Math.max(1, Math.round(coins / 499)); i++) event('tsunami', '🌊 цунами', nick); return; }
      const t = TIERS.find(t => coins >= t[0]); if (!t) return;
      event(t[1], t[2], nick);
    }
    // a big event now, or in the queue when another one is on
    function event(kind, label, nick) {
      if (busy(kind) || queue.some(q => (q[0] === 'meteor') === (kind === 'meteor'))) { queue.push([kind, nick]); o.flash('🎁 @' + nick + ' вызвал ' + label + ' — в очереди (' + queue.length + ')', 3); }
      else if (!run[kind](nick)) queue.push([kind, nick]);   // indoors: it waits until the hero is out on the street
    }
    function roses(nick, n) {
      const t = ROSE_CHASE.find(t => n >= t[0]);
      if (!t) { o.brawlers.add('cop', nick, n); return; }
      o.police.giftChase(t[1]);
      o.flash('🚨 @' + nick + ' прислал ' + n + ' роз — за тобой выехал наряд! ' + '★'.repeat(t[1]), 4);
    }
    // the queue: the next event as soon as the last one is over
    setInterval(() => {
      // the first of the big ones and the first meteor each go as soon as they can (a meteor doesn't wait for a wave)
      for (const m of [false, true]) {
        const i = queue.findIndex(q => (q[0] === 'meteor') === m); if (i < 0) continue;
        const [k, nick] = queue[i];
        if (!busy(k) && run[k](nick)) queue.splice(i, 1);
      }
    }, 3000);

    return { get live() { return live; }, get queue() { return queue.length; }, test: gift };
  };
})(window.NB);
