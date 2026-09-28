// Boot: renderer, sky and light, game states, HUD, minimap, quality settings and the main loop.
(function (NB) {
  'use strict';
  const { U } = NB;
  const $ = id => document.getElementById(id);

  if (!window.THREE) { $('lede').textContent = 'Не удалось загрузить 3D-движок. Проверьте интернет и обновите страницу.'; return; }

  const isTouchDevice = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0;
  const settings = { sens: 1, quality: 'auto', volume: 1, muted: false };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('nb_settings') || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem('nb_settings', JSON.stringify(settings)); } catch (e) {} };

  /* ---------- renderer & scene ---------- */
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe98a86, 70, 260);
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .1, 330);

  const hemi = new THREE.HemisphereLight(0xffc2d6, 0x4b3a6b, .78); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb27a, 1.05);
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 220 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -.0008; sun.shadow.normalBias = .04;
  scene.add(sun, sun.target);
  // sky, sun, moon and the colour of the light through the day; the clock starts at 19:12, one game minute per second
  const dn = NB.createDayNight(scene, hemi, sun), sky = dn.sky;
  let fogNear0 = 70, fogFar0 = 250;   // how far you see in clear weather at this quality setting
  const START_MIN = 19 * 60 + 12, MENU_HOUR = 19.35;

  const world = NB.buildWorld(scene, renderer);
  const player = new NB.Player(scene, world.col);
  player.place(world.spawn.x, world.spawn.z, world.spawn.heading);
  const rig = new NB.CameraRig(camera, world.col);
  const lowCrowd = () => settings.quality === 'low' || isTouchDevice || (settings.quality === 'auto' && !shadowsOn && scale < .6);
  const crowdOpts = {
    limits: () => lowCrowd() ? { walkers: 18, beach: 8, spotRange: 55, cops: 3, dogs: 2 } : { walkers: 32, beach: 14, spotRange: 80, cops: 4, dogs: 4 },
    onBump: (p, text) => say(p, text)
  };
  const crowd = NB.createCrowd(scene, world, crowdOpts);
  // speech bubbles over people the hero bumps into
  const bubbles = [...document.querySelectorAll('.bubble')].map(el => ({ el, owner: null, t: 0 }));
  function say(p, text) {
    const b = bubbles.find(x => !x.owner) || bubbles.reduce((a, c) => (a.t < c.t ? a : c));
    if (b.owner && b.owner.bubble === b) b.owner.bubble = null;   // taken over from someone else
    b.owner = p; b.t = 2.2; b.el.textContent = text; b.el.hidden = false; p.bubble = b;
  }
  const projV = new THREE.Vector3();
  function updateBubbles(dt) {
    for (const b of bubbles) {
      // the speaker is gone (walked off, knocked out, dead): the bubble goes too, it must not stay stuck on screen
      if (!b.owner) { if (!b.el.hidden) b.el.hidden = true; continue; }
      b.t -= dt;
      if (b.t <= 0 || !crowd.people.includes(b.owner)) { b.owner = null; b.el.hidden = true; continue; }
      const p = b.owner; projV.set(p.x, p.y + 2.05 * p.look.hs, p.z).project(camera);
      if (projV.z > 1) { b.el.style.visibility = 'hidden'; continue; }
      b.el.style.visibility = 'visible';
      b.el.style.transform = 'translate(' + ((projV.x + 1) / 2 * innerWidth).toFixed(0) + 'px,' + ((1 - projV.y) / 2 * innerHeight).toFixed(0) + 'px) translate(-50%,-100%)';
    }
  }
  rig.snap(player);

  /* ---------- cars ---------- */
  const audio = NB.createAudio();
  // sun, clouds, fog, rain and storms
  const weather = NB.createWeather(scene, camera, { audio, lowQuality: () => settings.quality === 'low' || isTouchDevice });   // fewer raindrops on phones
  crowdOpts.rain = () => weather.rain;
  player.onSplash = big => audio.splash(big); player.onStroke = () => audio.stroke();
  const vehOpts = { audio, slip: () => weather.slip(), onImpact: s => { shake = Math.min(.6, shake + s * .025); if (taxi) taxi.onImpact(s); } };
  const vehicles = NB.createVehicles(scene, world, vehOpts);
  // gulls, pigeons, dogs, crabs and dolphins
  const animals = NB.createAnimals(scene, world, { crowd, vehicles, player, audio, say: (p, t) => say(p, t), flash: (t, s) => flashTip(t, s), onBite: d => { heroDamage(d); flashTip('Собака кусается!', 1.4); } });
  crowdOpts.onPanic = (x, z, r) => animals.scare(x, z, r);
  const carLimits = () => lowCrowd() ? { traffic: 6, carRange: 90, patrols: 1 } : { traffic: 12, carRange: 130, patrols: 2 };
  let shake = 0, promptCar = null, edgeT = 0;
  const carCam = { x: 0, y: 0, z: 0, heading: 0, speed: 0, camDist: 7.2, camH: 1.7 };
  function toggleCar() {
    const car = vehicles.driving;
    if (car) {
      if (vehicles.exit(player)) {
        player.inCar = false; player.m.root.visible = true; player.blob.visible = true;
        document.body.classList.remove('driving'); rig.snap(player);
      } else flashTip(car.model.heli ? 'Сначала приземлитесь' : 'Сначала остановитесь', 1.5);
    } else if (promptCar) {
      const wasDriven = !!promptCar.ai || !!promptCar.pursuit || !!promptCar.goto || !!promptCar.autopilot, isPolice = !!promptCar.police, isAmb = !!promptCar.ems;
      const ej = vehicles.enter(promptCar, player);
      if (ej) { if (ej.cop || isPolice) crowd.spawnCop(0, 0, 0, 0, 0, 0, ej.x, ej.z); else crowd.ejectDriver(ej.x, ej.z, ej.h); }
      if (isPolice) police.reportCrime('copcar', player.x, player.z); else if (wasDriven) police.reportCrime('carjack', player.x, player.z);
      if (isAmb && player.hp < 100) { player.hp = 100; flashTip('Аптечка скорой: здоровье восстановлено', 2.4); }
      player.inCar = true; player.m.root.visible = false; player.blob.visible = false;
      document.body.classList.add('driving');
      showDistrict(promptCar.model.name);
      if (promptCar.model.heli) flashTip(input.touch ? 'ВПЕРЁД / НАЗАД, джойстик — поворот, ВВЕРХ / ВНИЗ — высота. Лопасти раскручиваются…'
        : 'W / S — вперёд и назад · A / D — поворот · Пробел — вверх · Shift — вниз. Лопасти раскручиваются…', 5);
      $('carName').textContent = promptCar.model.name;
    }
  }

  /* ---------- fights and the police ---------- */
  let respawnT = 0, endKind = '', vignette = 0;
  const places = world.places;
  const police = NB.createPolice(world, {
    crowd, vehicles, flash: (t, s) => flashTip(t, s),
    onWanted: (n, prev) => { if (n > prev) audio.starUp(); if (n > 0 && prev === 0) flashTip(n === 1 ? 'Полиция это видела!' : 'Полиция открыла на вас охоту!', 2.2); },
    onBust: () => endLife('busted'),
    disguised: () => progress.outfit === 'cop'
  });
  const combat = NB.createCombat(scene, world, { crowd, vehicles, player, audio, police, flash: (t, s) => flashTip(t, s), onPlayerHit: d => heroDamage(d), onCash: n => addMoney(n, 'Подобрано'),
    targets: () => places.current && places.current.targets, quiet: () => !!(places.current && places.current.quiet && places.current.quiet()) });

  /* ---------- money, armour and the saved game ---------- */
  const progress = { money: 150, armor: 0, inv: null, villa: false, outfit: 'hawaii', prevOutfit: 'hawaii', records: {}, bankT: 0, garage: [], time: 0 };
  try { Object.assign(progress, JSON.parse(localStorage.getItem('nb_save') || '{}')); } catch (e) {}
  progress.money = Math.max(0, Math.floor(+progress.money || 0)); progress.armor = U.clamp(+progress.armor || 0, 0, 100);
  if (!progress.records || typeof progress.records !== 'object') progress.records = {};
  if (!Array.isArray(progress.garage)) progress.garage = [];
  combat.load(progress.inv);
  player.setOutfit(progress.outfit);
  let saveT = 0;
  function saveProgress() {
    progress.garage = garageCars();
    const { money, villa, outfit, prevOutfit, records, bankT, garage } = progress;
    try { localStorage.setItem('nb_save', JSON.stringify({ money, armor: Math.round(progress.armor), inv: combat.inv, villa, outfit, prevOutfit, records, bankT, garage, time: Math.round(time) })); } catch (e) {}
    saveT = 0;
  }
  // cars standing in the villa garage are kept between visits
  function garageCars() {
    const G = places.garage; if (!G || !progress.villa) return [];
    const r = G.rect;
    return vehicles.cars.filter(c => !c.ai && c.driver !== 'player' && c.x > r.x0 && c.x < r.x1 && c.z > r.z0 && c.z < r.z1).slice(0, 2)
      .map(c => ({ id: c.model.id, color: c.color, accent: c.accent, x: +c.x.toFixed(2), z: +c.z.toFixed(2), h: +c.h.toFixed(3) }));
  }
  if (progress.villa) for (const g of progress.garage) vehicles.spawnParked(g.id, g.x, g.z, g.h, g.color, g.accent);
  addEventListener('pagehide', saveProgress);
  let popTimer = 0;
  function moneyPop(text, sub, neg) {
    const el = $('moneyPop');
    el.textContent = text; if (sub) { const s = document.createElement('small'); s.textContent = sub; el.appendChild(s); }
    el.className = neg ? 'neg' : ''; void el.offsetWidth; el.className = (neg ? 'neg ' : '') + 'on';
    clearTimeout(popTimer); popTimer = setTimeout(() => { el.className = ''; }, 2300);
  }
  function addMoney(n, sub) { if (n <= 0) return; progress.money += n; audio.cash(n >= 100); moneyPop('+$' + n, sub); saveProgress(); }
  function spend(n, sub) { n = Math.min(n, progress.money); if (n <= 0) return 0; progress.money -= n; moneyPop('−$' + n, sub, true); saveProgress(); return n; }

  Object.assign(crowdOpts, {
    onKill: (p, src) => {
      combat.bloodPool(p.x, p.y, p.z); audio.scream([p.x, 1, p.z]);
      if (src.byPlayer) {
        police.reportCrime(p.cop ? 'copKill' : 'kill', p.x, p.z);
        if (!p.medic && (p.cop || Math.random() < .7)) combat.dropCash(p.x, p.z, p.cop ? 40 + (Math.random() * 40 | 0) : 5 + (Math.random() * 40 | 0));
      }
    },
    // knocked out: sometimes a few dollars fall out of their pockets
    onDown: (p, src) => { if (src.byPlayer && !p.medic && Math.random() < .5) combat.dropCash(p.x, p.z, 3 + (Math.random() * 25 | 0)); },
    onHurt: (p, src) => { if (src.byPlayer && p.cop && src.kind !== 'car') police.reportCrime('copAttack', p.x, p.z); },
    onCopShoot: p => combat.copShoot(p, police.wanted),
    onHitPlayer: dmg => { heroDamage(dmg); audio.punch(null); },
    onBustTick: dt => { if (!player.inCar || vehicles.speedKmh() < 5) police.bustTick(dt); },
    onScream: p => audio.scream([p.x, 1.6, p.z]),
    onGroan: p => audio.groan([p.x, .4, p.z])
  });
  const sea = NB.createSeaLife(world, { vehicles, audio, police, player, flash: (t, s) => flashTip(t, s),
    onBoat: () => !!(vehicles.driving && vehicles.driving.model.boat), onWater: () => !!(player.swim || (vehicles.driving && vehicles.driving.model.boat)),
    target: () => ({ x: player.x, z: player.z, vx: player.vx, vz: player.vz }) });
  const fire = NB.createFireService(world, { crowd, vehicles, scene, say: (p, t) => say(p, t), flash: (t, s) => flashTip(t, s) });
  const ems = NB.createEMS(world, {
    crowd, vehicles, say: (p, t) => say(p, t),
    onDispatch: u => { if (Math.hypot(u.patient.x - player.x, u.patient.z - player.z) < 45) flashTip('Скорая выехала на вызов', 2); }
  });
  Object.assign(vehOpts, {
    onHeroHit: v => heroDamage(v * 2.2),
    onFlood: () => { audio.engineOn(false); flashTip('Машина заглохла в воде — выплывайте (F)', 2.6); },
    // two officers get out; if the hero is inside the building by the car, they go in through the front door
    onExplode: (x, y, z, blame, car) => {
      const d = Math.hypot(player.x - x, player.z - z);
      shake = Math.min(.9, shake + Math.max(0, 1 - d / 45) * .9);
      for (const p of crowd.people.slice()) {
        const dp = Math.hypot(p.x - x, p.z - z);
        if (dp < 7 && !p.dead && Math.abs(p.y - y) < 3) crowd.damage(p, 150 * (1 - dp / 7) + 25, { byPlayer: blame, kind: 'explosion', x, z });
      }
      if (car === vehicles.driving) { leaveCar(); heroDamage(250); }
      else if (d < 7 && Math.abs(player.y - y) < 3) heroDamage(90 * (1 - d / 7) + 10);
      crowd.panic(x, z, 40, blame);
      if (blame) police.reportCrime('shoot', x, z);
    },
    onCarFire: () => flashTip('Машина горит! Выходите, пока не взорвалась (F)', 3),
    onCopsExit: car => {
      const rx = -Math.cos(car.h), rz = Math.sin(car.h), pl = places.current, door = pl && pl.door;
      const inside = door && pl.copEntry && Math.hypot(car.x - door.x, car.z - door.z) < 30;
      car.crew = 0; car.waitT = 0;
      for (const s of [-1, 1]) {
        const p = inside ? crowd.spawnCop(0, 0, 0, 0, 0, 0, pl.copEntry.x + s * .6, pl.copEntry.z)
          : crowd.spawnCop(0, 0, 0, 0, 0, 0, car.x + rx * s * (car.model.w / 2 + .8), car.z + rz * s * (car.model.w / 2 + .8));
        if (p) { p.unit = car; p.unitSide = s; car.crew++; }
      }
    }
  });

  /* ---------- jobs and shopping ---------- */
  const taxi = NB.createTaxi(scene, world, { crowd, vehicles, audio, police, flash: (t, s) => flashTip(t, s), onPay: (n, note) => addMoney(n, note || 'Поездка на такси') });
  const shop = NB.createShop(scene, world, {
    combat, audio, police, flash: (t, s) => flashTip(t, s),
    getMoney: () => progress.money, spend: n => spend(n, 'Покупка'),
    getArmor: () => progress.armor, setArmor: v => { progress.armor = v; }
  });

  /* ---------- places: doors, interiors, and the things to do in them ---------- */
  function setOutfit(id) { progress.outfit = id; player.setOutfit(id); saveProgress(); }
  // a short blink to black, then the hero is somewhere else (through a door, up a lift)
  let fading = false, drunkT = 0;
  function blink(fn) {
    if (fading) return; fading = true;
    $('fade').classList.add('on'); input.reset();
    setTimeout(() => { fn(); $('fade').classList.remove('on'); fading = false; }, 240);
  }
  function teleport(x, z, heading, place, title, y) {
    blink(() => {
      if (places.current && places.current !== place && places.current.onLeave) places.current.onLeave();
      places.current = place || null;
      player.place(x, z, heading); if (y != null) player.y = y;
      player.vx = player.vz = 0; rig.snap(player); places.disarm();
      if (title) showDistrict(title);
    });
  }
  function enterPlace(p) { teleport(p.inside.x, p.inside.z, p.inside.heading, p, p.name); }
  function exitPlace(p) { const d = p.door; teleport(d.x + d.nx * .9, d.z + d.nz * .9, d.heading, null, world.districtAt(d.x, d.z)); }
  function leavePlace() { if (places.current && places.current.onLeave) places.current.onLeave(); places.current = null; }
  // a night's sleep: time jumps to the next morning (or to the evening if it's already day), full health, saved
  function sleep(msg) {
    blink(() => {
      const h = ((START_MIN + time) / 60) % 24, target = h >= 6 && h < 18 ? 20 : 8;
      time += ((target - h + 24) % 24) * 60;
      player.hp = 100; saveProgress(); flashTip(msg + ' Сейчас ' + String(target).padStart(2, '0') + ':00', 3);
    });
  }
  const ui = NB.createUI({
    money: { get: () => progress.money, spend: (n, note) => { if (progress.money < n) { audio.deny(); return false; } spend(n, note); return true; }, add: (n, note) => addMoney(n, note) },
    audio, progress, save: saveProgress, setOutfit,
    onOpen: () => { if (state === 'playing') { state = 'panel'; input.reset(); if (document.pointerLockElement) document.exitPointerLock(); show('panelOnly'); } },
    onClose: () => { if (state === 'panel') play(); }
  });
  const wallet = { get: () => progress.money, spend: (n, note) => { if (progress.money < n) { audio.deny(); flashTip('Не хватает денег: нужно $' + n, 2); return false; } spend(n, note); return true; }, add: (n, note) => addMoney(n, note) };
  // the spray shop and the street: food carts, buskers, surfers, volleyball
  world.spray.attach({ vehicles, police, player, audio, money: wallet, flash: (t, s) => flashTip(t, s), blink: fn => blink(fn) });
  world.street.attach({ rain: () => weather.rain, police, hour: () => ((START_MIN + time) / 60) % 24,
    room: fn => blink(() => { time += 60; const d = places.byId('hotel').door; player.place(d.x + d.nx * 1.2, d.z - 1.5, d.heading); rig.snap(player); fn(); }),
    crowd, player, vehicles, audio, money: wallet, flash: (t, s) => flashTip(t, s), say: (p, t) => say(p, t) });
  places.attach({
    player, combat, crowd, police, audio, vehicles, progress, ui,
    money: { get: () => progress.money, spend: (n, note) => { if (progress.money < n) { audio.deny(); flashTip('Не хватает денег: нужно $' + n, 2); return false; } spend(n, note); return true; }, add: (n, note) => addMoney(n, note) },
    flash: (t, s) => flashTip(t, s), save: saveProgress, setOutfit, sleep, teleport, drunk: s => { drunkT = s; },
    getArmor: () => progress.armor, setArmor: v => { progress.armor = v; saveProgress(); },
    openShop: () => { if (shop.canServe()) openShop(); }
  });
  // the nearest thing to use (F / the action button), if any
  let interact = null;
  function findInteraction() {
    interact = null;
    if (vehicles.driving || player.dead || respawnT > 0) return;
    let bd = Infinity;
    const list = places.current ? places.interactions() : places.interactions().concat(world.spray.interactions(), world.street.interactions(), animals.interactions(player));
    for (const it of list) {
      if (Math.abs(player.y - (it.y || 0)) > 2.2) continue;
      const d = Math.hypot(player.x - it.x, player.z - it.z);
      if (d > it.r || d >= bd) continue;
      const label = it.label(); if (!label) continue;
      bd = d; interact = { it, label };
    }
  }
  function heroDamage(d) {
    if (player.dead || respawnT > 0) return;
    if (progress.armor > 0) { const a = Math.min(progress.armor, d); progress.armor -= a; d -= a; }   // the vest takes the hit first
    player.hp = Math.max(0, player.hp - d); vignette = Math.min(1, vignette + (d > 0 ? .45 : .2)); audio.hurt();
    if (player.hp <= 0) endLife('wasted');
  }
  function leaveCar() {
    if (!vehicles.driving) return;
    vehicles.exit(player, true);
    player.inCar = false; player.m.root.visible = true; document.body.classList.remove('driving');
  }
  let bill = 0;
  function endLife(kind) {
    if (respawnT > 0) return;
    respawnT = 3.6; endKind = kind;
    // the hospital charges for treatment, the police fine you more the more stars you had
    bill = kind === 'wasted' ? 100 : 100 * Math.max(1, police.wanted);
    input.reset(); leaveCar();
    if (kind === 'wasted') { player.dead = true; player.deadT = 0; }
    audio.sting(kind);
    $('bigmsg').textContent = kind === 'wasted' ? 'Потрачено' : 'Арестован'; $('bigmsg').className = 'on ' + kind;
  }
  function respawn() {
    const busted = endKind === 'busted', st = world.station;
    const hs = world.hospital;
    if (busted && st) player.place(st.x, st.z, st.heading); else if (hs) player.place(hs.x, hs.z, hs.heading); else player.place(world.spawn.x, world.spawn.z, world.spawn.heading);
    player.dead = false; player.deadT = 0; player.hp = 100; player.m.root.rotation.x = 0; player.aimT = 0;
    if (busted) combat.onBust(); else combat.onDeath();
    progress.armor = 0;
    // you wake up outside, whatever building you were in; the uniform is taken away
    leavePlace(); places.disarm();
    if (progress.outfit === 'cop') setOutfit(progress.prevOutfit || 'hawaii');
    police.clear(); rig.snap(player);
    $('bigmsg').className = '';
    const paid = spend(bill, busted ? 'Штраф' : 'Лечение');
    flashTip(busted ? 'Вас отпустили из участка' + (paid ? ', штраф $' + paid : '') + '. Оружие изъято.'
      : 'Вас подлатали в больнице' + (paid ? ' за $' + paid : '') + '. Половина патронов потеряна.', 3.4);
    saveProgress();
  }
  // where the hero is aiming: a person near the crosshair (desktop) or the best target in front (touch), else what the camera looks at
  const camDir = new THREE.Vector3(), aimV = new THREE.Vector3();
  let aimTarget = null;
  function computeAim() {
    aimTarget = null;
    if (vehicles.driving || player.dead || player.swim) return null;
    camera.getWorldDirection(camDir);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, gun = !combat.isMelee(), touch = input.touch;
    let best = null, bestScore = Infinity;
    if (gun) for (const p of crowd.people) {
      if (p.dead || p.down || p.anim === 'lie') continue;
      const dp = Math.hypot(p.x - player.x, p.z - player.z);
      if (dp > (touch ? 26 : 60) || dp < .4) continue;
      const tx = p.x - cx, ty = p.y + 1.25 * p.look.hs - cy, tz = p.z - cz, L = Math.hypot(tx, ty, tz);
      const ang = Math.acos(Math.min(1, (tx * camDir.x + ty * camDir.y + tz * camDir.z) / L));
      if (ang > (touch ? .75 : .06)) continue;
      let score = touch ? ang * 20 + dp : ang;
      if (touch && police.wanted > 0 && p.cop) score -= 15;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    if (best) {
      const sx = player.x, sy = player.y + 1.4, sz = player.z, ex = best.x, ey = best.y + 1.25 * best.look.hs, ez = best.z, L = Math.hypot(ex - sx, ey - sy, ez - sz);
      if (world.col.raycast(sx, sy, sz, (ex - sx) / L, (ey - sy) / L, (ez - sz) / L, L) < L - .4) best = null;
    }
    if (best) { aimTarget = best; aimV.set(best.x, best.y + 1.25 * best.look.hs, best.z); }
    else {
      let t = world.col.raycast(cx, cy, cz, camDir.x, camDir.y, camDir.z, 90);
      if (camDir.y < -1e-3) t = Math.min(t, -cy / camDir.y);
      aimV.set(cx + camDir.x * t, cy + camDir.y * t, cz + camDir.z * t);
    }
    if (gun && (input.fire || input.aim)) player.aimT = Math.max(player.aimT, .5);
    if (player.aimT > 0) {
      player.aimYaw = Math.atan2(aimV.x - player.x, aimV.z - player.z);
      player.aimPitch = U.clamp(Math.atan2(aimV.y - (player.y + 1.4), Math.hypot(aimV.x - player.x, aimV.z - player.z)), -.9, .9);
    }
    return aimV;
  }

  /* ---------- quality ---------- */
  let scale = 1, shadowsOn = true, autoMax = 1;
  function setScale(s) { scale = s; renderer.setPixelRatio(s); renderer.setSize(innerWidth, innerHeight, false); }
  function setShadows(on) { shadowsOn = on; sun.castShadow = on; if (on) renderer.shadowMap.needsUpdate = true; }
  function applyQuality() {
    const dpr = window.devicePixelRatio || 1, q = settings.quality;
    let far;
    if (q === 'high') { setScale(Math.min(dpr, 1.5)); setShadows(true); far = 300; }
    else if (q === 'low') { setScale(Math.min(dpr, 1) * .7); setShadows(false); far = 180; }
    // auto: start at full size; a phone with a sharp screen may go a little above it while the frame rate allows
    else { autoMax = isTouchDevice ? Math.min(dpr, 1.3) : Math.min(dpr, 1); setScale(Math.min(dpr, 1)); setShadows(!isTouchDevice); far = 250; }
    scene.fog.near = far * .28; scene.fog.far = far; fogNear0 = far * .28; fogFar0 = far; camera.far = far + 60; camera.updateProjectionMatrix();
    sky.scale.setScalar(camera.far * .9 / 480);   // keep the sky dome inside the far clipping plane
    world.setFog(scene.fog.near, scene.fog.far);
    document.querySelectorAll('[data-q]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.q === q)));
  }
  let perfT = 0, perfN = 0, good = 0;
  function adapt(raw) {
    if (settings.quality !== 'auto') return;
    perfT += raw; perfN++;
    if (perfT < 1.5) return;
    const fps = perfN / perfT; perfT = 0; perfN = 0;
    if (fps < 45) {
      good = 0;
      if (shadowsOn) setShadows(false);
      else if (scale > .8) setScale(Math.max(.75, scale - .1));
    } else if (fps > 57) {
      if (++good >= 3 && scale < autoMax) { good = 0; setScale(Math.min(autoMax, scale + .1)); }
    } else good = 0;
  }
  function onResize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.fov = innerHeight > innerWidth ? 75 : 62;
    camera.updateProjectionMatrix();
    $('portrait').hidden = !(document.body.classList.contains('touch') && innerHeight > innerWidth && state === 'playing');
    sizeMap();
  }
  addEventListener('resize', onResize);

  /* ---------- game state ---------- */
  let state = 'menu', locked = false, everLocked = false, noLock = false, time = Math.max(0, +progress.time || 0);   // the clock carries on from the last visit
  const input = NB.createInput(canvas, {
    active: () => state === 'playing',
    locked: () => locked,
    requestLock: lock,
    onEscape: () => { if (!locked) pause(); },
    onZoom: s => { rig.dist = U.clamp(rig.dist + s * .6, 2.6, 9); },
    onMute: () => toggleMute(),
    onMap: () => openMap(),
    onMode: () => onResize()
  });

  function lock() {
    if (noLock || input.touch) return;
    try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(lockFailed); } catch (e) { lockFailed(); }
  }
  function lockFailed() { if (!everLocked) noLock = true; }
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (locked) everLocked = true;
    else if (state === 'playing' && !input.touch && !noLock) pause();
  });
  document.addEventListener('pointerlockerror', lockFailed);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  function show(which) {
    $('menu').hidden = which !== 'menu'; $('pause').hidden = which !== 'pause'; $('hud').hidden = which !== 'hud'; $('shop').hidden = which !== 'shop';
    document.body.classList.toggle('playing', which === 'hud');
  }
  function fullscreen() {
    const el = document.documentElement;
    try {
      const p = (el.requestFullscreen || el.webkitRequestFullscreen || (() => null)).call(el);
      if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }).catch(() => {});
    } catch (e) {}
  }
  let firstPlay = true;
  function play() {
    state = 'playing'; show('hud'); input.reset(); audio.init();
    if (input.touch) { if (!document.fullscreenElement) fullscreen(); } else lock();
    if (firstPlay) {
      firstPlay = false;
      flashTip(input.touch ? 'Левый палец — ходьба · правый — камера · у машины появится кнопка «СЕСТЬ»'
        : 'WASD — идти · ЛКМ — удар/огонь · ПКМ — прицел · Q — оружие · F — машина · Esc — пауза', 10);
      showDistrict(world.districtAt(player.x, player.z));
    }
    onResize();
  }
  function pause() {
    saveProgress();
    if (state !== 'playing') return;
    state = 'paused'; input.reset(); show('pause');
    if (document.pointerLockElement) document.exitPointerLock();
  }
  // the gun shop counter: the city waits while you shop
  function openShop() {
    state = 'shop'; input.reset(); shop.open(); show('shop');
    if (document.pointerLockElement) document.exitPointerLock();
    audio.door();
    setTimeout(() => { const b = document.querySelector('#shopList .buy:not(:disabled)'); if (b && !input.touch) b.focus({ preventScroll: true }); }, 0);
  }
  function closeShop() { if (state !== 'shop') return; saveProgress(); play(); }
  $('shopClose').addEventListener('click', closeShop);
  addEventListener('keydown', e => { if (state === 'shop' && e.code === 'Escape') { e.preventDefault(); closeShop(); } });
  $('playBtn').addEventListener('click', play);
  $('resumeBtn').addEventListener('click', play);
  $('btnPause').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); pause(); });
  $('fsBtn').addEventListener('click', fullscreen);
  $('fsBtn2').addEventListener('click', fullscreen);
  document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => { settings.quality = b.dataset.q; save(); applyQuality(); }));
  for (const id of ['sens', 'sens2']) $(id).addEventListener('input', e => setSens(+e.target.value));
  function setSens(v) {
    settings.sens = v; save();
    for (const [i, o] of [['sens', 'sensOut'], ['sens2', 'sensOut2']]) { $(i).value = v; $(o).textContent = v.toFixed(2); }
  }
  setSens(settings.sens);
  // sound: a volume slider in the menus, a speaker button in the HUD and the M key; remembered between visits
  function applySound() {
    const on = !settings.muted && settings.volume > 0;
    audio.setVolume(settings.muted ? 0 : settings.volume);
    for (const [i, o, b] of [['vol', 'volOut', 'muteBtn'], ['vol2', 'volOut2', 'muteBtn2']]) {
      $(i).value = settings.volume; $(o).textContent = settings.muted ? 'выкл' : Math.round(settings.volume * 100) + '%';
      $(b).textContent = on ? 'Выключить' : 'Включить';
    }
    $('btnSound').classList.toggle('muted', !on);
    $('btnSound').setAttribute('aria-label', on ? 'Выключить звук' : 'Включить звук');
  }
  function toggleMute() {
    if (settings.muted || settings.volume <= 0) { settings.muted = false; if (settings.volume <= 0) settings.volume = .8; }
    else settings.muted = true;
    save(); applySound();
    if (state === 'playing') flashTip(settings.muted ? 'Звук выключен · M — включить' : 'Звук включён', 1.6);
  }
  for (const id of ['vol', 'vol2']) $(id).addEventListener('input', e => { settings.volume = +e.target.value; settings.muted = false; save(); applySound(); });
  for (const id of ['muteBtn', 'muteBtn2']) $(id).addEventListener('click', toggleMute);
  $('btnSound').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); toggleMute(); });
  applySound();

  /* ---------- HUD ---------- */
  let tipTimer = 0, hudHeli = false;
  function flashTip(text, sec) { $('tip').textContent = text; $('tip').classList.add('on'); clearTimeout(tipTimer); tipTimer = setTimeout(() => $('tip').classList.remove('on'), sec * 1000); }
  let district = '', districtT = 0, hudT = 0;
  function showDistrict(name) { district = name; $('district').textContent = name; $('district').classList.add('on'); districtT = 3.2; }
  const mapCv = $('map'), mapCtx = mapCv.getContext('2d');
  let mapPx = 150;
  function sizeMap() {
    mapPx = mapCv.clientWidth || 150;
    const r = Math.min(window.devicePixelRatio || 1, 2);
    mapCv.width = Math.round(mapPx * r); mapCv.height = Math.round(mapPx * r);
  }
  function drawMap() {
    const g = mapCtx, W = mapCv.width, Rr = W / 2, M = world.map, pxPerM = W / 120;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, W);
    if (places.current) {   // indoors the map just says where you are
      g.fillStyle = '#1a1226'; g.beginPath(); g.arc(Rr, Rr, Rr - 1, 0, 7); g.fill();
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,241,228,.6)'; g.font = `700 ${Math.round(W * .075)}px Rubik, sans-serif`; g.fillText('ВНУТРИ', Rr, Rr - W * .14);
      g.fillStyle = '#fff1e4'; g.font = `800 ${Math.round(W * .09)}px Rubik, sans-serif`;
      const words = places.current.name.split(' '), half = Math.ceil(words.length / 2);
      if (words.length > 2) { g.fillText(words.slice(0, half).join(' '), Rr, Rr + W * .02); g.fillText(words.slice(half).join(' '), Rr, Rr + W * .13); } else g.fillText(places.current.name, Rr, Rr + W * .04);
      g.strokeStyle = 'rgba(255,241,228,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(Rr, Rr, Rr - 1, 0, 7); g.stroke();
      return;
    }
    g.save(); g.beginPath(); g.arc(Rr, Rr, Rr - 1, 0, 7); g.clip();
    g.fillStyle = '#2a2140'; g.fillRect(0, 0, W, W);
    g.translate(Rr, Rr); g.rotate(rig.yaw); g.scale(pxPerM / M.s, pxPerM / M.s);
    g.drawImage(M.canvas, -(player.x - M.x0) * M.s, -(player.z - M.z0) * M.s);
    // taxi route along the streets
    const route = taxi.route;
    if (route.length > 1) {
      const k = M.s / pxPerM;
      g.lineJoin = g.lineCap = 'round';
      g.beginPath(); route.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo']((x - player.x) * M.s, (z - player.z) * M.s));
      g.strokeStyle = 'rgba(30,18,40,.8)'; g.lineWidth = W * .05 * k; g.stroke();
      g.strokeStyle = '#ffd84f'; g.lineWidth = W * .026 * k; g.stroke();
    }
    g.restore();
    // north marker
    const nr = Rr - W * .08, nx = Rr + Math.sin(rig.yaw) * nr, ny = Rr - Math.cos(rig.yaw) * nr;
    g.font = `700 ${Math.round(W * .085)}px Rubik, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff1e4'; g.fillText('С', nx, ny);
    // player arrow
    g.save(); g.translate(Rr, Rr); g.rotate(rig.yaw + Math.PI - player.heading);
    const a = W * .055; g.fillStyle = '#ff4fa3'; g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, W / 120);
    g.beginPath(); g.moveTo(0, -a * 1.3); g.lineTo(a, a); g.lineTo(0, a * .45); g.lineTo(-a, a); g.closePath(); g.fill(); g.stroke();
    g.restore();
    const cs = Math.cos(rig.yaw), sn = Math.sin(rig.yaw);
    const toMap = (wx, wz, clampEdge) => {
      const rx = (wx - player.x) * pxPerM, rz = (wz - player.z) * pxPerM;
      let sx = rx * cs - rz * sn, sy = rx * sn + rz * cs; const d = Math.hypot(sx, sy), lim = Rr - W * .08;
      if (d > lim) { if (!clampEdge) return null; sx *= lim / d; sy *= lim / d; }
      return [Rr + sx, Rr + sy];
    };
    const dot = (p, r, c) => { if (!p) return; g.fillStyle = c; g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.fill(); };
    for (const pk of combat.pickups) if (pk.active) dot(toMap(pk.x, pk.z), W * .02, pk.type === 'health' ? '#ff4f6a' : '#ffd84f');
    for (const c of combat.cashDrops) if (c.active) dot(toMap(c.x, c.z), W * .018, '#6bff8a');
    if (police.wanted > 0) {
      for (const p of crowd.people) if (p.cop && !p.dead) dot(toMap(p.x, p.z), W * .025, '#4f8cff');
      for (const c of vehicles.cars) if (c.pursuit) { const q = toMap(c.x, c.z); if (q) { g.fillStyle = (time * 4 | 0) % 2 ? '#ff3355' : '#4f8cff'; g.fillRect(q[0] - W * .03, q[1] - W * .03, W * .06, W * .06); } }
    }
    for (const u of ems.units) { const q = toMap(u.car.x, u.car.z); if (q) { g.fillStyle = u.car.sirenOn && (time * 4 | 0) % 2 ? '#ff3344' : '#ffffff'; g.fillRect(q[0] - W * .028, q[1] - W * .028, W * .056, W * .056); } }
    if (world.hospital) {
      const q = toMap(world.hospital.cx, world.hospital.cz, true);
      dot(q, W * .06, '#ffffff'); g.fillStyle = '#e02a2a'; g.fillRect(q[0] - W * .012, q[1] - W * .04, W * .024, W * .08); g.fillRect(q[0] - W * .04, q[1] - W * .012, W * .08, W * .024);
    }
    if (world.station) {
      const q = toMap(world.station.cx, world.station.cz, true);
      dot(q, W * .06, '#2f5fb0'); g.fillStyle = '#fff'; g.font = `800 ${Math.round(W * .075)}px Rubik, sans-serif`; g.fillText('П', q[0], q[1] + 1);
    }
    if (world.club) {
      // pink disc with "21" for the club
      const q = toMap(world.club.center.x, world.club.center.z, true);
      dot(q, W * .065, '#ff4fa3'); g.fillStyle = '#fff'; g.font = `800 ${Math.round(W * .062)}px Rubik, sans-serif`; g.fillText('21', q[0], q[1] + 1);
    }
    if (shop.place) {
      // orange disc with a little pistol
      const q = toMap(shop.place.cx, shop.place.cz, true), u = W * .012;
      dot(q, W * .06, '#ff8a3d'); g.fillStyle = '#2a1405';
      g.fillRect(q[0] - 3 * u, q[1] - 1.6 * u, 5.4 * u, 1.6 * u); g.fillRect(q[0] - 3 * u, q[1] - .2 * u, 1.6 * u, 2.6 * u);
    }
    // places you can go into: a letter on a coloured disc; the villa always shows at the edge
    const icon = (x, z, bg, fg, ch, edge) => { const q = toMap(x, z, edge); if (!q) return; dot(q, W * .05, bg); g.fillStyle = fg; g.font = `800 ${Math.round(W * .058)}px Rubik, sans-serif`; g.fillText(ch, q[0], q[1] + 1); };
    for (const [id, bg, ch] of [['bank', '#1a8a5a', '$'], ['casino', '#c9a04a', '♦'], ['arcade', '#8a5ad8', '★'], ['diner', '#e0286a', 'D'], ['hotel', '#2fa8a0', 'H']]) {
      const p = places.byId(id); if (p && p.door) icon(p.door.cx, p.door.cz, bg, '#fff', ch, false);
    }
    icon(123, 95, progress.villa ? '#ffffff' : '#ff7eb6', progress.villa ? '#e0286a' : '#fff', progress.villa ? '⌂' : '$', true);
    icon(places.tiki.x, places.tiki.z, '#a8743c', '#fff', 'T', false);
    icon(world.spray.center.x, world.spray.center.z, '#b06bff', '#fff', '✎', police.wanted > 0);
    if (world.fireStation) icon(world.fireStation.center.x, world.fireStation.center.z, '#e0483a', '#fff', '🔥', false);   // with stars on, the spray shop shows at the edge
    // taxi: the waiting fare blinks, the destination is a ring that sticks to the edge when far away
    for (const m of taxi.markers) {
      const q = toMap(m.x, m.z, true);
      if (m.kind === 'fare') { if ((time * 3 | 0) % 2 === 0) dot(q, W * .045, '#ffd84f'); dot(q, W * .022, '#2a1c05'); }
      else { dot(q, W * .055, '#ffd84f'); dot(q, W * .03, '#2a1c05'); dot(q, W * .016, '#ffd84f'); }
    }
    g.strokeStyle = 'rgba(255,241,228,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(Rr, Rr, Rr - 1, 0, 7); g.stroke();
  }
  /* ---------- the full-screen map (tap the minimap, or Tab) ---------- */
  const bm = { cv: $('bigmapCv'), open: false, sc: 1, cx: 217, cz: 0, drag: null, ptrs: new Map(), pinch: 0 };
  const bmG = bm.cv.getContext('2d');
  const BM_LABELS = [['Даунтаун', 0, 0], ['Коралловая полоса', 79, -30], ['Пальм-Хайтс', -79, 60], ['Старая гавань', -79, -60], ['Рынок Флорес', 0, -79], ['Мятный квартал', 0, 79],
    ['Пляж Санрайз', 124, 12], ['Залив Неон-Бэй', 245, 40], ['Мост Неон-Бэй', 230, -112], ['Старфиш-Хайтс', 425, 38], ['Вайс-Пойнт', 425, -22], ['Мыс Маяка', 492, 30], ['Остров Палм', 430, 102], ['Открытое море', -180, 0], ['Открытое море', 200, 200], ['Открытое море', 200, -200]];
  // everything worth finding, with the same look as on the minimap
  function mapIcons() {
    const out = [], P = id => places.byId(id);
    const add = (x, z, bg, fg, ch, label) => out.push({ x, z, bg, fg, ch, label });
    if (world.hospital) add(world.hospital.cx, world.hospital.cz, '#ffffff', '#e02a2a', '✚', 'Больница');
    if (world.station) add(world.station.cx, world.station.cz, '#2f5fb0', '#fff', 'П', 'Полиция');
    if (shop.place) add(shop.place.cx, shop.place.cz, '#ff8a3d', '#2a1405', '⌐', 'Оружие Ammo Bay');
    if (world.club) add(world.club.center.x, world.club.center.z, '#ff4fa3', '#fff', '21', 'Клуб NEPLOXO 21');
    for (const [id, bg, ch, label] of [['bank', '#1a8a5a', '$', 'Банк'], ['casino', '#c9a04a', '♦', 'Казино'], ['arcade', '#8a5ad8', '★', 'Игровые автоматы'], ['diner', '#e0286a', 'D', 'Закусочная'], ['hotel', '#2fa8a0', 'H', 'Отель OCEAN']]) { const p = P(id); if (p && p.door) add(p.door.cx, p.door.cz, bg, '#fff', ch, label); }
    add(123, 95, progress.villa ? '#ffffff' : '#ff7eb6', progress.villa ? '#e0286a' : '#fff', progress.villa ? '⌂' : '$', progress.villa ? 'Ваша вилла' : 'Вилла (продаётся)');
    add(places.tiki.x, places.tiki.z, '#a8743c', '#fff', 'T', 'Тики-бар');
    add(world.spray.center.x, world.spray.center.z, '#b06bff', '#fff', '✎', 'Покраска NEON SPRAY: снимает розыск');
    if (world.fireStation) add(world.fireStation.center.x, world.fireStation.center.z, '#e0483a', '#fff', '🔥', 'Пожарная часть');
    for (const c of world.street.carts) add(c.x, c.z, c.kind === 'hotdog' ? '#e8202a' : '#ff9fc3', '#fff', c.kind === 'hotdog' ? 'Х' : 'М', c.kind === 'hotdog' ? 'Хот-доги' : 'Мороженое');
    for (const b of world.street.buskers) add(b.x, b.z, '#2a2240', '#ffd84f', '♪', 'Уличный музыкант');
    add(125, -30, '#f5f0d8', '#2a6fe8', 'V', 'Пляжный волейбол');
    add(142, 46, '#3fe6e0', '#10202a', '⚓', 'Причал: катера');
    add(places.yacht.x, places.yacht.z, '#f6f2ec', '#1c2a4a', 'Я', 'Яхта LEHA NEPLOXO');
    add(510, 0, '#e02a3a', '#fff', '▲', 'Маяк');
    if (places.heliPad) add(places.heliPad.x + 7, places.heliPad.z - 7, '#6bffd0', '#10201c', 'В', 'Вертолёт (лифт в больнице)');
    if (places.towerRoof) add(places.towerRoof.cx, places.towerRoof.cz, '#10081c', '#ff4fa3', 'N', 'NEPLOXO TOWER: бассейн и вертолёт на крыше');
    return out;
  }
  const WB = world.bounds, BMW = WB.x1 - WB.x0, BMH = WB.z1 - WB.z0, BMX = (WB.x0 + WB.x1) / 2;
  function bmFit() {
    const W = bm.cv.width, H = bm.cv.height;
    bm.sc = Math.min(W / BMW, H / BMH); bm.cx = BMX; bm.cz = 0;
  }
  function bmSize() { const r = Math.min(window.devicePixelRatio || 1, 2); bm.cv.width = Math.round(innerWidth * r); bm.cv.height = Math.round(innerHeight * r); }
  function drawBigMap() {
    if (!bm.open) return;
    const g = bmG, W = bm.cv.width, H = bm.cv.height, M = world.map, sc = bm.sc, r = Math.min(window.devicePixelRatio || 1, 2);
    const sx = x => W / 2 + (x - bm.cx) * sc, sz = z => H / 2 + (z - bm.cz) * sc;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#2d6f9c'; g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = sc < M.s * 1.5;
    g.drawImage(M.canvas, sx(M.x0), sz(M.z0), M.canvas.width / M.s * sc, M.canvas.height / M.s * sc);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // district names
    g.font = `800 ${Math.round(Math.max(11, Math.min(26, sc * 4.2)) * r / Math.max(1, r * .75))}px Rubik, sans-serif`;
    for (const [name, x, z] of BM_LABELS) { g.lineWidth = 4 * r; g.strokeStyle = 'rgba(20,12,34,.75)'; g.strokeText(name, sx(x), sz(z)); g.fillStyle = '#fff1e4'; g.fillText(name, sx(x), sz(z)); }
    // the taxi route
    const route = taxi.route;
    if (route.length > 1) { g.lineJoin = g.lineCap = 'round'; g.beginPath(); route.forEach(([x, z], i) => g[i ? 'lineTo' : 'moveTo'](sx(x), sz(z))); g.strokeStyle = 'rgba(30,18,40,.8)'; g.lineWidth = 7 * r; g.stroke(); g.strokeStyle = '#ffd84f'; g.lineWidth = 3.5 * r; g.stroke(); }
    // places
    const ir = Math.max(9, Math.min(15, sc * 2.4)) * r;
    for (const ic of mapIcons()) {
      const X = sx(ic.x), Z = sz(ic.z);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(X, Z + r, ir + r, 0, 7); g.fill();
      g.fillStyle = ic.bg; g.beginPath(); g.arc(X, Z, ir, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.5 * r; g.stroke();
      g.fillStyle = ic.fg; g.font = `800 ${Math.round(ir * 1.1)}px Rubik, sans-serif`; g.fillText(ic.ch, X, Z + r);
    }
    for (const m of taxi.markers) { g.fillStyle = '#ffd84f'; g.beginPath(); g.arc(sx(m.x), sz(m.z), ir * .8, 0, 7); g.fill(); }
    // where you are (at the door of the building you're in)
    let px = player.x, pz = player.z;
    if (places.current && places.current.door) { px = places.current.door.x; pz = places.current.door.z; }
    const X = sx(px), Z = sz(pz), a = ir * 1.1;
    g.save(); g.translate(X, Z); g.rotate(Math.PI - player.heading);
    g.fillStyle = '#ff4fa3'; g.strokeStyle = '#fff'; g.lineWidth = 2 * r;
    g.beginPath(); g.moveTo(0, -a * 1.3); g.lineTo(a, a); g.lineTo(0, a * .45); g.lineTo(-a, a); g.closePath(); g.fill(); g.stroke();
    g.restore();
    if ((performance.now() / 500 | 0) % 2) { g.strokeStyle = 'rgba(255,79,163,.7)'; g.lineWidth = 2 * r; g.beginPath(); g.arc(X, Z, a * 2.2, 0, 7); g.stroke(); }
    // north arrow
    g.fillStyle = '#fff1e4'; g.font = `800 ${16 * r}px Rubik, sans-serif`; g.fillText('С ↑', W - 40 * r, 90 * r);
  }
  function openMap() {
    if (state !== 'playing' || bm.open) return;
    state = 'map'; bm.open = true; bm.t0 = performance.now(); input.reset();
    if (document.pointerLockElement) document.exitPointerLock();
    show('mapOnly'); $('bigmap').hidden = false;
    bmSize(); bmFit();
    // start centred on the hero, zoomed in a little if the whole map is tiny on screen
    const px = places.current && places.current.door ? places.current.door.x : player.x, pz = places.current && places.current.door ? places.current.door.z : player.z;
    if (bm.sc < 2.2) { bm.cx = U.clamp(px, WB.x0 + 100, WB.x1 - 100); bm.cz = U.clamp(pz, WB.z0 + 60, WB.z1 - 60); bm.sc = Math.max(bm.sc, Math.min(2.2, bm.sc * 1.6)); }
    $('bmLegend').innerHTML = mapIcons().filter((ic, i, all) => all.findIndex(o => o.label === ic.label) === i).map(ic => `<span><i style="background:${ic.bg};color:${ic.fg}">${ic.ch}</i>${ic.label}</span>`).join('');
    drawBigMap();
  }
  function closeMap() { if (!bm.open) return; bm.open = false; $('bigmap').hidden = true; play(); }
  const bmZoom = (k, fx, fy) => {
    const W = bm.cv.width, H = bm.cv.height, ns = U.clamp(bm.sc * k, Math.min(W / BMW, H / BMH) * .8, 18);
    if (fx != null) { const wx = bm.cx + (fx - W / 2) / bm.sc, wz = bm.cz + (fy - H / 2) / bm.sc; bm.cx = wx - (fx - W / 2) / ns; bm.cz = wz - (fy - H / 2) / ns; }
    bm.sc = ns; drawBigMap();
  };
  const bmXY = e => { const r = bm.cv.width / bm.cv.clientWidth; return [e.clientX * r, e.clientY * r]; };
  bm.cv.addEventListener('pointerdown', e => { bm.ptrs.set(e.pointerId, bmXY(e)); try { bm.cv.setPointerCapture(e.pointerId); } catch (err) {} });
  bm.cv.addEventListener('pointermove', e => {
    if (!bm.ptrs.has(e.pointerId)) return;
    const prev = bm.ptrs.get(e.pointerId), cur = bmXY(e); bm.ptrs.set(e.pointerId, cur);
    if (bm.ptrs.size === 2) {   // pinch to zoom
      const [a, b] = [...bm.ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (bm.pinch) bmZoom(d / bm.pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      bm.pinch = d; return;
    }
    bm.cx -= (cur[0] - prev[0]) / bm.sc; bm.cz -= (cur[1] - prev[1]) / bm.sc; drawBigMap();
  });
  const bmUp = e => { bm.ptrs.delete(e.pointerId); if (bm.ptrs.size < 2) bm.pinch = 0; };
  bm.cv.addEventListener('pointerup', bmUp); bm.cv.addEventListener('pointercancel', bmUp);
  bm.cv.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = bmXY(e); bmZoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, x, y); }, { passive: false });
  $('bmIn').addEventListener('click', () => bmZoom(1.4)); $('bmOut').addEventListener('click', () => bmZoom(1 / 1.4));
  $('bmMe').addEventListener('click', () => { bm.cx = places.current && places.current.door ? places.current.door.x : player.x; bm.cz = places.current && places.current.door ? places.current.door.z : player.z; bm.sc = Math.max(bm.sc, 3); drawBigMap(); });
  $('bmClose').addEventListener('click', closeMap);
  addEventListener('keydown', e => { if (bm.open && (e.code === 'Escape' || e.code === 'Tab') && !e.repeat && performance.now() - bm.t0 > 250) { e.preventDefault(); closeMap(); } });
  addEventListener('resize', () => { if (bm.open) { bmSize(); drawBigMap(); } });
  $('map').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); openMap(); });

  function updateHUD(dt) {
    const mins = Math.floor(START_MIN + time) % (24 * 60);
    const clock = String((mins / 60) | 0).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
    if ($('clock').textContent !== clock) $('clock').textContent = clock;
    hudT += dt;
    if (hudT > .4) { hudT = 0; const d = world.districtAt(player.x, player.z); if (d !== district) showDistrict(d); }
    if (districtT > 0) { districtT -= dt; if (districtT <= 0) $('district').classList.remove('on'); }
    const drv = vehicles.driving;
    if (drv) {
      const kmh = String(Math.round(vehicles.speedKmh())); if ($('speedNum').textContent !== kmh) $('speedNum').textContent = kmh;
      // in the helicopter: altitude next to the name
      const alt = vehicles.heliAlt(), nm = alt == null ? drv.model.name : drv.model.name + ' · ' + Math.round(alt) + ' м';
      if ($('carName').textContent !== nm) $('carName').textContent = nm;
    }
    // touch buttons read as flight controls in the helicopter
    const heli = !!(drv && drv.model.heli);
    if (heli !== hudHeli) {
      hudHeli = heli;
      const L = heli ? ['ВПЕРЁД', 'НАЗАД', 'ВВЕРХ', 'ВНИЗ'] : ['ГАЗ', 'ТОРМОЗ', 'РУЧНИК', 'БИП'];
      ['btnGas', 'btnBrake', 'btnHand', 'btnHorn'].forEach((id, i) => { $(id).textContent = L[i]; });
    }
    const promptText = input.touch || drv ? '' : interact ? 'F — ' + interact.label : promptCar ? 'F — сесть в ' + promptCar.model.name : '';
    if ($('prompt').textContent !== promptText) $('prompt').textContent = promptText;
    $('prompt').hidden = !promptText;
    const enter = $('btnEnter'), label = drv ? 'ВЫЙТИ' : interact ? interact.it.short : 'СЕСТЬ';
    enter.classList.toggle('avail', !!(drv || promptCar || interact)); if (enter.textContent !== label) enter.textContent = label;
    // health, stars, weapon, crosshair, lock-on ring, damage flash
    const hpw = Math.round(player.hp) + '%'; if ($('hpFill').style.width !== hpw) $('hpFill').style.width = hpw;
    $('hp').classList.toggle('low', player.hp <= 30);
    $('armor').hidden = progress.armor <= 0;
    const aw = Math.round(progress.armor) + '%'; if ($('armorFill').style.width !== aw) $('armorFill').style.width = aw;
    const wi = weather.info, wt = wi.icon + ' ' + wi.name; if ($('weather').textContent !== wt) $('weather').textContent = wt;
    const mt = progress.money.toLocaleString('ru-RU'); if ($('moneyNum').textContent !== mt) $('moneyNum').textContent = mt;
    const job = places.hud || taxi.hud;
    $('job').hidden = !job;
    if (job) {
      const tag = job.tag || 'ТАКСИ'; if ($('jobTag').textContent !== tag) $('jobTag').textContent = tag;
      if ($('jobText').textContent !== job.text) $('jobText').textContent = job.text;
      if ($('jobTime').textContent !== job.time) $('jobTime').textContent = job.time;
      $('job').classList.toggle('warn', job.warn);
    }
    const stars = $('stars').children, w = police.wanted;
    for (let i = 0; i < 5; i++) stars[i].classList.toggle('on', i < w);
    $('stars').classList.toggle('blink', police.searching);
    $('stars').classList.toggle('none', w === 0);
    const wp = combat.weapon, ammo = combat.ammo;
    if ($('wName').textContent !== wp.name) $('wName').textContent = wp.name;
    const at = ammo == null ? '' : String(ammo); if ($('wAmmo').textContent !== at) $('wAmmo').textContent = at;
    const fireLabel = combat.isMelee() ? 'УДАР' : 'ОГОНЬ'; if ($('btnFire').textContent !== fireLabel) $('btnFire').textContent = fireLabel;
    const showCross = !drv && !combat.isMelee() && !input.touch && !player.dead && !player.swim;
    $('cross').classList.toggle('on', showCross); $('cross').classList.toggle('aim', rig.aimBlend > .5);
    if (aimTarget && !combat.isMelee() && !drv) {
      projV.set(aimTarget.x, aimTarget.y + 1.25 * aimTarget.look.hs, aimTarget.z).project(camera);
      $('lock').style.transform = 'translate(' + ((projV.x + 1) / 2 * innerWidth).toFixed(0) + 'px,' + ((1 - projV.y) / 2 * innerHeight).toFixed(0) + 'px) translate(-50%,-50%)';
      $('lock').classList.add('on'); $('lock').classList.toggle('cop', !!aimTarget.cop);
    } else $('lock').classList.remove('on');
    vignette *= Math.exp(-2.5 * dt);
    const hv = Math.max(vignette, player.hp <= 30 ? .35 + Math.sin(time * 5) * .12 : 0).toFixed(2);
    if ($('hurt').style.opacity !== hv) $('hurt').style.opacity = hv;
    drawMap();
  }

  /* ---------- loop ---------- */
  function stepPlaying(dt, raw) {
      time += dt;
      input.poll();
      if (respawnT > 0) {
        respawnT -= dt; if (respawnT <= 0) respawn();
        input.move.x = input.move.y = 0; input.fire = false; input.action = false; input.jump = false; input.throttle = 0;
      }
      // in the spray shop the car stands still until the door goes up again
      if (world.spray.busy) { input.throttle = 0; input.move.x = 0; input.handbrake = true; input.horn = false; input.action = false; }
      if (input.cycle) { combat.cycle(1); input.cycle = 0; }
      if (input.select >= 0) { combat.select(input.select); input.select = -1; }
      const [lx, ly] = input.takeLook(settings.sens);
      rig.look(lx, ly);
      if (input.action) { input.action = false; if (interact && !vehicles.driving) interact.it.use(); else toggleCar(); }
      const aim = computeAim();
      rig.aimBlend = U.damp(rig.aimBlend, input.aim && !combat.isMelee() && !vehicles.driving && !player.dead ? 1 : 0, 10, dt);
      if (!vehicles.driving) player.update(dt, input, rig.yaw); else input.jump = false;
      vehicles.update(dt, { player, input, people: crowd.people, camYaw: rig.yaw, limits: carLimits, police, target: places.current && places.current.door ? { x: places.current.door.x, z: places.current.door.z, vx: 0, vz: 0, onFoot: true } : { x: player.x, z: player.z, vx: player.vx, vz: player.vz, onFoot: !vehicles.driving } });
      combat.update(dt, input, aim, !!vehicles.driving || player.swim);   // no fighting while swimming
      police.update(dt, player, rig.yaw);
      ems.update(dt, player, rig.yaw, lowCrowd() ? 1 : 2);
      fire.update(dt, player);
      sea.update(dt);
      taxi.update(dt);
      places.update(dt);
      world.spray.update(dt); world.street.update(dt);
      if ((saveT += dt) > 5) saveProgress();
      // the edge of the world: open ocean
      edgeT -= dt;
      if (edgeT <= 0 && !places.current && (player.x < WB.x0 + 10 || player.x > WB.x1 - 10 || player.z < WB.z0 + 10 || player.z > WB.z1 - 10)) { edgeT = 8; flashTip('Дальше только открытый океан — поворачивайте назад', 3); }
      const drv = vehicles.driving;
      if (drv) { player.x = drv.x; player.z = drv.z; player.y = drv.y; player.heading = drv.h; player.vx = drv.vx; player.vz = drv.vz; }
      crowd.update(dt, time, player, rig.yaw, vehicles.dangers(), police);
      animals.update(dt, player, crowdOpts.limits());
      promptCar = drv || player.dead || respawnT > 0 ? null : vehicles.nearest(player);
      if (drv) {
        const vF = drv.vx * Math.sin(drv.h) + drv.vz * Math.cos(drv.h);
        Object.assign(carCam, { x: drv.x, y: drv.y, z: drv.z, heading: drv.h, speed: vF, camDist: drv.model.heli ? 11 + Math.abs(vF) * .08 : 5.2 + drv.model.l * .45 + Math.abs(vF) * .05, camH: drv.model.heli ? 2.6 : 1.7 });
        rig.update(dt, carCam);
      } else rig.update(dt, player);
      if (drunkT > 0) { drunkT -= dt; const k = Math.min(1, drunkT / 8); camera.position.x += Math.sin(time * 1.1) * .25 * k; camera.position.y += Math.sin(time * .8) * .12 * k; camera.rotateZ(Math.sin(time * .7) * .07 * k); }   // a few drinks: the world sways
      if (shake > .01) { camera.position.x += (Math.random() - .5) * shake; camera.position.y += (Math.random() - .5) * shake; shake *= Math.exp(-8 * dt); }
      audio.listener(camera.position.x, camera.position.y, camera.position.z, -Math.sin(rig.yaw), -Math.cos(rig.yaw));
      updateBubbles(dt);
      updateHUD(dt);
      if (raw < .5) adapt(raw);
      findInteraction();
      // walking into a door circle takes you inside (or back out)
      if (!fading) { const m = places.doors(player, !drv && !player.dead && respawnT <= 0); if (m) { if (m.dir === 'in') enterPlace(m.place); else exitPlace(m.place); } }
  }
  let last = performance.now(), frameNo = 0, menuT = 0;
  const snapV = v => Math.round(v / 2) * 2;
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000; last = now;
    if (state === 'map') { drawBigMap(); return; }   // the city waits behind the map
    const dt = Math.min(raw, .05);
    if (state === 'playing') {
      stepPlaying(dt, raw);
    } else if (state === 'menu') {
      menuT += dt;
      vehicles.update(dt, { player, input: { throttle: 0, move: { x: 0 }, handbrake: false, horn: false }, people: crowd.people, camYaw: -Math.PI / 2, limits: carLimits });
      crowd.update(dt, menuT, player, -Math.PI / 2, vehicles.dangers());
      world.street.update(dt); animals.update(dt, player, crowdOpts.limits());
      const z = Math.sin(menuT * .05) * 55;
      camera.position.set(136, 7 + Math.sin(menuT * .13), z);
      camera.lookAt(70, 11, z * .7);
    }
    const env = dn.update(state === 'menu' ? MENU_HOUR : (START_MIN + time) / 60, now / 1000);
    if (state !== 'menu') {
      weather.update(state === 'playing' ? Math.min(raw, .05) : 0, env.hour, !places.current);
      weather.apply(env, { sky, scene, hemi, sun, world, fogNear: fogNear0, fogFar: fogFar0 });
    }
    // indoors the light is the building's own, whatever the time of day
    const inside = state !== 'menu' && places.current;
    if (inside && inside.light) { hemi.color.copy(inside.light.sky); hemi.groundColor.copy(inside.light.ground); hemi.intensity = inside.light.i; sun.intensity = .15; sun.color.setHex(0xffffff); }
    const fx = state === 'menu' ? camera.position.x - 40 : player.x, fz = state === 'menu' ? camera.position.z : player.z;
    sun.target.position.set(snapV(fx), 0, snapV(fz)); sun.target.updateMatrixWorld();
    sun.position.copy(sun.target.position).addScaledVector(env.lightDir, 90);
    if (shadowsOn && (++frameNo & 1)) renderer.shadowMap.needsUpdate = true;
    sky.position.copy(camera.position);
    env.px = fx; env.pz = fz;
    world.update(now / 1000, env);
    // venue music: the building you're in, else the club or the tiki bar if you're close (muffled through walls)
    if (state === 'menu') audio.venue(null, 0, false);
    else {
      let name = null, level = 0, full = false;
      const club = world.club, active = state === 'playing' || state === 'panel' || state === 'shop';
      if (inside) { name = inside.music; level = name && active ? 1 : 0; full = true; }
      else if (club) {
        const cin = club.inside(player.x, player.z), d = Math.hypot(player.x - club.door.out[0], player.z - club.door.z);
        name = 'club'; level = cin ? 1 : Math.max(0, 1 - d / 55) * .5; full = cin;
        const tv = places.venueAt(player.x, player.z);
        if (tv && tv.level > level) { name = tv.name; level = tv.level; full = true; }
        const bv = world.street.venueAt(player.x, player.z);   // street musicians
        if (bv && bv.level > level) { name = bv.name; level = bv.level; full = true; }
      }
      audio.venue(name, active ? level : 0, full);
      const bank = places.byId('bank');
      audio.alarm(active && bank && bank.alarm() && (places.current === bank || Math.hypot(player.x - bank.door.x, player.z - bank.door.z) < 70));
    }
    vehicles.setNight(env.night);
    renderer.render(scene, camera);
  }

  if (isTouchDevice) input.setTouch(true);
  applyQuality();
  onResize();
  show('menu');
  document.body.classList.add('ready');
  NB.debug = { player, vehicles, crowd, animals, world, fire, weather, sea, rig, toggleCar, input, play, police, combat, heroDamage, ems, taxi, shop, dn, progress, addMoney, openShop, closeShop, places, ui, enterPlace, exitPlace, teleport, saveProgress, get interact() { return interact; },
    simulate(n, dt = 1 / 60) { state = 'playing'; for (let i = 0; i < n; i++) { stepPlaying(dt, dt); if (state !== 'playing') break; } },
    setHour(h) { time = ((h * 60 - START_MIN) % 1440 + 1440) % 1440; },
    get state() { return state; }, get promptCar() { return promptCar; } };
  requestAnimationFrame(frame);
})(window.NB);
