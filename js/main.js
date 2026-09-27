// Boot: renderer, sky and light, game states, HUD, minimap, quality settings and the main loop.
(function (NB) {
  'use strict';
  const { U } = NB;
  const $ = id => document.getElementById(id);

  if (!window.THREE) { $('lede').textContent = 'Не удалось загрузить 3D-движок. Проверьте интернет и обновите страницу.'; return; }

  const isTouchDevice = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0;
  const settings = { sens: 1, quality: 'auto' };
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
  const START_MIN = 19 * 60 + 12, MENU_HOUR = 19.35;

  const world = NB.buildWorld(scene, renderer);
  const player = new NB.Player(scene, world.col);
  player.place(world.spawn.x, world.spawn.z, world.spawn.heading);
  const rig = new NB.CameraRig(camera, world.col);
  const lowCrowd = () => settings.quality === 'low' || isTouchDevice || (settings.quality === 'auto' && !shadowsOn && scale < .6);
  const crowdOpts = {
    limits: () => lowCrowd() ? { walkers: 18, beach: 8, spotRange: 55, cops: 2 } : { walkers: 32, beach: 14, spotRange: 80, cops: 3 },
    onBump: (p, text) => say(p, text)
  };
  const crowd = NB.createCrowd(scene, world, crowdOpts);
  // speech bubbles over people the hero bumps into
  const bubbles = [...document.querySelectorAll('.bubble')].map(el => ({ el, owner: null, t: 0 }));
  function say(p, text) {
    const b = bubbles.find(x => !x.owner) || bubbles.reduce((a, c) => (a.t < c.t ? a : c));
    b.owner = p; b.t = 2.2; b.el.textContent = text; b.el.hidden = false; p.bubble = b;
  }
  const projV = new THREE.Vector3();
  function updateBubbles(dt) {
    for (const b of bubbles) {
      if (!b.owner) continue;
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
  const vehOpts = { audio, onImpact: s => { shake = Math.min(.6, shake + s * .025); if (taxi) taxi.onImpact(s); } };
  const vehicles = NB.createVehicles(scene, world, vehOpts);
  const carLimits = () => lowCrowd() ? { traffic: 6, carRange: 90, patrols: 1 } : { traffic: 12, carRange: 130, patrols: 2 };
  let shake = 0, promptCar = null;
  const carCam = { x: 0, y: 0, z: 0, heading: 0, speed: 0, camDist: 7.2, camH: 1.7 };
  function toggleCar() {
    const car = vehicles.driving;
    if (car) {
      if (vehicles.exit(player)) {
        player.inCar = false; player.m.root.visible = true; player.blob.visible = true;
        document.body.classList.remove('driving'); rig.snap(player);
      } else flashTip('Сначала остановитесь', 1.5);
    } else if (promptCar) {
      const wasDriven = !!promptCar.ai || !!promptCar.pursuit || !!promptCar.goto, isPolice = !!promptCar.police, isAmb = !!promptCar.ems;
      const ej = vehicles.enter(promptCar, player);
      if (ej) { if (ej.cop || isPolice) crowd.spawnCop(0, 0, 0, 0, 0, 0, ej.x, ej.z); else crowd.ejectDriver(ej.x, ej.z, ej.h); }
      if (isPolice) police.reportCrime('copcar', player.x, player.z); else if (wasDriven) police.reportCrime('carjack', player.x, player.z);
      if (isAmb && player.hp < 100) { player.hp = 100; flashTip('Аптечка скорой: здоровье восстановлено', 2.4); }
      player.inCar = true; player.m.root.visible = false; player.blob.visible = false;
      document.body.classList.add('driving');
      showDistrict(promptCar.model.name);
      $('carName').textContent = promptCar.model.name;
    }
  }

  /* ---------- fights and the police ---------- */
  let respawnT = 0, endKind = '', vignette = 0;
  const police = NB.createPolice(world, {
    crowd, vehicles, flash: (t, s) => flashTip(t, s),
    onWanted: (n, prev) => { if (n > prev) audio.starUp(); if (n > 0 && prev === 0) flashTip(n === 1 ? 'Полиция это видела!' : 'Полиция открыла на вас охоту!', 2.2); },
    onBust: () => endLife('busted')
  });
  const combat = NB.createCombat(scene, world, { crowd, vehicles, player, audio, police, flash: (t, s) => flashTip(t, s), onPlayerHit: d => heroDamage(d), onCash: n => addMoney(n, 'Подобрано') });

  /* ---------- money, armour and the saved game ---------- */
  const progress = { money: 150, armor: 0, inv: null };
  try { Object.assign(progress, JSON.parse(localStorage.getItem('nb_save') || '{}')); } catch (e) {}
  progress.money = Math.max(0, Math.floor(+progress.money || 0)); progress.armor = U.clamp(+progress.armor || 0, 0, 100);
  combat.load(progress.inv);
  let saveT = 0;
  function saveProgress() { try { localStorage.setItem('nb_save', JSON.stringify({ money: progress.money, armor: Math.round(progress.armor), inv: combat.inv })); } catch (e) {} saveT = 0; }
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
    onHurt: (p, src) => { if (src.byPlayer && p.cop && src.kind !== 'car') police.reportCrime('copAttack', p.x, p.z); },
    onCopShoot: p => combat.copShoot(p, police.wanted),
    onHitPlayer: dmg => { heroDamage(dmg); audio.punch(null); },
    onBustTick: dt => { if (!player.inCar || vehicles.speedKmh() < 5) police.bustTick(dt); },
    onScream: p => audio.scream([p.x, 1.6, p.z]),
    onGroan: p => audio.groan([p.x, .4, p.z])
  });
  const ems = NB.createEMS(world, {
    crowd, vehicles, say: (p, t) => say(p, t),
    onDispatch: u => { if (Math.hypot(u.patient.x - player.x, u.patient.z - player.z) < 45) flashTip('Скорая выехала на вызов', 2); }
  });
  Object.assign(vehOpts, {
    onHeroHit: v => heroDamage(v * 2.2),
    onCopsExit: car => { const rx = -Math.cos(car.h), rz = Math.sin(car.h); for (const s of [-1, 1]) crowd.spawnCop(0, 0, 0, 0, 0, 0, car.x + rx * s * (car.model.w / 2 + .8), car.z + rz * s * (car.model.w / 2 + .8)); }
  });

  /* ---------- jobs and shopping ---------- */
  const taxi = NB.createTaxi(scene, world, { crowd, vehicles, audio, police, flash: (t, s) => flashTip(t, s), onPay: (n, note) => addMoney(n, note || 'Поездка на такси') });
  const shop = NB.createShop(scene, world, {
    combat, audio, police, flash: (t, s) => flashTip(t, s),
    getMoney: () => progress.money, spend: n => spend(n, 'Покупка'),
    getArmor: () => progress.armor, setArmor: v => { progress.armor = v; }
  });
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
    if (vehicles.driving || player.dead) return null;
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
    else { autoMax = Math.min(dpr, 1); setScale(autoMax); setShadows(!isTouchDevice); far = 250; }
    scene.fog.near = far * .28; scene.fog.far = far; camera.far = far + 60; camera.updateProjectionMatrix();
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
      if (scale > .6) setScale(Math.max(.55, scale - .15));
      else if (shadowsOn) setShadows(false);
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
  let state = 'menu', locked = false, everLocked = false, noLock = false, time = 0;
  const input = NB.createInput(canvas, {
    active: () => state === 'playing',
    locked: () => locked,
    requestLock: lock,
    onEscape: () => { if (!locked) pause(); },
    onZoom: s => { rig.dist = U.clamp(rig.dist + s * .6, 2.6, 9); },
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

  /* ---------- HUD ---------- */
  let tipTimer = 0;
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
    if (shop.place) {
      // orange disc with a little pistol
      const q = toMap(shop.place.cx, shop.place.cz, true), u = W * .012;
      dot(q, W * .06, '#ff8a3d'); g.fillStyle = '#2a1405';
      g.fillRect(q[0] - 3 * u, q[1] - 1.6 * u, 5.4 * u, 1.6 * u); g.fillRect(q[0] - 3 * u, q[1] - .2 * u, 1.6 * u, 2.6 * u);
    }
    // taxi: the waiting fare blinks, the destination is a ring that sticks to the edge when far away
    for (const m of taxi.markers) {
      const q = toMap(m.x, m.z, true);
      if (m.kind === 'fare') { if ((time * 3 | 0) % 2 === 0) dot(q, W * .045, '#ffd84f'); dot(q, W * .022, '#2a1c05'); }
      else { dot(q, W * .055, '#ffd84f'); dot(q, W * .03, '#2a1c05'); dot(q, W * .016, '#ffd84f'); }
    }
    g.strokeStyle = 'rgba(255,241,228,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(Rr, Rr, Rr - 1, 0, 7); g.stroke();
  }
  function updateHUD(dt) {
    const mins = Math.floor(START_MIN + time) % (24 * 60);
    const clock = String((mins / 60) | 0).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
    if ($('clock').textContent !== clock) $('clock').textContent = clock;
    hudT += dt;
    if (hudT > .4) { hudT = 0; const d = world.districtAt(player.x, player.z); if (d !== district) showDistrict(d); }
    if (districtT > 0) { districtT -= dt; if (districtT <= 0) $('district').classList.remove('on'); }
    const drv = vehicles.driving;
    if (drv) { const kmh = String(Math.round(vehicles.speedKmh())); if ($('speedNum').textContent !== kmh) $('speedNum').textContent = kmh; }
    const promptText = drv || !promptCar || input.touch ? '' : 'F — сесть в ' + promptCar.model.name;
    if ($('prompt').textContent !== promptText) $('prompt').textContent = promptText;
    $('prompt').hidden = !promptText;
    const enter = $('btnEnter'), label = drv ? 'ВЫЙТИ' : 'СЕСТЬ';
    enter.classList.toggle('avail', !!(drv || promptCar)); if (enter.textContent !== label) enter.textContent = label;
    // health, stars, weapon, crosshair, lock-on ring, damage flash
    const hpw = Math.round(player.hp) + '%'; if ($('hpFill').style.width !== hpw) $('hpFill').style.width = hpw;
    $('hp').classList.toggle('low', player.hp <= 30);
    $('armor').hidden = progress.armor <= 0;
    const aw = Math.round(progress.armor) + '%'; if ($('armorFill').style.width !== aw) $('armorFill').style.width = aw;
    const mt = progress.money.toLocaleString('ru-RU'); if ($('moneyNum').textContent !== mt) $('moneyNum').textContent = mt;
    const job = taxi.hud;
    $('job').hidden = !job;
    if (job) {
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
    const showCross = !drv && !combat.isMelee() && !input.touch && !player.dead;
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
      if (input.cycle) { combat.cycle(1); input.cycle = 0; }
      if (input.select >= 0) { combat.select(input.select); input.select = -1; }
      const [lx, ly] = input.takeLook(settings.sens);
      rig.look(lx, ly);
      if (input.action) { input.action = false; toggleCar(); }
      const aim = computeAim();
      rig.aimBlend = U.damp(rig.aimBlend, input.aim && !combat.isMelee() && !vehicles.driving && !player.dead ? 1 : 0, 10, dt);
      if (!vehicles.driving) player.update(dt, input, rig.yaw); else input.jump = false;
      vehicles.update(dt, { player, input, people: crowd.people, camYaw: rig.yaw, limits: carLimits, police, target: { x: player.x, z: player.z, vx: player.vx, vz: player.vz, onFoot: !vehicles.driving } });
      combat.update(dt, input, aim, !!vehicles.driving);
      police.update(dt, player, rig.yaw);
      ems.update(dt, player, rig.yaw, lowCrowd() ? 1 : 2);
      taxi.update(dt);
      if ((saveT += dt) > 5) saveProgress();
      const drv = vehicles.driving;
      if (drv) { player.x = drv.x; player.z = drv.z; player.y = drv.y; player.heading = drv.h; player.vx = drv.vx; player.vz = drv.vz; }
      crowd.update(dt, time, player, rig.yaw, vehicles.dangers(), police);
      promptCar = drv || player.dead || respawnT > 0 ? null : vehicles.nearest(player);
      if (drv) {
        const vF = drv.vx * Math.sin(drv.h) + drv.vz * Math.cos(drv.h);
        Object.assign(carCam, { x: drv.x, y: drv.y, z: drv.z, heading: drv.h, speed: vF, camDist: 5.2 + drv.model.l * .45 + Math.abs(vF) * .05 });
        rig.update(dt, carCam);
      } else rig.update(dt, player);
      if (shake > .01) { camera.position.x += (Math.random() - .5) * shake; camera.position.y += (Math.random() - .5) * shake; shake *= Math.exp(-8 * dt); }
      audio.listener(camera.position.x, camera.position.y, camera.position.z, -Math.sin(rig.yaw), -Math.cos(rig.yaw));
      updateBubbles(dt);
      updateHUD(dt);
      if (raw < .5) adapt(raw);
      if (shop.update(player, !drv && !player.dead && respawnT <= 0)) openShop();
  }
  let last = performance.now(), frameNo = 0, menuT = 0;
  const snapV = v => Math.round(v / 2) * 2;
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000; last = now;
    const dt = Math.min(raw, .05);
    if (state === 'playing') {
      stepPlaying(dt, raw);
    } else if (state === 'menu') {
      menuT += dt;
      vehicles.update(dt, { player, input: { throttle: 0, move: { x: 0 }, handbrake: false, horn: false }, people: crowd.people, camYaw: -Math.PI / 2, limits: carLimits });
      crowd.update(dt, menuT, player, -Math.PI / 2, vehicles.dangers());
      const z = Math.sin(menuT * .05) * 55;
      camera.position.set(136, 7 + Math.sin(menuT * .13), z);
      camera.lookAt(70, 11, z * .7);
    }
    const env = dn.update(state === 'menu' ? MENU_HOUR : (START_MIN + time) / 60, now / 1000);
    const fx = state === 'menu' ? camera.position.x - 40 : player.x, fz = state === 'menu' ? camera.position.z : player.z;
    sun.target.position.set(snapV(fx), 0, snapV(fz)); sun.target.updateMatrixWorld();
    sun.position.copy(sun.target.position).addScaledVector(env.lightDir, 90);
    if (shadowsOn && (++frameNo & 1)) renderer.shadowMap.needsUpdate = true;
    sky.position.copy(camera.position);
    world.update(now / 1000, env);
    vehicles.setNight(env.night);
    renderer.render(scene, camera);
  }

  if (isTouchDevice) input.setTouch(true);
  applyQuality();
  onResize();
  show('menu');
  document.body.classList.add('ready');
  NB.debug = { player, vehicles, crowd, rig, toggleCar, input, play, police, combat, heroDamage, ems, taxi, shop, dn, progress, addMoney, openShop, closeShop,
    simulate(n, dt = 1 / 60) { state = 'playing'; for (let i = 0; i < n; i++) { stepPlaying(dt, dt); if (state !== 'playing') break; } },
    setHour(h) { time = ((h * 60 - START_MIN) % 1440 + 1440) % 1440; },
    get state() { return state; }, get promptCar() { return promptCar; } };
  requestAnimationFrame(frame);
})(window.NB);
