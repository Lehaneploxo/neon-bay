// The money, the server's way (server/wallet.js). A signed-in player's cash is kept on the game server: every
// change made here (a wage, a purchase, a prize) is shown at once and also sent there as [seq, amount, why,
// asset, business]; the server checks it and answers with the true balance. What it refuses (more than can be
// earned honestly) disappears again. Money the server hands out itself (cash after a fight, business income,
// the admin) arrives as a new balance. Changes made with no connection wait in this browser and go when it's back.
// Guests keep their money in this browser only, as before.
(function (NB) {
  'use strict';
  const KEY = 'nb_mq';
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  NB.createWallet = function (o) {
    // o: progress, net, flash(text, s), save()
    const P = o.progress, N = o.net;
    const nick = () => (NB.online ? NB.online.nick : null);
    // the changes not yet counted by the server: kept across reloads (same session id, so nothing counts twice)
    let st = null;
    try { st = JSON.parse(get(KEY) || 'null'); } catch (e) {}
    if (!st || st.nick !== nick() || !Array.isArray(st.q)) st = { nick: nick(), sid: Math.random().toString(36).slice(2, 10), seq: 0, q: [] };
    let ready = false, sentTo = 0, flushT = 0;
    const keep = () => put(KEY, JSON.stringify(st));
    const pendingSum = () => st.q.reduce((a, op) => a + op[1], 0);
    const active = () => !!nick() && N.connected && !N.guest;

    // the server's balance plus what it hasn't counted yet
    function setBase(money, s) {
      if (s) st.q = st.q.filter(op => op[0] > s);
      sentTo = Math.max(sentTo, s || 0);
      P.money = Math.max(0, Math.floor(money + pendingSum()));
      keep();
    }
    function flush() {
      flushT = 0;
      if (!ready || !active()) return;
      const out = st.q.filter(op => op[0] > sentTo);
      if (!out.length) return;
      sentTo = out[out.length - 1][0];
      N.send({ t: '$', q: out });
    }

    N.on('welcome', () => { ready = false; sentTo = 0; if (nick()) N.send({ t: '$hello', sid: st.sid }); });
    // the first time after the update: the money and what was bought come from this save
    N.on('$init?', () => {
      st.q = []; keep();   // already in P.money
      N.send({ t: '$init', money: P.money, assets: o.assets() });
    });
    N.on('$m', m => { setBase(m.money, m.s); if (!ready) { ready = true; sentTo = m.s || 0; flush(); } o.save(); });
    N.on('$r', m => {
      setBase(m.money, m.s);
      const lost = (m.rej || []).filter(r => r[1] > 0).reduce((a, r) => a + r[1], 0);
      if (lost > 0) o.flash('Сервер не засчитал $' + lost.toLocaleString('ru-RU') + ' — столько честно не заработать', 3);
      o.save();
    });

    return NB.ledger = {
      // every change goes through here (main.js addMoney / spend): n > 0 earned, n < 0 spent
      change(n, why, asset, biz) {
        if (!nick()) return;   // a guest: this browser only
        const op = [++st.seq, Math.round(n), String(why || '').slice(0, 80)];
        if (asset || biz) op.push(asset || 0);
        if (biz) op.push(biz);
        st.q.push(op); if (st.q.length > 500) st.q.splice(0, st.q.length - 500);
        keep();
        if (!flushT) flushT = setTimeout(flush, 400);
      },
      // money the server already counted (cash after a fight, business income): its new balance comes by itself
      get serverSide() { return active() && ready; },
      flush
    };
  };
})(window.NB);
