// Wanted level. A crime only counts if a police officer or a patrol car sees it:
// a punch is noticed within 22 m, gunfire within 48 m (twice as far), and anything
// done while the police are already watching you. Out of their sight long enough, the stars go away.
// Nobody appears out of thin air: officers on the beat and patrol cars nearby join in, and the rest come
// by car from the police station, one car of two officers per star (vehicles.js).
(function (NB) {
  'use strict';
  const RANGE = { punch: 22, carjack: 18, copcar: 25, shoot: 48, kill: 30 };
  const LOSE = [0, 10, 15, 22, 30, 40];     // seconds out of sight to shake the police, per star
  
  NB.createPolice = function (world, o) {
    const col = world.col;
    const S = { wanted: 0, searchT: 0, seen: false, seenT: 0, bustT: 0, bustTick: false, kills: 0 };
    function los(ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
      return L < .5 || col.raycast(ax, ay, az, dx / L, dy / L, dz / L, L) >= L - .5;
    }
    function witnessed(x, z, r) {
      for (const p of o.crowd.cops()) {
        if (Math.hypot(p.x - x, p.z - z) < r && los(p.x, p.y + 1.55, p.z, x, 1.2, z)) return true;
      }
      for (const c of o.vehicles.cars) {
        if (!c.police || !(c.ai || c.pursuit)) continue;
        if (Math.hypot(c.x - x, c.z - z) < r * 1.2 && los(c.x, 1.3, c.z, x, 1.2, z)) return true;
      }
      return false;
    }
    function raise(n) {
      n = Math.min(5, n);
      if (n <= S.wanted) return;
      const prev = S.wanted; S.wanted = n; S.searchT = 0; S.seen = true;
      o.onWanted(n, prev);
    }
    const api = {
      get wanted() { return S.wanted; },
      get searching() { return S.wanted > 0 && !S.seen; },
      // a robbery: the alarm goes straight to the station (a bank: 3 stars, a 24/7 store: 2)
      robbery(n) { S.searchT = 0; S.seen = true; raise(Math.max(S.wanted, n || 3)); },
      // knocked out another player: one star more
      star() { S.searchT = 0; S.seen = true; raise(S.wanted + 1); },
      reportCrime(kind, x, z) {
        // in a police uniform the officers take you for one of their own and let small things slide
        if (o.disguised && o.disguised() && (kind === 'punch' || kind === 'carjack' || kind === 'copcar')) return;
        const direct = kind === 'copAttack' || kind === 'copKill';
        if (!direct && !(S.wanted > 0 && S.seen) && !witnessed(x, z, RANGE[kind] || 25)) return;
        S.searchT = 0; S.seen = true;
        switch (kind) {
          case 'punch': case 'carjack': case 'copcar': raise(Math.max(S.wanted, 1)); break;
          case 'shoot': case 'copAttack': raise(Math.max(S.wanted, 2)); break;
          case 'kill': S.kills++; raise(Math.max(S.wanted, 2) + (S.wanted >= 2 && S.kills % 2 === 0 ? 1 : 0)); break;
          case 'copKill': raise(Math.max(3, S.wanted + 1)); break;
        }
      },
      // an officer is close enough to grab you; hold still for a second and you're arrested
      bustTick(dt) {
        S.bustTick = true; S.bustT += dt;
        if (S.bustT > 1.1) { S.bustT = 0; o.onBust(); }
      },
      clear() {
        const prev = S.wanted;
        S.wanted = 0; S.searchT = 0; S.kills = 0; S.bustT = 0; S.seen = false;
        o.crowd.clearChase();
        if (prev) o.onWanted(0, prev);
      },
      update(dt, player, camYaw) {
        if (!S.bustTick) S.bustT = Math.max(0, S.bustT - dt * 2);
        S.bustTick = false;
        if (!S.wanted) return;
        S.seenT -= dt;
        if (S.seenT <= 0) {
          S.seenT = .3;
          S.seen = o.crowd.cops().some(p => p.chasing && p.los && Math.hypot(p.x - player.x, p.z - player.z) < 50) ||
            o.vehicles.cars.some(c => c.pursuit && c.pursuit.los && Math.hypot(c.x - player.x, c.z - player.z) < 75) ||
            o.vehicles.cars.some(c => (c.copHeli && !c.copHeli.leaving && Math.hypot(c.x - player.x, c.z - player.z) < 70) || (c.coastGuard && Math.hypot(c.x - player.x, c.z - player.z) < 60));   // the helicopter sees everything
        }
        if (S.seen) S.searchT = 0;
        else if ((S.searchT += dt) > LOSE[S.wanted]) { api.clear(); o.flash('Вы оторвались от полиции', 2.5); return; }
      }
    };
    return api;
  };
})(window.NB);
