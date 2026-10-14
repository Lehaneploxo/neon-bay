// Gift fighters on the owner's stream: a small gift sends a person with the viewer's nick over his head who runs
// up to the hero and fights him with his fists. One Rose = one police officer on foot, one TikTok = one passer-by. At most MAX of them are
// on the street at once; the rest wait in a queue and come in as the ones before are knocked out. When the hero
// knocks one out the screen says so. Only the owner's game has them (sync.js leaves them out).
(function (NB) {
  'use strict';
  const MAX = 20;          // on the street at once
  const GAP = .35;         // seconds between two coming in
  const FAR = 160;         // further than that from the hero: let go (he comes back from the queue)

  NB.createBrawlers = function (world, o) {
    // o: crowd, player, camera, flash(text, sec), indoors(), view()
    const col = world.col;
    function groundAt(x, z) {
      let f = 0;
      for (const b of col.query(x - .3, z - .3, x + .3, z + .3, [])) if (b.maxY <= 1.6 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > f) f = b.maxY;
      return f;
    }
    const solidAt = (x, z, y) => col.query(x - .4, z - .4, x + .4, z + .4, []).some(b => !b.npcOnly && b.maxY > y + .4 && b.minY < y + 1.6 && x + .4 > b.minX && x - .4 < b.maxX && z + .4 > b.minZ && z - .4 < b.maxZ);
    const walkable = (x, z) => !NB.water.at(x, z) && !solidAt(x, z, groundAt(x, z));
    function spot() {
      const p = o.player, v = o.view(), va = Math.atan2(v[0], v[1]);
      for (let i = 0; i < 24; i++) {
        const a = va + (Math.random() - .5) * (i < 12 ? 2 : 6.2), d = 14 + Math.random() * 10, x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
        if (walkable(x, z)) return [x, z];
      }
      return null;
    }

    const hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;top:206px;left:50%;transform:translateX(-50%);z-index:45;padding:6px 14px;border-radius:12px;font:800 14px Rubik,sans-serif;color:#e6f0ff;background:rgba(14,24,48,.85);box-shadow:0 0 0 2px rgba(80,140,255,.6),0 4px 18px rgba(0,0,0,.45);pointer-events:none;display:none;white-space:nowrap';
    document.body.appendChild(hud);
    const names = document.getElementById('names');

    const queue = [];   // [kind, nick] waiting to come in
    const list = [];    // { p, kind, nick, tag }
    let gapT = 0;
    const proj = new THREE.Vector3();

    function letGo(b) {
      b.tag.remove();
      if (o.crowd.people.includes(b.p)) { b.p.brawler = null; b.p.keep = false; }
    }
    function bring(kind, nick) {
      const s = spot(); if (!s) return false;
      const p = o.crowd.spawnBrawler(kind, s[0], s[1]); if (!p) return false;
      const tag = document.createElement('div'); tag.className = 'ntag gift'; tag.innerHTML = '<b></b>'; tag.firstChild.textContent = '@' + nick; tag.hidden = true;
      names.appendChild(tag);
      list.push({ p, kind, nick, tag });
      return true;
    }

    return {
      get count() { return list.length; },
      get waiting() { return queue.length; },
      // n fighters from one viewer (a combo of n roses)
      add(kind, nick, n) {
        n = Math.max(1, Math.min(500, n | 0)); nick = nick || 'зритель';
        for (let i = 0; i < n; i++) queue.push([kind, nick]);
        const cop = kind === 'cop';
        o.flash((cop ? '🌹 @' : '🎵 @') + nick + ' прислал ' + (n > 1 ? n + (cop ? ' копов' : ' драчунов') : cop ? 'копа' : 'драчуна') + ' — ' + (n > 1 ? 'бегут' : 'бежит') + ' драться!', 2.5);
      },
      clear() { queue.length = 0; for (const b of list.splice(0)) letGo(b); },
      update(dt, player) {
        // knocked out, killed or left far behind: off the list
        for (let i = list.length - 1; i >= 0; i--) {
          const b = list[i], p = b.p, gone = !o.crowd.people.includes(p);
          if (gone || p.dead || p.down) {
            if (!gone) o.flash('💥 Ты вырубил @' + b.nick, 2);
            list.splice(i, 1); letGo(b); continue;
          }
          if (Math.hypot(p.x - player.x, p.z - player.z) > FAR) { list.splice(i, 1); letGo(b); o.crowd.despawnPerson(p); queue.unshift([b.kind, b.nick]); }
        }
        // the next ones come in, one by one
        if ((gapT -= dt) <= 0 && queue.length && list.length < MAX && !player.dead && !o.indoors()) {
          gapT = GAP;
          const q = queue[0];
          if (bring(q[0], q[1])) queue.shift(); else gapT = 1;
        }
        // the nick over each one's head
        for (const b of list) {
          const p = b.p, d = Math.hypot(p.x - player.x, p.z - player.z);
          if (d > 60 || o.indoors()) { b.tag.hidden = true; continue; }
          proj.set(p.x, p.y + 2.15, p.z).project(o.camera);
          if (proj.z > 1) { b.tag.hidden = true; continue; }
          b.tag.hidden = false;
          b.tag.style.transform = 'translate(' + ((proj.x + 1) / 2 * innerWidth).toFixed(0) + 'px,' + ((1 - proj.y) / 2 * innerHeight).toFixed(0) + 'px) translate(-50%,-100%)';
        }
        if (list.length || queue.length) {
          const cops = list.filter(b => b.kind === 'cop').length, civ = list.length - cops;
          hud.style.display = 'block'; hud.textContent = [cops ? '👮 Копы: ' + cops : '', civ ? '👊 Драчуны: ' + civ : '', queue.length ? 'в очереди ' + queue.length : ''].filter(Boolean).join(' · ');
        }
        else hud.style.display = 'none';
      }
    };
  };
})(window.NB);
