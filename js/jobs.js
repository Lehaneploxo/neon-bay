// City jobs for the players: police officer, paramedic, firefighter. Sign on at the police station, the
// hospital or the fire station: you get the uniform, the service cars are yours to take, a wage comes in
// every minute of the shift, and the calls blink on the map — a brawler to arrest, someone lying hurt in the
// street, a burning car. Each one dealt with pays a bonus. The city's own ambulances and fire engines hold
// back a little while a player is on shift, so the work comes to the player first.
// Life in the street makes the work: now and then two passers-by come to blows; the one who's knocked down
// needs an ambulance, the one who started it runs off and is wanted by the police for a few minutes.
// (Fires still start only from wrecked cars — no fires out of nowhere.)
(function (NB) {
  'use strict';
  const { U } = NB;
  const rand = U.rand, pick = a => a[(Math.random() * a.length) | 0];
  const fmt = n => '$' + Math.round(n).toLocaleString('ru-RU');
  const JOBS = {
    police: { place: 'Полицейский участок', title: 'Полицейский', outfit: 'cop', car: 'police', pay: 45, bonus: 150, color: '#4f8aff',
      task: 'Задерживайте зачинщиков драк (подбегите и нажмите «АРЕСТ»)' },
    ems: { place: 'Больница', title: 'Медик скорой', outfit: 'medic', car: 'ambulance', pay: 40, bonus: 120, color: '#ff4f6a',
      task: 'Помогайте пострадавшим на улицах (подойдите и нажмите «ПОМОЧЬ»)' },
    fire: { place: 'Пожарная часть', title: 'Пожарный', outfit: 'fire', car: 'firetruck', pay: 40, bonus: 200, color: '#ff8a3d',
      task: 'Тушите горящие машины (подойдите и нажмите «ТУШИТЬ»)' }
  };
  const CALL_R = 300;   // how far away calls are shown
  const NOT_BRAWLERS = new Set(['escort', 'soldier', 'prisoner', 'security', 'cop', 'medic', 'firefighter', 'waitress', 'cook', 'croupier', 'bellboy', 'bouncer', 'elderly']);

  NB.createJobs = function (o) {
    // o: crowd, vehicles, player, police, money { add }, flash, say, wear(outfit|null), ui, audio, inside() -> bool, world
    let duty = null, payT = 0, brawlT = rand(60, 100);
    const seen = new Set();
    const P = () => o.player;
    const near = (a, r) => Math.hypot(a.x - P().x, a.z - P().z) < r;
    const alive = p => o.crowd.people.includes(p);

    function start(kind) {
      const J = JOBS[kind];
      if (kind === 'police' && o.police.wanted > 0) { o.flash('Вас разыскивают — в полицию на смену не возьмут', 2.6); o.audio.deny(); return 'Сначала избавьтесь от розыска'; }
      duty = kind; payT = 0; seen.clear();
      o.wear(J.outfit);
      o.flash(J.title + ': смена началась. Зарплата ' + fmt(J.pay) + ' в минуту, за каждый вызов +' + fmt(J.bonus) + '. Вызовы мигают на карте', 5);
      return 'Вы на смене. Служебные машины — ваши';
    }
    function end() {
      if (!duty) return '';
      const J = JOBS[duty]; duty = null; o.wear(null);
      o.flash(J.title + ': смена окончена', 2.4);
      return 'Смена окончена';
    }
    // the desk at each service: sign on, sign off
    function desk(kind) {
      const J = JOBS[kind];
      o.ui.menu({ eyebrow: J.place, title: 'Работа: ' + J.title.toLowerCase(), items: () => [
        duty === kind ? { name: 'Закончить смену', desc: 'Снять форму и вернуться в свою одежду', price: 0, label: 'Закончить', buy: end }
          : { name: 'Начать смену', desc: duty ? 'Сначала закончите смену: ' + JOBS[duty].title.toLowerCase() : 'Форма, служебные машины, зарплата ' + fmt(J.pay) + ' в минуту', price: 0, label: 'Начать', disabled: duty ? 'Вы на другой смене' : '', buy: () => start(kind) },
        { name: 'Что делать', desc: J.task + '. За каждый вызов +' + fmt(J.bonus), price: 0, disabled: 'Понятно', buy: () => '' }
      ] });
    }

    /* ---------- the calls ---------- */
    function calls() {
      if (!duty) return [];
      const out = [];
      if (duty === 'police') { for (const p of o.crowd.people) if (p.suspect && !p.dead && near(p, CALL_R)) out.push({ kind: 'police', who: p, x: p.x, z: p.z }); }
      else if (duty === 'ems') { for (const p of o.crowd.people) if ((p.dead || p.down) && !p.bodyguard && p.x < 1000 && near(p, CALL_R)) out.push({ kind: 'ems', who: p, x: p.x, z: p.z }); }
      else if (duty === 'fire') { for (const c of o.vehicles.fires()) if (near(c, CALL_R) && c !== o.vehicles.driving) out.push({ kind: 'fire', who: c, x: c.x, z: c.z }); }
      return out;
    }
    function pay(n, why) { o.money.add(n, why); o.audio.fare && o.audio.fare(); }
    function arrest(p) {
      if (!alive(p) || !p.suspect) return;
      p.suspect = false; o.say(p, pick(['Ладно, ладно, сдаюсь!', 'Это не я начал!', 'Без рук, начальник!']));
      setTimeout(() => o.crowd.despawnPerson(p), 900);
      pay(JOBS.police.bonus, 'Задержание'); o.flash('Зачинщик драки задержан! +' + fmt(JOBS.police.bonus), 2.6);
    }
    function help(p) {
      if (!alive(p) || !(p.dead || p.down)) return;
      const bonus = JOBS.ems.bonus + (p.dead ? 60 : 0);
      o.crowd.revive(p, 60); o.say(p, pick(['Спасибо, доктор!', 'Я жив?!', 'Ох, голова…', 'Где я?']));
      pay(bonus, 'Помощь пострадавшему'); o.flash((p.dead ? 'Реанимация удалась! +' : 'Пострадавший спасён! +') + fmt(bonus), 2.6);
    }
    function douse(c) {
      if (!o.vehicles.cars.includes(c) || !(c.burnT > 0 || c.wreckFireT > 0)) return;
      o.vehicles.extinguish(c);
      pay(JOBS.fire.bonus, 'Пожар потушен'); o.flash('Пожар потушен! +' + fmt(JOBS.fire.bonus), 2.6);
    }

    /* ---------- life in the street: a brawl now and then ---------- */
    function brawler(p) {
      return !p.dead && !p.down && !p.cop && !p.medic && !p.gang && !p.bodyguard && !p.puppet && !p.fare && !p.boxer && !p.bouncer && !p.brawl && !p.suspect && !p.spot &&
        !p.look.female && !NOT_BRAWLERS.has(p.look.type) && p.x < 1000 && !(p.fightT > 0) && !(p.fleeT > 0);
    }
    function startBrawl() {
      const max = duty === 'police' || duty === 'ems' ? 160 : 90;
      const pool = o.crowd.people.filter(p => brawler(p) && !near(p, 20) && near(p, max));
      for (let k = 0; k < 6 && pool.length > 1; k++) {
        const a = pick(pool);
        let b = null, bd = 10;
        for (const q of pool) { if (q === a) continue; const d = Math.hypot(q.x - a.x, q.z - a.z); if (d < bd) { bd = d; b = q; } }
        if (!b) continue;
        o.crowd.brawl(a, b);
        if (duty === 'police') o.flash('Вызов: драка на улице! Зачинщик отмечен на карте', 3);
        return true;
      }
      return false;
    }

    return {
      JOBS,
      get duty() { return duty; },
      desk, end,
      // the city's own services wait a little for a player on shift nearby
      holdEMS: p => duty === 'ems' && near(p, CALL_R),
      holdFire: c => duty === 'fire' && near(c, CALL_R),
      update(dt) {
        // the wage, every minute on shift
        if (duty) { payT += dt; if (payT >= 60) { payT -= 60; const J = JOBS[duty]; o.money.add(J.pay, 'Зарплата: ' + J.title.toLowerCase()); } }
        // a brawl somewhere around every couple of minutes (more often when there's someone on shift to see to it)
        if (!o.inside() && (brawlT -= dt) <= 0) brawlT = startBrawl() ? (duty ? rand(70, 120) : rand(120, 200)) : 15;
        // suspects are wanted for three minutes, then it's forgotten
        for (const p of o.crowd.people) if (p.suspect && !p.brawl && (p.suspectT = (p.suspectT || 0) + dt) > 180) p.suspect = false;
        // a new call: tell the player
        if (duty) for (const c of calls()) if (!seen.has(c.who)) {
          seen.add(c.who);
          if (c.kind === 'ems') o.flash('Вызов: пострадавший на улице — он отмечен на карте', 2.6);
          else if (c.kind === 'fire') o.flash('Вызов: горит машина — отмечено на карте', 2.6);
        }
      },
      // what's under the hero's hand: arrest, help, put out
      interactions() {
        if (!duty) return [];
        const out = [];
        for (const c of calls()) {
          if (c.kind === 'police' && near(c.who, 6)) out.push({ x: c.x, z: c.z, y: c.who.y, r: 2.2, short: 'АРЕСТ', label: () => 'Задержать зачинщика драки', use: () => arrest(c.who) });
          if (c.kind === 'ems' && near(c.who, 6)) out.push({ x: c.x, z: c.z, y: c.who.y, r: 2.2, short: 'ПОМОЧЬ', label: () => c.who.dead ? 'Реанимировать' : 'Оказать помощь', use: () => help(c.who) });
          if (c.kind === 'fire' && near(c.who, 10)) out.push({ x: c.x, z: c.z, y: c.who.y, r: 7, short: 'ТУШИТЬ', label: () => 'Потушить машину', use: () => douse(c.who) });
        }
        return out;
      },
      // for the minimap: the calls, in the service's colour
      markers() { return calls().map(c => ({ x: c.x, z: c.z, color: JOBS[duty].color })); }
    };
  };
})(window.NB);
