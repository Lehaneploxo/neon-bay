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
  const vehOpts = { audio, slip: () => weather.slip(), onImpact: s => { shake = Math.min(.6, shake + s * .025); if (taxi) taxi.onImpact(s); if (s > 11 && vehicles.driving && vehicles.driving.model.bike) setTimeout(() => thrownOff(s)); } };
  const vehicles = NB.createVehicles(scene, world, vehOpts);
  // the car radio: on while you're in a vehicle; tap the station name (or press R) for the next one
  // the banner plane over the bay
  const plane = NB.createPlane(scene);
  const radio = NB.createRadio(audio);
  radio.onChange = t => { $('radio').textContent = '📻 ' + t; };
  $('radio').textContent = '📻 ' + radio.label();
  $('radio').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); radio.next(); });
  // gulls, pigeons, dogs, crabs and dolphins
  const animals = NB.createAnimals(scene, world, { crowd, vehicles, player, audio, say: (p, t) => say(p, t), flash: (t, s) => flashTip(t, s), onBite: d => { heroDamage(d); flashTip('Собака кусается!', 1.4); } });
  crowdOpts.onPanic = (x, z, r) => animals.scare(x, z, r);
  // Turtle Island's crabs, turtles, parrots, monkeys, iguanas and its shark
  const wildlife = NB.createWildlife(scene, world, { player, vehicles, audio, flash: (t, s) => flashTip(t, s), onBite: d => heroDamage(d) });
  const carLimits = () => lowCrowd() ? { traffic: 6, carRange: 90, patrols: 1 } : { traffic: 12, carRange: 130, patrols: 2 };
  let shake = 0, promptCar = null, edgeT = 0;
  const carCam = { x: 0, y: 0, z: 0, heading: 0, speed: 0, camDist: 7.2, camH: 1.7 };
  function toggleCar() {
    const car = vehicles.driving;
    if (car) {
      const out = vehicles.exit(player);
      if (out) {
        if (net) net.carLeft(car);
        player.fallTop = player.y;   // a fall is counted from where you step out, not from where you got in
        if (out === 'bail') flashTip(player.hasChute ? (input.touch ? 'Прыжок! Нажмите ПРЫЖОК — раскрыть парашют' : 'Прыжок! Пробел — раскрыть парашют') : 'Прыжок… без парашюта!', 3.5);
        player.inCar = false; player.m.root.visible = true; player.blob.visible = true;
        document.body.classList.remove('driving'); rig.snap(player);
      } else flashTip(car.model.heli ? 'Сначала приземлитесь' : 'Сначала остановитесь', 1.5);
    } else if (promptCar) {
      const wasDriven = !!promptCar.ai || !!promptCar.pursuit || !!promptCar.goto || !!promptCar.autopilot, isPolice = !!promptCar.police;
      const ej = vehicles.enter(promptCar, player);
      if (net) net.carEntered(promptCar);
      if (ej) { if (ej.cop || isPolice) crowd.spawnCop(0, 0, 0, 0, 0, 0, ej.x, ej.z); else crowd.ejectDriver(ej.x, ej.z, ej.h); }
      if (isPolice && !(jobs && jobs.duty === 'police')) police.reportCrime('copcar', player.x, player.z); else if (wasDriven) police.reportCrime('carjack', player.x, player.z);
      player.inCar = true; player.m.root.visible = false; player.blob.visible = false;
      document.body.classList.add('driving');
      showDistrict(promptCar.model.name);
      if (promptCar.model.heli) player.hasChute = true;   // every helicopter and plane has a parachute on board
      if (promptCar.model.jet) flashTip(input.touch ? 'ГАЗ — форсаж, джойстик — крен и поворот, ВВЕРХ / ВНИЗ — нос. Разгонитесь до 140 км/ч и тяните ВВЕРХ'
        : 'W — форсаж · S — тормоз · A / D — поворот · Пробел — нос вверх · Shift — вниз. Разгонитесь до 140 км/ч и тяните вверх', 6);
      else if (promptCar.model.id === 'tank') flashTip(input.touch ? 'Танк: ОГОНЬ — выстрел из пушки' : 'Танк: левая кнопка мыши — выстрел из пушки', 4);
      else if (promptCar.model.heli) flashTip(input.touch ? 'ВПЕРЁД / НАЗАД, джойстик — поворот, ВВЕРХ / ВНИЗ — высота. Лопасти раскручиваются…'
        : 'W / S — вперёд и назад · A / D — поворот · Пробел — вверх · Shift — вниз. Лопасти раскручиваются… В воздухе F — прыгнуть с парашютом', 5);
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
  let guards = null;
  const combat = NB.createCombat(scene, world, { crowd, vehicles, player, audio, police, flash: (t, s) => flashTip(t, s), onPlayerHit: d => heroDamage(d), onCash: n => addMoney(n, 'Подобрано'), records: () => progress.records, save: () => saveProgress(),
    power: () => 1 + ((progress.stats && progress.stats.str) || 0) / 100,   // trained strength: up to twice as hard
    targets: () => places.current && places.current.targets, quiet: () => !!(places.current && places.current.quiet && places.current.quiet()),
    // other players (net.js): the hero's shots and punches can land on them
    remoteHit: (...a) => (net ? net.remoteHit(...a) : null), remoteNear: (...a) => (net ? net.remoteNear(...a) : null), hitRemote: (id, d, k) => { if (net) net.hitRemote(id, d, k); } });

  /* ---------- money, armour and the saved game ---------- */
  const MEGA_VEST = 1000000;   // the golden vest on Turtle Island; an ordinary one is 100
  const progress = { money: 150, armor: 0, inv: null, villa: false, outfit: 'hawaii', prevOutfit: 'hawaii', records: {}, bankT: 0, garage: [], owned: null, guards: 0 };
  try { Object.assign(progress, JSON.parse(localStorage.getItem('nb_save') || '{}')); } catch (e) {}
  progress.money = Math.max(0, Math.floor(+progress.money || 0)); progress.armor = U.clamp(+progress.armor || 0, 0, MEGA_VEST);
  if (!progress.records || typeof progress.records !== 'object') progress.records = {};
  if (!Array.isArray(progress.garage)) progress.garage = [];
  // clothes are owned and worn piece by piece (progress.wear: 'slot:key', progress.look: slot -> key).
  // An old save had whole outfits: each becomes a top, with trousers of its colour
  {
    const CL = NB.CLOTHES, PANTS_OF = { 0xf5f0e6: 'white', 0x141418: 'black', 0x18223c: 'navy', 0x8a1f2a: 'red' };
    const pantsFor = k => { const o = NB.OUTFITS[k]; if (!o) return 'jeans'; const c = o.pants; return PANTS_OF[c] || Object.keys(CL.pants).find(p => CL.pants[p].color === c) || 'jeans'; };
    const oldOwned = Array.isArray(progress.owned) ? progress.owned : [];
    if (!Array.isArray(progress.wear)) progress.wear = NB.STARTER_WEAR.concat(oldOwned.filter(k => CL.top[k]).flatMap(k => ['top:' + k, 'pants:' + pantsFor(k)]));
    progress.wear = [...new Set(progress.wear.concat(NB.STARTER_WEAR))].filter(w => { const [s, k] = w.split(':'); return CL[s] && CL[s][k]; });
    if (!progress.look || typeof progress.look !== 'object') {
      const old = progress.outfit !== 'cop' ? progress.outfit : progress.prevOutfit;
      progress.look = CL.top[old] && old !== 'cop' ? { top: old, pants: pantsFor(old) } : {};
    }
    progress.look = Object.assign({}, NB.DEFAULT_LOOK, progress.look);
    for (const s in progress.look) if (!CL[s] || !CL[s][progress.look[s]] || !progress.wear.includes(s + ':' + progress.look[s])) progress.look[s] = NB.DEFAULT_LOOK[s];
    if (progress.outfit !== 'cop') progress.outfit = 'own';
    progress.prevOutfit = 'own';
  }
  combat.load(progress.inv); combat.syncMedkit();
  player.setLook(progress.look);
  if (progress.outfit === 'cop') player.setOutfit('cop');
  let saveT = 0;
  // the save is kept in this browser and, for a signed-in player, on the game server too (see online.js).
  // `urgent` (pause, leaving the page) sends it at once; the autosave every few seconds is batched
  function saveProgress(urgent) {
    const online = NB.online;
    if (online && online.replacing) return;   // the server's copy is being loaded in: don't write over it
    progress.garage = garageCars();
    if (autos) autos.snapshot();
    const { money, villa, outfit, prevOutfit, records, bankT, garage, look, wear, stats, homes, homeSpawn, job, biz, cars, garages } = progress, guardsN = guards ? guards.list : progress.guards;
    const data = { money, armor: Math.round(progress.armor), inv: combat.inv, villa, outfit, prevOutfit, records, bankT, garage, look, wear, stats, homes, homeSpawn, job, biz, cars, garages, guards: guardsN, _t: online ? online.now() : Date.now() };
    try { localStorage.setItem('nb_save', JSON.stringify(data)); } catch (e) {}
    if (online) online.push(data, urgent === true);
    saveT = 0;
  }
  // cars standing in the villa garage are kept between visits
  function garageCars() {
    const G = places.garage; if (!G || !progress.villa) return [];
    const r = G.rect;
    return vehicles.cars.filter(c => !c.ai && !c.owned && c.driver !== 'player' && c.x > r.x0 && c.x < r.x1 && c.z > r.z0 && c.z < r.z1).slice(0, 2)
      .map(c => ({ id: c.model.id, color: c.color, accent: c.accent, x: +c.x.toFixed(2), z: +c.z.toFixed(2), h: +c.h.toFixed(3) }));
  }
  if (progress.villa) for (const g of progress.garage) vehicles.spawnParked(g.id, g.x, g.z, g.h, g.color, g.accent);
  addEventListener('pagehide', () => saveProgress(true));
  let popTimer = 0;
  function moneyPop(text, sub, neg) {
    const el = $('moneyPop');
    el.textContent = text; if (sub) { const s = document.createElement('small'); s.textContent = sub; el.appendChild(s); }
    el.className = neg ? 'neg' : ''; void el.offsetWidth; el.className = (neg ? 'neg ' : '') + 'on';
    clearTimeout(popTimer); popTimer = setTimeout(() => { el.className = ''; }, 2300);
  }
  // police and soldiers carry guns, and drop them: a policeman his pistol, a soldier his rifle
  function dropGun(p, chance) {
    const type = p.cop && !p.medic ? 'pistol' : p.gang === 'army' ? 'rifle' : null;
    if (type && Math.random() < chance) combat.dropWeapon(p.x, p.z, type);
  }
  function addMoney(n, sub) { if (n <= 0) return; progress.money += n; audio.cash(n >= 100); moneyPop('+$' + n, sub); saveProgress(); }
  function spend(n, sub) { n = Math.min(n, progress.money); if (n <= 0) return 0; progress.money -= n; moneyPop('−$' + n, sub, true); saveProgress(); if (business) business.spent(n, sub); return n; }

  Object.assign(crowdOpts, {
    onKill: (p, src) => {
      combat.bloodPool(p.x, p.y, p.z); audio.scream([p.x, 1, p.z]);
      if (src.byPlayer) {
        police.reportCrime(p.cop ? 'copKill' : 'kill', p.x, p.z);
        if (!p.medic && (p.cop || Math.random() < .7)) combat.dropCash(p.x, p.z, p.cop ? 40 + (Math.random() * 40 | 0) : 5 + (Math.random() * 40 | 0));
        dropGun(p, 1);
      }
    },
    // knocked out: sometimes a few dollars fall out of their pockets
    onDown: (p, src) => { if (src.byPlayer && !p.medic && Math.random() < .5) combat.dropCash(p.x, p.z, 3 + (Math.random() * 25 | 0)); if (src.byPlayer) dropGun(p, .5); },
    onHurt: (p, src) => { if (src.byPlayer && p.cop && src.kind !== 'car') police.reportCrime('copAttack', p.x, p.z); },
    onCopShoot: p => combat.copShoot(p, police.wanted),
    onGangShoot: p => combat.copShoot(p, p.gang === 'army' ? 4 : 2),   // soldiers shoot straighter than gangsters
    onGangShootAt: (p, t) => combat.npcShoot(p, t),
    // bodyguards: their pistols hit hard and never hit the hero; their punches land with a thud
    onGuardShoot: (p, t) => combat.npcShoot(p, t, { dmg: 48, noPlayer: true }),
    onCopShootAt: (p, t) => combat.npcShoot(p, t, { dmg: 30 }),   // an officer returning a bodyguard's fire
    onCopAttacked: c => police.reportCrime('copAttack', c.x, c.z),   // your men attacking the police is on you
    onPunchSound: t => audio.punch([t.x, 1.5, t.z]),
    playerArmed: () => !vehicles.driving && !combat.isMelee(),
    onHitPlayer: dmg => { heroDamage(dmg); audio.punch(null); },
    onBustTick: dt => { if (!player.inCar || vehicles.speedKmh() < 5) police.bustTick(dt); },
    onScream: p => audio.scream([p.x, 1.6, p.z]),
    onGroan: p => audio.groan([p.x, .4, p.z])
  });
  const sea = NB.createSeaLife(world, { vehicles, audio, police, player, flash: (t, s) => flashTip(t, s),
    onBoat: () => !!(vehicles.driving && vehicles.driving.model.boat), onWater: () => !!(player.swim || (vehicles.driving && vehicles.driving.model.boat)),
    target: () => ({ x: player.x, z: player.z, vx: player.vx, vz: player.vz }) });
  let jobs = null, net = null, business = null, autos = null;   // police / ambulance / fire shifts for the player (jobs.js), made once the city is ready
  const fire = NB.createFireService(world, { crowd, vehicles, scene, say: (p, t) => say(p, t), flash: (t, s) => flashTip(t, s), hold: c => !!jobs && jobs.holdFire(c) });
  const ems = NB.createEMS(world, {
    hold: p => !!jobs && jobs.holdEMS(p),
    crowd, vehicles, say: (p, t) => say(p, t),
    onDispatch: u => { if (Math.hypot(u.patient.x - player.x, u.patient.z - player.z) < 45) flashTip('Скорая выехала на вызов', 2); }
  });
  Object.assign(vehOpts, {
    onJetEdge: () => flashTip('Граница зоны полётов — автопилот разворачивает назад', 2.5),
    onWaveDown: sec => flashTip('Все копы выведены из строя. Новый наряд выедет через ' + (sec >= 60 ? Math.round(sec / 60) + ' мин' : sec + ' с'), 3),
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
      if (car && car === vehicles.driving) { leaveCar(); heroDamage(250); }
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
  function setOutfit(id) { progress.outfit = id === 'cop' ? 'cop' : 'own'; if (id === 'cop') player.setOutfit('cop'); else player.setLook(progress.look); saveProgress(); }
  // one piece on (or off): out of a police uniform, if it was on, into your own clothes
  function wear(slot, key) { if (jobs && jobs.duty) jobs.end(false, 'смена окончена — вы переоделись'); progress.look[slot] = key; progress.outfit = 'own'; player.setLook(progress.look); saveProgress(); }
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
  function exitPlace(p) { const d = p.door; teleport(d.x + d.nx * .9, d.z + d.nz * .9, d.heading, null, world.districtAt(d.x, d.z), d.y); }
  function leavePlace() { if (places.current && places.current.onLeave) places.current.onLeave(); places.current = null; }
  // a rest: full health and a save. The clock never jumps (the game is headed online: one time for everyone)
  function sleep(msg) {
    blink(() => { player.hp = 100; saveProgress(); flashTip(msg, 3); });
  }
  const ui = NB.createUI({
    money: { get: () => progress.money, spend: (n, note) => { if (progress.money < n) { audio.deny(); return false; } spend(n, note); return true; }, add: (n, note) => addMoney(n, note) },
    audio, progress, save: saveProgress, setOutfit, wear,
    onOpen: () => { if (state === 'playing') { state = 'panel'; input.reset(); if (document.pointerLockElement) document.exitPointerLock(); show('panelOnly'); } },
    onClose: () => { if (state === 'panel') play(); }
  });
  const wallet = { get: () => progress.money, spend: (n, note) => { if (progress.money < n) { audio.deny(); flashTip('Не хватает денег: нужно $' + n, 2); return false; } spend(n, note); return true; }, add: (n, note) => addMoney(n, note) };
  // the spray shop and the street: food carts, buskers, surfers, volleyball
  world.spray.attach({ vehicles, police, player, audio, money: wallet, flash: (t, s) => flashTip(t, s), blink: fn => blink(fn) });
  // Turtle Island: the pirate chest pays out, and a speedboat waits at the old jetty to take you back
  // Base Omega: the patrol jeep, the trespass alarm, the armoury crate, a boat at the jetty
  if (world.military) { world.military.attach({ player, vehicles, crowd, flash: (t, s) => flashTip(t, s), say: (p, t) => say(p, t), give: (id, n) => combat.give(id, n), setArmor: n => { progress.armor = Math.max(progress.armor, n); } }); const b = world.military.boat; vehicles.spawnParked(b.id, b.x, b.z, b.h); }
  if (world.tropic) { world.tropic.attach({ progress, addMoney: (n, why) => addMoney(n, why), flash: (t, s) => flashTip(t, s), armor: () => progress.armor, setArmor: n => { progress.armor = n; saveProgress(); }, pickup: () => audio.pickup() }); const b = world.tropic.boat; vehicles.spawnParked(b.id, b.x, b.z, b.h); }
  if (world.hideaway) world.hideaway.attach({ progress, addMoney: (n, why) => addMoney(n, why), flash: (t, s) => flashTip(t, s), armor: () => progress.armor, setArmor: n => { progress.armor = n; saveProgress(); }, pickup: () => audio.pickup() });
  { const room = places.byId('motel'), m = world.street.motel; if (room && m) { room.door = m.room; room.after = m.door; } }
  world.street.attach({ rain: () => weather.rain, police, hour: () => ((START_MIN + time) / 60) % 24,
    room: girl => { const pl = places.byId('motel'); pl.guest = girl; enterPlace(pl); },   // in through the door upstairs, she's already inside
    crowd, player, vehicles, audio, money: wallet, flash: (t, s) => flashTip(t, s), say: (p, t) => say(p, t) });
  const placeCtx = {
    player, combat, crowd, police, audio, vehicles, progress, ui,
    money: { get: () => progress.money, spend: (n, note) => { if (progress.money < n) { audio.deny(); flashTip('Не хватает денег: нужно $' + n, 2); return false; } spend(n, note); return true; }, add: (n, note) => addMoney(n, note) },
    flash: (t, s) => flashTip(t, s), save: saveProgress, setOutfit, sleep, teleport, drunk: s => { drunkT = s; },
    say: (p, t) => say(p, t), get input() { return input; }, day: () => Math.floor((START_MIN + time) / 1440), view: (yaw, pitch) => { rig.yaw = yaw; rig.pitch = pitch; },
    getArmor: () => progress.armor, setArmor: v => { progress.armor = v; saveProgress(); },
    openShop: () => { if (shop.canServe()) openShop(); }
  };
  places.attach(placeCtx);
  // Neon Fashion, the clothes shop
  // Shield Security: bodyguards for hire, $1000 a head, up to five
  guards = NB.createGuards({ crowd, vehicles, player, progress, flash: (t, sec) => flashTip(t, sec), say: (p, t) => say(p, t) });
  const securityDoor = world.security ? [{ x: world.security.x, z: world.security.z, r: 2, short: 'ОХРАНА', label: () => 'Охранное агентство Shield Security', use: () => ui.security(guards) }] : [];
  const fashionDoor = [];   // Neon Fashion is a boutique you walk into (places.js)
  // every way in gets a storefront you can't miss: neon frame, lit door, signs, an arrow and a name tag
  const fronts = NB.buildEntrances(scene, world.col), entFront = {};   // entFront: the storefront of each place, by id
  {
    const ENT = {
      ammo: ['AMMO BAY', 'оружие · патроны · тир', '🔫', 'ОРУЖИЕ', { canopy: false, board: false }],
      bank: ['БАНК', 'Банк Неплохо Сити', '🏦', 'БАНК', { canopy: false }],
      police: ['ПОЛИЦИЯ', 'работа · камеры · оружейная', '🚓', 'ПОЛИЦИЯ', { canopy: false, board: false }],
      dealer: ['NEPLOXO MOTORS', 'автосалон · эксклюзивные машины', '🚗', 'АВТОСАЛОН', { canopy: false, board: false }],
      firestation: ['ПОЖАРНАЯ ЧАСТЬ', 'работа пожарным', '🚒', 'РАБОТА', { canopy: false, board: false }],
      hospital: ['БОЛЬНИЦА', 'лечение · работа · вертолёт', '🏥', 'БОЛЬНИЦА', { canopy: false, board: false }],
      tower: ['NEPLOXO TOWER', 'лобби · лифт на крышу', '🏙', 'TOWER', { canopy: false, board: false }],
      arcade: ['ИГРОВЫЕ АВТОМАТЫ', 'NEON RACER и другие', '🕹', 'ИГРЫ', { canopy: false }],
      diner: ['ЗАКУСОЧНАЯ', 'бургеры · шейки · музыка', '🍔', 'ЕДА', { canopy: false }],
      hotel: ['ОТЕЛЬ OCEAN', 'номера · бассейн на крыше', '🏨', 'ОТЕЛЬ', { canopy: false, board: false }],
      casino: ['КАЗИНО', 'автоматы · рулетка', '🎰', 'КАЗИНО', { canopy: false }],
      airport: ['АЭРОПОРТ', 'терминал · Duty Free', '✈', 'АЭРОПОРТ', { canopy: false, board: false }],
      fashion: ['NOT BAD FASHION', 'бутик одежды', '👕', 'ОДЕЖДА', { canopy: false }],
      prison: ['ТЮРЬМА', 'можно зайти посмотреть', '⛓', 'ТЮРЬМА', { canopy: false, board: false }],
      boxing: ['NOT BAD BOXING', 'ринг · бои', '🥊', 'БОКС', { canopy: false, board: false }],
      gym: ['NEPLOXO GYM', 'сила · выносливость', '🏋', 'ЗАЛ', { canopy: false, board: false }],
      strip: ['NOT BAD GIRLS', 'круглосуточно', '💃', 'КЛУБ', { canopy: false }],
      villa: ['ВИЛЛА', '', '🏠', 'ВИЛЛА', { canopy: false, board: false, blade: false }]
    };
    for (const id in ENT) {
      const p = places.byId(id); if (!p || !p.door) continue;
      const [title, sub, icon, tag, opt] = ENT[id], d = p.door;
      const e = entFront[id] = fronts.add(Object.assign({ x: d.x, z: d.z, y: d.y, nx: d.nx, nz: d.nz, hex: d.hex || '#ffd84f', title, sub, icon, tag }, opt));
      if (id === 'villa') { e.hintFn = () => progress.villa ? (shops.ok('villa') ? 'ВАШ ДОМ' : 'ДОЛГ ЗА АРЕНДУ') : shops.villaOwner() ? 'ВЛАДЕЛЕЦ: ' + shops.villaOwner() : 'ПРОДАЁТСЯ · $' + places.VILLA_PRICE.toLocaleString('ru-RU') + ' · $' + shops.villaRent().toLocaleString('ru-RU') + ' в день'; }
    }
    if (world.security) { const s = world.security; fronts.add({ x: s.x, z: s.z, ...doorDir(s), hex: '#3fe6e0', title: 'SHIELD SECURITY', sub: 'телохранители · $1 000', icon: '🛡', tag: 'ОХРАНА', hint: 'ОХРАНА · подойдите к двери', canopy: false, ring: true }); }
    if (world.club) fronts.add({ x: world.club.door.out[0], z: world.club.door.z, nx: 1, nz: 0, wall: world.club.door.out[0] - world.club.door.x, hex: '#ff4fa3', title: 'NEPLOXO 21', sub: 'диско-клуб', icon: '🪩', tag: 'КЛУБ', canopy: false, board: false });
  }
  // the direction a door looks, from where it stands next to its building's centre
  function doorDir(d) { const dx = d.x - d.cx, dz = d.z - d.cz; return Math.abs(dx) > Math.abs(dz) ? { nx: Math.sign(dx), nz: 0 } : { nx: 0, nz: Math.sign(dz) }; }
  // shops, cafés, 24/7 stores and homes for sale all over the city (shops.js)
  const shops = NB.createShops({ places, fronts, ui, player, progress, money: wallet, audio, drunk: s => { drunkT = s; },
    flash: (t, s) => flashTip(t, s), save: saveProgress, sleep, leave: () => { if (places.current) exitPlace(places.current); }, villa: { price: places.VILLA_PRICE } });
  placeCtx.homeOk = id => shops.ok(id);   // the villa's door opens only while its rent is paid
  fronts.finish();
  // city jobs: get hired in the boss's office, start and end each shift in the locker room (jobs.js)
  jobs = NB.createJobs({ crowd, vehicles, player, police, ui, audio, world, combat, progress, save: saveProgress, money: wallet, flash: (t, s) => flashTip(t, s), say: (p, t) => say(p, t),
    getArmor: () => progress.armor, setArmor: v => { progress.armor = v; saveProgress(); },
    inside: () => !!places.current, district: () => world.districtAt(player.x, player.z),
    // the uniform: the police one is the station's (the police take you for one of theirs), the others are just worn
    wear: id => { if (id === 'cop') setOutfit('cop'); else if (id) { if (progress.outfit === 'cop') setOutfit('own'); player.setOutfit(id); } else setOutfit('own'); } });
  placeCtx.jobs = jobs;   // the bosses' offices and the locker rooms inside the stations
  setTimeout(() => jobs.resume(), 0);   // came back in the middle of a shift: still on it (once the whole game is set up)
  // the live world: the other players and the chat (net.js)
  net = NB.createNet({ scene, col: world.col, camera, player, vehicles, places, progress, get input() { return input; }, audio, flash: (t, s) => flashTip(t, s), playing: () => state === 'playing', lock: () => lock(),
    hurt: d => heroDamage(d), star: () => police.star(), kickOut: () => leaveCar(), loseCash: n => spend(n, 'Выронили при нокауте'), addCash: n => addMoney(n, 'Подобрано'),
    // safe places for knockouts: the spawn beach, round the hospital, inside a home
    safe: () => { const pl = places.current; if (pl) return /^home_|^villa$/.test(pl.id); const h = world.hospital, sp = world.spawn; return (h && Math.hypot(player.x - h.x, player.z - h.z) < 45) || Math.hypot(player.x - sp.x, player.z - sp.z) < 60; } });
  // player businesses: bought at the desk in NEPLOXO TOWER, half of what others spend inside goes to the owner
  // your own cars: NEPLOXO MOTORS, cars that stay where you leave them, home garages (autos.js)
  autos = NB.createAutos({ vehicles, places, shops, player, progress, money: wallet, ui, audio, scene, flash: (t, s) => flashTip(t, s), save: saveProgress });
  business = NB.createBusiness({ places, shops, fronts: entFront, progress, money: wallet, ui, audio, flash: (t, s) => flashTip(t, s), save: saveProgress });
  net.on('timer', m => { if (m.key === 'bank' && m.by && m.by !== net.nick) flashTip('🚨 ' + m.by + ' грабит банк Неплохо Сити!', 4); });   // news for everybody
  // the game starts in the home you last walked into: inside it (the beach villa too)
  {
    const sp = shops.spawn(), vl = places.byId('villa');
    if (sp && sp.marker && sp.marker.info && (!sp.marker.info.enabled || sp.marker.info.enabled())) {
      const m = sp.marker, pl = m.place;
      pl.door = m.door; pl.info = m.info; pl.name = m.info.name || pl.name; if (pl.sign) pl.sign(m.info.title, m.info.sub, m.info.hex);
      places.current = pl; player.place(pl.inside.x, pl.inside.z, pl.inside.heading); places.disarm();
    } else if (sp) { player.place(sp.x, sp.z, sp.heading); if (sp.y != null) player.y = sp.y; }
    else if (progress.homeSpawn === 'villa' && progress.villa && vl && shops.ok('villa')) { places.current = vl; player.place(vl.inside.x, vl.inside.z, vl.inside.heading); places.disarm(); }
  }
  // free seats nearby (the same ones passers-by use): sit down, or lie down on a lounger or a bed
  let seatSpot = null;
  function seatsNear() {
    const out = [];
    if (vehicles.driving) return out;
    for (const s of places.current ? crowd.spots.concat(places.freeSeats) : crowd.spots) {
      if ((s.kind !== 'sit' && s.kind !== 'lie') || s.person || s.taken || s.type === 'prisoner') continue;
      if (Math.abs(s.x - player.x) > 1.5 || Math.abs(s.z - player.z) > 1.5 || Math.abs(s.y - .7 - player.y) > 1.3) continue;
      out.push({ x: s.x, z: s.z, y: player.y, r: 1.3, short: s.kind === 'sit' ? 'СЕСТЬ' : 'ЛЕЧЬ', label: () => s.kind === 'sit' ? 'Сесть' : 'Прилечь', use: () => {
        seatSpot = s; s.taken = true;
        if (s.kind === 'sit') player.sitAt(s.x, s.z, s.heading, s.y - .95, 'sit'); else player.sitAt(s.x, s.z, s.heading, s.y, 'lie');
        rig.snap(player);
      } });
    }
    return out;
  }
  // the nearest thing to use (F / the action button), if any
  let interact = null;
  function findInteraction() {
    interact = null;
    if (vehicles.driving || player.dead || respawnT > 0) return;
    let bd = Infinity;
    if (player.seat) { if (!player.seat.locked) interact = { it: { short: 'ВСТАТЬ', use: () => player.standUp() }, label: 'Встать' }; return; }
    const list = places.current ? places.interactions() : places.interactions().concat(world.spray.interactions(), world.street.interactions(), animals.interactions(player), fashionDoor, securityDoor, world.tropic ? world.tropic.interactions() : [], world.hideaway ? world.hideaway.interactions() : [], world.military ? world.military.interactions() : [], jobs.interactions(), autos.interactions());
    for (const it of seatsNear()) list.push(it);
    for (const it of list) {
      if (Math.abs(player.y - (it.y || 0)) > 2.2) continue;
      const d = Math.hypot(player.x - it.x, player.z - it.z);
      if (d > it.r || d >= bd) continue;
      const label = it.label(); if (!label) continue;
      bd = d; interact = { it, label };
    }
  }
  // the tank's main gun: a shell flies from the muzzle to the first thing in its way and blows up there
  let tankReload = 0;
  const shells = [];
  function fireTankGun(car) {
    const fx = Math.sin(car.h), fz = Math.cos(car.h), ox = car.x + fx * 5.7, oy = car.y + 2.1, oz = car.z + fz * 5.7;
    let t = world.col.raycast(ox, oy, oz, fx, -.02, fz, 160); if (oy - .02 * t < 0) t = Math.min(t, oy / .02);
    const hitCar = vehicles.cars.find(c => c !== car && !c.wreck && (() => { const dx = c.x - ox, dz = c.z - oz, a = dx * fx + dz * fz; return a > 0 && a < t && Math.abs(dx * fz - dz * fx) < c.model.w / 2 + .6 && Math.abs(c.y - car.y) < 4; })());
    if (hitCar) t = Math.min(t, (hitCar.x - ox) * fx + (hitCar.z - oz) * fz);
    for (const p of crowd.people) { if (p.dead || p.bodyguard) continue; const dx = p.x - ox, dz = p.z - oz, a = dx * fx + dz * fz; if (a > 0 && a < t && Math.abs(dx * fz - dz * fx) < .5) t = a; }
    const m = new THREE.Mesh(new THREE.SphereGeometry(.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    m.position.set(ox, oy, oz); scene.add(m);
    shells.push({ m, x: ox, y: oy, z: oz, fx, fz, left: t, speed: 140, hitCar });
    audio.explosion([ox, oy, oz]); shake = Math.min(.9, shake + .35);
    car.vx -= fx * 1.5; car.vz -= fz * 1.5;   // the recoil
    police.reportCrime('shoot', car.x, car.z); crowd.panic(car.x, car.z, 50, true);
  }
  function shellsStep(dt) {
    for (let k = shells.length - 1; k >= 0; k--) {
      const s = shells[k], step = Math.min(s.left, s.speed * dt);
      s.x += s.fx * step; s.z += s.fz * step; s.y -= .02 * step; s.left -= step; s.m.position.set(s.x, s.y, s.z);
      if (s.left <= .01) {
        scene.remove(s.m); shells.splice(k, 1);
        if (s.hitCar) { s.hitCar.damage += 400; s.hitCar.blame = true; }
        vehicles.blast(s.x, Math.max(0, s.y - 1), s.z, true);
      }
    }
  }
  // a fall from high up: the vest doesn't help, training does a little
  function fallDamage(d, h) {
    if (player.dead || respawnT > 0) return;
    d *= 1 - ((progress.stats && progress.stats.tough) || 0) / 400;
    player.hp = Math.max(0, player.hp - d); vignette = Math.min(1, vignette + .6); audio.hurt();
    if (player.hp <= 0) endLife('wasted'); else flashTip('Жёсткое приземление: ' + Math.round(h) + ' м, −' + Math.round(d) + ' здоровья', 2.2);
  }
  // standing on a car that moves or turns: the hero goes with it
  function rideCar(c) {
    if (c.px == null) return;
    const dh = c.h - c.ph, ox = player.x - c.px, oz = player.z - c.pz, cs = Math.cos(dh), sn = Math.sin(dh);
    player.x = c.x + ox * cs + oz * sn; player.z = c.z + oz * cs - ox * sn; player.y += c.y - c.py; player.heading += dh;
  }
  player.carFloor = (x, z, maxY) => vehicles.topAt(x, z, maxY);   // jump onto a car and stand on it
  player.onFall = (d, h) => fallDamage(d, h);
  function heroDamage(d) {
    if (player.dead || respawnT > 0) return;
    d *= 1 - ((progress.stats && progress.stats.tough) || 0) / 400;   // trained toughness: up to a quarter less
    if (progress.armor > 0) { const a = Math.min(progress.armor, d); progress.armor -= a; d -= a; }   // the vest takes the hit first
    player.hp = Math.max(0, player.hp - d); vignette = Math.min(1, vignette + (d > 0 ? .45 : .2)); audio.hurt();
    if (player.hp <= 0) endLife('wasted');
  }
  // a hard crash on a motorbike throws the rider off onto the road
  function thrownOff(s) {
    if (!vehicles.driving || !vehicles.driving.model.bike) return;
    leaveCar(); player.blob.visible = true; rig.snap(player);
    heroDamage(Math.min(60, s * 1.6)); flashTip('Вы вылетели с мотоцикла!', 1.8);
  }
  function leaveCar() {
    if (!vehicles.driving) return;
    const car = vehicles.driving;
    vehicles.exit(player, true); if (net) net.carLeft(car); player.fallTop = player.y;
    player.inCar = false; player.m.root.visible = true; document.body.classList.remove('driving');
  }
  let bill = 0;
  function endLife(kind) {
    if (respawnT > 0) return;
    respawnT = 3.6; endKind = kind;
    // the hospital charges for treatment, the police fine you more the more stars you had
    bill = kind === 'wasted' ? 100 : 100 * Math.max(1, police.wanted);
    input.reset(); leaveCar();
    if (kind === 'wasted') { player.dead = true; player.deadT = 0; if (net) net.died(); }
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
    const shiftOff = !!jobs.duty;
    if (shiftOff) jobs.end(true); else if (progress.outfit === 'cop') setOutfit('own');
    police.clear(); rig.snap(player);
    if (net) net.respawned();
    $('bigmsg').className = '';
    const paid = spend(bill, busted ? 'Штраф' : 'Лечение');
    flashTip((busted ? 'Вас отпустили из участка' + (paid ? ', штраф $' + paid : '') + '. Оружие изъято.'
      : 'Вас подлатали в больнице' + (paid ? ' за $' + paid : '') + '. Половина патронов потеряна.') + (shiftOff ? ' Смена прервана.' : ''), 3.4);
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
      if (p.dead || p.down || p.anim === 'lie' || p.bodyguard) continue;   // never aim at your own bodyguards
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
  // One clock for everybody (the game is headed online): a game minute per real second, counted from the
  // server's time, so every player has the same hour. `time` is game minutes past START_MIN, kept within a
  // few years of minutes so the animations that use it stay precise; clockShift is only for NB.debug.setHour
  const CLOCK_SPAN = 1440 * 1000;
  let clockShift = 0;
  const sharedTime = () => ((((NB.online ? NB.online.now() : Date.now()) / 1000 - START_MIN + clockShift) % CLOCK_SPAN) + CLOCK_SPAN) % CLOCK_SPAN;
  let state = 'menu', locked = false, everLocked = false, noLock = false, time = sharedTime();
  const input = NB.createInput(canvas, {
    active: () => state === 'playing' && !(net && net.chatting),
    locked: () => locked,
    requestLock: lock,
    onEscape: () => { if (!locked) pause(); },
    onZoom: s => { rig.dist = U.clamp(rig.dist + s * .6, 2.6, 9); },
    onMute: () => toggleMute(),
    onRadio: () => { if (vehicles.driving) radio.next(); },
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
      if (progress.guards && (progress.guards.length || progress.guards > 0)) guards.restore(progress.guards);   // the bodyguards hired last time are still with you
      flashTip(input.touch ? 'Левый палец — ходьба · правый — камера · у машины появится кнопка «СЕСТЬ»'
        : 'WASD — идти · ЛКМ — удар/огонь · ПКМ — прицел · Q — оружие · F — машина · Esc — пауза', 10);
      showDistrict(world.districtAt(player.x, player.z));
    }
    onResize();
  }
  function pause() {
    saveProgress(true);
    if (state !== 'playing') return;
    state = 'paused'; input.reset(); show('pause');
    $('endShiftBtn').hidden = !jobs.duty;
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
  $('endShiftBtn').addEventListener('click', () => { jobs.end(); play(); });
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
    // gang turf, tinted
    if (world.north) for (const t of world.north.territories) { g.fillStyle = t.color; g.globalAlpha = .18; g.fillRect((t.x0 - player.x) * M.s, (t.z0 - player.z) * M.s, (t.x1 - t.x0) * M.s, (t.z1 - t.z0) * M.s); g.globalAlpha = 1; }
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
    if ((time * 3 | 0) % 2 === 0) for (const m of jobs.markers()) dot(toMap(m.x, m.z, true), W * .04, m.color);   // calls for the shift, blinking (at the edge when far)
    for (const c of combat.cashDrops) if (c.active) dot(toMap(c.x, c.z), W * .018, '#6bff8a');
    if (autos && !places.current) for (const m of autos.markers()) { const q = toMap(m.x, m.z); if (q) { g.fillStyle = '#141018'; g.fillRect(q[0] - W * .03, q[1] - W * .022, W * .06, W * .044); g.fillStyle = '#3fe6e0'; g.fillRect(q[0] - W * .022, q[1] - W * .015, W * .044, W * .03); } }   // your own cars
    if (net && !places.current) for (const m of net.markers()) { const q = toMap(m.x, m.z); if (q) { dot(q, W * .036, '#141018'); dot(q, W * .026, '#ffe14f'); } }   // the other players
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
    if (world.fashion) icon(world.fashion.cx, world.fashion.cz, '#ff7eb6', '#fff', '👕', false);
    if (world.security) icon(world.security.cx, world.security.cz, '#1c2a3e', '#3fe6e0', '🛡', false);
    for (const s of shops.icons()) icon(s.x, s.z, s.bg, s.fg, s.ch, !!s.mine);   // shops, cafés, homes (yours stay at the edge)
    if (world.bay) icon(503, -433, '#3f8fe6', '#fff', '✈', false);
    if (world.tropic) icon(world.tropic.center.x, world.tropic.center.z, '#3cc850', '#fff', '🐢', false);
    if (world.military) icon(world.military.center.x - 17, world.military.center.z + 7, '#e8c020', '#141414', '⚠', false);
    icon(world.spray.center.x, world.spray.center.z, '#b06bff', '#fff', '✎', police.wanted > 0);
    if (world.fireStation) icon(world.fireStation.center.x, world.fireStation.center.z, '#e0483a', '#fff', '🔥', false);
    if (places.dealer) icon(25, -86, '#3fe6e0', '#141018', '🚗', false);
    if (world.north && world.north.sport) icon(world.north.sport.x, world.north.sport.z, '#c81e2a', '#fff', '🥊', false);
    if (world.strip) icon(world.strip.cx, world.strip.cz, '#ff2d7a', '#fff', '♀', false);
    if (world.north && world.north.prison) icon(world.north.prison.x, world.north.prison.z, '#5a6270', '#fff', '⛓', false);
    const ns = world.street.nightSpot(); if (ns) icon(ns.x, ns.z, '#ff2d7a', '#fff', '♥', false);   // the girls outside Hotel OCEAN, at night   // with stars on, the spray shop shows at the edge
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
  const BM_LABELS = [['Даунтаун NEPLOXO', 0, 0], ['Бульвар Not Bad', 79, -30], ['Лёха-Хайтс', -79, 60], ['Гавань Лёхи', -79, -60], ['Рынок «Неплохо»', 0, -79], ['Квартал 21', 0, 79],
    ['Пляж Not Bad', 124, 12], ['Залив Неплохо', 245, 40], ['Мост NEPLOXO', 230, -112], ['Хайтс Not Bad', 425, 38], ['Пойнт 21', 425, -22], ['Мыс Неплохо', 492, 30], ['Остров Not Bad', 430, 102], ['Открытое море', -180, 0], ['Открытое море', 200, 200], ['Открытое море', 820, -120], ['Мост 21', 20, -145], ['Район 21', 75, -300], ['Доки', 75, -380], ['Земля Кобр', -40, -210], ['Земля Черепов', 190, -210], ['Лёха-Вью', 545, -300], ['Аэропорт LEHA NEPLOXO', 545, -480], ['Портовый мост', 298, -305], ['Мост Лёха-Вью', 470, -142], ['Остров Лёхи', 760, 100], ['Остров Омега-21', -400, 290], ['Запретная зона', -420, 390]];
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
    if (world.fashion) add(world.fashion.cx, world.fashion.cz, '#ff7eb6', '#fff', '👕', 'Бутик NOT BAD Fashion');
    if (world.security) add(world.security.cx, world.security.cz, '#1c2a3e', '#3fe6e0', '🛡', 'Охранное агентство Shield Security: телохранители');
    for (const s of shops.icons()) add(s.x, s.z, s.bg, s.fg, s.ch, s.label);
    if (world.bay) add(503, -433, '#3f8fe6', '#fff', '✈', 'Аэропорт LEHA NEPLOXO International');
    if (world.tropic) add(world.tropic.center.x, world.tropic.center.z, '#3cc850', '#fff', '🐢', 'Остров Лёхи: необитаемый, только на лодке или вертолёте');
    if (world.military) add(world.military.center.x - 17, world.military.center.z + 7, '#e8c020', '#141414', '⚠', 'Остров Омега-21: секретная военная база, вход запрещён');
    if (world.north) for (const h of world.north.hangouts) add(h.x, h.z, h.gang === 'red' ? '#c81e1e' : '#1f9a55', '#fff', '☠', h.name);
    if (world.north && world.north.sport) add(world.north.sport.x, world.north.sport.z, '#c81e2a', '#fff', '🥊', 'NOT BAD BOXING и NEPLOXO GYM: ринг, спарринги, тренажёры');
    if (world.strip) add(world.strip.cx, world.strip.cz, '#ff2d7a', '#fff', '♀', 'Стрип-клуб NOT BAD GIRLS (круглосуточно)');
    if (world.north && world.north.prison) add(world.north.prison.x, world.north.prison.z, '#5a6270', '#fff', '⛓', 'Тюрьма Района 21: можно зайти и посмотреть камеры');
    add(world.spray.center.x, world.spray.center.z, '#b06bff', '#fff', '✎', 'Покраска NEON SPRAY: снимает розыск');
    if (world.fireStation) add(world.fireStation.center.x, world.fireStation.center.z, '#e0483a', '#fff', '🔥', 'Пожарная часть');
    if (places.dealer) add(25, -86, '#3fe6e0', '#141018', '🚗', 'NEPLOXO MOTORS: автосалон, эксклюзивные машины');
    if (world.street.motel) add(world.street.motel.center.x, world.street.motel.center.z, '#ff2d7a', '#fff', '♥', 'Мотель Pink Flamingo: девушки с 19:00 до 5:00');
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
    // gang turf on the North Side
    if (world.north) for (const t of world.north.territories) { g.fillStyle = t.color; g.globalAlpha = .16; g.fillRect(sx(t.x0), sz(t.z0), (t.x1 - t.x0) * sc, (t.z1 - t.z0) * sc); g.globalAlpha = 1; }
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
    const heli = !!(drv && drv.model.heli) && (drv.model.jet ? 'jet' : 'heli');
    document.body.classList.toggle('tank', !!(drv && drv.model.id === 'tank'));
    if (heli !== hudHeli) {
      hudHeli = heli;
      const L = heli === 'jet' ? ['ГАЗ', 'ТОРМОЗ', 'ВВЕРХ', 'ВНИЗ'] : heli ? ['ВПЕРЁД', 'НАЗАД', 'ВВЕРХ', 'ВНИЗ'] : ['ГАЗ', 'ТОРМОЗ', 'РУЧНИК', 'БИП'];
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
    const aCap = progress.armor > 100 ? MEGA_VEST : 100, aw = Math.max(progress.armor > 0 ? 1 : 0, Math.round(progress.armor / aCap * 100)) + '%'; if ($('armorFill').style.width !== aw) $('armorFill').style.width = aw;
    $('armor').classList.toggle('mega', progress.armor > 100);
    const wi = weather.info, wt = wi.icon + ' ' + wi.name; if ($('weather').textContent !== wt) $('weather').textContent = wt;
    const mt = progress.money.toLocaleString('ru-RU'); if ($('moneyNum').textContent !== mt) $('moneyNum').textContent = mt;
    const job = places.hud || taxi.hud || jobs.hud;
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
      { const t = sharedTime(); if (Math.abs(t - time) > 1) time = t; }   // back in step after a pause or a slow frame
      guards.update(dt);
      wildlife.update(dt, player);
      input.poll();
      if (respawnT > 0) {
        respawnT -= dt; if (respawnT <= 0) respawn();
        input.move.x = input.move.y = 0; input.fire = false; input.action = false; input.jump = false; input.throttle = 0;
      }
      // in the spray shop the car stands still until the door goes up again
      // following a girl up to the motel room: the hero walks after her on his own
      const lead = world.street.autoWalk && world.street.autoWalk();
      if (lead) {
        const cy = Math.cos(rig.yaw), sy = Math.sin(rig.yaw), m = lead.mag || 0;
        input.move.x = (lead.dx * cy - lead.dz * sy) * m; input.move.y = (-lead.dx * sy - lead.dz * cy) * m;
        input.sprint = false; input.fire = false; input.jump = false; input.action = false;
      }
      if (places.current && places.current.onInput) places.current.onInput(input);   // training, the ring: the place reads the buttons first
      player.speedMul = 1 + ((progress.stats && progress.stats.sta) || 0) / 1000;
      if (places.current && places.current.busy && places.current.busy()) { input.move.x = input.move.y = 0; input.fire = false; input.jump = false; input.action = false; }
      // in the tank: the fire button fires the main gun straight down the barrel
      if (vehicles.driving && vehicles.driving.model.id === 'tank') { tankReload -= dt; if (input.fire && tankReload <= 0) { tankReload = 1.4; fireTankGun(vehicles.driving); } }
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
      if (!vehicles.driving && player.standCar && player.onGround && !player.dead) rideCar(player.standCar);
      combat.update(dt, input, aim, !!vehicles.driving || player.swim);
      shellsStep(dt);   // no fighting while swimming
      police.update(dt, player, rig.yaw);
      ems.update(dt, player, rig.yaw, lowCrowd() ? 1 : 2);
      fire.update(dt, player);
      sea.update(dt);
      taxi.update(dt);
      if (seatSpot && !player.seat) { seatSpot.taken = false; seatSpot = null; }   // got up: passers-by may sit there again
      places.update(dt); shops.tick(dt); jobs.update(dt); net.update(dt); business.update(dt); autos.update(dt);
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
      if (!fading) { const m = places.doors(player, !drv && !player.dead && respawnT <= 0); if (m) { if (m.dir === 'in') { enterPlace(m.place); if (m.info && m.info.enter) m.info.enter(); else if (m.place.id === 'villa' && progress.villa && progress.homeSpawn !== 'villa') { progress.homeSpawn = 'villa'; saveProgress(); flashTip('Теперь игра будет начинаться здесь: вилла', 3); } } else exitPlace(m.place); } }
  }
  let last = performance.now(), frameNo = 0, menuT = 0;
  const snapV = v => Math.round(v / 2) * 2;
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000; last = now;
    radio.update(state === 'playing' && !!vehicles.driving);
    if (state === 'playing' || state === 'menu') plane.update(Math.min(raw, .05));
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
    fronts.update(now / 1000, camera.position, env.night || 0, !!inside);
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
      audio.alarm(active && ((bank && bank.alarm() && (places.current === bank || Math.hypot(player.x - bank.door.x, player.z - bank.door.z) < 70)) || (world.military && world.military.alarm)));
    }
    vehicles.setNight(env.night);
    renderer.render(scene, camera);
  }

  if (isTouchDevice) input.setTouch(true);
  applyQuality();
  onResize();
  show('menu');
  document.body.classList.add('ready');
  NB.debug = { get jobs() { return jobs; }, get net() { return net; }, player, vehicles, radio, audio, plane, guards, wildlife, crowd, animals, world, fire, weather, sea, rig, toggleCar, input, play, police, combat, heroDamage, ems, taxi, shop, dn, progress, addMoney, openShop, closeShop, places, ui, enterPlace, exitPlace, teleport, saveProgress, get interact() { return interact; },
    simulate(n, dt = 1 / 60) { state = 'playing'; for (let i = 0; i < n; i++) { stepPlaying(dt, dt); if (state !== 'playing') break; } },
    setHour(h) { clockShift = 0; const cur = (START_MIN + sharedTime()) % 1440; clockShift = ((h * 60 - cur) % 1440 + 1440) % 1440; time = sharedTime(); },
    get state() { return state; }, get promptCar() { return promptCar; } };
  requestAnimationFrame(frame);
})(window.NB);
