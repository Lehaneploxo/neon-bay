// The owner's stream mode: only the owner's game (the 👑 admin) has it. A row in the admin panel starts any of the
// big events by hand (to try them out) and switches the stream on: the game then listens to the owner's TikTok LIVE
// through the TikTok games' server (gameleha.xyz, the same feed as the other stream games) and a gift starts an
// event in this game only — nobody else in the city sees it.
//   (the meteor shower, the zombie apocalypse and the tornado: only by hand for now, no gift chosen yet)
//   500+ coins — the meteor, 1000+ — the tsunami, 1500+ — the war, 2000+ — the alien invasion.
// Only real gifts count (the server's demo bots are ignored). The tsunami, the war and the invasion take turns:
// one that comes while another is on waits in the queue; a meteor can fall at any time.
(function (NB) {
  'use strict';
  const FEED = 'wss://gameleha.xyz/';
  const TIERS = [[2000, 'aliens', '🛸 пришельцев'], [1500, 'war', '⚔ войну'], [1000, 'tsunami', '🌊 цунами'], [500, 'meteor', '☄ метеорит']];
  const BIG = ['tsunami', 'war', 'aliens', 'shower', 'zombies', 'tornado'];

  NB.createStream = function (o) {
    // o: events { meteor, tsunami, war, aliens }, flash(text, sec), closeAdmin()
    const E = o.events;
    const $ = id => document.getElementById(id);
    const run = {
      meteor: n => E.meteor.drop(n), shower: n => E.meteor.shower(n), tsunami: n => E.tsunami.launch(n), war: n => E.war.start(n), aliens: n => E.aliens.start(n), zombies: n => E.zombies.start(n), tornado: n => E.tornado.start(n)
    };
    const busy = k => k === 'meteor' ? E.meteor.busy : E.meteor.showerBusy || ['tsunami', 'war', 'aliens', 'zombies', 'tornado'].some(b => E[b].busy);
    const queue = [];   // [kind, nick]

    // the buttons to try an event by hand
    for (const b of document.querySelectorAll('#streamBar [data-ev]')) b.addEventListener('click', () => {
      o.closeAdmin();
      const k = b.dataset.ev;
      setTimeout(() => { if (busy(k)) o.flash('Сначала дождитесь конца текущего события', 2.5); else run[k](''); }, 150);
    });

    /* ---------- the stream ---------- */
    let ws = null, on = false, live = false, retryT = null;
    const nickBox = $('streamNick'), btn = $('streamBtn'), st = $('streamState');
    nickBox.value = localStorage.getItem('nb_stream_user') || 'lehaneploxo';
    function show(text) { st.textContent = text; btn.textContent = on ? '⏹ Выключить стрим' : '🔴 Включить стрим'; btn.classList.toggle('on', on); }
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
        if (d.type === 'arena_gift' && live) gift(d.username || 'зритель', Number(d.coins) || 0);
      };
      ws.onclose = () => { ws = null; live = false; if (on) { show('Связь потеряна, переподключение…'); retryT = setTimeout(connect, 4000); } };
    }
    function stop() { on = false; live = false; clearTimeout(retryT); if (ws) { const w = ws; ws = null; w.onclose = null; w.close(); } show('Стрим выключен'); }
    btn.addEventListener('click', () => { if (on) stop(); else { on = true; connect(); } });
    show('Стрим выключен');

    function gift(nick, coins) {
      const t = TIERS.find(t => coins >= t[0]); if (!t) return;
      if (busy(t[1]) || queue.some(q => (q[0] === 'meteor') === (t[1] === 'meteor'))) { queue.push([t[1], nick]); o.flash('🎁 @' + nick + ' вызвал ' + t[2] + ' — в очереди (' + queue.length + ')', 3); }
      else if (!run[t[1]](nick)) queue.push([t[1], nick]);   // indoors: it waits until the hero is out on the street
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
