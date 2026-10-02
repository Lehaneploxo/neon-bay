// City jobs for the players: police officer, paramedic, firefighter. It works like a real job:
//  1. you get HIRED in the boss's office (the station chief, the head doctor, the fire chief) — one job at a time;
//  2. each shift starts and ends in the locker room: the uniform goes on, the wage comes in every minute, the
//     service cars are yours, the calls blink on the map — a brawler to arrest, someone hurt in the street,
//     a burning car. Each one dealt with pays a bonus;
//  3. calls dealt with are your record: ranks come with it, and with each rank a bigger wage and bonus;
//  4. you can QUIT in the same office. The shift also ends from the pause menu, at death or arrest, or when
//     you change into your own clothes.
// The job, the record and whether you're on shift are kept in the save (progress.job).
// The city's own ambulances and fire engines hold back a little while a player is on shift, so the work
// comes to the player first. Life in the street makes the work: now and then two passers-by come to blows;
// the one who's knocked down needs an ambulance, the one who started it runs off and is wanted for a while.
(function (NB) {
  'use strict';
  const { U } = NB;
  const rand = U.rand, pick = a => a[(Math.random() * a.length) | 0];
  const fmt = n => '$' + Math.round(n).toLocaleString('ru-RU');
  // ranks: [name, calls dealt with to reach it, wage per minute, bonus per call]
  const JOBS = {
    police: { place: 'Полицейский участок', boss: 'Начальник участка', bossRoom: 'кабинет начальника — из холла прямо, в отделе детективов дверь налево', title: 'Полицейский', outfit: 'cop', car: 'police', color: '#4f8aff',
      task: 'Задерживайте зачинщиков драк и грабителей (подбегите и нажмите «АРЕСТ»)',
      ranks: [['Стажёр', 0, 45, 150], ['Патрульный', 10, 55, 180], ['Сержант', 30, 70, 220], ['Лейтенант', 60, 90, 280], ['Капитан', 100, 120, 350]] },
    ems: { place: 'Больница', boss: 'Главврач', bossRoom: 'кабинет главврача — из холла прямо через пост медсестры, дальняя дверь справа', title: 'Медик скорой', outfit: 'medic', car: 'ambulance', color: '#ff4f6a',
      task: 'Помогайте пострадавшим на улицах (подойдите и нажмите «ПОМОЧЬ»)',
      ranks: [['Санитар', 0, 40, 120], ['Фельдшер', 10, 50, 150], ['Врач скорой', 30, 65, 190], ['Хирург', 60, 85, 240], ['Заведующий отделением', 100, 110, 300]] },
    fire: { place: 'Пожарная часть', boss: 'Начальник части', bossRoom: 'кабинет начальника — из гаража в правую дальнюю дверь', title: 'Пожарный', outfit: 'fire', car: 'firetruck', color: '#ff8a3d',
      task: 'Тушите горящие машины (подойдите и нажмите «ТУШИТЬ»)',
      ranks: [['Курсант', 0, 40, 200], ['Пожарный', 10, 50, 240], ['Старший пожарный', 30, 65, 290], ['Командир отделения', 60, 85, 350], ['Начальник караула', 100, 110, 430]] }
  };
  const CALL_R = 300;   // how far away calls are shown
  // seconds between street crimes near the hero, by district
  const crimeGap = name => /^(Район 21|Доки|Мост 21)/.test(name || '') ? [20, 40] : /^(Рынок|Гавань)/.test(name || '') ? [45, 75] : [60, 100];
  const NOT_BRAWLERS = new Set(['escort', 'soldier', 'prisoner', 'security', 'cop', 'medic', 'firefighter', 'waitress', 'cook', 'croupier', 'bellboy', 'bouncer', 'elderly']);

  NB.createJobs = function (o) {
    // o: crowd, vehicles, player, police, money { add }, flash, say, wear(outfit|null), ui, audio, inside() -> bool, world,
    //    progress (the save: progress.job), save(), combat, getArmor(), setArmor(n)
    let duty = null, payT = 0, brawlT = rand(60, 100), crashT = rand(90, 150);
    const shift = { pay: 0, calls: 0, gun: false };
    const seen = new Set();
    const P = () => o.player;
    const near = (a, r) => Math.hypot(a.x - P().x, a.z - P().z) < r;
    const alive = p => o.crowd.people.includes(p);
    // the job in the save: { kind: hired where (or null), duty: on shift, xp: { police, ems, fire } calls dealt with }
    const job = o.progress.job = Object.assign({ kind: null, duty: false, xp: {} }, o.progress.job || {});
    if (!job.xp || typeof job.xp !== 'object') job.xp = {};
    if (!JOBS[job.kind]) job.kind = null;
    if (!job.kind && o.progress.outfit === 'cop') { job.kind = 'police'; job.duty = true; }   // an older save, made in the police uniform
    const xp = kind => job.xp[kind] || 0;
    function rankOf(kind) { const R = JOBS[kind].ranks; let i = 0; while (i + 1 < R.length && xp(kind) >= R[i + 1][1]) i++; return i; }
    const rank = kind => { const r = JOBS[kind].ranks[rankOf(kind)]; return { i: rankOf(kind), name: r[0], pay: r[2], bonus: r[3] }; };
    const nextRank = kind => JOBS[kind].ranks[rankOf(kind) + 1] || null;
    const store = () => { job.duty = !!duty; o.save(); };

    function hire(kind) {
      const J = JOBS[kind];
      if (job.kind === kind) return 'Вы уже работаете здесь';
      if (job.kind) { o.audio.deny(); return 'Сначала уволитесь: ' + JOBS[job.kind].place.toLowerCase(); }
      if (kind === 'police' && o.police.wanted > 0) { o.audio.deny(); return 'Вас разыскивают — в полицию не возьмут'; }
      job.kind = kind; store();
      o.flash(J.boss + ': «Добро пожаловать! Вы — ' + rank(kind).name.toLowerCase() + '. Форма в раздевалке — там и начинайте смену»', 5);
      return 'Вы приняты на работу!';
    }
    function quit() {
      if (!job.kind) return '';
      const J = JOBS[job.kind];
      if (duty) end(true);
      job.kind = null; store();
      o.flash(J.boss + ': «Жаль. Надумаете — возвращайтесь»', 3);
      return 'Вы уволились';
    }
    function start(kind, quiet) {
      const J = JOBS[kind];
      if (job.kind !== kind) return 'Вы здесь не работаете';
      if (duty === kind) return 'Вы уже на смене';
      if (kind === 'police' && o.police.wanted > 0) { o.flash('Вас разыскивают — на смену не пустят', 2.6); o.audio.deny(); return 'Сначала избавьтесь от розыска'; }
      duty = kind; payT = 0; seen.clear(); shift.pay = 0; shift.calls = 0; shift.gun = false;
      o.wear(J.outfit); store();
      const r = rank(kind);
      if (!quiet) o.flash(r.name + ': смена началась. ' + J.task + '. Зарплата ' + fmt(r.pay) + ' в минуту, за вызов +' + fmt(r.bonus) + '. Вызовы мигают на карте', 6);
      return 'Вы на смене. Служебные машины — ваши';
    }
    // the shift's over: the uniform comes off; why — said in the message ('смена прервана' etc.)
    function end(silent, why) {
      if (!duty) return '';
      const J = JOBS[duty]; duty = null; o.wear(null); store();
      const sum = 'заработано ' + fmt(shift.pay) + ', вызовов ' + shift.calls;
      if (!silent) o.flash(J.title + ': ' + (why || 'смена окончена') + ' — ' + sum, 3.6);
      return 'Смена окончена: ' + sum;
    }
    // a call dealt with: the record grows, and with it the rank
    function credit(kind) {
      const before = rankOf(kind);
      job.xp[kind] = xp(kind) + 1; shift.calls++;
      if (rankOf(kind) > before) { const r = rank(kind); setTimeout(() => o.flash('Повышение! Теперь вы: ' + r.name + '. Зарплата ' + fmt(r.pay) + ' в минуту, за вызов +' + fmt(r.bonus), 5), 2800); }
      store();
    }
    // the boss's office: get hired, see your record, quit
    function boss(kind) {
      const J = JOBS[kind];
      o.ui.menu({ eyebrow: J.place, title: J.boss, items: () => {
        const r = rank(kind), nx = nextRank(kind), mine = job.kind === kind;
        const ladder = J.ranks.map(R => R[0] + ' — ' + fmt(R[2]) + '/мин').join(' · ');
        if (!mine) return [
          { name: 'Устроиться на работу', desc: job.kind ? 'Вы уже работаете: ' + JOBS[job.kind].place.toLowerCase() + '. Сначала уволитесь там' : 'Начнёте: ' + r.name.toLowerCase() + ', ' + fmt(r.pay) + ' в минуту на смене, за вызов +' + fmt(r.bonus),
            price: 0, label: 'Устроиться', disabled: job.kind ? 'Вы работаете в другом месте' : kind === 'police' && o.police.wanted > 0 ? 'Вас разыскивают' : '', buy: () => hire(kind) },
          { name: 'Что за работа', desc: J.task + '. Смена начинается и заканчивается в раздевалке', price: 0, disabled: 'Понятно', buy: () => '' },
          { name: 'Звания', desc: ladder, price: 0, disabled: 'Растут с опытом', buy: () => '' }
        ];
        return [
          { name: 'Ваша должность: ' + r.name, desc: 'Вызовов за всё время: ' + xp(kind) + (nx ? ' · до звания «' + nx[0] + '» ещё ' + (nx[1] - xp(kind)) : ' · высшее звание') + ' · ' + fmt(r.pay) + '/мин, за вызов +' + fmt(r.bonus),
            price: 0, disabled: duty === kind ? 'На смене' : 'Не на смене', buy: () => '' },
          { name: 'Смена', desc: duty === kind ? 'Идёт: заработано ' + fmt(shift.pay) + ', вызовов ' + shift.calls + '. Закончить — в раздевалке или в меню паузы' : 'Начинается в раздевалке: там форма', price: 0, disabled: 'В раздевалке', buy: () => '' },
          { name: 'Уволиться', desc: (duty === kind ? 'Смена закончится. ' : '') + 'Опыт и звание сохранятся, если вернётесь', price: 0, label: 'Уволиться', buy: quit },
          { name: 'Звания', desc: ladder, price: 0, disabled: 'Растут с опытом', buy: () => '' }
        ];
      } });
    }
    // the locker room: the uniform on and off = the shift
    function locker(kind) {
      const J = JOBS[kind];
      o.ui.menu({ eyebrow: J.place, title: 'Раздевалка', items: () => {
        if (job.kind !== kind) return [{ name: 'Шкафчика у вас нет', desc: 'Сначала устройтесь на работу: ' + J.bossRoom, price: 0, disabled: 'Вы здесь не работаете', buy: () => '' }];
        const r = rank(kind);
        return [duty === kind
          ? { name: 'Закончить смену', desc: 'Заработано за смену ' + fmt(shift.pay) + ', вызовов ' + shift.calls + '. Форма — в шкафчик', price: 0, label: 'Закончить', buy: () => end(true) }
          : { name: 'Начать смену', desc: r.name + ': форма, служебные машины, ' + fmt(r.pay) + ' в минуту, за вызов +' + fmt(r.bonus), price: 0, label: 'Начать', buy: () => start(kind) }];
      } });
    }
    // the police armoury: a service pistol, ammo and a vest, once a shift
    function armoury() {
      o.ui.menu({ eyebrow: 'Полицейский участок', title: 'Оружейная', items: () => [
        { name: 'Табельное оружие', desc: 'Пистолет, 60 патронов и бронежилет — раз за смену', price: 0, label: 'Получить',
          disabled: job.kind !== 'police' ? 'Только для сотрудников' : duty !== 'police' ? 'Сначала начните смену' : shift.gun ? 'Уже выдано' : '',
          buy: () => { shift.gun = true; o.combat.give('pistol', 60); if (o.getArmor() < 100) o.setArmor(100); return 'Выдано. Берегите себя!'; } }
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
    function pay(n, why) { shift.pay += n; o.money.add(n, why); o.audio.fare && o.audio.fare(); }
    function arrest(p) {
      if (!alive(p) || !p.suspect) return;
      p.suspect = false; o.say(p, pick(['Ладно, ладно, сдаюсь!', 'Это не я начал!', 'Без рук, начальник!']));
      setTimeout(() => o.crowd.despawnPerson(p), 900);
      const bonus = rank('police').bonus; credit('police');
      pay(bonus, 'Задержание'); o.flash('Зачинщик задержан! +' + fmt(bonus), 2.6);
    }
    function help(p) {
      if (!alive(p) || !(p.dead || p.down)) return;
      const bonus = rank('ems').bonus + (p.dead ? 60 : 0); credit('ems');
      o.crowd.revive(p, 60); o.say(p, pick(['Спасибо, доктор!', 'Я жив?!', 'Ох, голова…', 'Где я?']));
      pay(bonus, 'Помощь пострадавшему'); o.flash((p.dead ? 'Реанимация удалась! +' : 'Пострадавший спасён! +') + fmt(bonus), 2.6);
    }
    function douse(c) {
      if (!o.vehicles.cars.includes(c) || !(c.burnT > 0 || c.wreckFireT > 0)) return;
      o.vehicles.extinguish(c);
      const bonus = rank('fire').bonus; credit('fire');
      pay(bonus, 'Пожар потушен'); o.flash('Пожар потушен! +' + fmt(bonus), 2.6);
    }

    /* ---------- life in the street: a brawl now and then ---------- */
    function brawler(p) {
      return !p.dead && !p.down && !p.cop && !p.medic && !p.gang && !p.bodyguard && !p.puppet && !p.fare && !p.boxer && !p.bouncer && !p.brawl && !p.suspect && !p.spot &&
        !p.look.female && !NOT_BRAWLERS.has(p.look.type) && p.x < 1000 && !(p.fightT > 0) && !(p.fleeT > 0);
    }
    function startBrawl() {
      const max = duty === 'police' || duty === 'ems' ? 160 : 100;
      const pool = o.crowd.people.filter(p => brawler(p) && !near(p, 20) && near(p, max));
      for (let k = 0; k < 6 && pool.length > 1; k++) {
        const a = pick(pool);
        let b = null, bd = 10;
        for (const q of pool) { if (q === a) continue; const d = Math.hypot(q.x - a.x, q.z - a.z); if (d < bd) { bd = d; b = q; } }
        if (!b) continue;
        const mug = Math.random() < .4;   // a mugging: the robber beats his victim, takes the wallet and runs
        o.crowd.brawl(a, b, mug ? 'mug' : 'fight');
        if (duty === 'police') o.flash(mug ? 'Вызов: ограбление на улице! Грабитель отмечен на карте' : 'Вызов: драка на улице! Зачинщик отмечен на карте', 3);
        return true;
      }
      return false;
    }

    function startCrash() {
      const max = duty === 'fire' || duty === 'ems' ? 170 : 120;
      const pool = o.vehicles.cars.filter(c => c.ai && !c.model.police && !c.model.ems && !c.model.fire && !c.model.bike && !c.model.boat && !c.model.heli && !c.wreck && !near(c, 30) && near(c, max));
      if (!pool.length) return false;
      const c = pick(pool);
      if (!o.vehicles.crash(c)) return false;
      const sx = -Math.cos(c.h), sz = Math.sin(c.h), p = o.crowd.dropOff(c.x + sx * (c.model.w / 2 + .9), c.z + sz * (c.model.w / 2 + .9), c.h, null, pick(['Аааа, нога!', 'Помогите!', 'Тормоза отказали!']), true);
      if (p) { p.fare = null; o.crowd.damage(p, p.maxHp * .85, { byPlayer: false, kind: 'car', x: c.x, z: c.z }); }
      if (duty === 'fire' || duty === 'ems') o.flash('Вызов: авария, машина горит' + (duty === 'ems' ? ', водитель ранен' : '') + ' — отмечено на карте', 3);
      return true;
    }

    return {
      JOBS,
      get duty() { return duty; },
      get job() { return job.kind; },
      rank, boss, locker, armoury, end, start,
      // a game loaded in the middle of a shift: back in the uniform, on shift (once the whole game is set up)
      resume() { if (job.kind && job.duty && !duty) start(job.kind, true); },
      // the line on the screen while on shift: how many calls, how far the nearest
      get hud() {
        if (!duty) return null;
        const cs = calls();
        let best = Infinity; for (const c of cs) best = Math.min(best, Math.hypot(c.x - P().x, c.z - P().z));
        return { tag: 'СМЕНА', text: rank(duty).name + (cs.length ? ' · вызовов: ' + cs.length + ' · ближайший ' + Math.round(best) + ' м' : ' · вызовов нет, патрулируйте'), time: fmt(shift.pay), warn: cs.length > 0 };
      },
      // the city's own services wait a little for a player on shift nearby
      holdEMS: p => duty === 'ems' && near(p, CALL_R),
      holdFire: c => duty === 'fire' && near(c, CALL_R),
      update(dt) {
        // the wage, every minute on shift
        if (duty) { payT += dt; if (payT >= 60) { payT -= 60; const r = rank(duty); shift.pay += r.pay; o.money.add(r.pay, 'Зарплата: ' + r.name.toLowerCase()); } }
        // a brawl somewhere around every couple of minutes (more often when there's someone on shift to see to it)
        // a road accident every couple of minutes (more often with a firefighter or a paramedic on shift)
        if (!o.inside() && (crashT -= dt) <= 0) crashT = startCrash() ? (duty === 'fire' || duty === 'ems' ? rand(50, 90) : rand(120, 200)) : 10;
        if (!o.inside() && (brawlT -= dt) <= 0) { const g = crimeGap(o.district()); brawlT = startBrawl() ? rand(g[0], g[1]) : 5; }
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
