// The zombie apocalypse: a gift on the owner's stream starts it near the hero for five minutes. It begins with
// one zombie. A zombie goes for whoever is nearest — a passer-by, a policeman, the hero — and bites: the bitten
// one falls, turns grey-green and gets up a zombie, and goes after the next. So it spreads through the streets
// while people run screaming. The hero isn't turned, a bite only takes his health; he can shoot or beat them down
// and the police don't mind. If the zombies are wiped out (or the hero ends up far away) a new one turns up near
// him, so it goes on for the whole five minutes. Then the infection burns out and they all drop dead.
(function (NB) {
  'use strict';
  const MAX = 45;   // more than that at once and a bite simply kills

  NB.createZombies = function (world, o) {
    // o: scene, crowd, audio, player, flash(text, sec), heroDamage(v), indoors(), view()
    const col = world.col;
    function groundAt(x, z) {
      let f = 0;
      for (const b of col.query(x - .3, z - .3, x + .3, z + .3, [])) if (b.maxY <= 1.6 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > f) f = b.maxY;
      return f;
    }
    const solidAt = (x, z, y) => col.query(x - .4, z - .4, x + .4, z + .4, []).some(b => !b.npcOnly && b.maxY > y + .4 && b.minY < y + 1.6 && x + .4 > b.minX && x - .4 < b.maxX && z + .4 > b.minZ && z - .4 < b.maxZ);
    const walkable = (x, z) => !NB.water.at(x, z) && !solidAt(x, z, groundAt(x, z));

    const hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;top:164px;left:50%;transform:translateX(-50%);z-index:45;padding:8px 16px;border-radius:12px;font:800 16px Rubik,sans-serif;color:#e9ffe0;background:rgba(22,34,14,.85);box-shadow:0 0 0 2px rgba(150,200,60,.6),0 4px 18px rgba(0,0,0,.45);pointer-events:none;display:none;white-space:nowrap';
    document.body.appendChild(hud);
    // a red flash at the edges of the screen when the hero is bitten
    const bite = document.createElement('div');
    bite.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:39;opacity:0;transition:opacity .5s ease-out;box-shadow:inset 0 0 120px 40px rgba(170,0,0,.85)';
    document.body.appendChild(bite);

    /* ---------- sound: groans and the bite ---------- */
    const AC = () => o.audio.ctx && o.audio.ctx();
    function groan(x, z) {
      const ac = AC(); if (!ac) return;
      const d = Math.hypot(o.player.x - x, o.player.z - z); if (d > 40) return;
      const t = ac.currentTime, g = ac.createGain(), osc = ac.createOscillator(), lp = ac.createBiquadFilter(), v = .07 * (1 - d / 40), f = 70 + Math.random() * 50, len = .8 + Math.random() * .7;
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f * 1.3, t); osc.frequency.linearRampToValueAtTime(f, t + len * .6); osc.frequency.linearRampToValueAtTime(f * .8, t + len);
      lp.type = 'bandpass'; lp.frequency.value = 420 + Math.random() * 200; lp.Q.value = 2;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .15); g.gain.setValueAtTime(v, t + len * .7); g.gain.linearRampToValueAtTime(0, t + len);
      osc.connect(lp); lp.connect(g); g.connect(o.audio.bus()); osc.start(t); osc.stop(t + len + .05);
    }
    function crunch(x, z) {
      const ac = AC(), buf = o.audio.noiseBuf && o.audio.noiseBuf(); if (!ac || !buf) return;
      const d = Math.hypot(o.player.x - x, o.player.z - z); if (d > 30) return;
      const t = ac.currentTime, s = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.5;
      g.gain.setValueAtTime(.25 * (1 - d / 30), t); g.gain.exponentialRampToValueAtTime(.001, t + .18);
      s.connect(bp); bp.connect(g); g.connect(o.audio.bus()); s.start(t); s.stop(t + .2);
    }

    let Z = null;   // the apocalypse going on: { t, dur, nick, list: [], seedT, panicT, groanT, turned }

    function spotAhead(dMin, dMax) {
      const p = o.player, v = o.view(), va = Math.atan2(v[0], v[1]);
      for (let i = 0; i < 20; i++) {
        const a = va + (Math.random() - .5) * (i < 10 ? 1.2 : 6), d = dMin + Math.random() * (dMax - dMin), x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
        if (walkable(x, z)) return [x, z];
      }
      return null;
    }
    function seed() {
      const s = spotAhead(16, 26); if (!s) return null;
      const q = o.crowd.spawnZombie(s[0], s[1]);
      if (q) { Z.list.push(q); groan(q.x, q.z); }
      return q;
    }

    function end() {
      for (const p of Z.list) if (o.crowd.people.includes(p) && !p.dead) { o.crowd.damage(p, 9999, { byPlayer: false, kind: 'zombie', x: p.x, z: p.z }); }
      for (const p of Z.list) p.keep = false;
      hud.style.display = 'none';
      o.flash('🧟 Зараза выдохлась — зомби падают замертво', 4);
      Z = null;
    }

    return {
      get busy() { return !!Z; },
      start(nick, dur) {
        if (Z) return false;
        if (o.indoors()) { o.flash('Зомби на улицах — выйдите из помещения', 2.5); return false; }
        Z = { t: 0, dur: dur || 300, nick: nick || '', list: [], seedT: 0, panicT: 0, groanT: 2, turned: 0 };
        if (!seed()) { Z = null; return false; }
        o.flash('🧟 ' + (nick ? '@' + nick + ' устроил ' : '') + 'ЗОМБИ-АПОКАЛИПСИС! Укушенные становятся зомби — не дай себя укусить!', 5);
        return true;
      },
      // a zombie's bite (npc.js decides when): the hero loses health, anyone else turns (or dies, when there are too many)
      bite(p, t) {
        if (!Z) return;
        crunch(p.x, p.z);
        if (t === 'hero') {
          if (o.indoors()) return;
          o.heroDamage(7 + Math.random() * 5);
          bite.style.transition = 'none'; bite.style.opacity = '1'; requestAnimationFrame(() => { bite.style.transition = 'opacity .6s ease-out'; bite.style.opacity = '0'; });
          return;
        }
        if (!o.crowd.people.includes(t) || t.zombie || t.dead) return;
        o.audio.scream && o.audio.scream([t.x, 1, t.z]);
        if (Z.list.filter(q => !q.dead && !q.down).length >= MAX) { o.crowd.damage(t, 9999, { byPlayer: false, kind: 'zombie', x: p.x, z: p.z }); return; }
        if (o.crowd.infect(t, 2 + Math.random())) { Z.list.push(t); Z.turned++; }
      },
      update(dt, player) {
        if (!Z) return;
        Z.t += dt;
        Z.list = Z.list.filter(p => o.crowd.people.includes(p));
        const alive = Z.list.filter(p => !p.dead && !p.down);
        const left = Math.max(0, Z.dur - Z.t), mm = Math.floor(left / 60), ss = Math.floor(left % 60);
        hud.textContent = '🧟 ЗОМБИ · ' + alive.length + ' · ' + mm + ':' + String(ss).padStart(2, '0');
        // the living run from them
        if ((Z.panicT -= dt) <= 0) { Z.panicT = 1; for (const p of alive) if (Math.hypot(p.x - player.x, p.z - player.z) < 120) o.crowd.panic(p.x, p.z, 9, false); }
        if ((Z.groanT -= dt) <= 0) { Z.groanT = .6 + Math.random() * 1.2; const near = alive.filter(p => Math.hypot(p.x - player.x, p.z - player.z) < 40); if (near.length) { const p = near[(Math.random() * near.length) | 0]; groan(p.x, p.z); } }
        // none left near the hero (shot down, or he woke up in the hospital): a new one turns up
        if ((Z.seedT -= dt) <= 0) {
          Z.seedT = 4;
          const near = alive.some(p => Math.hypot(p.x - player.x, p.z - player.z) < 70);
          if (!near && !o.indoors() && !player.dead) { seed(); Z.seedT = 12; }
        }
        // far-off ones are let go (the crowd takes them off out of sight)
        for (const p of alive) if (Math.hypot(p.x - player.x, p.z - player.z) > 160) o.crowd.despawnPerson(p);
        if (Z.t >= Z.dur) end();
      }
    };
  };
})(window.NB);
