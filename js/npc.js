// Pedestrians. Every body part of every person is one instance of a single unit-box InstancedMesh,
// so the whole crowd is one draw call. People walk a sidewalk graph, wander the beach, jog,
// sit on benches, sunbathe, chat in groups, and react when the hero bumps into them.
(function (NB) {
  'use strict';
  const { U } = NB;
  const rand = U.rand, pick = a => a[(Math.random() * a.length) | 0];
  const chance = p => Math.random() < p;

  /* ---------- body layout ---------- */
  // joints: 0 root, 1 hips, 2 torso, 3 head, 4 shoulderL, 5 elbowL, 6 shoulderR, 7 elbowR, 8 hipL, 9 kneeL, 10 hipR, 11 kneeR
  const BASE = [
    ['pelvis', 1, 0, .01, 0, .34, .15, .21], ['torso', 2, 0, .27, 0, .4, .5, .23], ['top', 2, 0, .35, .004, .41, .13, .24],
    ['tie', 2, 0, .3, .118, .06, .3, .012], ['neck', 3, 0, .04, 0, .1, .08, .1], ['head', 3, 0, .2, .005, .22, .25, .23],
    ['hairTop', 3, 0, .33, -.005, .235, .07, .245], ['hairBack', 3, 0, .24, -.095, .235, .17, .07],
    ['brim', 3, 0, .36, 0, .38, .03, .38], ['crown', 3, 0, .41, -.005, .24, .1, .25], ['shades', 3, 0, .225, .122, .21, .055, .02],
    ['uaL', 4, 0, -.08, 0, .13, .2, .14], ['ua2L', 4, 0, -.22, 0, .09, .1, .09], ['faL', 5, 0, -.12, 0, .085, .24, .085], ['handL', 5, 0, -.28, 0, .09, .09, .065],
    ['uaR', 6, 0, -.08, 0, .13, .2, .14], ['ua2R', 6, 0, -.22, 0, .09, .1, .09], ['faR', 7, 0, -.12, 0, .085, .24, .085], ['handR', 7, 0, -.28, 0, .09, .09, .065],
    ['bag', 7, 0, -.42, .02, .08, .28, .36],
    ['thighL', 8, 0, -.23, 0, .15, .46, .17], ['shinL', 9, 0, -.21, 0, .13, .42, .15], ['shoeL', 9, 0, -.45, .05, .14, .08, .27],
    ['thighR', 10, 0, -.23, 0, .15, .46, .17], ['shinR', 11, 0, -.21, 0, .13, .42, .15], ['shoeR', 11, 0, -.45, .05, .14, .08, .27],
    ['skirt', 1, 0, -.12, 0, .38, .3, .27]
  ];
  const PARTS = BASE.length, KEY = {}, JOINT = BASE.map(b => b[1]);
  BASE.forEach((b, i) => { KEY[b[0]] = i; });

  const SKIN = ['#f3cfb0', '#e8b890', '#d49a6e', '#b97a50', '#8d5a36', '#633b22'];
  const HAIR = ['#1e140e', '#2e1d12', '#4a2e1a', '#6b4423', '#a8743c', '#d9b36c', '#e9d6a4', '#b34a2a', '#111111'];
  const SUIT = ['#23262e', '#343a46', '#2c3a55', '#4a4038', '#e9e3d4', '#6f7580', '#3b2d3f'];
  const SUIT_F = ['#23262e', '#e9e3d4', '#b0374f', '#2c3a55', '#f2c6d4', '#6f7580', '#1f5f5b'];
  const TIE = ['#b0203a', '#1e3f8a', '#d9a21e', '#ff4fa3', '#2b8a5a'];
  const SHIRT = ['#ff7eb6', '#4fd1c5', '#ffcf5c', '#b388ff', '#ff9966', '#7fd67a', '#ffffff', '#6fa8ff', '#ff5f5f'];
  const SHORTS = ['#e8dcc0', '#3b5a8a', '#6b8e5a', '#2a2a2a', '#c9a27a', '#f2f2f2'];
  const DRESS = ['#ff7eb6', '#ffffff', '#ffd84f', '#4fd1c5', '#b388ff', '#ff6b5a', '#9be37a'];
  const SWIM = ['#ff3d7f', '#ffd23d', '#3dd6ff', '#ff7a3d', '#9b5cff', '#ffffff', '#2bd67b', '#111111', '#ff5fd2'];
  const SPORT = ['#ff4fa3', '#3fe6e0', '#ffffff', '#ffd84f', '#8cff6b'];
  const CAR_PHRASES = ['Смотри куда едешь!', 'Эй, тормози!', 'Совсем сдурел?!', 'Караул!', 'Ты что творишь?!', 'Тут люди ходят!'];
  const CARJACK_PHRASES = ['Эй! Это моя машина!', 'Верни машину!', 'Полиция! Угнали!', 'Ты что делаешь?!', 'Ну всё, я звоню копам!'];
  const FLEE_PHRASES = ['Помогите!', 'Он псих!', 'Бежим!', 'Не стреляйте!', 'Полиция!!', 'А-а-а!'];
  const FIGHT_PHRASES = ['Ах ты так?!', 'Ну держись!', 'Сам напросился!', 'Иди сюда!'];
  const PHRASES = ['Эй, смотри куда идёшь!', 'Осторожнее!', 'Ай!', 'Ну ты даёшь!', 'Полегче, приятель!', 'Куда ты так несёшься?', 'Извините?!', 'Совсем уже…'];

  function makeLook(type) {
    const female = /_f$/.test(type) || ((type === 'jogger' || type === 'elderly') && chance(.5)) || (type === 'cop' && chance(.3));
    const L = { type, female, hs: female ? rand(.9, 1) : rand(.96, 1.08), ws: rand(.92, 1.18), col: {}, hide: new Set(['tie', 'top', 'brim', 'crown', 'shades', 'bag', 'skirt']),
      long: false, skirt: 0, purse: false, speed: rand(1.1, 1.4), lean: 0, run: false };
    const skin = pick(SKIN), hair = type === 'elderly' ? pick(['#9a9a9a', '#c9c9c9', '#e5e5e5']) : pick(HAIR);
    const set = (keys, c) => keys.split(' ').forEach(k => { L.col[k] = c; });
    const show = keys => keys.split(' ').forEach(k => L.hide.delete(k));
    set('neck head handL handR', skin); set('hairTop hairBack', hair);
    L.long = female && chance(.75);
    if (!female && chance(.12)) L.hide.add('hairTop');
    const sleeves = (kind, c) => { set('uaL uaR', kind === 'none' ? skin : c); set('ua2L ua2R', kind === 'long' ? c : skin); set('faL faR', kind === 'long' ? c : skin); };
    const legs = (kind, c) => { set('pelvis', c); set('thighL thighR', kind === 'bare' ? skin : c); set('shinL shinR', kind === 'pants' ? c : skin); };
    const extras = (hat, shades) => {
      if (chance(hat)) { show('brim crown'); set('brim crown', pick(['#e8d49a', '#f5f0e6', '#ff7eb6', '#2a2a2a'])); }
      if (chance(shades)) { show('shades'); set('shades', '#141018'); }
    };
    switch (type) {
      case 'business_m': {
        const s = pick(SUIT); set('torso', s); sleeves('long', s); legs('pants', s); set('shoeL shoeR', '#141414');
        show('tie'); set('tie', pick(TIE));
        if (chance(.5)) { show('bag'); set('bag', pick(['#4a2e1a', '#1a1a1a', '#6b4a2a'])); }
        L.speed = rand(1.45, 1.75); extras(0, .25); break;
      }
      case 'business_f': {
        const s = pick(SUIT_F); set('torso', s); sleeves('long', s);
        if (chance(.65)) { legs('bare', s); show('skirt'); set('skirt', s); L.skirt = 1; } else legs('pants', s);
        set('shoeL shoeR', pick(['#141414', '#7a1d2e', '#3a2a1e']));
        if (chance(.45)) { show('bag'); set('bag', pick(['#141414', '#7a1d2e', '#c9a27a'])); L.purse = true; }
        L.speed = rand(1.35, 1.6); extras(0, .3); break;
      }
      case 'tourist_m': {
        const s = pick(SHIRT); set('torso', s); sleeves('short', s); legs('shorts', pick(SHORTS));
        set('shoeL shoeR', pick(['#f2f2f2', '#d8cfc0', '#5a4a3a'])); extras(.3, .45); break;
      }
      case 'tourist_f': {
        if (chance(.5)) { const c = pick(DRESS); set('torso', c); sleeves('none', c); legs('bare', c); show('skirt'); set('skirt', c); L.skirt = 2; }
        else { const c = pick(SHIRT); set('torso', c); sleeves('none', c); legs('shorts', pick(SHORTS)); }
        set('shoeL shoeR', pick(['#c9a27a', '#f2f2f2', '#ff7eb6']));
        if (chance(.3)) { show('bag'); set('bag', pick(['#f5f0e6', '#c9a27a', '#ff7eb6'])); L.purse = true; }
        extras(.3, .5); break;
      }
      case 'beach_f': {
        const b = pick(SWIM); set('torso', skin); sleeves('none'); legs('bare', b); set('pelvis', b);
        show('top'); set('top', chance(.7) ? b : pick(SWIM)); set('shoeL shoeR', skin);
        L.speed = rand(.9, 1.2); extras(.25, .5); break;
      }
      case 'beach_m': {
        set('torso', skin); sleeves('none'); legs('shorts', pick(SWIM)); set('shoeL shoeR', skin);
        L.speed = rand(.95, 1.25); extras(.15, .4); break;
      }
      case 'jogger': {
        const t = pick(SPORT); set('torso', t); sleeves(female ? 'none' : 'short', t); legs('shorts', pick(['#1a1a1a', '#2b3d6b', '#ff4fa3', '#f2f2f2']));
        set('shoeL shoeR', '#f2f2f2'); L.speed = rand(3, 3.6); L.run = true; extras(0, .4); break;
      }
      case 'medic': {
        set('torso', '#f2f4f7'); sleeves('short', '#f2f4f7'); legs('pants', '#2b3550'); set('shoeL shoeR', '#111111');
        show('tie bag'); set('tie', '#e02a2a'); set('bag', '#d42a2a');
        L.speed = rand(1.3, 1.5); break;
      }
      case 'cop': {
        set('torso', '#23407a'); sleeves('short', '#23407a'); legs('pants', '#18223c'); set('shoeL shoeR', '#111111');
        show('brim crown tie bag'); set('crown', '#18223c'); set('brim', '#111111'); set('tie', '#e8c547'); set('bag', '#151515');
        if (chance(.4)) { show('shades'); set('shades', '#141018'); }
        L.speed = rand(1.2, 1.4); break;
      }
      default: { // elderly
        const s = pick(['#d9c7a6', '#a9c4d8', '#e6b8c2', '#c8d9b0', '#f3efe6']); set('torso', s); sleeves(chance(.5) ? 'long' : 'short', s);
        legs('pants', pick(['#c9b89a', '#8a8f98', '#e8e2d4'])); set('shoeL shoeR', '#5a4030');
        L.speed = rand(.72, .92); L.lean = .14; extras(.45, .3);
      }
    }
    // per-part centre and size, with the body variations baked in
    L.cs = new Float32Array(PARTS * 6);
    BASE.forEach((b, i) => {
      let [, , cx, cy, cz, sx, sy, sz] = b;
      const k = b[0];
      if (k === 'torso') { sx *= (female ? .9 : 1) * L.ws; sz *= L.ws; }
      if (k === 'top') { sx *= (female ? .9 : 1) * L.ws + .01; sz = .24 * L.ws + .01; }
      if (k === 'pelvis') sx *= (female ? 1.04 : 1) * L.ws;
      if (k === 'tie') cz = .118 * L.ws;
      if (k === 'hairBack' && L.long) { sy = .4; cy = .12; }
      if (k === 'skirt') { if (L.skirt === 2) { sy = .66; cy = -.3; sx = .42 * L.ws; sz = .3; } else { sx = .37 * L.ws; } }
      if (k === 'bag' && L.purse) { sx = .07; sy = .2; sz = .26; cy = -.36; }
      if (type === 'medic') { // red cross patch, medical bag
        if (k === 'tie') { cx = -.1; cy = .4; cz = .12 * L.ws; sx = .08; sy = .08; sz = .02; }
        if (k === 'bag') { cy = -.36; cz = .02; sx = .14; sy = .2; sz = .3; }
      }
      if (type === 'cop') { // peaked cap, badge, pistol in hand
        if (k === 'brim') { cy = .345; cz = .1; sx = .25; sy = .03; sz = .16; }
        if (k === 'crown') { cy = .39; sx = .245; sy = .09; sz = .25; }
        if (k === 'tie') { cx = -.1; cy = .4; cz = .12 * L.ws; sx = .07; sy = .07; sz = .02; }
        if (k === 'bag') { cy = -.33; cz = .1; sx = .05; sy = .11; sz = .2; }
      }
      if (L.hide.has(k)) sx = sy = sz = 0;
      L.cs.set([cx, cy, cz, sx, sy, sz], i * 6);
    });
    return L;
  }

  const TYPE_MIX = {
    downtown: [['business_m', .33], ['business_f', .3], ['tourist_m', .14], ['tourist_f', .13], ['elderly', .06], ['jogger', .04]],
    strip: [['tourist_m', .24], ['tourist_f', .26], ['beach_f', .16], ['beach_m', .12], ['elderly', .1], ['business_m', .04], ['business_f', .04], ['jogger', .04]],
    promenade: [['beach_f', .28], ['beach_m', .22], ['tourist_f', .16], ['tourist_m', .14], ['jogger', .14], ['elderly', .06]],
    beach: [['beach_f', .48], ['beach_m', .4], ['tourist_f', .07], ['tourist_m', .05]],
    cop: [['cop', 1]],
    medic: [['medic', 1]],
    town: [['tourist_m', .22], ['tourist_f', .24], ['business_m', .12], ['business_f', .1], ['elderly', .16], ['jogger', .08], ['beach_f', .04], ['beach_m', .04]]
  };
  function typeFor(mix) { let r = Math.random(); for (const [t, w] of mix) { if ((r -= w) <= 0) return t; } return mix[0][0]; }

  /* ---------- system ---------- */
  NB.createCrowd = function (scene, world, opts) {
    const CAP = 110;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), CAP * PARTS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.castShadow = true;
    const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), WHITE = new THREE.Color(1, 1, 1);
    for (let i = 0; i < CAP * PARTS; i++) { mesh.setMatrixAt(i, ZERO); mesh.setColorAt(i, WHITE); }
    scene.add(mesh);
    const blobs = new THREE.InstancedMesh(new THREE.CircleGeometry(.4, 12).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .25, depthWrite: false }), CAP);
    blobs.frustumCulled = false; for (let i = 0; i < CAP; i++) blobs.setMatrixAt(i, ZERO); scene.add(blobs);

    const free = []; for (let i = CAP - 1; i >= 0; i--) free.push(i);
    const people = [];
    const col = world.col, tmp = [];
    const { ROADS, RH, CITY, SHORE, blocks } = world.layout;

    /* sidewalk graph: block rings, crossings at the zebra stripes, the beach promenade, park paths */
    const nodes = [];
    const node = (x, z, area) => { nodes.push({ x, z, nb: [], area }); return nodes.length - 1; };
    const link = (a, b) => { nodes[a].nb.push(b); nodes[b].nb.push(a); };
    const IN = 1.6, corner = {};
    const areaOf = b => b.type === 'hotel' ? 'strip' : b.type === 'downtown' ? 'downtown' : 'town';
    for (const b of blocks) {
      const a = areaOf(b), SW = node(b.bx0 + IN, b.bz0 + IN, a), SE = node(b.bx1 - IN, b.bz0 + IN, a), NE = node(b.bx1 - IN, b.bz1 - IN, a), NW = node(b.bx0 + IN, b.bz1 - IN, a);
      corner[b.i + ',' + b.j] = { SW, SE, NE, NW };
      if (b.type === 'park') {
        const mx = (b.bx0 + b.bx1) / 2, mz = (b.bz0 + b.bz1) / 2, R = 7.4;
        const S = node(mx, b.bz0 + IN, a), E = node(b.bx1 - IN, mz, a), N = node(mx, b.bz1 - IN, a), W = node(b.bx0 + IN, mz, a);
        link(SW, S); link(S, SE); link(SE, E); link(E, NE); link(NE, N); link(N, NW); link(NW, W); link(W, SW);
        const fS = node(mx, mz - R, a), fE = node(mx + R, mz, a), fN = node(mx, mz + R, a), fW = node(mx - R, mz, a);
        link(S, fS); link(E, fE); link(N, fN); link(W, fW); link(fS, fE); link(fE, fN); link(fN, fW); link(fW, fS);
      } else { link(SW, SE); link(SE, NE); link(NE, NW); link(NW, SW); }
    }
    for (const b of blocks) {
      const c = corner[b.i + ',' + b.j], r = corner[(b.i + 1) + ',' + b.j], u = corner[b.i + ',' + (b.j + 1)];
      if (r) { link(c.SE, r.SW); link(c.NE, r.NW); }
      if (u) { link(c.NW, u.SW); link(c.NE, u.SE); }
    }
    const PX = CITY + 2.9, promZ = [-104, 104];
    for (const b of blocks) if (b.i === 3) promZ.push(b.bz0 + IN, b.bz1 - IN);
    promZ.sort((a, b) => a - b);
    const prom = promZ.map(z => node(PX, z, 'promenade'));
    for (let k = 1; k < prom.length; k++) link(prom[k - 1], prom[k]);
    for (const b of blocks) if (b.i === 3) {
      const c = corner['3,' + b.j];
      link(c.SE, prom[promZ.indexOf(b.bz0 + IN)]); link(c.NE, prom[promZ.indexOf(b.bz1 - IN)]);
    }

    /* fixed spots: benches, loungers, chatting groups */
    const spots = [];
    for (const b of world.benches) {
      const fx = Math.sin(b.face), fz = Math.cos(b.face), ax = b.rot ? 0 : 1, az = b.rot ? 1 : 0;
      for (const s of [-.45, .45]) if (chance(.6)) spots.push({ kind: 'sit', x: b.x + ax * s - fx * .12, z: b.z + az * s - fz * .12, y: .66, heading: b.face, mix: 'town' });
    }
    for (const l of world.loungers) if (chance(.7)) spots.push({ kind: 'lie', x: l.x, z: l.z + .92, y: .47, heading: 0, mix: 'beach' });
    const groups = [];
    const ringBlocks = blocks.filter(b => b.type !== 'park' && b.type !== 'parking');
    for (let g = 0; g < 14; g++) {
      const b = pick(ringBlocks), side = (Math.random() * 4) | 0, t = rand(.25, .75);
      const inset = 2.45;
      let x, z;
      if (side === 0) { x = b.bx0 + inset; z = b.bz0 + (b.bz1 - b.bz0) * t; }
      else if (side === 1) { x = b.bx1 - inset; z = b.bz0 + (b.bz1 - b.bz0) * t; }
      else if (side === 2) { z = b.bz0 + inset; x = b.bx0 + (b.bx1 - b.bx0) * t; }
      else { z = b.bz1 - inset; x = b.bx0 + (b.bx1 - b.bx0) * t; }
      groups.push({ x, z, mix: areaOf(b), along: side < 2 ? 'z' : 'x' });
    }
    for (let g = 0; g < 7; g++) groups.push({ x: rand(114, 134), z: rand(-95, 95), mix: 'beach', along: 'x' });
    if (world.station) groups.push({ x: world.station.x + 1.4, z: world.station.z + 4.5, mix: 'cop', along: 'z' });
    if (world.hospital) groups.push({ x: world.hospital.x + .6, z: world.hospital.z + 5.5, mix: 'medic', along: 'z' });
    for (const g of groups) {
      const n = chance(.4) ? 3 : 2, seed = Math.random() * 10;
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2 + (g.along === 'x' ? 0 : Math.PI / 2);
        const x = g.x + Math.sin(a) * .55, z = g.z + Math.cos(a) * .55;
        spots.push({ kind: 'talk', x, z, y: 0, heading: Math.atan2(g.x - x, g.z - z), mix: g.mix, seed, idx: k, n });
      }
    }
    for (const s of spots) { s.person = null; s.y = s.kind === 'talk' ? floorAt(s.x, s.z, 5) : s.y; }

    /* ---------- physics helpers ---------- */
    function floorAt(x, z, fromY) {
      let f = 0;
      for (const b of col.query(x - .5, z - .5, x + .5, z + .5, tmp)) {
        if (b.maxY > fromY + .42) continue;
        if (x + .2 > b.minX && x - .2 < b.maxX && z + .2 > b.minZ && z - .2 < b.maxZ && b.maxY > f) f = b.maxY;
      }
      return f;
    }
    function collide(p) {
      const r = .3;
      for (const b of col.query(p.x - 1, p.z - 1, p.x + 1, p.z + 1, tmp)) {
        if (b.maxY <= p.y + .42 || b.minY >= p.y + 1.8) continue;
        const cx = U.clamp(p.x, b.minX, b.maxX), cz = U.clamp(p.z, b.minZ, b.maxZ);
        const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-5) { p.x += dx / d * (r - d); p.z += dz / d * (r - d); p.blocked += 1; }
      }
    }

    /* ---------- spawning ---------- */
    function spawn(look, x, z, mode) {
      if (!free.length) return null;
      const slot = free.pop();
      const p = { slot, look, x, z, y: floorAt(x, z, 5), heading: rand(0, Math.PI * 2), mode, anim: 'walk', speed: 0,
        phase: rand(0, 6), headY: 0, pauseT: 0, target: null, node: -1, prev: -1, off: rand(-.45, .45), blocked: 0,
        stuckT: 0, lastX: x, lastZ: z, bumpT: -9, stumbleT: 0, frame: (Math.random() * 3) | 0, seed: Math.random() * 10,
        cop: look.type === 'cop', hp: look.type === 'cop' ? 100 : 60, dead: false, fallT: 0, deadT: 0,
        fleeT: 0, fleeX: 0, fleeZ: 0, fightT: 0, punchCD: 0, punchT: 0, running: false,
        los: false, losT: Math.random() * .2, shootT: rand(.5, 1.2), sideT: 0, sideX: 0, sideZ: 0, chasing: false,
        pose: { bob: 0, lean: 0, twist: 0, headP: 0, headY: 0, aL: 0, aR: 0, eL: 0, eR: 0, tL: 0, tR: 0, kL: 0, kR: 0, spread: 0 } };
      const c = new THREE.Color();
      BASE.forEach((b, i) => { const hex = look.col[b[0]]; c.set(hex || '#ffffff'); mesh.setColorAt(slot * PARTS + i, c); if (look.cs[i * 6 + 3] === 0) mesh.setMatrixAt(slot * PARTS + i, ZERO); });
      mesh.instanceColor.needsUpdate = true;
      people.push(p);
      return p;
    }
    function despawn(p) {
      for (let i = 0; i < PARTS; i++) mesh.setMatrixAt(p.slot * PARTS + i, ZERO);
      blobs.setMatrixAt(p.slot, ZERO);
      free.push(p.slot);
      people.splice(people.indexOf(p), 1);
      if (p.spot) p.spot.person = null;
      if (p.bubble) p.bubble.owner = null;
    }
    function nextNode(p) {
      const nb = nodes[p.node].nb;
      let options = nb.filter(n => n !== p.prev);
      if (!options.length) options = nb;
      p.prev = p.node; p.node = pick(options);
      const a = nodes[p.prev], b = nodes[p.node], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      p.target = { x: b.x + dz / L * p.off, z: b.z - dx / L * p.off };
    }
    function spawnWalker(px, pz, fx, fz, near, forceType, minD, maxD) {
      for (let tries = 0; tries < 12; tries++) {
        const ni = (Math.random() * nodes.length) | 0, a = nodes[ni];
        const nb = pick(a.nb), b = nodes[nb], t = Math.random();
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, d = Math.hypot(x - px, z - pz);
        if (d > (maxD || 88) || d < (minD || (near ? 6 : 30))) continue;
        if (!near && d < 60 && ((x - px) * fx + (z - pz) * fz) / d > .2) continue; // don't pop up in plain view
        const area = x > CITY ? 'promenade' : a.area;
        const p = spawn(makeLook(forceType || typeFor(TYPE_MIX[area])), x, z, 'graph');
        if (!p) return null;
        p.prev = ni; p.node = nb;
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        p.target = { x: b.x + dz / L * p.off, z: b.z - dx / L * p.off };
        return p;
      }
      return null;
    }
    function nearestNode(x, z) {
      let ni = 0, nd = Infinity;
      for (let i = 0; i < nodes.length; i++) { const d = Math.hypot(nodes[i].x - x, nodes[i].z - z); if (d < nd) { nd = d; ni = i; } }
      return ni;
    }
    // back to normal life after fleeing, fighting or chasing
    function resumeRoute(p) {
      p.running = false; p.chasing = false; p.fightT = 0; p.fleeT = 0;
      if (p.x > CITY + 4 && !p.cop) { p.mode = 'beach'; p.target = { x: U.clamp(p.x + rand(-10, 10), 112, 137), z: U.clamp(p.z + rand(-10, 10), -100, 100) }; return; }
      const ni = nearestNode(p.x, p.z); p.mode = 'graph'; p.node = ni; p.prev = ni; p.target = { x: nodes[ni].x, z: nodes[ni].z };
    }
    function detachSpot(p) {
      if (!p.spot) return;
      const s = p.spot; s.person = null; p.spot = null;
      if (s.kind === 'lie') p.x += .9;
      p.y = floorAt(p.x, p.z, 5);
      if (p.anim === 'sit' || p.anim === 'lie' || p.anim === 'talk') p.anim = 'idle';
      resumeRoute(p);
    }
    function spawnBeach(px, pz, fx, fz, near) {
      for (let tries = 0; tries < 10; tries++) {
        const jog = chance(.2);
        const x = jog ? SHORE - rand(1.5, 3.5) : rand(112, 136), z = rand(-100, 100), d = Math.hypot(x - px, z - pz);
        if (d > 88 || d < (near ? 6 : 28)) continue;
        if (!near && d < 55 && ((x - px) * fx + (z - pz) * fz) / d > .2) continue;
        const p = spawn(makeLook(jog ? 'jogger' : typeFor(TYPE_MIX.beach)), x, z, jog ? 'jog' : 'beach');
        if (!p) return;
        p.dir = chance(.5) ? 1 : -1;
        p.target = jog ? { x: SHORE - rand(1.5, 3.5), z: 100 * p.dir } : { x: U.clamp(x + rand(-15, 15), 112, 137), z: U.clamp(z + rand(-20, 20), -100, 100) };
        return;
      }
    }

    /* ---------- behaviour ---------- */
    let bumpCallback = opts.onBump || (() => {});
    let pol = { wanted: 0 };
    const call = (name, ...a) => { if (opts[name]) opts[name](...a); };
    function stepMove(p, vx, vz, speed, dt) {
      p.speed = U.damp(p.speed, speed, 6, dt);
      p.x += vx * p.speed * dt; p.z += vz * p.speed * dt;
      p.blocked = 0; collide(p); p.y = floorAt(p.x, p.z, p.y);
    }
    function unstick(p, dt, dx, dz) {
      p.stuckT += dt;
      if (p.stuckT > 1.2) {
        if (Math.hypot(p.x - p.lastX, p.z - p.lastZ) < .5) { const s = chance(.5) ? 1 : -1; p.sideX = -dz * s * 1.6; p.sideZ = dx * s * 1.6; p.sideT = 1.4; }
        p.stuckT = 0; p.lastX = p.x; p.lastZ = p.z;
      }
    }
    // police officer while the hero is wanted: 1 star — run up and arrest; 2+ stars — keep distance and shoot
    function copChase(p, dt, player) {
      const dx = player.x - p.x, dz = player.z - p.z, d = Math.hypot(dx, dz) || .001;
      p.chasing = true;
      p.losT -= dt;
      if (p.losT <= 0) {
        p.losT = .22 + Math.random() * .08;
        const sy = p.y + 1.55, ty = player.y + 1.2, L3 = Math.hypot(dx, ty - sy, dz);
        p.los = d < 55 && col.raycast(p.x, sy, p.z, dx / L3, (ty - sy) / L3, dz / L3, L3) >= L3 - .5;
      }
      const w = pol.wanted;
      let move = 0, aiming = false, face = Math.atan2(dx, dz);
      if (w <= 1) { if (d > .9) move = 1; if (d < 1.5 && p.los) call('onBustTick', dt, p); }
      else {
        if (!p.los || d > 15) move = 1; else if (d < 5) move = -.5;
        aiming = p.los && d < 32;
        if (aiming) { p.shootT -= dt; if (p.shootT <= 0) { p.shootT = rand(.6, 1.2) / (.8 + w * .1); call('onCopShoot', p); } }
      }
      if (move) {
        let vx = dx / d * move, vz = dz / d * move;
        if (p.sideT > 0) { p.sideT -= dt; vx += p.sideX; vz += p.sideZ; const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l; }
        stepMove(p, vx, vz, move > 0 ? 4.6 : 1.6, dt);
        if (!aiming) face = Math.atan2(vx, vz);
        p.running = move > 0; p.anim = aiming ? 'aimwalk' : 'walk';
        unstick(p, dt, dx / d, dz / d);
      } else { p.speed = 0; p.running = false; p.anim = aiming ? 'aim' : 'idle'; }
      p.heading += U.angDiff(p.heading, face) * Math.min(1, dt * 10);
    }
    function flee(p, dt) {
      p.fleeT -= dt;
      let vx = p.x - p.fleeX, vz = p.z - p.fleeZ; const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l;
      if (p.sideT > 0) { p.sideT -= dt; vx += p.sideX; vz += p.sideZ; }
      vx += Math.sin(p.seed + p.fleeT * 1.3) * .3; vz += Math.cos(p.seed * 1.7 + p.fleeT) * .3;
      const n = Math.hypot(vx, vz) || 1; vx /= n; vz /= n;
      stepMove(p, vx, vz, 4.3, dt);
      p.heading += U.angDiff(p.heading, Math.atan2(vx, vz)) * Math.min(1, dt * 8);
      p.running = true; p.anim = 'walk';
      unstick(p, dt, vx, vz);
      if (p.fleeT <= 0) resumeRoute(p);
    }
    function fight(p, dt, player) {
      p.fightT -= dt; p.punchT -= dt;
      const dx = player.x - p.x, dz = player.z - p.z, d = Math.hypot(dx, dz) || .001;
      if (d > 16 || player.inCar || player.dead || p.fightT <= 0) { resumeRoute(p); return; }
      p.heading += U.angDiff(p.heading, Math.atan2(dx, dz)) * Math.min(1, dt * 10);
      if (d > 1.05) { stepMove(p, dx / d, dz / d, 3.8, dt); p.running = true; p.anim = 'walk'; unstick(p, dt, dx / d, dz / d); }
      else {
        p.speed = 0; p.running = false; p.anim = 'punch'; p.punchCD -= dt;
        if (p.punchCD <= 0) { p.punchCD = rand(.8, 1.3); p.punchT = .35; call('onHitPlayer', rand(5, 9), p); }
      }
    }
    function medicStep(p, dt) {
      const m = p.medic;
      if (!m.goal) { p.anim = 'idle'; return; }
      const dx = m.goal[0] - p.x, dz = m.goal[1] - p.z, d = Math.hypot(dx, dz);
      if (d > .35) {
        m.arrived = false;
        let vx = dx / d, vz = dz / d;
        if (p.sideT > 0) { p.sideT -= dt; vx += p.sideX; vz += p.sideZ; const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l; }
        stepMove(p, vx, vz, d > 3 ? 3.4 : 1.6, dt); p.running = d > 3; p.anim = 'walk';
        p.heading += U.angDiff(p.heading, Math.atan2(vx, vz)) * Math.min(1, dt * 10);
        unstick(p, dt, dx / d, dz / d);
      } else {
        m.arrived = true; p.speed = 0; p.running = false;
        if (m.face != null) p.heading += U.angDiff(p.heading, m.face) * Math.min(1, dt * 8);
        p.anim = m.kneel ? 'cpr' : 'idle';
      }
    }
    function updateWalker(p, dt, player, others) {
      if (p.dead || p.down) return;
      if (p.medic) { if (p.stumbleT > 0) { p.stumbleT -= dt; p.anim = 'stumble'; return; } medicStep(p, dt); return; }
      if (p.dodge) {
        p.dodge.t -= dt; p.anim = 'dodge';
        p.x += p.dodge.vx * dt; p.z += p.dodge.vz * dt; p.blocked = 0; collide(p); p.y = floorAt(p.x, p.z, p.y);
        if (p.dodge.t <= 0) p.dodge = null;
        return;
      }
      if (p.stumbleT > 0) { p.stumbleT -= dt; p.anim = 'stumble'; p.speed = U.damp(p.speed, 0, 8, dt); return; }
      if (p.cop && pol.wanted > 0 && !player.dead && Math.hypot(player.x - p.x, player.z - p.z) < 90) { copChase(p, dt, player); return; }
      if (p.cop && p.chasing) resumeRoute(p);
      if (p.fleeT > 0) { flee(p, dt); return; }
      if (p.fightT > 0) { fight(p, dt, player); return; }
      if (p.pauseT > 0) {
        p.pauseT -= dt; p.anim = 'idle'; p.speed = 0;
        if (p.pauseFace != null) p.heading += U.angDiff(p.heading, p.pauseFace) * Math.min(1, dt * 4);
        return;
      }
      let dx = p.target.x - p.x, dz = p.target.z - p.z, d = Math.hypot(dx, dz);
      if (d < .6) {
        if (p.mode === 'graph') {
          if (chance(.12)) { p.pauseT = rand(2, 6); p.pauseFace = p.heading + (chance(.5) ? Math.PI / 2 : -Math.PI / 2); }
          nextNode(p);
        } else if (p.mode === 'jog') {
          p.dir = -p.dir; p.target = { x: SHORE - rand(1.5, 3.5), z: 100 * p.dir };
        } else {
          if (chance(.35)) { p.pauseT = rand(3, 9); p.pauseFace = Math.PI / 2 + rand(-.6, .6); }
          p.target = { x: U.clamp(p.x + rand(-18, 18), 112, 137), z: U.clamp(p.z + rand(-25, 25), -100, 100) };
        }
        return;
      }
      dx /= d; dz /= d;
      let sx = 0, sz = 0;
      // keep right of anyone coming the other way, and give the hero room
      for (const o of others) {
        if (o === p) continue;
        const ox = o.x - p.x, oz = o.z - p.z, od = Math.hypot(ox, oz);
        if (od > 2.2 || od < 1e-3) continue;
        const ahead = (ox * dx + oz * dz) / od;
        if (ahead > .3) { const w = (2.2 - od) / 2.2; sx += dz * w * .9; sz -= dx * w * .9; }
      }
      const hx = player.x - p.x, hz = player.z - p.z, hd = Math.hypot(hx, hz);
      if (hd < 2.4 && hd > 1e-3 && (hx * dx + hz * dz) / hd > .2) { const w = (2.4 - hd) / 2.4; const side = (hx * dz - hz * dx) > 0 ? -1 : 1; sx += dz * side * w * 1.4; sz -= dx * side * w * 1.4; }
      let vx = dx + sx, vz = dz + sz; const vl = Math.hypot(vx, vz) || 1; vx /= vl; vz /= vl;
      p.speed = U.damp(p.speed, p.look.speed, 4, dt);
      p.x += vx * p.speed * dt; p.z += vz * p.speed * dt;
      p.blocked = 0; collide(p);
      p.y = floorAt(p.x, p.z, p.y);
      p.heading += U.angDiff(p.heading, Math.atan2(vx, vz)) * Math.min(1, dt * 8);
      p.anim = 'walk';
      // stuck on something: pick another way
      p.stuckT += dt;
      if (p.stuckT > 2) {
        if (Math.hypot(p.x - p.lastX, p.z - p.lastZ) < .6) {
          if (p.mode === 'graph') { const t = p.node; p.node = p.prev; p.prev = t; const b = nodes[p.node]; p.target = { x: b.x, z: b.z }; }
          else p.target = { x: U.clamp(p.x + rand(-10, 10), 112, 137), z: U.clamp(p.z + rand(-10, 10), -100, 100) };
        }
        p.stuckT = 0; p.lastX = p.x; p.lastZ = p.z;
      }
    }

    function pose(p, dt, t) {
      const P = p.pose, L = p.look;
      P.bob = 0; P.lean = L.lean; P.twist = 0; P.headP = 0; P.spread = 0;
      let aL = 0, aR = 0, eL = -.12, eR = -.12, tL = 0, tR = 0, kL = 0, kR = 0;
      const breathe = Math.sin(t * 1.8 + p.seed) * .008;
      const anim = p.anim === 'aimwalk' ? 'walk' : p.anim;
      switch (anim) {
        case 'walk': {
          const sp = p.speed, run = (L.run || p.running) ? 1 : 0, moving = U.clamp(sp / 1.1, 0, 1);
          p.phase += dt * (2.2 + sp * (run ? 1.3 : 2.1));
          const s = Math.sin(p.phase), c = Math.cos(p.phase), A = (run ? .9 : .5) * moving;
          tL = -s * A; tR = s * A;
          kL = (.06 + Math.max(0, c) * (run ? 1.3 : .6)) * moving; kR = (.06 + Math.max(0, -c) * (run ? 1.3 : .6)) * moving;
          aL = s * A * .85; aR = -s * A * .85; eL = eR = run ? -1.3 : -.25;
          if (!L.hide.has('bag')) { aR = -s * .15; eR = -.1; }
          P.bob = Math.abs(s) * (run ? .07 : .03) * moving; P.lean += run ? .18 : .04; P.twist = s * .07 * moving;
          break;
        }
        case 'idle': P.bob = breathe; aL = .05; aR = .05; P.twist = Math.sin(t * .4 + p.seed) * .08; break;
        case 'talk': {
          P.bob = breathe;
          const speaking = (((t + p.seed * 3) / 2.6) | 0) % p.spot.n === p.spot.idx;
          if (speaking) { aR = -.5 + Math.sin(t * 2.7 + p.seed) * .35; eR = -1.1 + Math.sin(t * 3.9 + p.seed) * .35; aL = -.2 + Math.sin(t * 2.1) * .15; eL = -.7; P.headP = Math.sin(t * 2.2 + p.seed) * .06; }
          else { aL = aR = .05; P.headP = Math.sin(t * .9 + p.seed) * .04; }
          P.twist = Math.sin(t * .5 + p.seed) * .05;
          break;
        }
        case 'sit': tL = tR = -1.5; kL = kR = 1.5; aL = aR = -.5; eL = eR = -.75; P.lean = -.06 + L.lean; P.bob = breathe; P.headY = Math.sin(t * .3 + p.seed) * .5; break;
        case 'lie': P.spread = .12; P.bob = breathe * .5; tL = .03; tR = -.03; break;
        case 'cpr': { const pump = Math.sin(t * 10 + p.seed); tL = tR = 0; kL = kR = 1.57; P.lean = .55; aL = aR = -1.05 + pump * .15; eL = eR = -.15; P.headP = .2; break; }
        case 'aim': P.bob = breathe; aR = -1.52; eR = -.05; aL = -1.25; eL = -.55; P.twist = -.12; break;
        case 'punch': { const k = p.punchT > 0 ? Math.sin((1 - p.punchT / .35) * Math.PI) : 0; aR = -.4 - 1.2 * k; eR = -1.2 + k; aL = -1; eL = -1.6; P.lean = .1; P.twist = -.2 * k; break; }
        case 'dead': P.spread = .5; tL = -.08; tR = .1; kL = .1; aL = -.3; aR = .2; break;
        case 'dodge': aL = -2.6; aR = -2.4; eL = eR = -.3; P.lean = -.2; tL = -.9; tR = .3; kL = 1.1; kR = .4; P.bob = .08; break;
        case 'stumble': { const w = Math.sin(t * 18) * .2; aL = -2.3 + w; aR = -2.1 - w; eL = eR = -.4; P.lean = -.28; tL = -.3; tR = .2; kL = .3; break; }
      }
      if (p.anim === 'aimwalk') { aR = -1.52; eR = -.05; aL = -1.25; eL = -.55; }
      const k = Math.min(1, dt * 14);
      P.aL += (aL - P.aL) * k; P.aR += (aR - P.aR) * k; P.eL += (eL - P.eL) * k; P.eR += (eR - P.eR) * k;
      P.tL += (tL - P.tL) * k; P.tR += (tR - P.tR) * k; P.kL += (kL - P.kL) * k; P.kR += (kR - P.kR) * k;
      if (p.anim !== 'sit') P.headY += (p.headY - P.headY) * Math.min(1, dt * 5);
    }

    /* ---------- skinning into the instanced mesh ---------- */
    const E = new THREE.Euler(), TM = new THREE.Matrix4(), OUT = new THREE.Matrix4(), SV = new THREE.Vector3();
    const JM = Array.from({ length: 12 }, () => new THREE.Matrix4());
    function jt(out, parent, x, y, z, rx, ry, rz) { E.set(rx, ry, rz, 'YXZ'); TM.makeRotationFromEuler(E); TM.setPosition(x, y, z); out.multiplyMatrices(parent, TM); }
    function write(p) {
      const P = p.pose, L = p.look, hs = L.hs;
      let lift = 0;
      if (p.anim === 'lie') E.set(Math.PI / 2, Math.PI, 0, 'XYZ');
      else if (p.anim === 'dead') { const f = Math.min(1, p.fallT / .55); E.set(-Math.PI / 2 * f * f, p.heading, 0, 'YXZ'); lift = .12 * f; }
      else E.set(0, p.heading, 0, 'YXZ');
      if (p.anim === 'cpr') lift = -.41 * hs;
      JM[0].makeRotationFromEuler(E); JM[0].setPosition(p.x, p.y + lift, p.z); JM[0].scale(SV.set(hs, hs, hs));
      jt(JM[1], JM[0], 0, .95 + P.bob, 0, 0, 0, 0);
      jt(JM[2], JM[1], 0, .08, 0, P.lean, P.twist, 0);
      jt(JM[3], JM[2], 0, .52, 0, P.headP, P.headY, 0);
      const sw = (L.female ? .23 : .255) * (.9 + L.ws * .1);
      jt(JM[4], JM[2], -sw, .46, 0, P.aL, 0, -P.spread - .07);
      jt(JM[5], JM[4], 0, -.27, 0, P.eL, 0, 0);
      jt(JM[6], JM[2], sw, .46, 0, P.aR, 0, P.spread + .07);
      jt(JM[7], JM[6], 0, -.27, 0, P.eR, 0, 0);
      jt(JM[8], JM[1], -.1, 0, 0, P.tL, 0, 0); jt(JM[9], JM[8], 0, -.46, 0, P.kL, 0, 0);
      jt(JM[10], JM[1], .1, 0, 0, P.tR, 0, 0); jt(JM[11], JM[10], 0, -.46, 0, P.kR, 0, 0);
      const cs = L.cs, base = p.slot * PARTS;
      for (let i = 0; i < PARTS; i++) {
        const o = i * 6; if (cs[o + 3] === 0) continue;
        TM.makeScale(cs[o + 3], cs[o + 4], cs[o + 5]); TM.setPosition(cs[o], cs[o + 1], cs[o + 2]);
        OUT.multiplyMatrices(JM[JOINT[i]], TM); mesh.setMatrixAt(base + i, OUT);
      }
      if (p.anim === 'lie' || p.anim === 'dead') blobs.setMatrixAt(p.slot, ZERO);
      else { TM.makeTranslation(p.x, (p.anim === 'sit' ? .15 : p.y) + .02, p.z); blobs.setMatrixAt(p.slot, TM); }
    }

    /* ---------- population ---------- */
    let popT = 0, first = true, frameNo = 0;
    function populate(player, camYaw) {
      const px = player.x, pz = player.z, fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      const lim = opts.limits();
      for (const p of people.slice()) {
        const far = Math.hypot(p.x - px, p.z - pz) > (p.cop && p.chasing ? 130 : 100);
        const lying = p.dead || p.down;
        if ((!p.spot && !lying && far) || (lying && (far || (p.deadT > 30 && !p.ems)))) despawn(p);
      }
      for (const s of spots) {
        const d = Math.hypot(s.x - px, s.z - pz);
        if (s.person && d > lim.spotRange + 12) despawn(s.person);
        else if (!s.person && d < lim.spotRange && free.length) {
          const kindType = s.kind === 'lie' ? (chance(.55) ? 'beach_f' : 'beach_m') : typeFor(TYPE_MIX[s.mix]);
          const p = spawn(makeLook(kindType === 'jogger' ? 'tourist_m' : kindType), s.x, s.z, 'spot');
          if (p) { p.spot = s; s.person = p; p.anim = s.kind; p.heading = s.heading; p.y = s.kind === 'sit' ? s.y - .95 * p.look.hs : s.y; p.seed = s.seed != null ? s.seed + s.idx : p.seed; }
        }
      }
      const walkers = people.filter(p => p.mode === 'graph' && !p.cop && !p.dead).length, beach = people.filter(p => (p.mode === 'beach' || p.mode === 'jog') && !p.dead).length;
      const cops = people.filter(p => p.cop && !p.dead && !p.spot).length;
      if (cops < (lim.cops || 0)) spawnWalker(px, pz, fx, fz, first, 'cop');
      const wantBeach = px > 60 ? lim.beach : 0;
      const n = first ? 40 : 2;
      for (let k = 0; k < n; k++) {
        if (beach + k < wantBeach && chance(.5)) spawnBeach(px, pz, fx, fz, first);
        else if (walkers + k < lim.walkers) spawnWalker(px, pz, fx, fz, first);
      }
      first = false;
    }

    const api = {
      update(dt, t, player, camYaw, dangers, police) {
        if (police) pol = police;
        popT -= dt;
        if (popT <= 0) { popT = .5; populate(player, camYaw); }
        frameNo++;
        for (const p of people) {
          const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz);
          if (p.dead || p.down) {
            p.fallT += dt; p.deadT += dt;
            if (p.fallT < .8) { pose(p, dt, t); write(p); }
            // injured people get back up on their own if no ambulance comes
            if (p.down && !p.ems && p.deadT > 45) api.revive(p, 30);
            if (p.down && (p.groanT = (p.groanT || rand(3, 6)) - dt) <= 0) { p.groanT = rand(4, 8); if (d < 20) call('onGroan', p); }
            continue;
          }
          if (p.spot && p.cop && pol.wanted > 0 && d < 90) detachSpot(p);
          if (!p.spot) updateWalker(p, dt, player, people);
          else if (p.spot.kind === 'talk' && p.stumbleT > 0) { p.stumbleT -= dt; p.anim = p.stumbleT > 0 ? 'stumble' : 'talk'; }
          else if (p.spot.kind === 'talk' && p.dodge) { p.dodge.t -= dt; p.anim = 'dodge'; p.x += p.dodge.vx * dt; p.z += p.dodge.vz * dt; collide(p); if (p.dodge.t <= 0) { p.dodge = null; p.anim = 'talk'; } }
          // cars: jump out of the way, or get shoved if too late
          if (dangers && p.anim !== 'lie' && p.anim !== 'sit') for (const c of dangers) {
            const cx = p.x - c.x, cz = p.z - c.z;
            if (Math.abs(cx) > 14 || Math.abs(cz) > 14) continue;
            const a = cx * c.fx + cz * c.fz, b = cx * -c.fz + cz * c.fx;
            if (a < -c.hl - .4 || a > c.hl + c.speed * .75 + 1 || Math.abs(b) > c.hw + .8) continue;
            const side = b >= 0 ? 1 : -1, sx = -c.fz * side, sz = c.fx * side;
            if (Math.abs(a) < c.hl + .3 && Math.abs(b) < c.hw + .35) {
              const push = c.hw + .4 - Math.abs(b); p.x += sx * push; p.z += sz * push;
              p.stumbleT = .9; p.dodge = null;
              if (c.speed > 6.5 && c.player) { api.damage(p, c.speed * 6, { byPlayer: c.player, kind: 'car', x: c.x, z: c.z }); if (p.dead) break; }
              if (t - p.bumpT > 2) { p.bumpT = t; bumpCallback(p, pick(CAR_PHRASES)); }
            } else if (!p.dodge && p.stumbleT <= 0) {
              p.dodge = { vx: sx * 4.5, vz: sz * 4.5, t: .5 };
              if (c.player && t - p.bumpT > 3 && chance(.45)) { p.bumpT = t; bumpCallback(p, pick(CAR_PHRASES)); }
            }
          }
          // bumping into the hero
          if (p.dead) continue;
          if (!player.inCar && !player.dead && d < .62 && d > 1e-4 && p.anim !== 'lie' && p.anim !== 'sit') {
            const push = .62 - d;
            if (!p.spot) { p.x += dx / d * push * .75; p.z += dz / d * push * .75; }
            player.x -= dx / d * push * (p.spot ? 1 : .25); player.z -= dz / d * push * (p.spot ? 1 : .25);
            if (player.speed > 2.5 && t - p.bumpT > 3) {
              p.bumpT = t; p.stumbleT = .7; p.heading = Math.atan2(-dx, -dz);
              bumpCallback(p, pick(PHRASES));
            }
          }
          // look at a hero who runs close by
          p.headY = (!player.inCar && d < 5 && player.speed > 4 && p.anim !== 'lie') ? U.clamp(U.angDiff(p.heading, Math.atan2(-dx, -dz)), -1, 1) : 0;
          // animate: near people every frame, far ones every third frame
          if (d < 40 || (frameNo + p.frame) % 3 === 0) { pose(p, d < 40 ? dt : dt * 3, t); write(p); }
        }
        // keep people from overlapping each other
        for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
          const a = people[i], b = people[j];
          if ((a.spot && b.spot) || a.dead || b.dead) continue;
          const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
          if (d < .55 && d > 1e-4) { const k = (.55 - d) / d * .5; if (!a.spot) { a.x -= dx * k; a.z -= dz * k; } if (!b.spot) { b.x += dx * k; b.z += dz * k; } }
        }
        mesh.instanceMatrix.needsUpdate = true; blobs.instanceMatrix.needsUpdate = true;
      },
      setShadows(on) { mesh.castShadow = on; },
      // the driver the hero pulled out of a car: lands on the road, complains, then walks off
      ejectDriver(x, z, h) {
        const p = spawn(makeLook(typeFor(TYPE_MIX.town)), x, z, 'graph');
        if (!p) return;
        let ni = 0, nd = Infinity;
        nodes.forEach((n, i) => { const d = Math.hypot(n.x - x, n.z - z); if (d < nd) { nd = d; ni = i; } });
        p.node = ni; p.prev = ni; p.target = { x: nodes[ni].x, z: nodes[ni].z };
        p.heading = h + Math.PI / 2; p.stumbleT = 1.1; p.bumpT = -9;
        bumpCallback(p, pick(CARJACK_PHRASES));
      },
      count: () => people.length,
      people,
      // first living person hit by a ray (bodies are upright cylinders); head = top 28 cm
      hitTest(ox, oy, oz, dx, dy, dz, maxT, skip) {
        let best = maxT, hit = null, head = false;
        const a = dx * dx + dz * dz; if (a < 1e-8) return null;
        for (const p of people) {
          if (p.dead || p.down || p === skip || p.anim === 'lie') continue;
          const fx = ox - p.x, fz = oz - p.z, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - .1;
          const disc = b * b - 4 * a * c; if (disc < 0) continue;
          const t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0 || t >= best) continue;
          const y = oy + dy * t, top = p.y + (p.anim === 'sit' ? 1.35 : 1.86) * p.look.hs;
          if (y < p.y || y > top) continue;
          best = t; hit = p; head = y > top - .28;
        }
        return hit ? { t: best, p: hit, head } : null;
      },
      damage(p, dmg, src) {
        if (p.dead) return;
        p.hp -= dmg;
        detachSpot(p);
        if (p.hp <= 0) {
          p.dead = true; p.hp = 0; p.anim = 'dead'; p.fallT = 0; p.deadT = 0; p.dodge = null; p.running = false;
          if (src && src.x != null) p.heading = Math.atan2(src.x - p.x, src.z - p.z);
          if (p.bubble) { p.bubble.owner = null; }
          call('onKill', p, src || {});
          return;
        }
        if (!p.cop && !p.medic && p.hp < 25 && src && (src.kind === 'melee' || src.kind === 'car')) {
          p.down = true; p.anim = 'dead'; p.fallT = 0; p.deadT = 0; p.dodge = null; p.fightT = 0; p.fleeT = 0; p.running = false;
          if (src.x != null) p.heading = Math.atan2(src.x - p.x, src.z - p.z);
          call('onHurt', p, src); call('onDown', p, src);
          return;
        }
        p.stumbleT = Math.max(p.stumbleT, .35);
        if (!p.cop && src && src.byPlayer) {
          if (src.kind === 'melee' && !p.look.female && p.look.type !== 'elderly' && chance(.35)) { p.fightT = 10; p.punchCD = .5; bumpCallback(p, pick(FIGHT_PHRASES)); }
          else { p.fleeT = rand(7, 11); p.fleeX = src.x; p.fleeZ = src.z; if (chance(.6)) bumpCallback(p, pick(FLEE_PHRASES)); }
        }
        call('onHurt', p, src || {});
      },
      // gunfire nearby: everyone who is not a police officer runs away
      panic(x, z, r) {
        let shouted = 0;
        for (const p of people) {
          if (p.dead || p.down || p.cop || p.medic || p.fightT > 0) continue;
          const d = Math.hypot(p.x - x, p.z - z); if (d > r) continue;
          detachSpot(p);
          p.fleeT = rand(6, 10); p.fleeX = x; p.fleeZ = z; p.dodge = null;
          if (shouted < 2 && d < 25 && chance(.3)) { shouted++; bumpCallback(p, pick(FLEE_PHRASES)); call('onScream', p); }
        }
      },
      spawnCop(px, pz, fx, fz, minD, maxD, atX, atZ) {
        let p;
        if (atX != null) { p = spawn(makeLook('cop'), atX, atZ, 'graph'); if (p) resumeRoute(p); }
        else p = spawnWalker(px, pz, fx, fz, false, 'cop', minD, maxD);
        return p;
      },
      cops() { return people.filter(p => p.cop && !p.dead); },
      spawnMedic(x, z) {
        const p = spawn(makeLook('medic'), x, z, 'medic');
        if (p) p.medic = { goal: null, face: null, kneel: false, arrived: false };
        return p;
      },
      releaseMedic(p) { if (people.includes(p)) { p.medic = null; resumeRoute(p); } },
      despawnPerson(p) { if (people.includes(p)) despawn(p); },
      // paramedics got them back on their feet
      revive(p, hp) {
        if (!people.includes(p)) return;
        p.dead = false; p.down = false; p.hp = hp || 60; p.anim = 'idle'; p.fallT = 0; p.deadT = 0; p.ems = null;
        p.stumbleT = 1.1; p.fleeT = 0; p.fightT = 0;
        resumeRoute(p);
      },
      clearChase() { for (const p of people) if (p.cop && p.chasing) resumeRoute(p); }
    };
    return api;
  };
})(window.NB);
