// Places you can go into. Like the interiors in Vice City, each building's inside is a separate room
// built far outside the city: walk into the glowing circle at a door, the screen blinks and you're in.
// Also built here, right in the city: the hero's beach villa with its garage and pool, the tiki bar
// on the sand, and the pool deck on the roof of Hotel OCEAN.
// Each place builds its geometry, its people (spots for npc.js) and, once the game is running,
// its interactions: things the hero can use with F / the action button.
(function (NB) {
  'use strict';
  const { U, GeoBuilder } = NB;
  const rand = U.rand, pick = a => a[(Math.random() * a.length) | 0];
  const FLAT = [.03, .5];

  /* =====================================================================
     building kit: boxes, neon, walls with doorways, textured floors, pictures, screens
     ===================================================================== */
  function makeKit(scene, col, C) {
    const P = new GeoBuilder(), N = new GeoBuilder(), GL = new GeoBuilder();
    const o = [0, 0];
    const ax = x => x + o[0], az = z => z + o[1];
    const screens = { pos: [], uv: [], seed: [], mode: [], idx: [], n: 0 };
    const K = {
      scene, col, C,
      at(x, z) { o[0] = x; o[1] = z; },
      wx: ax, wz: az,
      box(x0, y0, z0, x1, y1, z1, hex, solid, opt) {
        P.box(ax(x0), y0, az(z0), ax(x1), y1, az(z1), C(hex), opt);
        if (solid) return col.add(ax(x0), y0 < .5 ? Math.min(0, y0) : y0, az(z0), ax(x1), y1, az(z1));
      },
      solid(x0, y0, z0, x1, y1, z1) { return col.add(ax(x0), y0, az(z0), ax(x1), y1, az(z1)); },
      neon(x0, y0, z0, x1, y1, z1, hex, glow = true) {
        N.box(ax(x0), y0, az(z0), ax(x1), y1, az(z1), C(hex));
        if (glow) GL.box(ax(x0) - .16, y0 - .16, az(z0) - .16, ax(x1) + .16, y1 + .16, az(z1) + .16, C(hex).multiplyScalar(.8), { noTop: true });
      },
      glow(x0, y0, z0, x1, y1, z1, hex, k = .6) { GL.box(ax(x0), y0, az(z0), ax(x1), y1, az(z1), C(hex).multiplyScalar(k), { noTop: true }); },
      ceil(x0, z0, x1, z1, y, hex) { P.quad([ax(x0), y, az(z0)], [ax(x1), y, az(z0)], [ax(x1), y, az(z1)], [ax(x0), y, az(z1)], 0, -1, 0, C(hex), FLAT, FLAT, FLAT, FLAT); },
      // a wall running along x at z, or along z at x, with doorway gaps [{ c, w, h }]
      wallZ(z, x0, x1, h, hex, gaps = [], t = .3) {
        const g = gaps.slice().sort((a, b) => a.c - b.c); let s = x0;
        for (const d of g) { if (d.c - d.w / 2 > s) K.box(s, 0, z - t / 2, d.c - d.w / 2, h, z + t / 2, hex, true); K.box(d.c - d.w / 2, d.h, z - t / 2, d.c + d.w / 2, h, z + t / 2, hex, true); s = d.c + d.w / 2; }
        if (x1 > s) K.box(s, 0, z - t / 2, x1, h, z + t / 2, hex, true);
      },
      wallX(x, z0, z1, h, hex, gaps = [], t = .3) {
        const g = gaps.slice().sort((a, b) => a.c - b.c); let s = z0;
        for (const d of g) { if (d.c - d.w / 2 > s) K.box(x - t / 2, 0, s, x + t / 2, h, d.c - d.w / 2, hex, true); K.box(x - t / 2, d.h, d.c - d.w / 2, x + t / 2, h, d.c + d.w / 2, hex, true); s = d.c + d.w / 2; }
        if (z1 > s) K.box(x - t / 2, 0, s, x + t / 2, h, z1, hex, true);
      },
      // four walls around [x0..x1] x [z0..z1], doorways per side, ceiling, a skirting band and a neon line under the ceiling
      room(x0, z0, x1, z1, h, s) {
        const gp = s.gaps || {};
        K.wallZ(z0 - .15, x0 - .3, x1 + .3, h, s.wall, gp['-z']); K.wallZ(z1 + .15, x0 - .3, x1 + .3, h, s.wall, gp['+z']);
        K.wallX(x0 - .15, z0, z1, h, s.wall, gp['-x']); K.wallX(x1 + .15, z0, z1, h, s.wall, gp['+x']);
        K.ceil(x0, z0, x1, z1, h - .01, s.ceil || '#1a1420');
        if (s.trim) { for (const [a, b, c, d] of [[x0, z0, x1, z0 + .04], [x0, z1 - .04, x1, z1], [x0, z0, x0 + .04, z1], [x1 - .04, z0, x1, z1]]) K.box(a, 0, b, c, .14, d, s.trim); }
        if (s.neon) { for (const [a, b, c, d] of [[x0, z0, x1, z0 + .05], [x0, z1 - .05, x1, z1], [x0, z0, x0 + .05, z1], [x1 - .05, z0, x1, z1]]) K.neon(a, h - .35, b, c, h - .29, d, s.neon); }
      },
      tex(w, h, draw, repeat = true) { return U.canvasTex(w, h, draw, repeat, 4); },
      // a textured floor: tile = metres per texture repeat
      floor(x0, z0, x1, z1, tex, tile, y = .004) {
        const w = x1 - x0, d = z1 - z0, t = tex.clone(); t.needsUpdate = true;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / tile, d / tile);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: t }));
        m.position.set(ax((x0 + x1) / 2), y, az((z0 + z1) / 2)); m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m); return m;
      },
      // an upright picture facing '+x' | '-x' | '+z' | '-z', centred at (cx, cy, cz)
      picture(face, cx, cy, cz, w, h, tex, lit) {
        const g = new THREE.PlaneGeometry(w, h);
        if (face === '-z') g.rotateY(Math.PI); else if (face === '+x') g.rotateY(Math.PI / 2); else if (face === '-x') g.rotateY(-Math.PI / 2);
        const m = new THREE.Mesh(g, lit ? new THREE.MeshLambertMaterial({ map: tex, transparent: true }) : new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
        m.position.set(ax(cx), cy, az(cz)); scene.add(m); return m;
      },
      // an animated screen quad (arcade game, slot reels, TV); all screens share one mesh and one shader
      screen(face, cx, cy, cz, w, h, mode, seed = Math.random()) {
        const R = { '+x': [0, -1], '-x': [0, 1], '+z': [1, 0], '-z': [-1, 0] }[face];
        const x = ax(cx), z = az(cz), hw = w / 2;
        const p = [[x - R[0] * hw, cy - h / 2, z - R[1] * hw], [x + R[0] * hw, cy - h / 2, z + R[1] * hw], [x + R[0] * hw, cy + h / 2, z + R[1] * hw], [x - R[0] * hw, cy + h / 2, z - R[1] * hw]];
        const s = screens.n;
        p.forEach((v, i) => { screens.pos.push(...v); screens.uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0); screens.seed.push(seed); screens.mode.push(mode); });
        screens.idx.push(s, s + 1, s + 2, s, s + 2, s + 3); screens.n += 4;
      },
      spot(s) { return Object.assign({ home: !s.patrol }, s, { x: ax(s.x), z: az(s.z), patrol: s.patrol && s.patrol.map(([x, z]) => [ax(x), az(z)]) }); },
      pt(x, z) { return { x: ax(x), z: az(z) }; },
      finish() {
        const add = (b, mat) => { const m = new THREE.Mesh(b.build(), mat); m.matrixAutoUpdate = false; scene.add(m); return m; };
        const pm = add(P, new THREE.MeshLambertMaterial({ vertexColors: true })); pm.receiveShadow = true; pm.castShadow = true;
        add(N, new THREE.MeshBasicMaterial({ vertexColors: true }));
        K.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false });
        add(GL, K.glowMat);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(screens.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(screens.uv, 2));
        g.setAttribute('seed', new THREE.Float32BufferAttribute(screens.seed, 1));
        g.setAttribute('mode', new THREE.Float32BufferAttribute(screens.mode, 1));
        g.setIndex(screens.idx); g.computeBoundingSphere();
        K.screenMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: SCREEN_VS, fragmentShader: SCREEN_FS, side: THREE.DoubleSide });
        const sm = new THREE.Mesh(g, K.screenMat); sm.frustumCulled = false; scene.add(sm);
      }
    };
    return K;
  }

  const SCREEN_VS = `attribute float seed; attribute float mode; varying vec2 vUv; varying float vSeed; varying float vMode;
    void main(){ vUv = uv; vSeed = seed; vMode = mode; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
  const SCREEN_FS = `uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vMode;
    vec3 hue(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec3 c = vec3(0.02,0.01,0.05); float t = uTime * (0.8 + fract(vSeed*7.1) * 0.6) + vSeed * 40.0;
      if (vMode < 0.5) {                       // arcade games: invaders, a racer or a maze, picked by seed
        float kind = floor(fract(vSeed*3.7)*3.0); vec2 g = vUv * vec2(14.0, 12.0);
        if (kind < 0.5) {
          vec2 id = floor(g + vec2(sin(t)*1.5, 0.0));
          float on = step(0.45, hash(id)) * step(6.0, id.y) * step(id.y, 10.0);
          c += hue(vSeed + id.y*0.08) * on * step(0.2, fract(g.x + sin(t)*1.5)) * step(0.25, fract(g.y));
          c += vec3(0.3,1.0,0.4) * step(abs(vUv.x - 0.5 - sin(t*1.3)*0.3), 0.05) * step(vUv.y, 0.1) * step(0.04, vUv.y);
          c += vec3(1.0,1.0,0.6) * step(abs(vUv.x - 0.5 - sin(t*1.3 - 0.4)*0.3), 0.008) * step(abs(vUv.y - fract(t*0.9)), 0.03);
        } else if (kind < 1.5) {
          float road = step(abs(vUv.x - 0.5), 0.3);
          c = mix(vec3(0.05,0.25,0.12), vec3(0.14,0.13,0.18), road);
          c += vec3(0.9) * step(abs(vUv.x - 0.5), 0.012) * step(0.5, fract(vUv.y*5.0 + t*1.8)) * road;
          c += vec3(1.0,0.3,0.6) * step(abs(vUv.x - 0.5 - sin(t)*0.16), 0.055) * step(abs(vUv.y - 0.18), 0.07);
          c += vec3(0.3,0.9,1.0) * step(abs(vUv.x - 0.5 - 0.15), 0.05) * step(abs(fract(vUv.y + t*0.35) - 0.6), 0.06);
        } else {
          vec2 id = floor(g); vec2 f = fract(g); float wall = step(0.68, hash(id + 3.0));
          c = mix(c, vec3(0.1,0.2,1.0), wall * 0.8); c += vec3(1.0,0.9,0.5) * (1.0 - wall) * step(length(f - 0.5), 0.12);
          c += vec3(1.0,1.0,0.0) * step(length(vUv - vec2(fract(t*0.15), 0.5)), 0.06);
        }
        c *= 0.82 + 0.18 * sin(vUv.y * 320.0);
      } else if (vMode < 1.5) {                // slot machine reels
        float colI = floor(vUv.x * 3.0), spinning = step(0.55, fract(uTime*0.13 + vSeed + colI*0.07));
        float y = vUv.y * 3.0 + (spinning > 0.5 ? uTime * 9.0 : floor(vSeed * 9.0 + colI));
        vec2 f = vec2(fract(vUv.x * 3.0), fract(y)); float sid = floor(hash(vec2(colI, floor(y))) * 4.0);
        c = vec3(0.96,0.94,0.88);
        vec3 sc = sid < 0.5 ? vec3(0.9,0.1,0.15) : sid < 1.5 ? vec3(1.0,0.75,0.1) : sid < 2.5 ? vec3(0.2,0.7,1.0) : vec3(0.9,0.2,0.8);
        c = mix(c, sc, step(length(f - 0.5), 0.3));
        c *= step(0.04, f.x) * step(f.x, 0.96) * 0.85 + 0.15;
      } else if (vMode < 2.5) {                // TV: an 80s show, sunset over a grid, flicker
        vec2 u = vUv; float sky = step(0.45, u.y);
        c = mix(vec3(0.3,0.05,0.4), vec3(1.0,0.45,0.3), 1.0 - u.y) * sky;
        c += vec3(1.0,0.8,0.3) * step(length((u - vec2(0.5, 0.52)) * vec2(1.6, 1.0)), 0.18) * sky * step(0.5, fract(u.y*30.0 + 0.2));
        float gy = (0.45 - u.y); vec2 gp = vec2((u.x - 0.5) / max(gy, 0.02), 1.0 / max(gy, 0.02) + uTime*2.0);
        c += (1.0 - sky) * vec3(1.0,0.2,0.8) * (step(0.95, fract(gp.x)) + step(0.9, fract(gp.y * 0.25)));
        c *= 0.9 + 0.1 * sin(u.y * 400.0 + uTime * 30.0);
      } else {                                 // lift floor indicator / plain glow
        c = vec3(1.0,0.35,0.3) * step(0.5, fract(uTime*0.5));
      }
      gl_FragColor = vec4(c, 1.0);
    }`;

  /* =====================================================================
     textures
     ===================================================================== */
  function textures(K) {
    const T = {};
    T.checker = K.tex(64, 64, (g, s) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? '#141418' : '#f2efe8'; g.fillRect(x * s / 2, y * s / 2, s / 2, s / 2); } });
    T.marble = K.tex(256, 256, (g, s) => {
      g.fillStyle = '#ece6dc'; g.fillRect(0, 0, s, s); U.speckle(g, s, s, 2500, ['#dcd4c6', '#f8f4ee'], .2, .6, 1, 3);
      g.strokeStyle = 'rgba(150,140,130,.35)'; g.lineWidth = 1.5;
      for (let k = 0; k < 7; k++) { g.beginPath(); let x = Math.random() * s, y = 0; g.moveTo(x, y); while (y < s) { x += U.rand(-14, 14); y += U.rand(8, 22); g.lineTo(x, y); } g.stroke(); }
      g.fillStyle = 'rgba(120,110,100,.35)'; g.fillRect(0, 0, s, 2); g.fillRect(0, 0, 2, s);
    });
    T.pinkMarble = K.tex(256, 256, (g, s) => {
      g.fillStyle = '#f4d4dc'; g.fillRect(0, 0, s, s); U.speckle(g, s, s, 2000, ['#e8bcc8', '#fbe8ee'], .2, .6, 1, 3);
      g.strokeStyle = 'rgba(190,120,150,.35)'; g.lineWidth = 1.5;
      for (let k = 0; k < 6; k++) { g.beginPath(); let x = Math.random() * s, y = 0; g.moveTo(x, y); while (y < s) { x += U.rand(-14, 14); y += U.rand(8, 22); g.lineTo(x, y); } g.stroke(); }
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, 3); g.fillRect(0, 0, 3, s);
    });
    T.tiles = K.tex(64, 64, (g, s) => { g.fillStyle = '#dfe6e8'; g.fillRect(0, 0, s, s); U.speckle(g, s, s, 300, ['#cfd8da', '#eef3f4'], .3, .6, 1, 2); g.fillStyle = '#b8c2c6'; g.fillRect(0, 0, s, 2); g.fillRect(0, 0, 2, s); });
    T.mint = K.tex(64, 64, (g, s) => { g.fillStyle = '#d7efe8'; g.fillRect(0, 0, s, s); U.speckle(g, s, s, 300, ['#c6e4db', '#e8f7f2'], .3, .6, 1, 2); g.fillStyle = '#a9cfc4'; g.fillRect(0, 0, s, 2); g.fillRect(0, 0, 2, s); });
    T.concrete = K.tex(128, 128, (g, s) => { g.fillStyle = '#8a8690'; g.fillRect(0, 0, s, s); U.speckle(g, s, s, 2500, ['#77737e', '#9c98a2'], .3, .7, 1, 2); });
    T.darkTile = K.tex(64, 64, (g, s) => { g.fillStyle = '#3a3642'; g.fillRect(0, 0, s, s); U.speckle(g, s, s, 400, ['#34303c', '#444050'], .3, .6, 1, 2); g.fillStyle = '#26232c'; g.fillRect(0, 0, s, 2); g.fillRect(0, 0, 2, s); });
    T.wood = K.tex(128, 128, (g, s) => { g.fillStyle = '#9a6a42'; g.fillRect(0, 0, s, s); for (let y = 0; y < s; y += 16) { g.fillStyle = y % 32 ? '#8e5f3a' : '#a47249'; g.fillRect(0, y, s, 15); g.fillStyle = 'rgba(40,20,10,.35)'; g.fillRect(0, y + 15, s, 1); g.fillRect((y * 37) % s, y, 1, 16); } U.speckle(g, s, s, 500, ['#7a4e30', '#b07a50'], .2, .5, 1, 3); });
    T.whiteTile = K.tex(64, 64, (g, s) => { g.fillStyle = '#f6f3ee'; g.fillRect(0, 0, s, s); U.speckle(g, s, s, 200, ['#ebe6de', '#ffffff'], .3, .6, 1, 2); g.fillStyle = '#dcd6cc'; g.fillRect(0, 0, s, 1); g.fillRect(0, 0, 1, s); });
    // casino carpet: deep red with gold diamonds
    T.casino = K.tex(128, 128, (g, s) => {
      g.fillStyle = '#6a0f1e'; g.fillRect(0, 0, s, s);
      g.strokeStyle = '#c9a04a'; g.lineWidth = 3;
      for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s], [s / 2, s / 2]]) { g.beginPath(); g.moveTo(x, y - 26); g.lineTo(x + 26, y); g.lineTo(x, y + 26); g.lineTo(x - 26, y); g.closePath(); g.stroke(); }
      g.fillStyle = '#e8c56a'; for (const [x, y] of [[s / 2, 0], [0, s / 2], [s, s / 2], [s / 2, s]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
      U.speckle(g, s, s, 600, ['#5a0c18', '#7a1426'], .3, .6, 1, 2);
    });
    // the classic 80s arcade carpet: black with neon squiggles, triangles and dots
    T.arcade = K.tex(256, 256, (g, s) => {
      g.fillStyle = '#0d0a1a'; g.fillRect(0, 0, s, s);
      const cols = ['#ff4fa3', '#3fe6e0', '#ffd84f', '#8cff6b', '#c28bff'];
      g.lineWidth = 4; g.lineCap = 'round';
      for (let k = 0; k < 26; k++) {
        const c = cols[k % cols.length], x = Math.random() * s, y = Math.random() * s; g.strokeStyle = g.fillStyle = c;
        const kind = k % 3;
        if (kind === 0) { g.beginPath(); g.moveTo(x, y); for (let i = 1; i < 5; i++) g.lineTo(x + i * 9, y + (i % 2 ? -8 : 8)); g.stroke(); }
        else if (kind === 1) { g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 9, y + 7); g.lineTo(x - 9, y + 7); g.closePath(); g.stroke(); }
        else { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
      }
    });
    T.carpetPink = K.tex(64, 64, (g, s) => { g.fillStyle = '#e88aa8'; g.fillRect(0, 0, s, s); U.speckle(g, s, s, 700, ['#d97898', '#f29ab6'], .3, .6, 1, 2); });
    T.sign = (text, sub, col, bg = '#140a1c', font = 'bold') => K.tex(512, 128, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = col; g.lineWidth = 6; g.shadowColor = col; g.shadowBlur = 14; g.strokeRect(10, 10, w - 20, h - 20);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col; g.font = `${font} ${sub ? 52 : 64}px Rubik, "Trebuchet MS", Arial, sans-serif`;
      g.fillText(text, w / 2, sub ? h / 2 - 14 : h / 2); g.shadowBlur = 4; g.fillStyle = '#fff'; g.globalAlpha = .7; g.fillText(text, w / 2, sub ? h / 2 - 14 : h / 2); g.globalAlpha = 1;
      if (sub) { g.shadowBlur = 0; g.font = '600 24px Rubik, Arial, sans-serif'; g.fillStyle = '#f5e8ff'; g.fillText(sub, w / 2, h / 2 + 32); }
    }, false);
    T.poster = (draw) => K.tex(128, 180, draw, false);
    return T;
  }

  /* =====================================================================
     places
     ===================================================================== */
  NB.buildPlaces = function (ctx) {
    const { scene, col, C, doors, hotelRoof, towerRoof, hospital, palms, mapShapes } = ctx;
    const K = makeKit(scene, col, C), T = textures(K);
    const places = [], spots = [], outdoor = [], markers = [];
    let G = null;   // the running game, handed over in attach()
    const ORIGIN = { ammo: [1500, 1500], bank: [1600, 1500], police: [1700, 1500], hospital: [1800, 1500], arcade: [1500, 1620], diner: [1600, 1620], hotel: [1700, 1620], casino: [1800, 1620], villa: [1500, 1740], tower: [1900, 1500] };

    // an interior: its room, where you appear inside, the exit circle, lighting and music
    function interior(id, name, door, o) {
      const [ox, oz] = ORIGIN[id];
      const pl = { id, name, door, ox, oz, kind: 'interior', light: o.light, music: o.music || null, interactions: [], hudInfo: null,
        inside: { x: ox + o.inside[0], z: oz + o.inside[1], heading: o.inside[2] || 0 },
        exit: { x: ox + o.exit[0], z: oz + o.exit[1] },
        copEntry: { x: ox + o.inside[0], z: oz + o.inside[1] },
        bounds: { x0: ox + o.bounds[0], z0: oz + o.bounds[1], x1: ox + o.bounds[2], z1: oz + o.bounds[3] },
        enabled: () => true, update: null, render: null, attach: null };
      // this interior's own local-to-world helpers (the kit's origin moves on as other places are built)
      pl.X = x => ox + x; pl.Z = z => oz + z; pl.P = (x, z) => ({ x: ox + x, z: oz + z });
      // every entrance is on the room's -z wall: close it from the inside with glass doors, and start
      // the hero a few steps in so the camera has room behind them
      pl.inside.z = pl.exit.z + 2.4;
      K.at(ox, oz);
      const ex = o.exit[0], wz = o.exit[1] - .85;
      K.box(ex - 1.25, 0, wz - .12, ex + 1.25, 3.3, wz + .12, '#2a2a34', true);
      for (const s of [-1, 1]) { K.box(ex + s * .62 - .5, .15, wz + .12, ex + s * .62 + .5, 2.5, wz + .14, '#6fa8c8'); K.box(ex + s * .62 - .35, 1.05, wz + .14, ex + s * .62 + .35, 1.12, wz + .2, '#d9d9e2'); }
      K.neon(ex - 1.2, 2.65, wz + .12, ex + 1.2, 2.72, wz + .17, door && door.hex || '#ffffff', false);
      places.push(pl);
      if (door) markers.push(marker(door.x, door.y || .15, door.z, door.hex || '#ffd84f', pl, 'in'));
      markers.push(marker(pl.exit.x, .02, pl.exit.z, '#ffffff', pl, 'out'));
      return pl;
    }
    // the glowing circle at a door
    function marker(x, y, z, hex, place, dir) {
      const g = new THREE.Group(), c = new THREE.Color(hex);
      const mk = (geo, op) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); g.add(m); return m; };
      mk(new THREE.RingGeometry(.62, .8, 32).rotateX(-Math.PI / 2).translate(0, .03, 0), .9);
      mk(new THREE.CircleGeometry(.62, 32).rotateX(-Math.PI / 2).translate(0, .02, 0), .16);
      const beam = mk(new THREE.CylinderGeometry(.7, .7, 1.4, 24, 1, true).translate(0, .7, 0), .1);
      g.position.set(x, y, z); scene.add(g);
      return { x, z, g, beam, place, dir, armed: true };
    }
    const lit = (sky, ground, i) => ({ sky: C(sky), ground: C(ground), i });

    /* ---------------------------------------------------------------
       1. AMMO BAY: counter, racks of guns, a four-lane shooting range
       --------------------------------------------------------------- */
    {
      const pl = interior('ammo', 'Ammo Bay', doors.ammo, { inside: [0, -4.4, 0], exit: [0, -5.3], bounds: [-8, -6, 8, 20], light: lit('#f4f1ea', '#6a6470', .95) });
      K.at(pl.ox, pl.oz);
      K.room(-8, -6, 8, 20, 4.2, { wall: '#4a4450', ceil: '#2a262e', trim: '#1c1a20', neon: '#ff8a3d', gaps: { '-z': [{ c: 0, w: 1.6, h: 2.6 }] } });
      K.floor(-8, -6, 8, 4, T.darkTile, 1.2); K.floor(-8, 4, 8, 20, T.concrete, 3);
      K.wallZ(4, -8, 8, 4.2, '#3a3440', [{ c: 6.3, w: 1.4, h: 2.6 }]);
      // counter with a glass top and the clerk behind it
      K.box(-6, 0, 1.5, 2, 1.02, 2.3, '#3a2a22', true); K.box(-6.05, 1.02, 1.45, 2.05, 1.1, 2.35, '#9aa2ae');
      K.neon(-6, .25, 1.44, 2, .31, 1.5, '#ff8a3d', false);
      K.box(-6, 0, 2.3, -5.4, 1.02, 3.9, '#3a2a22', true);
      spots.push(K.spot({ kind: 'guard', x: -2, z: 3.1, heading: Math.PI, mix: 'guard', home: true }));
      // racks of guns on the side walls
      const gunShape = (x, y, z, face, long) => { const L = long ? .9 : .45, d = face === '+x' ? 1 : -1; K.box(x, y, z - L / 2, x + .06 * d, y + .1, z + L / 2, '#18181c'); K.box(x, y - .15, z - L / 2 + .08, x + .06 * d, y, z - L / 2 + .18, '#18181c'); };
      for (const [x, face] of [[-7.84, '+x'], [7.84, '-x']]) {
        K.box(face === '+x' ? -7.85 : 7.75, .9, -5, face === '+x' ? -7.75 : 7.85, 3.3, 1.2, '#6b5a44');
        for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) gunShape(x + (face === '+x' ? .1 : -.1), 1.2 + r * .55, -4.2 + k * 1.5, face, (r + k) % 3 === 0);
        K.neon(face === '+x' ? -7.8 : 7.76, 3.35, -5, face === '+x' ? -7.76 : 7.8, 3.4, 1.2, '#ff8a3d', false);
      }
      K.picture('-z', -2, 2.9, 3.83, 4.4, 1.1, T.sign('AMMO BAY', 'оружие · патроны · тир', '#ff8a3d'));
      K.picture('+z', -5.5, 1.9, -5.83, 1.3, 1.8, T.poster((g, w, h) => { g.fillStyle = '#f2e6c8'; g.fillRect(0, 0, w, h); g.fillStyle = '#222'; g.beginPath(); g.arc(w / 2, 60, 26, 0, 7); g.fill(); g.fillRect(w / 2 - 34, 86, 68, 80); g.strokeStyle = '#d02030'; g.lineWidth = 5; for (const r of [20, 40, 60]) { g.beginPath(); g.arc(w / 2, 100, r, 0, 7); g.stroke(); } }), true);
      for (let z = -4; z < 4; z += 3) K.neon(-3, 4.15, z, 3, 4.19, z + .25, '#fff4e0', false);
      // shooting range: booth counter, lane dividers, a backstop and four pop-up targets
      K.box(-8, 0, 5.2, 8, 1.0, 5.8, '#5a5a62', true); K.box(-8, 1.0, 5.15, 8, 1.06, 5.85, '#8a8a94');
      for (const x of [-4, 0, 4]) K.box(x - .05, 0, 5.8, x + .05, 2.2, 7.5, '#6a6a74', true);
      K.box(-8, 0, 19.4, 8, 4.2, 19.8, '#2a2226', true);
      for (const x of [-6, -2, 2, 6]) { K.neon(x - .02, .02, 6, x + .02, .04, 19, '#ffd84f', false); K.neon(x - .6, 3.9, 5.4, x + .6, 3.95, 5.5, '#ff8a3d', false); }
      const targetTex = K.tex(128, 160, (g, w, h) => {
        g.fillStyle = '#f5efe0'; g.fillRect(0, 0, w, h); g.fillStyle = '#1a1a1e'; g.beginPath(); g.arc(w / 2, 40, 22, 0, 7); g.fill(); g.fillRect(w / 2 - 34, 62, 68, 90);
        g.strokeStyle = '#f5efe0'; g.lineWidth = 3; for (const r of [14, 28, 42]) { g.beginPath(); g.arc(w / 2, 96, r, 0, 7); g.stroke(); }
        g.fillStyle = '#e02a3a'; g.beginPath(); g.arc(w / 2, 96, 7, 0, 7); g.fill();
      }, false);
      const targets = [-6, -2, 2, 6].map((x, i) => {
        const pivot = new THREE.Group(); pivot.position.set(K.wx(x), .05, K.wz(17));
        const card = new THREE.Mesh(new THREE.PlaneGeometry(.9, 1.2).rotateY(Math.PI).translate(0, .95, 0), new THREE.MeshLambertMaterial({ map: targetTex }));
        const pole = new THREE.Mesh(new THREE.BoxGeometry(.06, .4, .06).translate(0, .2, 0), new THREE.MeshLambertMaterial({ color: 0x333338 }));
        pivot.add(card, pole); pivot.rotation.x = Math.PI / 2 - .05; scene.add(pivot);
        return { i, x: K.wx(x), z: K.wz(17), pivot, up: 0, want: 0, t: 0 };
      });
      const R = { on: false, t: 0, score: 0, next: 0, lent: false };
      pl.attach = () => {
        pl.interactions = [
          { ...pl.P(-2, .8), r: 1.6, short: 'КУПИТЬ', label: () => 'Магазин оружия', use: () => G.openShop() },
          { ...pl.P(0, 4.65), r: 2.8, short: 'ТИР', label: () => R.on || G.player.z < pl.Z(4.1) ? null : 'Тир · $10 · 30 секунд', use: startRange }
        ];
      };
      function startRange() {
        if (!G.money.spend(10, 'Тир')) return;
        R.on = true; R.t = 30; R.score = 0; R.next = .6;
        R.lent = G.combat.startRange();
        G.flash(R.lent ? 'Вам выдали пистолет. Стреляйте по мишеням!' : 'Стреляйте по мишеням, пока они подняты!', 2.4);
      }
      function endRange(msg) {
        R.on = false; for (const tg of targets) tg.want = 0;
        G.combat.endRange(R.lent);
        const pay = R.score * 4, best = G.progress.records.range || 0;
        if (R.score > best) G.progress.records.range = R.score;
        G.flash((msg ? msg + ' ' : '') + 'Попаданий: ' + R.score + (R.score > best ? ' — новый рекорд!' : ' · рекорд ' + best), 3);
        if (pay) G.money.add(pay, 'Приз тира'); else G.save();
      }
      // shots are checked against the raised targets
      pl.targets = {
        hitTest(ox, oy, oz, dx, dy, dz, maxT) {
          let best = null;
          for (const tg of targets) {
            if (tg.up < .8 || Math.abs(dz) < 1e-4) continue;
            const t = (tg.z - oz) / dz; if (t < 0 || t > maxT || (best && t > best.t)) continue;
            const x = ox + dx * t, y = oy + dy * t;
            if (Math.abs(x - tg.x) < .45 && y > .45 && y < 1.6) best = { t, tg };
          }
          return best;
        },
        onHit(h) { if (h.tg.want) { h.tg.want = 0; R.score++; G.audio.pickup(); } }
      };
      pl.update = (dt) => {
        for (const tg of targets) { tg.up = U.damp(tg.up, tg.want, 12, dt); tg.pivot.rotation.x = (Math.PI / 2 - .05) * (1 - tg.up); if (tg.want && (tg.t -= dt) <= 0) tg.want = 0; }
        if (!R.on) { pl.hudInfo = null; return; }
        R.t -= dt; R.next -= dt;
        if (R.next <= 0) { R.next = rand(.5, 1.1); const f = targets.filter(t => !t.want); if (f.length) { const tg = pick(f); tg.want = 1; tg.t = rand(1.4, 2.3); } }
        const p = G.player;
        if (p.z > pl.Z(5.25) || p.z < pl.Z(4.05) || G.player.dead) { endRange('Вы ушли с позиции.'); return; }
        pl.hudInfo = { tag: 'ТИР', text: 'Попаданий: ' + R.score + ' · рекорд ' + (G.progress.records.range || 0), time: '0:' + String(Math.max(0, Math.ceil(R.t))).padStart(2, '0'), warn: R.t < 5 };
        if (R.t <= 0) endRange('Время!');
      };
      pl.quiet = () => true;   // shooting in here never bothers the police
    }

    /* ---------------------------------------------------------------
       2. BANK: marble hall, teller windows, a guard and the vault
       --------------------------------------------------------------- */
    {
      const pl = interior('bank', 'Банк Neon Bay', doors.bank, { inside: [0, -6.4, 0], exit: [0, -7.3], bounds: [-12, -8, 12, 16], light: lit('#fff4e0', '#7a6a5a', .95), music: null });
      K.at(pl.ox, pl.oz);
      K.room(-12, -8, 12, 10, 6, { wall: '#e8dcc6', ceil: '#d8ccb6', trim: '#6a4a2a', gaps: { '-z': [{ c: 0, w: 2.2, h: 3.2 }], '+z': [{ c: 0, w: 3.4, h: 3.5 }] } });
      K.floor(-12, -8, 12, 10, T.marble, 2);
      for (const x of [-7, 7]) for (const z of [-4, 1.5]) { K.box(x - .45, 0, z - .45, x + .45, 6, z + .45, '#efe6d4', true); K.box(x - .55, 0, z - .55, x + .55, .4, z + .55, '#c9b48a'); K.box(x - .55, 5.5, z - .55, x + .55, 5.9, z + .55, '#c9b48a'); }
      // teller counter with three brass-barred windows
      K.box(-12, 0, 4.2, 9.5, 1.15, 5.0, '#5a2f22', true); K.box(-12, 1.15, 4.15, 9.55, 1.22, 5.05, '#e8e2d6');
      const windows = [-6, -1, 4];
      for (let x = -12; x < 9.5; x += .25) if (!windows.some(w => Math.abs(x + .125 - w) < 1)) K.box(x, 1.22, 4.5, x + .25, 2.7, 4.7, '#5a2f22'); else K.box(x + .1, 1.22, 4.56, x + .14, 2.7, 4.62, '#c9a04a');
      K.box(-12, 2.7, 4.45, 9.55, 2.85, 4.75, '#c9a04a'); K.solid(-12, 1.22, 4.45, 9.55, 2.85, 4.75);
      for (const x of windows) spots.push(K.spot({ kind: 'idle', x, z: 6.1, heading: Math.PI, type: pick(['business_f', 'business_m']), home: true }));
      // queue ropes, benches, customers, the guard
      for (let x = -9; x <= 7; x += 2) { K.box(x - .06, 0, 2, x + .06, .95, 2.12, '#c9a04a', true); if (x < 7) K.box(x, .8, 2.03, x + 2, .86, 2.09, '#b0203a'); }
      K.box(-11.8, 0, -6, -10.9, .6, -1, '#6a4a2a', true);
      for (const z of [-5.2, -3.6, -2]) if (Math.random() < .7) spots.push(K.spot({ kind: 'sit', x: -11.25, z, y: .66, heading: Math.PI / 2, mix: 'downtown' }));
      for (const x of windows) if (Math.random() < .75) spots.push(K.spot({ kind: 'idle', x, z: 3.35, heading: 0, mix: 'downtown', home: true }));
      spots.push(K.spot({ kind: 'guard', x: 9.8, z: -6.3, heading: -Math.PI / 2 - .5, type: 'security', home: true }));
      K.picture('-z', 0, 4.6, 9.83, 8, 1.3, T.sign('BANK OF NEON BAY', 'надёжно с 1961 года', '#e8c56a', '#1d1a24'));
      for (const x of [-8, 0, 8]) { K.neon(x - 1.2, 5.9, -3, x + 1.2, 5.96, -2.6, '#fff0cc', false); K.glow(x - 1.6, 5.4, -3.4, x + 1.6, 6, -2.2, '#fff0cc', .4); }
      // the vault: round steel door in the back wall, and the strong room behind it
      K.wallZ(16.15, -4.3, 4.3, 3.6, '#5a5a62'); K.wallX(-4.15, 10, 16, 3.6, '#5a5a62'); K.wallX(4.15, 10, 16, 3.6, '#5a5a62');
      K.ceil(-4, 10.1, 4, 16, 3.59, '#3a3a40'); K.floor(-4, 10.1, 4, 16, T.concrete, 2);
      for (const x of [-3.8, 3.6]) for (let y = .4; y < 3.2; y += .5) for (let z = 10.6; z < 15.6; z += .6) K.box(x, y, z, x + .2, y + .42, z + .52, '#9a9aa4');
      K.box(-2, 0, 15.2, 2, 1.1, 15.9, '#6a6a72', true);
      for (let k = 0; k < 6; k++) K.box(-1.8 + k * .6, 1.1, 15.3, -1.4 + k * .6, 1.25, 15.8, '#e8c040');
      K.neon(-3.9, 3.4, 10.2, 3.9, 3.45, 10.3, '#ff3344', false);
      const vaultPivot = new THREE.Group(); vaultPivot.position.set(K.wx(-1.65), 0, K.wz(9.8)); scene.add(vaultPivot);
      const vdoor = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, .45, 28).rotateX(Math.PI / 2).translate(1.65, 1.75, 0), new THREE.MeshLambertMaterial({ color: 0x9aa0aa }));
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(.5, .06, 8, 20).translate(1.65, 1.75, -.3), new THREE.MeshLambertMaterial({ color: 0xd9c070 }));
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, .2, 12).rotateX(Math.PI / 2).translate(1.65, 1.75, -.3), new THREE.MeshLambertMaterial({ color: 0xd9c070 }));
      vaultPivot.add(vdoor, wheel, hub);
      const vaultCol = K.solid(-1.7, 0, 9.55, 1.7, 3.4, 10.1);
      const V = { robbing: false, alarmT: 0, drill: 0, open: 0, tellers: new Set(), spawned: false };
      const ready = () => Date.now() - (G.progress.bankT || 0) > 15 * 60 * 1000;
      function startRobbery() {
        if (V.robbing) return true;
        if (!ready()) { G.flash('Банк ещё не оправился после прошлого налёта', 2.4); return false; }
        if (G.combat.isMelee()) { G.flash('Для ограбления нужен ствол в руках', 2.2); G.audio.deny(); return false; }
        V.robbing = true; V.alarmT = 60; V.drill = 8; V.tellers.clear(); V.spawned = false;
        G.progress.bankT = Date.now(); G.save();
        G.police.robbery(); G.crowd.panic(pl.X(0), pl.Z(0), 40, true);
        G.flash('Ограбление! Сработала сигнализация — полиция уже едет', 3);
        return true;
      }
      pl.attach = () => {
        pl.interactions = windows.map((x, i) => ({ ...pl.P(x, 3.3), r: 1.25, short: 'ГРАБИТЬ',
          label: () => (V.tellers.has(i) || (!V.robbing && !ready())) ? null : 'Ограбить кассу',
          use: () => { if (!startRobbery()) return; V.tellers.add(i); G.money.add(Math.round(rand(250, 420)), 'Касса'); } }));
        pl.interactions.push({ ...pl.P(0, 8.9), r: 1.7, short: 'ВЗЛОМ',
          label: () => V.open > 0 || V.drilling ? null : !V.robbing && !ready() ? null : 'Взломать хранилище',
          use: () => { if (startRobbery()) { V.drilling = true; G.flash('Взлом хранилища… держитесь рядом с дверью', 2.2); } } });
      };
      pl.update = (dt) => {
        const p = G.player, nearVault = Math.hypot(p.x - pl.X(0), p.z - pl.Z(8.9)) < 2.6;
        if (V.drilling) {
          if (nearVault && !p.dead) V.drill -= dt;
          pl.hudInfo = { tag: 'ВЗЛОМ', text: nearVault ? 'Взлом хранилища…' : 'Вернитесь к двери хранилища!', time: Math.ceil(Math.max(0, V.drill)) + ' с', warn: !nearVault };
          if (V.drill <= 0) {
            V.drilling = false; V.open = .001; pl.hudInfo = null; vaultCol.maxY = -1; G.audio.impact(10);
            for (let k = 0; k < 6; k++) G.combat.dropCash(pl.X(rand(-2.6, 2.6)), pl.Z(rand(11, 14.5)), Math.round(rand(320, 620)));
            G.flash('Хранилище открыто! Хватайте деньги и уходите', 3);
          }
        } else pl.hudInfo = null;
        if (V.open > 0 && V.open < 1) { V.open = Math.min(1, V.open + dt * .5); vaultPivot.rotation.y = -1.9 * (1 - Math.pow(1 - V.open, 3)); wheel.rotation.z += dt * 6; }
        if (V.robbing) { V.alarmT -= dt; if (V.alarmT <= 0) V.robbing = false; }
      };
      pl.alarm = () => V.robbing && V.alarmT > 0;
      pl.onLeave = () => { if (!V.robbing && V.open >= 1) { V.open = 0; vaultPivot.rotation.y = 0; vaultCol.maxY = 3.4; } V.drilling = false; };
    }

    /* ---------------------------------------------------------------
       3. POLICE STATION: desk sergeant, holding cells, locker room with a uniform
       --------------------------------------------------------------- */
    {
      const pl = interior('police', 'Полицейский участок', doors.police, { inside: [0, -4.4, 0], exit: [0, -5.3], bounds: [-17, -6, 21, 6], light: lit('#e8f0ff', '#50586a', .9) });
      K.at(pl.ox, pl.oz);
      K.room(-9, -6, 9, 6, 4, { wall: '#c9d2de', ceil: '#b8c2ce', trim: '#2f5fb0', neon: '#3f8cff', gaps: { '-z': [{ c: 0, w: 1.6, h: 2.6 }], '+x': [{ c: -3, w: 1.4, h: 2.5 }], '-x': [{ c: 2, w: 1.4, h: 2.5 }] } });
      K.floor(-9, -6, 9, 6, T.tiles, 1.5);
      K.box(-4, 0, 1.5, 4, 1.15, 2.4, '#2f3a52', true); K.box(-4.05, 1.15, 1.45, 4.05, 1.22, 2.45, '#dfe6ee'); K.box(-4, 1.22, 2.3, 4, 1.7, 2.4, '#2f3a52');
      K.neon(-4, .3, 1.44, 4, .36, 1.5, '#3f8cff', false);
      spots.push(K.spot({ kind: 'idle', x: 0, z: 3.4, heading: Math.PI, type: 'cop', home: true }));
      spots.push(K.spot({ kind: 'guard', x: 7.4, z: -4.6, heading: -Math.PI * .75, type: 'cop', home: true }));
      K.box(-8.8, 0, -5, -8, .6, -.5, '#5a6478', true);
      for (const z of [-4.2, -2.6]) if (Math.random() < .7) spots.push(K.spot({ kind: 'sit', x: -8.4, z, y: .66, heading: Math.PI / 2, mix: 'town', home: true }));
      K.picture('-z', 0, 3, 5.83, 5, 1.1, T.sign('NEON BAY PD', 'служить и защищать', '#3f8cff', '#0e1628'));
      const wanted = n => T.poster((g, w, h) => { g.fillStyle = '#f0e6c8'; g.fillRect(0, 0, w, h); g.fillStyle = '#222'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.fillText('WANTED', w / 2, 26); g.fillStyle = ['#c98f65', '#8d5a36', '#e8b890'][n]; g.fillRect(w / 2 - 26, 40, 52, 60); g.fillStyle = '#2a1c14'; g.fillRect(w / 2 - 28, 36, 56, 16); g.fillStyle = '#222'; g.font = 'bold 18px Arial'; g.fillText('$' + (n + 1) * 500, w / 2, 130); });
      for (let k = 0; k < 3; k++) K.picture('+x', -8.83, 2.1, -3.5 + k * 1.4, 1, 1.4, wanted(k), true);
      // holding cells in the east wing
      K.room(9.3, -6, 21, 6, 4, { wall: '#b8c0cc', ceil: '#a8b0bc', trim: '#2f3a52', gaps: { '-x': [{ c: -3, w: 1.4, h: 2.5 }] } });
      K.floor(9.3, -6, 21, 6, T.concrete, 2.5);
      for (const x of [13, 17]) K.wallX(x, 1, 6, 4, '#9aa2ae');
      for (let x = 9.35; x < 21; x += .24) K.box(x, 0, .95, x + .06, 3, 1.02, '#3a3a44');
      K.solid(9.3, 0, .9, 21, 3, 1.05); K.box(9.3, 3, .9, 21, 3.12, 1.05, '#3a3a44');
      for (const cx of [11.15, 15, 19]) { K.box(cx - 1.4, 0, 5, cx + 1.4, .6, 6, '#6a6a74', true); if (Math.random() < .8) spots.push(K.spot({ kind: 'sit', x: cx + rand(-.8, .8), z: 5.4, y: .66, heading: Math.PI, mix: 'town', home: true })); }
      spots.push(K.spot({ kind: 'guard', x: 19.5, z: -3.8, heading: Math.PI * .75, type: 'cop', home: true }));
      // locker room in the west wing
      K.room(-17, -6, -9.3, 6, 4, { wall: '#c2cad6', ceil: '#b2bac6', trim: '#2f3a52', gaps: { '+x': [{ c: 2, w: 1.4, h: 2.5 }] } });
      K.floor(-17, -6, -9.3, 6, T.tiles, 1.2);
      for (let z = -5; z < 5; z += .9) { K.box(-16.9, 0, z, -16.3, 2.3, z + .85, '#4f6a8a', true); K.box(-16.29, 1.6, z + .3, -16.27, 1.9, z + .55, '#2a3a4a'); }
      K.box(-13.5, 0, -2, -12.9, .5, 2, '#8a6a4a', true);
      const lockers = K.pt(-15.4, 0);
      let warnT = 0;
      pl.attach = () => {
        pl.interactions = [{ ...lockers, r: 2, short: 'ФОРМА', label: () => G.progress.outfit === 'cop' ? 'Снять полицейскую форму' : 'Надеть полицейскую форму',
          use: () => {
            if (G.progress.outfit === 'cop') { G.setOutfit(G.progress.prevOutfit || 'hawaii'); G.flash('Вы снова в своей одежде', 2); }
            else { G.progress.prevOutfit = G.progress.outfit; G.setOutfit('cop'); G.flash('Форма надета: копы не замечают мелкие нарушения. Стрельба и убийства — замечают.', 4); }
          } }];
      };
      // walking around the station with a gun out gets you in trouble
      pl.update = (dt) => {
        const armed = !G.combat.isMelee() && G.progress.outfit !== 'cop' && G.police.wanted === 0;
        if (!armed) { warnT = 0; return; }
        if (warnT === 0) G.flash('Дежурный: «Эй! Уберите оружие!»', 2.5);
        warnT += dt;
        if (warnT > 3.5) { warnT = 0; G.police.reportCrime('punch', G.player.x, G.player.z); }
      };
    }

    /* ---------------------------------------------------------------
       4. HOSPITAL: reception, waiting chairs, beds with patients
       --------------------------------------------------------------- */
    {
      const pl = interior('hospital', 'Больница', doors.hospital, { inside: [0, -4.4, 0], exit: [0, -5.3], bounds: [-9, -6, 9, 8], light: lit('#f2fbff', '#6a7a80', 1.0) });
      K.at(pl.ox, pl.oz);
      K.room(-9, -6, 9, 8, 3.8, { wall: '#eef3f4', ceil: '#e2e8ea', trim: '#3aa88a', neon: '#6bffd0', gaps: { '-z': [{ c: 0, w: 1.8, h: 2.6 }] } });
      K.floor(-9, -6, 9, 8, T.mint, 1.2);
      K.box(-6.5, 0, 0, -1, 1.1, .9, '#f6f8f8', true); K.box(-6.55, 1.1, -.05, -.95, 1.18, .95, '#3aa88a'); K.box(-6.5, .4, -.02, -1, .55, 0, '#e02a3a');
      spots.push(K.spot({ kind: 'idle', x: -3.6, z: 1.9, heading: Math.PI, type: 'medic', home: true }));
      spots.push(K.spot({ kind: 'idle', x: 4, z: 1.2, heading: Math.PI / 2, type: 'medic', home: true }));
      for (let z = -4.6; z < 0; z += .8) { K.box(-8.7, 0, z - .3, -8.1, .6, z + .3, '#5ab0d0', true); K.box(-8.95, .6, z - .3, -8.7, 1.2, z + .3, '#5ab0d0'); if (Math.random() < .55) spots.push(K.spot({ kind: 'sit', x: -8.4, z, y: .66, heading: Math.PI / 2, type: pick(['elderly', 'tourist_m', 'tourist_f']), home: true })); }
      for (const cz of [-3, 1, 5]) {
        K.box(5.8, 0, cz - 1.05, 8.2, .5, cz + 1.05, '#c9ced4', true); K.box(5.9, .5, cz - 1, 8.1, .62, cz + 1, '#ffffff'); K.box(5.9, .62, cz + .5, 8.1, .72, cz + 1, '#dfe8f4');
        K.box(5.5, 0, cz + 1.4, 8.6, 2.4, cz + 1.44, '#a8d0e8');
        if (Math.random() < .8) spots.push(K.spot({ kind: 'lie', x: 7, z: cz - .9, y: .74, heading: 0, type: pick(['elderly', 'tourist_m', 'business_m', 'tourist_f']), home: true }));
      }
      K.picture('-z', 2, 2.6, 7.83, 1.6, 1.6, K.tex(128, 128, (g, s) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s); g.fillStyle = '#e02a3a'; g.fillRect(s * .38, s * .12, s * .24, s * .76); g.fillRect(s * .12, s * .38, s * .76, s * .24); }, false));
      K.picture('-z', -4, 2.7, 7.83, 5, 1.1, T.sign('NEON BAY GENERAL', 'приёмный покой', '#3aa88a', '#f4fbfa'));
      let bloodT = 0;
      pl.attach = () => {
        pl.interactions = [{ ...pl.P(-3.6, -.7), r: 1.6, short: 'МЕДСЕСТРА', label: () => 'Поговорить с медсестрой',
          use: () => G.ui.menu({ eyebrow: 'Больница', title: 'Приёмный покой', items: () => [
            { name: 'Лечение', desc: 'Полностью восстановить здоровье', price: 40, disabled: G.player.hp >= 100 ? 'Вы здоровы' : '', buy: () => { G.player.hp = 100; return 'Здоровье восстановлено'; } },
            { name: 'Бронежилет', desc: 'Со склада больницы, дешевле, чем в магазине', price: 150, disabled: G.getArmor() >= 100 ? 'Уже надет' : '', buy: () => { G.setArmor(100); return 'Бронежилет надет'; } },
            { name: 'Сдать кровь', desc: '−25 здоровья, +$25. Раз в 5 минут', price: -25, disabled: Date.now() - bloodT < 300000 ? 'Приходите позже' : G.player.hp <= 30 ? 'Слишком мало здоровья' : '', buy: () => { bloodT = Date.now(); G.player.hp -= 25; return 'Спасибо, вы спасли жизнь!'; } }
          ] }) }];
        if (heliPad) pl.interactions.push({ ...pl.P(-8.1, 6.5), r: 1.4, short: 'ЛИФТ', label: () => 'Лифт на крышу — вертолёт', use: () => G.teleport(heliPad.liftX, heliPad.z, Math.PI / 2, null, 'Крыша больницы', heliPad.y) });
      };
      // the lift up to the helipad, on the west wall
      K.box(-8.99, 0, 5.6, -8.86, 2.6, 7.4, '#b8bcc8'); K.box(-8.87, 0, 6.48, -8.84, 2.6, 6.52, '#7a7e8a'); K.neon(-8.9, 2.6, 5.5, -8.84, 2.7, 7.5, '#6bffd0');
      K.picture('+x', -8.83, 3.05, 6.5, 1.6, .35, T.sign('ВЕРТОЛЁТ ↑', null, '#6bffd0', '#10201c'));
    }
    /* ---------------------------------------------------------------
       NEPLOXO TOWER: a black-and-gold lobby with a lift to the roof; up top a pool, sunbeds,
       a glass railing, a spire with a red light, and a helipad with a helicopter
       --------------------------------------------------------------- */
    let towerPad = null;
    if (towerRoof && doors.tower) {
      const pl = interior('tower', 'NEPLOXO TOWER', doors.tower, { inside: [0, -4.4, 0], exit: [0, -5.3], bounds: [-10, -6, 10, 12], light: lit('#fff0e6', '#4a3a4a', .95), music: 'lounge' });
      K.at(pl.ox, pl.oz);
      K.room(-10, -6, 10, 12, 7, { wall: '#1c1622', ceil: '#120e18', trim: '#c9a04a', neon: '#ff4fa3', gaps: { '-z': [{ c: 0, w: 2.2, h: 3.2 }] } });
      K.floor(-10, -6, 10, 12, T.marble, 2.5);
      for (const x of [-6.5, 6.5]) for (const z of [-2, 6]) { K.box(x - .45, 0, z - .45, x + .45, 7, z + .45, '#101014', true); K.neon(x - .47, .3, z - .47, x + .47, .36, z + .47, '#c9a04a', false); K.neon(x - .47, 6.5, z - .47, x + .47, 6.56, z + .47, '#c9a04a', false); }
      K.box(-4, 0, 5.2, 4, 1.15, 6.1, '#101014', true); K.box(-4.05, 1.15, 5.15, 4.05, 1.22, 6.15, '#c9a04a'); K.neon(-4, .3, 5.14, 4, .36, 5.2, '#ff4fa3', false);
      spots.push(K.spot({ kind: 'idle', x: -1.5, z: 6.9, heading: Math.PI, type: 'business_f' }), K.spot({ kind: 'guard', x: 2.5, z: 6.9, heading: Math.PI, type: 'security' }));
      for (const x of [-4.5, 0, 4.5]) { K.box(x - 1, 0, 11.85, x + 1, 3, 11.99, '#c9a04a'); K.box(x - .02, 0, 11.83, x + .02, 3, 11.86, '#7a6a3a'); K.neon(x - 1.1, 3, 11.8, x + 1.1, 3.1, 11.9, '#3fe6e0'); }
      K.picture('-z', 0, 4.8, 11.83, 8, 2, T.sign('NEPLOXO TOWER', '150 метров над Neon Bay', '#ff4fa3', '#10081c'));
      for (const [x0, x1, h] of [[-9.8, -9, Math.PI / 2], [9, 9.8, -Math.PI / 2]]) { K.box(x0, 0, -3, x1, .6, 2, '#2a2230', true); for (let z = -2.4; z < 2; z += 1.2) if (Math.random() < .5) spots.push(K.spot({ kind: 'sit', x: (x0 + x1) / 2, z, y: .66, heading: h, mix: 'downtown' })); }
      const lobbyLift = pl.P(0, 10.6);
      towerPad = { lobbyLift };
      pl.attach = () => { pl.interactions = [{ ...lobbyLift, r: 2.2, short: 'ЛИФТ', label: () => 'Лифт на крышу — 150 м', use: () => G.teleport(towerPad.roofX, towerPad.roofZ, towerPad.roofH, null, 'Крыша NEPLOXO TOWER', towerRoof.y) }]; };

      // the roof: local axes u along the tower's length, v across it
      K.at(0, 0);
      const R = towerRoof, y = R.y, base = y - 1.8, deep = y - 1.66;
      const W = (u, v) => R.alongZ ? [R.cx + v, R.cz + u] : [R.cx + u, R.cz + v];
      const rect = (u0, v0, u1, v1) => { const [ax, az] = W(u0, v0), [bx, bz] = W(u1, v1); return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)]; };
      const RB = (u0, v0, u1, v1, y0, y1, hex, solid) => { const [a, b, c, d] = rect(u0, v0, u1, v1); K.box(a, y0, b, c, y1, d, hex, solid); };
      const RS = (u0, v0, u1, v1, y0, y1) => { const [a, b, c, d] = rect(u0, v0, u1, v1); K.solid(a, y0, b, c, y1, d); };
      const RN = (u0, v0, u1, v1, y0, y1, hex, glow) => { const [a, b, c, d] = rect(u0, v0, u1, v1); K.neon(a, y0, b, c, y1, d, hex, glow); };
      // deck round the pool (pool at u -8.5..-2.5, v -3..3)
      for (const [u0, v0, u1, v1] of [[-10, -5, -8.5, 5], [-2.5, -5, 10, 5], [-8.5, -5, -2.5, -3], [-8.5, 3, -2.5, 5]]) { RB(u0, v0, u1, v1, y - .12, y, '#e8e2da'); RS(u0, v0, u1, v1, base, y); }
      RB(-8.5, -3, -2.5, 3, deep - .05, deep, '#2fa8c0'); RS(-8.5, -3, -2.5, 3, base, deep);
      for (const [u0, v0, u1, v1] of [[-8.5, -3, -8.4, 3], [-2.6, -3, -2.5, 3], [-8.5, -3, -2.5, -2.9], [-8.5, 2.9, -2.5, 3]]) RB(u0, v0, u1, v1, deep, y - .02, '#3fc0d6');
      for (let k = 1; k <= 3; k++) { RB(-2.6 - (4 - k) * .55, -3, -2.6, 3, deep, deep + k * .415, k % 2 ? '#5fd6e2' : '#4fc9d6'); RS(-2.6 - (4 - k) * .55, -3, -2.5, 3, base, deep + k * .415); }
      const [pa, pb, pc, pd] = rect(-8.4, -2.9, -2.6, 2.9);
      const water = new THREE.Mesh(new THREE.PlaneGeometry(pc - pa, pd - pb).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
        transparent: true, uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uTime; varying vec2 vU;
          void main(){ vec2 p = vU * vec2(7.0, 7.0); float w = sin(p.x*2.1 + uTime*1.7) * sin(p.y*2.7 - uTime*1.3) + sin((p.x+p.y)*1.3 + uTime);
            gl_FragColor = vec4(mix(vec3(0.12,0.62,0.85), vec3(0.85,1.0,1.0), smoothstep(0.9, 1.6, w)), 0.72); }` }));
      water.position.set((pa + pc) / 2, y - .22, (pb + pd) / 2); scene.add(water);
      NB.water.add({ name: 'towerpool', test: (x, z) => x > pa && x < pc && z > pb && z < pd, surface: () => y - .22 });
      // sunbeds with sunbathers along the pool
      // sunbeds by the pool: sunbathers always lie along +z, so each bed runs from v -4.6 to -2.35 in world z
      for (const u of [-9.25, -1.85, -.75]) {
        const [x, zs] = W(u, -4.6), z0 = R.alongZ ? R.cz - 4.6 : zs, z1 = z0 + 2.25;
        K.box(x - .35, y, z0, x + .35, y + .33, z1, '#ffffff', true); K.box(x - .35, y + .33, z1 - .3, x + .35, y + .41, z1, '#e8e0d0');
        K.box(x - .3, y + .331, z0 + .1, x + .3, y + .345, z1 - .35, u < -5 ? '#ff7eb6' : '#3fe6e0');
        if (Math.random() < .85) spots.push({ kind: 'lie', x, z: z0 + .15, y: y + .45, fixedY: true, heading: 0, type: Math.random() < .7 ? 'beach_f' : 'beach_m', home: true });
      }
      // the helipad at the other end
      RB(1.2, -4.4, 9.6, 4.4, y, y + .04, '#2a2a32');
      RN(1.4, -4.2, 9.4, -4.05, y + .04, y + .07, '#ffd84f', false); RN(1.4, 4.05, 9.4, 4.2, y + .04, y + .07, '#ffd84f', false); RN(1.4, -4.2, 1.55, 4.2, y + .04, y + .07, '#ffd84f', false); RN(9.25, -4.2, 9.4, 4.2, y + .04, y + .07, '#ffd84f', false);
      RB(3.8, -2, 4.3, 2, y + .04, y + .06, '#f2f2f2'); RB(6.7, -2, 7.2, 2, y + .04, y + .06, '#f2f2f2'); RB(4.3, -.25, 6.7, .25, y + .04, y + .06, '#f2f2f2');
      // lift hut, spire with a red light, glass railing all round
      RB(-2.3, 2.9, .3, 5, y, y + 2.8, '#1c1622', true); RN(-2.2, 2.85, .2, 2.9, y + 2.4, y + 2.5, '#ff4fa3');
      RB(-9.9, 4.2, -9.3, 4.8, y, y + 26, '#d8d8e2', true); RN(-9.75, 4.35, -9.45, 4.65, y + 26, y + 27.2, '#ff2233');
      // real glass: one see-through pane per side, a thin lit handrail and steel posts every two metres
      const glassMat = new THREE.MeshBasicMaterial({ color: 0x9fdcf0, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide });
      const rail = (u0, v0, u1, v1) => {
        const [a, b, c, d] = rect(u0, v0, u1, v1), m = new THREE.Mesh(new THREE.BoxGeometry(c - a, 1.05, d - b), glassMat);
        m.position.set((a + c) / 2, y + .525, (b + d) / 2); scene.add(m);
        RS(u0, v0, u1, v1, y, y + 1.2); RN(u0, v0, u1, v1, y + 1.05, y + 1.12, '#3fe6e0', false);
        const along = c - a > d - b, n = Math.round((along ? c - a : d - b) / 2);
        for (let k = 0; k <= n; k++) { const t = k / n, px = along ? a + (c - a) * t : (a + c) / 2, pz = along ? (b + d) / 2 : b + (d - b) * t; K.box(px - .05, y, pz - .05, px + .05, y + 1.05, pz + .05, '#d8dce4'); }
      };
      rail(-10, -5, 10, -4.9); rail(-10, 4.9, 10, 5); rail(-10, -5, -9.9, 5); rail(9.9, -5, 10, 5);
      const [hx, hz] = W(-1, 2.3), [lx, lz] = W(-1, 1.6);
      towerPad.roofX = lx; towerPad.roofZ = lz; towerPad.roofH = R.alongZ ? Math.PI : -Math.PI / 2;
      const [cx, cz] = W(5.4, 0); towerPad.heli = { x: cx, z: cz, h: R.alongZ ? 0 : Math.PI / 2 };
      outdoor.push({ x: hx, z: hz, y, r: 1.5, short: 'ЛИФТ', label: () => 'Лифт вниз', use: () => G.teleport(lobbyLift.x, lobbyLift.z - .8, Math.PI, pl, pl.name) });
      pl.renderRoof = t => { water.material.uniforms.uTime.value = t; };
    }
    // the helipad on the hospital roof: a lift hut to come up and go down, and the helicopter itself
    let heliPad = null;
    if (hospital) {
      K.at(0, 0);
      const y = 13.7, x = hospital.cx, z = hospital.cz;
      K.box(x - 10.3, y, z - 1.2, x - 8.1, y + 2.7, z + 1.2, '#f4f6f8', true); K.box(x - 8.1, y, z - .6, x - 8.05, y + 2.3, z + .6, '#b8bcc8');
      K.neon(x - 8.08, y + 2.3, z - .7, x - 8.02, y + 2.4, z + .7, '#6bffd0');
      for (const [a, b] of [[-4.3, -4.2], [4.2, 4.3]]) { K.neon(x - 4.3, y + .06, z + a, x + 4.3, y + .1, z + b, '#ffd84f', false); K.neon(x + a, y + .06, z - 4.3, x + b, y + .1, z + 4.3, '#ffd84f', false); }
      heliPad = { x: x + .8, z, y, liftX: x - 7.4 };
      const hosp = places.find(p => p.id === 'hospital'), down = hosp.P(-7.4, 6.5);
      outdoor.push({ x: x - 7.6, z, y, r: 1.4, short: 'ЛИФТ', label: () => 'Лифт вниз', use: () => G.teleport(down.x, down.z, Math.PI / 2, hosp, hosp.name) });
    }

    /* ---------------------------------------------------------------
       5. ARCADE: rows of machines with live screens, neon carpet, a prize counter
       --------------------------------------------------------------- */
    {
      const pl = interior('arcade', 'Зал игровых автоматов', doors.arcade, { inside: [0, -4.4, 0], exit: [0, -5.3], bounds: [-10, -6, 10, 12], light: lit('#b8a0ff', '#201430', .55), music: 'arcade' });
      K.at(pl.ox, pl.oz);
      K.room(-10, -6, 10, 12, 3.6, { wall: '#1c1230', ceil: '#0e0a18', trim: '#0a0812', neon: '#c28bff', gaps: { '-z': [{ c: 0, w: 1.8, h: 2.6 }] } });
      K.floor(-10, -6, 10, 12, T.arcade, 3);
      const MARQ = ['#ff4fa3', '#3fe6e0', '#ffd84f', '#8cff6b', '#c28bff', '#ff8a3d'];
      const machines = [];
      // a cabinet whose front faces direction dir (+1: +x, -1: -x), standing at x = back
      const cabinet = (back, z, dir, k) => {
        const f = back + dir * .8, bx0 = Math.min(back, f), bx1 = Math.max(back, f);
        K.box(bx0, 0, z - .42, bx1, 1.95, z + .42, '#241a34', true);
        K.box(Math.min(f, f + dir * .32), .95, z - .4, Math.max(f, f + dir * .32), 1.08, z + .4, '#3a2a50');
        K.screen(dir > 0 ? '+x' : '-x', f + dir * .01, 1.45, z, .62, .5, 0);
        K.neon(bx0, 1.75, z - .42, bx1 + (dir > 0 ? .02 : 0), 1.95, z + .42, MARQ[k % MARQ.length]);
        for (const s of [-1, 1]) K.neon(f + dir * .01 - .01, .1, z + s * .41 - .01, f + dir * .01 + .01, 1.7, z + s * .41 + .01, MARQ[(k + 2) % MARQ.length], false);
        machines.push({ x: f + dir * .75, z, heading: dir > 0 ? -Math.PI / 2 : Math.PI / 2 });
      };
      let k = 0;
      for (let z = -3.4; z <= 10.5; z += 1.3) { cabinet(-10, z, 1, k++); cabinet(10, z, -1, k++); }
      for (let z = 0; z <= 7.8; z += 1.3) { cabinet(-.02, z, -1, k++); cabinet(.02, z, 1, k++); }
      for (const m of machines) if (Math.random() < .3) { m.busy = true; spots.push(K.spot({ kind: 'play', x: m.x, z: m.z, heading: m.heading, mix: 'town', home: true })); }
      // prize counter at the back with plush toys
      K.box(-4, 0, 10.2, 4, 1.05, 10.9, '#2a1a40', true); K.neon(-4, .9, 10.16, 4, .96, 10.2, '#ffd84f', false);
      K.box(-4, 0, 11.45, 4, 1.0, 11.95, '#2a1a40', true);
      for (let x = -3.6; x < 3.6; x += .5) K.box(x, 1.0, 11.5, x + .38, 1.0 + rand(.25, .45), 11.9, pick(['#ff7eb6', '#7fe0ff', '#ffd84f', '#9be37a', '#c9a4ff']));
      spots.push(K.spot({ kind: 'idle', x: 0, z: 11.15, heading: Math.PI, mix: 'town', home: true }));
      K.picture('-z', 0, 2.8, 11.83, 5, 1.1, T.sign('NEON ARCADE', '1 жетон = $5', '#c28bff', '#0c0818'));
      // air hockey in the corner
      K.box(4.5, 0, -4.4, 7.5, .85, -2.8, '#1a1a2a', true); K.neon(4.5, .85, -4.4, 7.5, .88, -2.8, '#3fe6e0');
      pl.attach = () => {
        pl.interactions = machines.filter(m => !m.busy).map(m => ({ ...pl.P(m.x, m.z), r: .95, short: 'ИГРАТЬ', label: () => 'Играть в NEON RACER · $5', use: () => G.ui.racer() }));
      };
    }

    /* ---------------------------------------------------------------
       6. DINER: checkerboard floor, counter and stools, booths, a jukebox, a waitress on skates
       --------------------------------------------------------------- */
    {
      const pl = interior('diner', 'Закусочная', doors.diner, { inside: [6, -3.4, 0], exit: [6, -4.3], bounds: [-10, -5, 10, 7], light: lit('#fff0e0', '#6a4a50', .95), music: 'diner' });
      K.at(pl.ox, pl.oz);
      K.room(-10, -5, 10, 7, 3.4, { wall: '#f4e8d8', ceil: '#e8dcca', trim: '#c8283c', neon: '#ff4fa3', gaps: { '-z': [{ c: 6, w: 1.6, h: 2.6 }] } });
      K.floor(-10, -5, 10, 7, T.checker, 1.2);
      K.box(-10, .9, -4.99, 10, 1.05, -4.9, '#c8283c'); K.box(-10, 2.9, 6.9, 10, 3.0, 6.99, '#c8283c');
      // counter, stools, the cook
      K.box(-8, 0, 3, 3, 1.02, 3.8, '#c8283c', true); K.box(-8.05, 1.02, 2.95, 3.05, 1.1, 3.85, '#f4f0ea'); K.box(-8, .45, 2.98, 3, .55, 3.0, '#d9d9e2');
      for (let x = -7.2; x < 2.6; x += 1.2) {
        K.box(x - .05, 0, 2.2, x + .05, .55, 2.3, '#d9d9e2'); K.box(x - .24, .55, 2.01, x + .24, .62, 2.49, '#c8283c');
        K.solid(x - .2, 0, 2.05, x + .2, .62, 2.45);
        if (Math.random() < .45) spots.push(K.spot({ kind: 'sit', x, z: 2.2, y: .66, heading: 0, mix: 'town', home: true }));
      }
      K.box(-8, 0, 6.2, 3, 1.0, 6.9, '#b8b8c2', true); K.box(-7, 1.9, 6.4, -2, 2.7, 6.9, '#9a9aa4');
      spots.push(K.spot({ kind: 'idle', x: -3, z: 5.1, heading: Math.PI, type: 'cook', home: true }));
      for (let x = -6; x < 2; x += 1.8) { K.box(x, 1.1, 3.2, x + .5, 1.3, 3.6, '#f2d6a8'); K.box(x + .05, 1.3, 3.25, x + .45, 1.34, 3.55, '#c8283c'); }
      K.picture('-z', -2.5, 2.35, 6.83, 4.2, 1, T.sign('БУРГЕР · ФРИ · ШЕЙК', 'открыто круглосуточно', '#ffd84f', '#1a1216'));
      // booths along the front windows
      for (const cx of [-8.2, -4.4, -.6]) {
        for (const s of [-1, 1]) { const x0 = cx + s * .95 - .3, x1 = cx + s * .95 + .3; K.box(x0, 0, -4.8, x1, .6, -3, '#c8283c', true); K.box(s < 0 ? x0 - .2 : x1, .6, -4.8, s < 0 ? x0 : x1 + .2, 1.3, -3, '#a81e30', true); }
        K.box(cx - .45, 0, -4.7, cx + .45, .78, -3.2, '#f4f0ea', true);
        for (const s of [-1, 1]) if (Math.random() < .55) spots.push(K.spot({ kind: 'sit', x: cx + s * .9, z: -3.9, y: .66, heading: s < 0 ? Math.PI / 2 : -Math.PI / 2, mix: 'town', home: true }));
      }
      for (let x = -9.5; x < 1.5; x += 2.4) K.neon(x, 1.3, -4.99, x + 1.8, 2.6, -4.97, '#a8e0ff', false);
      // jukebox
      K.box(8.9, 0, 2, 9.9, 1.5, 3.2, '#5a2a1a', true); K.neon(8.88, 1.5, 2.05, 8.92, 1.9, 3.15, '#ffd84f'); K.neon(8.88, .3, 2.2, 8.9, 1.3, 2.3, '#ff4fa3', false); K.neon(8.88, .3, 2.9, 8.9, 1.3, 3.0, '#3fe6e0', false);
      K.screen('-x', 8.87, 1.0, 2.6, .5, .3, 3);
      // the waitress skates a loop between the booths and the counter
      spots.push(K.spot({ kind: 'skate', x: -7, z: 1, heading: Math.PI / 2, type: 'waitress', patrol: [[-7.5, 1.1], [3.5, 1.1], [4.5, -1.6], [-8.5, -1.9]] }));
      const SONGS = ['diner', 'diner2', 'diner3'], NAMES = ['«Neon Boogie»', '«Малибу-твист»', '«Полночный шейк»'];
      let song = 0;
      pl.attach = () => {
        pl.interactions = [
          { ...pl.P(-2.5, 1.7), r: 1.9, short: 'МЕНЮ', label: () => 'Меню закусочной', use: () => G.ui.menu({ eyebrow: 'Закусочная', title: 'Меню', items: () => [
            { name: 'Бургер «Neon»', desc: '+40 здоровья', price: 12, disabled: G.player.hp >= 100 ? 'Вы сыты' : '', buy: () => { G.player.hp = Math.min(100, G.player.hp + 40); return 'Вкусно!'; } },
            { name: 'Картошка фри', desc: '+15 здоровья', price: 5, disabled: G.player.hp >= 100 ? 'Вы сыты' : '', buy: () => { G.player.hp = Math.min(100, G.player.hp + 15); return 'Хрустит!'; } },
            { name: 'Молочный коктейль', desc: '+20 здоровья', price: 7, disabled: G.player.hp >= 100 ? 'Вы сыты' : '', buy: () => { G.player.hp = Math.min(100, G.player.hp + 20); return 'Клубничный, с вишенкой'; } },
            { name: 'Кофе', desc: '+10 здоровья', price: 3, disabled: G.player.hp >= 100 ? 'Вы сыты' : '', buy: () => { G.player.hp = Math.min(100, G.player.hp + 10); return 'Бодрит!'; } }
          ] }) },
          { ...pl.P(8.4, 2.6), r: 1.4, short: 'МУЗЫКА', label: () => 'Музыкальный автомат · $1', use: () => { if (!G.money.spend(1, 'Музыка')) return; song = (song + 1) % SONGS.length; pl.music = SONGS[song]; G.flash('Играет ' + NAMES[song], 2); } }
        ];
      };
    }

    /* ---------------------------------------------------------------
       7. HOTEL OCEAN: lobby with a fountain and a lift to the rooftop pool
       --------------------------------------------------------------- */
    let roofLift = null;
    {
      const pl = interior('hotel', 'Отель OCEAN', doors.hotel, { inside: [0, -4.4, 0], exit: [0, -5.3], bounds: [-10, -6, 10, 10], light: lit('#fff2ec', '#7a5a6a', 1.0), music: 'lounge' });
      K.at(pl.ox, pl.oz);
      K.room(-10, -6, 10, 10, 6, { wall: '#f6e2e6', ceil: '#f0d8de', trim: '#3fb8b0', neon: '#3fe6e0', gaps: { '-z': [{ c: 0, w: 2, h: 3 }] } });
      K.floor(-10, -6, 10, 10, T.pinkMarble, 2);
      K.box(-4, 0, 6, 4, 1.15, 7, '#ffffff', true); K.box(-4.05, 1.15, 5.95, 4.05, 1.22, 7.05, '#3fb8b0'); K.neon(-4, .2, 5.94, 4, .28, 6, '#3fe6e0', false);
      spots.push(K.spot({ kind: 'idle', x: 0, z: 8, heading: Math.PI, type: 'business_f', home: true }));
      for (let x = -3; x <= 3; x += .5) for (let y = 1.6; y < 3.2; y += .4) K.box(x - .12, y, 9.88, x + .12, y + .25, 9.99, '#c9a04a');
      K.picture('-z', 0, 4.2, 9.83, 6, 1.3, T.sign('HOTEL OCEAN', 'Neon Bay · since 1938', '#3fe6e0', '#fff6f8'));
      // the fountain in the middle
      K.box(-1.8, 0, -.3, 1.8, .6, 3.3, '#ffffff', true); K.neon(-1.6, .5, -.1, 1.6, .54, 3.1, '#6fe0ff', false); K.box(-.3, .6, 1.2, .3, 1.8, 1.8, '#ffffff', true); K.box(-.7, 1.8, .8, .7, 1.95, 2.2, '#ffffff');
      K.glow(-1.6, .5, -.1, 1.6, 1.2, 3.1, '#6fe0ff', .4);
      // sofas with guests, potted palms, a chandelier
      for (const [x0, x1, face] of [[-9.8, -9, Math.PI / 2], [-6, -5.2, -Math.PI / 2]]) {
        K.box(x0, 0, -1, x1, .6, 3, '#3fb8b0', true); K.box(face > 0 ? x0 - .0 : x1 - .01, .6, -1, face > 0 ? x0 + .25 : x1, 1.25, 3, '#2f9890');
        for (let z = -.4; z < 3; z += 1.1) if (Math.random() < .5) spots.push(K.spot({ kind: 'sit', x: (x0 + x1) / 2 + (face > 0 ? .1 : -.1), z, y: .66, heading: face, mix: 'strip', home: true }));
      }
      K.box(-8, 0, .3, -7, .45, 1.7, '#e8e0d4', true);
      const pot = (x, z) => { K.box(x - .35, 0, z - .35, x + .35, .7, z + .35, '#c9a04a', true); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; K.box(x + Math.cos(a) * .15 - .06, .7, z + Math.sin(a) * .15 - .06, x + Math.cos(a) * .7, 1.6 + (k % 2) * .3, z + Math.sin(a) * .7, '#2f8a44'); } };
      for (const [x, z] of [[-9, -5], [9, -5], [-9, 9], [9, 9], [5, 6.5], [-5, 6.5]]) pot(x, z);
      K.neon(-1.5, 5.4, .3, 1.5, 5.46, 2.7, '#fff0d8'); K.glow(-2, 4.9, -.2, 2, 5.9, 3.2, '#fff0d8', .5);
      // the lift doors on the east wall
      K.box(9.85, 0, 3, 9.99, 2.7, 5, '#b8bcc8'); K.box(9.83, 0, 3.98, 9.86, 2.7, 4.02, '#7a7e8a'); K.neon(9.84, 2.7, 2.9, 9.88, 2.8, 5.1, '#3fe6e0');
      K.screen('-x', 9.82, 3.05, 4, .5, .25, 3);
      spots.push(K.spot({ kind: 'skate', x: 6, z: -3, heading: 0, type: 'bellboy', patrol: [[6, -3], [6, 4.5], [-6.5, 4.5], [-3, -3.5]] }));
      pl.attach = () => {
        pl.interactions = [
          { ...pl.P(0, 5.2), r: 1.8, short: 'НОМЕР', label: () => 'Снять номер на ночь · $60', use: () => { if (!G.money.spend(60, 'Номер в отеле')) return; G.sleep('Вы выспались в отеле OCEAN'); } },
          { ...pl.P(9, 4), r: 1.5, short: 'ЛИФТ', label: () => roofLift ? 'Лифт на крышу' : null, use: () => G.teleport(roofLift.x, roofLift.z, roofLift.heading, null, 'Крыша отеля OCEAN', roofLift.y) }
        ];
      };
    }
    // the rooftop pool deck, built on top of the real hotel in the city
    if (hotelRoof) {
      const R = hotelRoof; K.at(0, 0);
      const px0 = R.x0 + 4.2, px1 = R.x1 - 3.4, pz0 = R.z0 + 2.2, pz1 = R.z1 - 2.2, y = R.y, base = y - 3.05, deep = y - 1.66;
      NB.water.add({ name: 'roofpool', test: (x, z) => x > px0 + .1 && x < px1 - .1 && z > pz0 + .1 && z < pz1 - .1, surface: () => y - .22 });
      for (const [a, b, c, d] of [[R.x0, R.z0, px0, R.z1], [px1, R.z0, R.x1, R.z1], [px0, R.z0, px1, pz0], [px0, pz1, px1, R.z1]]) { K.box(a, y - .12, b, c, y, d, '#efe4d6'); K.solid(a, base, b, c, y, d); }
      K.box(px0, deep - .05, pz0, px1, deep, pz1, '#3fb3c7'); K.solid(px0, base, pz0, px1, deep, pz1);
      for (const [a, b, c, d] of [[px0, pz0, px0 + .12, pz1], [px1 - .12, pz0, px1, pz1], [px0, pz0, px1, pz0 + .12], [px0, pz1 - .12, px1, pz1]]) K.box(a, deep, b, c, y - .02, d, '#4fc9d6');
      // steps out of the pool at the east end, each one an easy step up
      for (let k = 1; k <= 3; k++) { const x0 = px1 - .12 - (4 - k) * .6; K.box(x0, deep, pz0 + .12, px1 - .12, deep + k * .415, pz1 - .12, k % 2 ? '#5fd6e2' : '#4fc9d6'); K.solid(x0, base, pz0, px1, deep + k * .415, pz1); }
      const water = new THREE.Mesh(new THREE.PlaneGeometry(px1 - px0 - .24, pz1 - pz0 - .24).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
        transparent: true, uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uTime; varying vec2 vU;
          void main(){ vec2 p = vU * vec2(9.0, 6.0); float w = sin(p.x*2.1 + uTime*1.7) * sin(p.y*2.7 - uTime*1.3) + sin((p.x+p.y)*1.3 + uTime);
            float caust = smoothstep(0.9, 1.6, w); gl_FragColor = vec4(mix(vec3(0.15,0.72,0.85), vec3(0.85,1.0,1.0), caust), 0.72); }`
      }));
      water.position.set((px0 + px1) / 2, y - .22, (pz0 + pz1) / 2); scene.add(water);
      // railing all round, loungers, umbrellas
      const rail = (a, b, c, d) => { K.box(a, y, b, c, y + 1.05, d, '#ffffff'); K.solid(a, y, b, c, y + 1.1, d); K.neon(a, y + 1.05, b, c, y + 1.1, d, '#ff4fa3', false); };
      rail(R.x0, R.z0, R.x1, R.z0 + .08); rail(R.x0, R.z1 - .08, R.x1, R.z1); rail(R.x0, R.z0, R.x0 + .08, R.z1); rail(R.x1 - .08, R.z0, R.x1, R.z1);
      for (let k = 0; k < 3; k++) {
        const x = px0 + .8 + k * 2.2;
        for (const [z0, z1, back] of [[R.z0 + .3, R.z0 + 2.0, R.z0 + .3], [R.z1 - 2.0, R.z1 - .3, R.z1 - .7]]) {
          if (x > px1 - 1.6) continue;
          K.box(x - .35, y, z0, x + .35, y + .35, z1, '#ffffff', true); K.box(x - .35, y + .35, back, x + .35, y + .8, back + .4, '#ffffff'); K.box(x - .3, y + .36, z0 + .2, x + .3, y + .38, z1 - .2, k % 2 ? '#ff7eb6' : '#3fe6e0');
        }
      }
      // lift hut in the south-west corner
      K.box(R.x0 + .15, y, R.z0 + .15, R.x0 + 2.8, y + 2.8, R.z0 + 2.6, R.hex || '#f7b5c9', true); K.box(R.x0 + 2.8, y, R.z0 + .8, R.x0 + 2.85, y + 2.3, R.z0 + 1.9, '#b8bcc8');
      K.neon(R.x0 + 2.82, y + 2.3, R.z0 + .7, R.x0 + 2.9, y + 2.4, R.z0 + 2.0, '#3fe6e0');
      roofLift = { x: R.x0 + 3.5, z: R.z0 + 1.35, heading: Math.PI / 2, y };
      const hotel = places.find(p => p.id === 'hotel'), fromLift = hotel.P(8.3, 4);
      outdoor.push({ x: R.x0 + 3.4, z: R.z0 + 1.35, y, r: 1.4, short: 'ЛИФТ', label: () => 'Лифт в лобби', use: () => G.teleport(fromLift.x, fromLift.z, -Math.PI / 2, hotel, hotel.name) });
      hotel.renderRoof = t => { water.material.uniforms.uTime.value = t; };
    }

    /* ---------------------------------------------------------------
       8. CASINO: roulette, card tables, rows of slot machines, a cashier's cage
       --------------------------------------------------------------- */
    {
      const pl = interior('casino', 'Казино', doors.casino, { inside: [0, -4.4, 0], exit: [0, -5.3], bounds: [-12, -6, 12, 14], light: lit('#ffe6c8', '#5a2a2a', .85), music: 'casino' });
      K.at(pl.ox, pl.oz);
      K.room(-12, -6, 12, 14, 5, { wall: '#3a0f1a', ceil: '#24080f', trim: '#c9a04a', neon: '#ffd84f', gaps: { '-z': [{ c: 0, w: 2.2, h: 3 }] } });
      K.floor(-12, -6, 12, 14, T.casino, 2.5);
      for (const x of [-6, 6]) for (const z of [-1, 8]) { K.box(x - .4, 0, z - .4, x + .4, 5, z + .4, '#c9a04a', true); K.neon(x - .42, .2, z - .42, x + .42, .26, z + .42, '#ff4fa3', false); K.neon(x - .42, 4.6, z - .42, x + .42, 4.66, z + .42, '#ff4fa3', false); }
      // roulette table with a wheel that spins
      K.box(-2.3, 0, 4, 2.3, .9, 6.2, '#5a2a1a', true); K.box(-2.2, .9, 4.1, 2.2, .95, 6.1, '#1f6b3a');
      for (let k = 0; k < 12; k++) K.box(-1.9 + k * .28, .951, 4.4, -1.72 + k * .28, .955, 5.2, k % 2 ? '#c81e2a' : '#141418');
      const wheel = new THREE.Group(); wheel.position.set(K.wx(1.55), .96, K.wz(5.5)); scene.add(wheel);
      wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(.5, .55, .1, 24), new THREE.MeshLambertMaterial({ color: 0x5a2a1a })));
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .11, 18), new THREE.MeshBasicMaterial({ vertexColors: false, color: 0xc81e2a })); wheel.add(rim);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(.12, .2, 8).translate(0, .15, 0), new THREE.MeshLambertMaterial({ color: 0xd9c070 })); wheel.add(cone);
      spots.push(K.spot({ kind: 'idle', x: 0, z: 6.9, heading: Math.PI, type: 'croupier', home: true }));
      for (const x of [-1.4, .2]) if (Math.random() < .8) spots.push(K.spot({ kind: 'idle', x, z: 3.3, heading: 0, mix: 'downtown', home: true }));
      // card tables with dealers and players
      for (const cx of [-6, 6]) {
        K.box(cx - 1.4, 0, 10, cx + 1.4, .9, 11.2, '#5a2a1a', true); K.box(cx - 1.3, .9, 10.1, cx + 1.3, .94, 11.1, '#1f6b3a');
        spots.push(K.spot({ kind: 'idle', x: cx, z: 11.9, heading: Math.PI, type: 'croupier', home: true }));
        for (const dx of [-.9, 0, .9]) { K.box(cx + dx - .22, 0, 9.1, cx + dx + .22, .62, 9.55, '#c9a04a', true); if (Math.random() < .6) spots.push(K.spot({ kind: 'sit', x: cx + dx, z: 9.3, y: .66, heading: 0, mix: 'downtown', home: true })); }
      }
      // slot machines along both walls
      const slots = [];
      for (const [back, dir] of [[-12, 1], [12, -1]]) for (let z = -4.2; z <= 12.5; z += 1.25) {
        if (Math.abs(z - 8) < .7 || Math.abs(z + 1) < .7) continue;
        const f = back + dir * .75, bx0 = Math.min(back, f), bx1 = Math.max(back, f);
        K.box(bx0, 0, z - .45, bx1, 1.75, z + .45, '#8a1a2a', true);
        K.screen(dir > 0 ? '+x' : '-x', f + dir * .01, 1.25, z, .6, .42, 1);
        K.neon(bx0, 1.75, z - .45, bx1, 1.95, z + .45, '#ffd84f');
        K.box(f - .05, .7, z + .46, f + .05, 1.2, z + .5, '#d9d9e2');
        const sx = f + dir * .75;
        K.box(sx - .22, 0, z - .22, sx + .22, .62, z + .22, '#c9a04a', true);
        if (Math.random() < .35) spots.push(K.spot({ kind: 'sit', x: sx, z, y: .66, heading: dir > 0 ? -Math.PI / 2 : Math.PI / 2, mix: 'downtown', home: true }));
        slots.push({ x: f + dir * .5, z });
      }
      // cashier's cage
      K.box(-4, 0, 12.6, 4, 1.1, 13.2, '#5a2a1a', true); for (let x = -4; x < 4; x += .2) K.box(x, 1.1, 12.85, x + .04, 2.6, 12.9, '#c9a04a');
      spots.push(K.spot({ kind: 'idle', x: 0, z: 13.6, heading: Math.PI, type: 'croupier', home: true }));
      K.picture('-z', 0, 3.6, 13.83, 6, 1.3, T.sign('ROYAL NEON CASINO', 'удача любит смелых', '#ffd84f', '#24080f'));
      for (const [x, z] of [[0, 1.5], [0, 9.5]]) { K.neon(x - 1, 4.7, z - 1, x + 1, 4.76, z + 1, '#fff0cc'); K.glow(x - 1.6, 3.9, z - 1.6, x + 1.6, 4.9, z + 1.6, '#fff0cc', .5); }
      pl.attach = () => {
        pl.interactions = [{ ...pl.P(0, 3.2), r: 1.9, short: 'РУЛЕТКА', label: () => 'Рулетка', use: () => G.ui.roulette() }]
          .concat(slots.map(s => ({ ...pl.P(s.x, s.z), r: .95, short: 'СЛОТЫ', label: () => 'Игровой автомат', use: () => G.ui.slots() })));
      };
      pl.render = (t) => { wheel.rotation.y = t * .8; };
    }

    /* ---------------------------------------------------------------
       9. THE VILLA: bought on the beach, with a garage for two cars and a pool;
          inside a living room with a TV and a bedroom with a round bed and a wardrobe
       --------------------------------------------------------------- */
    const VILLA_PRICE = 4000;
    let villaDoor = null, garage = null;
    {
      K.at(0, 0);
      const WHITE = '#f6f2ec', GLASS = '#1f3a4a', PINK = '#ff7eb6';
      // garage: two bays, a roller door facing the promenade
      K.box(111.2, 0, 80.4, 119, 3.2, 80.7, WHITE, true); K.box(111.2, 0, 88.7, 119, 3.2, 89, WHITE, true); K.box(118.7, 0, 80.4, 119, 3.2, 89, WHITE, true);
      K.box(111.2, 0, 80.4, 111.5, 3.2, 81, WHITE, true); K.box(111.2, 0, 88.4, 111.5, 3.2, 89, WHITE, true);
      K.box(111.2, 2.8, 81, 111.5, 3.2, 88.4, WHITE, true);
      K.box(111, 3.2, 80.2, 119.2, 3.45, 89.2, '#e4ddd2', true);
      K.box(111.5, .02, 80.7, 118.7, .04, 88.7, '#8a8690');
      K.neon(110.95, 2.95, 81, 111.05, 3.05, 88.4, '#3fe6e0');
      K.box(109.5, .03, 81, 111.2, .05, 88.4, '#9a96a0');
      K.ceil(111.5, 80.7, 118.7, 88.7, 3.19, '#d8d0c4');
      const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(.12, 2.8, 7.4).translate(0, 1.4, 0), new THREE.MeshLambertMaterial({ color: 0xd8d4cc }));
      doorMesh.position.set(111.33, 0, 84.7); scene.add(doorMesh);
      for (let k = 1; k < 7; k++) { const line = new THREE.Mesh(new THREE.BoxGeometry(.13, .03, 7.4), new THREE.MeshLambertMaterial({ color: 0xb8b2a8 })); line.position.set(0, k * .4, 0); doorMesh.add(line); }
      const doorCol = col.add(111.1, 0, 81, 111.55, 2.8, 88.4);
      garage = { bays: [{ x: 115.2, z: 82.85, h: -Math.PI / 2 }, { x: 115.2, z: 86.55, h: -Math.PI / 2 }], rect: { x0: 111.6, x1: 118.6, z0: 80.8, z1: 88.6 }, doorMesh, doorCol, open: 0 };
      // perimeter wall with a gate
      K.box(111.2, 0, 103.4, 133.5, 1.3, 103.7, WHITE, true);
      K.box(111.2, 0, 89, 111.5, 1.3, 92.4, WHITE, true); K.box(111.2, 0, 96.6, 111.5, 1.3, 103.7, WHITE, true);
      K.box(119, 0, 80.1, 133.5, 1.3, 80.4, WHITE, true);
      for (const z of [92.1, 96.6]) { K.box(111, 0, z - .15, 111.7, 1.8, z + .15, WHITE, true); K.neon(111.2, 1.8, z - .1, 111.5, 2.05, z + .1, PINK); }
      // the house: two white storeys, bands of dark glass, a pink stripe and neon under the roof
      K.box(119.5, 0, 90, 127.5, 3.6, 101.5, WHITE, true);
      K.box(119.44, .5, 91, 119.5, 3.1, 93.6, GLASS); K.box(119.44, .5, 95.6, 119.5, 3.1, 100.6, GLASS);
      K.box(127.5, .5, 90.8, 127.56, 3.1, 100.8, GLASS);
      K.box(119.4, 3.5, 89.9, 127.6, 3.72, 101.6, PINK);
      K.box(120.5, 3.72, 91, 127, 7, 100.5, WHITE, true);
      K.box(120.44, 4.3, 91.8, 120.5, 6.4, 99.8, GLASS); K.box(127, 4.3, 91.8, 127.06, 6.4, 99.8, GLASS);
      K.box(119.2, 7, 89.7, 127.8, 7.25, 101.8, '#e4ddd2', true); K.neon(119.2, 6.93, 89.7, 127.8, 7.0, 89.8, PINK); K.neon(119.2, 6.93, 101.7, 127.8, 7.0, 101.8, PINK); K.neon(127.7, 6.93, 89.7, 127.8, 7.0, 101.8, PINK); K.neon(119.2, 6.93, 89.7, 119.3, 7.0, 101.8, PINK);
      K.box(117.8, 2.9, 93.2, 119.5, 3.1, 95.8, '#e4ddd2');
      K.box(119.44, 0, 93.9, 119.5, 2.5, 95.1, '#3a2a30'); K.neon(119.4, 2.5, 93.8, 119.46, 2.6, 95.2, '#3fe6e0');
      villaDoor = { x: 118.2, z: 94.5, y: .02, heading: -Math.PI / 2, nx: -1, nz: 0, hex: '#ff7eb6' };
      // terrace with a pool facing the ocean
      const dy = .38;
      for (const [a, b, c, d] of [[127.5, 81, 133.5, 85], [127.5, 95, 133.5, 103.2], [127.5, 85, 128.6, 95], [132.4, 85, 133.5, 95]]) K.box(a, 0, b, c, dy, d, '#efe4d6', true);
      K.box(128.6, 0, 85, 132.4, .03, 95, '#3fb3c7');
      for (const [a, b, c, d] of [[128.6, 85, 128.7, 95], [132.3, 85, 132.4, 95], [128.6, 85, 132.4, 85.1], [128.6, 94.9, 132.4, 95]]) K.box(a, 0, b, c, dy - .01, d, '#4fc9d6');
      const water = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 9.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5fd6e6, transparent: true, opacity: .75 }));
      water.position.set(130.5, .3, 90); scene.add(water);
      // deep enough to swim; you climb out over the edge onto the deck
      NB.water.add({ name: 'villapool', test: (x, z) => x > 128.7 && x < 132.3 && z > 85.1 && z < 94.9, surface: () => .3, floor: () => -1.3 });
      for (const z of [97.5, 100]) { K.box(129, dy, z, 131.5, dy + .32, z + .7, '#ffffff', true); K.box(131.1, dy + .32, z, 131.5, dy + .8, z + .7, '#ffffff'); K.box(129.1, dy + .33, z + .1, 131, dy + .35, z + .6, PINK); }
      palms.push([133, .02, 80.8], [133, .38, 102.6], [110.2, .02, 98.2], [128.2, .38, 82]);
      mapShapes.push({ x0: 111.2, z0: 80.4, x1: 119, z1: 89, c: '#f6f2ec', k: 'b' }, { x0: 119.5, z0: 90, x1: 127.5, z1: 101.5, c: '#ffd6e6', k: 'b' }, { x0: 128.6, z0: 85, x1: 132.4, z1: 95, c: '#4fc9d6', k: 'p' });
      // for-sale board at the gate
      const saleTex = K.tex(256, 160, (g, w, h) => {
        g.fillStyle = '#fff6ea'; g.fillRect(0, 0, w, h); g.fillStyle = '#e0286a'; g.fillRect(0, 0, w, 44);
        g.fillStyle = '#fff'; g.font = 'bold 30px Rubik, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('ПРОДАЁТСЯ', w / 2, 32);
        g.fillStyle = '#2a1a24'; g.font = 'bold 26px Rubik, Arial, sans-serif'; g.fillText('Вилла у океана', w / 2, 84);
        g.fillStyle = '#1a8a5a'; g.font = '900 38px Rubik, Arial, sans-serif'; g.fillText('$' + VILLA_PRICE.toLocaleString('ru-RU'), w / 2, 132);
      }, false);
      const sale = new THREE.Group();
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.25).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: saleTex }));
      board.position.set(110.1, 1.6, 90.6); sale.add(board);
      for (const z of [89.8, 91.4]) { const post = new THREE.Mesh(new THREE.BoxGeometry(.08, 1.4, .08).translate(0, .7, 0), new THREE.MeshLambertMaterial({ color: 0xffffff })); post.position.set(110.15, 0, z); sale.add(post); }
      scene.add(sale);
      const pl = interior('villa', 'Вилла', villaDoor, { inside: [0, -4.4, 0], exit: [0, -5.3], bounds: [-8, -6, 8, 14], light: lit('#fff6f0', '#806a70', 1.0) });
      pl.enabled = () => !!G && G.progress.villa;
      pl.locked = () => 'Вилла продаётся — купите её у ворот за $' + VILLA_PRICE.toLocaleString('ru-RU');
      K.at(pl.ox, pl.oz);
      K.room(-8, -6, 8, 6, 3.4, { wall: '#f8f4f0', ceil: '#f0ebe4', trim: '#d8cfc4', neon: '#ff7eb6', gaps: { '-z': [{ c: 0, w: 1.6, h: 2.6 }], '+z': [{ c: 4, w: 1.4, h: 2.5 }] } });
      K.floor(-8, -6, 8, 6, T.whiteTile, 1.2); K.floor(-5.5, -3.5, 1.5, 2, T.carpetPink, 1.5, .01);
      // the big window with the ocean at sunset
      K.picture('-z', -3, 1.9, 5.83, 8, 2, K.tex(512, 128, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h * .6); gr.addColorStop(0, '#3a2466'); gr.addColorStop(.6, '#f26b9e'); gr.addColorStop(1, '#ffb070'); g.fillStyle = gr; g.fillRect(0, 0, w, h * .6);
        g.fillStyle = '#ffd86a'; g.beginPath(); g.arc(w * .6, h * .6, 30, Math.PI, 0); g.fill();
        g.fillStyle = '#244d8c'; g.fillRect(0, h * .6, w, h * .4); g.fillStyle = 'rgba(255,200,140,.6)'; for (let k = 0; k < 12; k++) g.fillRect(w * .6 - 30 + Math.random() * 60, h * .62 + k * 4, 20 + Math.random() * 30, 2);
        g.fillStyle = '#1a1a22'; for (let x = 0; x < w; x += w / 4) g.fillRect(x, 0, 4, h);
      }, false));
      K.box(-6.5, 0, -1, -2, .5, -.2, '#ffffff', true); K.box(-6.5, .5, -1, -2, 1.15, -.75, '#ffffff'); K.box(-6.5, 0, -1, -5.7, .5, 3, '#ffffff', true); K.box(-6.5, .5, -.2, -6.25, 1.15, 3, '#ffffff');
      for (let x = -6; x < -2; x += 1.1) K.box(x, .5, -.7, x + .6, .7, -.45, pick(['#ff7eb6', '#3fe6e0', '#ffd84f']));
      K.box(-4.6, 0, .6, -2.6, .42, 1.8, '#9fdfff', true);
      K.box(7.2, 0, -2.5, 7.9, .7, 2.5, '#2a2a30', true); K.box(7.35, .7, -1.6, 7.45, 2.1, 1.6, '#141418'); K.screen('-x', 7.33, 1.4, 0, 3, 1.3, 2);
      K.box(-7.9, 0, -5.8, -7.2, 1.1, -2, '#3a2a30', true); for (let z = -5.5; z < -2.2; z += .35) K.box(-7.8, 1.1, z, -7.65, 1.1 + rand(.25, .4), z + .12, pick(['#5fd38a', '#ffb347', '#ff6b8a', '#f5e6a8']));
      K.neon(-7.84, 1.6, -1.2, -7.8, 2.8, -1.1, '#ff7eb6'); K.neon(-7.84, 2.7, -1.1, -7.8, 2.8, .1, '#ff7eb6'); K.neon(-7.84, 1.6, .1, -7.8, 2.7, .2, '#3fe6e0');
      const pot = (x, z) => { K.box(x - .3, 0, z - .3, x + .3, .6, z + .3, '#ffffff', true); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; K.box(x + Math.cos(a) * .12 - .05, .6, z + Math.sin(a) * .12 - .05, x + Math.cos(a) * .6, 1.4 + (k % 2) * .3, z + Math.sin(a) * .6, '#2f8a44'); } };
      pot(7, -5.2); pot(-7, 5.2); pot(7, 5.2);
      // bedroom
      K.room(0, 6.3, 8, 14, 3.4, { wall: '#f8eef2', ceil: '#f0e4ea', trim: '#d8cfc4', neon: '#3fe6e0', gaps: { '-z': [{ c: 4, w: 1.4, h: 2.5 }] } });
      K.floor(0, 6.3, 8, 14, T.wood, 2);
      const bed = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, .55, 32).translate(0, .275, 0), new THREE.MeshLambertMaterial({ color: 0xffffff })); bed.position.set(K.wx(4.6), 0, K.wz(10.8)); scene.add(bed);
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, .12, 32).translate(0, .6, 0), new THREE.MeshLambertMaterial({ color: 0xff7eb6 })); cover.position.copy(bed.position); scene.add(cover);
      K.solid(3.2, 0, 9.4, 6, .66, 12.2); K.box(3.2, 0, 12.3, 6, 1.4, 12.6, '#ffffff', true);
      K.box(.3, 0, 8, .9, 2.6, 12.5, '#e8dce4', true); K.box(.9, .2, 8.2, .92, 2.4, 10.2, '#bcd8e8'); K.box(.9, .2, 10.3, .92, 2.4, 12.3, '#bcd8e8');
      K.picture('-z', 4.6, 2.3, 13.83, 2.4, 1.4, K.tex(256, 160, (g, w, h) => { g.fillStyle = '#1a1030'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ff7eb6'; g.lineWidth = 6; g.shadowColor = '#ff7eb6'; g.shadowBlur = 12; g.beginPath(); g.moveTo(90, 130); g.lineTo(96, 80); g.quadraticCurveTo(80, 40, 110, 30); g.quadraticCurveTo(150, 30, 140, 70); g.quadraticCurveTo(120, 80, 130, 100); g.stroke(); g.beginPath(); g.moveTo(96, 80); g.lineTo(110, 130); g.stroke(); }, false));
      pl.attach = () => {
        pl.interactions = [
          { ...pl.P(4.6, 8.8), r: 1.7, short: 'СПАТЬ', label: () => 'Спать и сохраниться', use: () => G.sleep('Вы выспались. Игра сохранена.') },
          { ...pl.P(1.6, 10.2), r: 1.5, short: 'ОДЕЖДА', label: () => 'Гардероб', use: () => G.ui.wardrobe() }
        ];
      };
      K.at(0, 0);
      outdoor.push({ x: 109.3, z: 90.6, r: 1.8, short: 'КУПИТЬ', label: () => G.progress.villa ? null : 'Купить виллу · $' + VILLA_PRICE.toLocaleString('ru-RU'),
        use: () => { if (!G.money.spend(VILLA_PRICE, 'Покупка виллы')) return; G.progress.villa = true; G.save(); G.flash('Вилла ваша! Дверь открыта, гараж на две машины — ваш', 4); G.audio.fare(); } });
      pl.renderOutdoor = () => { sale.visible = !G || !G.progress.villa; };
    }

    /* ---------------------------------------------------------------
       10. TIKI BAR on the sand: thatched roof on stilts, a round bar, torches, hammocks
       --------------------------------------------------------------- */
    const tiki = { x: 125, z: -67 };
    const torches = [];
    {
      K.at(0, 0);
      const dy = .38, BAMBOO = '#c9a06a';
      K.box(120, 0, -72, 130, dy, -62, '#a8743c', true);
      for (let z = -71.6; z < -62; z += .5) K.box(120, dy, z, 130, dy + .005, z + .04, '#7a5028');
      for (const [x, z] of [[120.3, -71.7], [129.7, -71.7], [120.3, -62.3], [129.7, -62.3]]) K.box(x - .15, dy, z - .15, x + .15, 3.7, z + .15, '#7a5028', true);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(7.8, 2.6, 4, 1).rotateY(Math.PI / 4).translate(0, 1.3, 0), new THREE.MeshLambertMaterial({ color: 0xc9a86a }));
      roof.position.set(125, 3.6, -67); scene.add(roof);
      const fringe = new THREE.Mesh(new THREE.CylinderGeometry(7.1, 7.4, .35, 4, 1, true).rotateY(Math.PI / 4).translate(0, 3.55, 0), new THREE.MeshLambertMaterial({ color: 0xa8864a, side: THREE.DoubleSide }));
      fringe.position.set(125, 0, -67); scene.add(fringe);
      // the round bar and its shelves
      for (const [a, b, c, d] of [[122.6, -69.4, 127.4, -68.8], [122.6, -65.2, 127.4, -64.6], [122.6, -68.8, 123.2, -65.2], [126.8, -68.8, 127.4, -65.2]]) { K.box(a, dy, b, c, 1.45, d, BAMBOO, true); K.box(a - .05, 1.45, b - .05, c + .05, 1.52, d + .05, '#8a5a2a'); }
      K.box(124.5, dy, -67.5, 125.5, 2.6, -66.5, '#7a5028', true);
      for (let y = 1.2; y < 2.5; y += .45) for (const [x0, z0, x1, z1] of [[124.4, -67.6, 124.5, -66.4], [125.5, -67.6, 125.6, -66.4]]) for (let k = 0; k < 4; k++) K.box(x0, y, z0 + k * .3, x1 + (x0 < 125 ? -.05 : .05), y + .3, z0 + k * .3 + .1, pick(['#5fd38a', '#ffb347', '#ff6b8a', '#f5e6a8', '#9fd8ff']));
      spots.push(K.spot({ kind: 'idle', x: 123.8, z: -67, heading: -Math.PI / 2, type: 'tourist_m', home: true }));
      const stools = [[121.9, -68.2], [121.9, -65.8], [124, -70.1], [126, -70.1], [128.1, -68.2], [128.1, -65.8], [124, -63.9], [126, -63.9]];
      for (const [x, z] of stools) {
        K.box(x - .05, dy, z - .05, x + .05, 1.0, z + .05, '#7a5028'); K.box(x - .22, 1.0, z - .22, x + .22, 1.06, z + .22, BAMBOO); K.solid(x - .18, 0, z - .18, x + .18, 1.06, z + .18);
        const face = Math.atan2(125 - x, -67 - z);
        if (Math.random() < .5) spots.push(K.spot({ kind: 'sit', x: x - Math.sin(face) * .05, z: z - Math.cos(face) * .05, y: 1.12, heading: face, mix: 'beach', home: true }));
      }
      // string lights under the roof edge, torches at the corners
      const BULBS = ['#ff4fa3', '#ffd84f', '#3fe6e0', '#8cff6b', '#ff8a3d'];
      let bi = 0;
      for (const [x0, z0, x1, z1] of [[120, -72, 130, -72], [130, -72, 130, -62], [130, -62, 120, -62], [120, -62, 120, -72]]) for (let t = 0; t < 1; t += .1) { const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; K.neon(x - .07, 3.35 - Math.sin(t * Math.PI) * .25, z - .07, x + .07, 3.49 - Math.sin(t * Math.PI) * .25, z + .07, BULBS[bi++ % BULBS.length]); }
      const flameTex = K.tex(64, 64, (g, s) => { const gr = g.createRadialGradient(s / 2, s * .6, 0, s / 2, s * .6, s / 2); gr.addColorStop(0, 'rgba(255,240,180,1)'); gr.addColorStop(.35, 'rgba(255,150,40,.9)'); gr.addColorStop(1, 'rgba(255,60,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }, false);
      for (const [x, z] of [[119.4, -72.6], [130.6, -72.6], [119.4, -61.4], [130.6, -61.4]]) {
        K.box(x - .06, 0, z - .06, x + .06, 1.9, z + .06, '#5a3a1a', true); K.box(x - .12, 1.9, z - .12, x + .12, 2.1, z + .12, '#3a2a1a');
        const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        f.position.set(x, 2.35, z); f.scale.set(.6, .8, 1); scene.add(f); torches.push(f);
      }
      // hammock between two palms
      palms.push([133.4, .02, -73.2], [133.4, .02, -66.4]);
      for (let k = 0; k <= 12; k++) { const z = -72.6 + k * .5, sag = Math.sin(k / 12 * Math.PI) * .45; K.box(133.05, 1.35 - sag, z, 133.75, 1.4 - sag, z + .5, k % 2 ? '#ff7eb6' : '#fff0d8'); }
      K.solid(133, 0, -72, 133.8, .9, -67);
      spots.push(K.spot({ kind: 'lie', x: 133.4, z: -71.4, y: 1.05, heading: 0, mix: 'beach', home: true }));
      const tikiSign = K.tex(256, 96, (g, w, h) => { g.fillStyle = '#6a3a18'; g.fillRect(0, 0, w, h); g.strokeStyle = '#3a1a08'; g.lineWidth = 6; g.strokeRect(4, 4, w - 8, h - 8); g.fillStyle = '#ffd84f'; g.font = 'bold 50px "Trebuchet MS", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = '#ff8a3d'; g.shadowBlur = 10; g.fillText('TIKI BAR', w / 2, h / 2 + 2); }, false);
      K.picture('-x', 119.3, 2.6, -67, 3, 1.1, tikiSign, true);
      K.box(119.35, 0, -68.3, 119.45, 2.1, -68.1, '#5a3a1a', true); K.box(119.35, 0, -65.9, 119.45, 2.1, -65.7, '#5a3a1a', true);
      mapShapes.push({ x0: 120, z0: -72, x1: 130, z1: -62, c: '#c9a06a', k: 'b' });
      outdoor.push({ x: 121.7, z: -67, r: 1.9, short: 'БАР', label: () => 'Тики-бар: коктейли', use: () => G.ui.menu({ eyebrow: 'Тики-бар', title: 'Коктейли', items: () => [
        { name: 'Коктейль «Закат»', desc: '+30 здоровья', price: 15, disabled: G.player.hp >= 100 ? 'Вам хватит' : '', buy: () => { G.player.hp = Math.min(100, G.player.hp + 30); return 'Освежает!'; } },
        { name: 'Пина колада', desc: '+20 здоровья', price: 10, disabled: G.player.hp >= 100 ? 'Вам хватит' : '', buy: () => { G.player.hp = Math.min(100, G.player.hp + 20); return 'Кокос и ананас'; } },
        { name: 'Кокосовая вода', desc: '+10 здоровья', price: 4, disabled: G.player.hp >= 100 ? 'Вам хватит' : '', buy: () => { G.player.hp = Math.min(100, G.player.hp + 10); return 'Прямо из кокоса'; } }
      ] }) });
    }

    /* ---------------------------------------------------------------
       11. THE YACHT "LEHA NEPLOXO": at anchor out in the open sea south-east of the city. Swim to the stern, climb onto the bathing
           platform and up the steps: a party on the aft deck, a bar, a DJ, a jacuzzi and sunbeds up top
       --------------------------------------------------------------- */
    // drawn round (173, -25) and moved as a whole to where it lies at anchor, (200, 200)
    const YDX = 27, YDZ = 225;
    const yacht = { x: 173 + YDX, z: -25 + YDZ, x0: 168.4 + YDX, x1: 177.6 + YDX, z0: -43.3 + YDZ, z1: -8 + YDZ, deck: 2 };
    let jacuzziMat = null, underGlow = null;
    {
      K.at(YDX, YDZ);
      const WH = '#f7f6f2', TEAK = '#b07a48', NAVY = '#1c2a4a', GLASS = '#16263a', CHROME = '#d9d9e2', D = 2, UP = 4.4;
      NB.water.hole({ x0: yacht.x0, x1: yacht.x1, z0: yacht.z0, z1: yacht.z1 });
      // hull: the main body, two stern wings either side of the steps, and a bow narrowing to a point
      K.box(168.5, -1.2, -39.65, 177.5, D, -15, WH, true);
      K.box(168.5, -1.2, -41, 171, D, -39.65, WH, true); K.box(175, -1.2, -41, 177.5, D, -39.65, WH, true); K.box(171, -1.2, -41, 175, .25, -39.65, WH, true);
      const bow = [];
      for (let k = 0; k < 7; k++) { const f = Math.pow((k + 1) / 7, 1.5), hw = 4.5 * (1 - f * .92), za = -15 + k; bow.push([hw, za]); K.box(173 - hw, -1.2 + k * .15, za, 173 + hw, D, za + 1, WH, true); K.box(173 - hw + .15, D, za, 173 + hw - .15, D + .02, za + 1, TEAK); }
      for (const s of [-1, 1]) {
        const xo = s < 0 ? 168.44 : 177.5, xi = s < 0 ? 168.5 : 177.56;
        K.box(xo, .12, -41, xi, .6, -15, NAVY); K.box(xo, 1.9, -41, xi, 2.02, -15, CHROME);
        for (const [a, b] of [[-37, -30.5], [-28.5, -22.5], [-20.5, -16.5]]) K.box(xo, .95, a, xi, 1.45, b, GLASS);
        K.neon(s < 0 ? 168.38 : 177.56, 1.78, -41, s < 0 ? 168.44 : 177.62, 1.84, -15, '#ff4fa3');
      }
      K.box(168.5, .12, -41.06, 177.5, .6, -41, NAVY);
      // teak decks with plank lines
      K.box(168.7, D, -39.65, 177.3, D + .02, -15, TEAK); K.box(168.7, D, -41, 171, D + .02, -39.65, TEAK); K.box(175, D, -41, 177.3, D + .02, -39.65, TEAK);
      for (let x = 169.1; x < 177.2; x += .45) K.box(x, D + .021, -39.6, x + .025, D + .024, -15.1, '#8a5a32');
      // bathing platform and the steps up to the deck (a low invisible edge keeps the party on board)
      K.box(168.8, .25, -43.2, 177.2, .45, -41, TEAK, true);
      [.84, 1.23, 1.62].forEach((top, i) => K.box(171, .25, -41 + i * .45, 175, top, -40.55 + i * .45, TEAK, true));
      K.solid(168.8, .45, -43.35, 177.2, 1.15, -43.2); K.solid(168.65, .45, -43.2, 168.8, 1.15, -41); K.solid(177.2, .45, -43.2, 177.35, 1.15, -41);
      for (let x = 169; x <= 177.1; x += 1.35) K.box(x - .03, .45, -43.28, x + .03, 1.05, -43.22, CHROME);
      K.box(168.8, 1.0, -43.3, 177.2, 1.05, -43.2, CHROME);
      // chrome railings round the main deck (open at the steps) and along the bow
      const rail = (x0, z0, x1, z1, y = D) => {
        K.solid(x0, y, z0, x1, y + 1.05, z1); K.box(x0, y + .95, z0, x1, y + 1.0, z1, CHROME); K.box(x0, y + .5, z0, x1, y + .53, z1, CHROME);
        const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 1.3));
        for (let i = 0; i <= n; i++) { const px = x0 + (x1 - x0) * i / n, pz = z0 + (z1 - z0) * i / n; K.box(px - .025, y, pz - .025, px + .025, y + .95, pz + .025, CHROME); }
      };
      rail(168.6, -41, 168.7, -15); rail(177.3, -41, 177.4, -15); rail(168.6, -41, 171, -40.92); rail(175, -41, 177.4, -40.92);
      for (const [hw, za] of bow) { rail(173 - hw - .05, za, 173 - hw + .05, za + 1); rail(173 + hw - .05, za, 173 + hw + .05, za + 1); }
      // main cabin with a wraparound glass band, sliding doors onto the aft deck
      K.box(169.5, D, -30, 176.5, UP, -15, WH, true);
      K.box(169.44, 2.6, -29.4, 169.5, 3.9, -15.6, GLASS); K.box(176.5, 2.6, -29.4, 176.56, 3.9, -15.6, GLASS);
      K.box(170.1, D + .1, -30.06, 175.9, 4.0, -30, GLASS); K.neon(170.1, 4.02, -30.1, 175.9, 4.08, -30.04, '#3fe6e0', false);
      // the upper deck: an overhang over the aft deck, stairs up the port side
      K.box(169.5, 4.25, -33, 176.5, UP, -30, WH, true);
      for (const x of [169.6, 176.2]) K.box(x, D, -32.95, x + .2, 4.25, -32.75, CHROME, true);
      K.box(169.6, UP, -33, 176.4, UP + .02, -18.2, TEAK);
      for (let i = 0; i < 6; i++) K.box(175.4, .25, -36 + i * .5, 176.6, D + (i + 1) * .4, -35.5 + i * .5, TEAK, true);
      rail(169.45, -33, 169.55, -18.2, UP); rail(176.45, -33, 176.55, -18.2, UP); rail(169.45, -33.08, 175.35, -32.98, UP);
      // jacuzzi on the upper deck
      for (const [a, b, c, d] of [[171, -28, 175, -27.75], [171, -24.85, 175, -24.6], [171, -27.75, 171.25, -24.85], [174.75, -27.75, 175, -24.85]]) K.box(a, UP, b, c, UP + .55, d, '#e8f4f6', true);
      for (const [a, b, c, d] of [[171.25, -27.75, 174.75, -27.35], [171.25, -25.25, 174.75, -24.85], [171.25, -27.35, 171.65, -25.25], [174.35, -27.35, 174.75, -25.25]]) K.box(a, UP, b, c, UP + .12, d, '#bfe8ee');
      K.box(171.25, UP + .005, -27.75, 174.75, UP + .01, -24.85, '#4fc9d6');
      jacuzziMat = new THREE.ShaderMaterial({ transparent: true, uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform float uTime; varying vec2 vU;
          float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
          void main(){ vec2 g = vU * vec2(14.0, 11.0); vec2 id = floor(g + vec2(0.0, uTime * 1.3)); vec2 f = fract(g + vec2(0.0, uTime * 1.3));
            float bub = step(0.8, h(id)) * smoothstep(0.28, 0.12, length(f - 0.5));
            float w = sin(vU.x * 18.0 + uTime * 3.0) * sin(vU.y * 15.0 - uTime * 2.4);
            gl_FragColor = vec4(mix(vec3(0.25,0.8,0.9), vec3(0.9,1.0,1.0), clamp(bub + smoothstep(0.6, 1.0, w) * 0.5, 0.0, 1.0)), 0.7); }` });
      const jw = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.9).rotateX(-Math.PI / 2), jacuzziMat); jw.position.set(K.wx(173), UP + .45, K.wz(-26.3)); scene.add(jw);
      NB.water.add({ name: 'jacuzzi', test: (x, z) => x > K.wx(171.25) && x < K.wx(174.75) && z > K.wz(-27.75) && z < K.wz(-24.85), surface: () => UP + .45 });
      // sunbeds up top, the wheelhouse and the radar arch
      for (const x of [170.6, 173, 175.4]) { K.box(x - .6, UP, -22, x + .6, UP + .35, -19.9, '#ffffff', true); K.box(x - .55, UP + .36, -22, x + .55, UP + .38, -20.2, '#ff7eb6'); }
      K.box(170, UP, -18, 176, 6.3, -15, GLASS, true); K.box(169.6, 6.3, -18.4, 176.4, 6.45, -14.8, WH, true);
      for (const x of [170.3, 175.5]) K.box(x, UP, -19.3, x + .25, 7.3, -19, WH, true);
      K.box(170.3, 7.0, -19.3, 175.75, 7.3, -19, WH); K.box(172.6, 7.3, -19.4, 173.4, 7.6, -18.9, '#e8e8ee'); K.neon(172.95, 7.6, -19.2, 173.05, 8.8, -19.1, '#ff3344');
      // foredeck sun pads
      K.box(171, D, -14, 175, D + .3, -11.2, '#ffffff', true); K.box(171.1, D + .3, -13.9, 174.9, D + .32, -11.3, '#3fe6e0');
      for (let k = 0; k < 10; k++) K.box(172.94, 1.9 - k * .2, -8.3 + k * .06, 173.06, 2.0 - k * .2, -8.2 + k * .06, '#5a5a62');
      // bar on the starboard side of the aft deck, shelves of bottles, champagne on ice
      K.box(170.6, D, -37, 171.2, 3.1, -32.5, '#1a1a22', true); K.box(170.55, 3.1, -37.05, 171.25, 3.16, -32.45, '#e8e2d6'); K.neon(171.2, 2.2, -37, 171.24, 2.26, -32.5, '#ff4fa3', false);
      K.box(168.75, 2.5, -36.8, 169.1, 3.7, -32.7, '#2a2a30', true);
      const BOT = ['#5fd38a', '#ffb347', '#ff6b8a', '#f5e6a8', '#9fd8ff', '#c28bff'];
      for (const y of [2.6, 3.05]) for (let z = -36.7; z < -32.8; z += .28) K.neon(169.12, y, z, 169.2, y + rand(.28, .4), z + .1, pick(BOT), false);
      for (const z of [-36, -34.2]) { K.box(170.7, 3.16, z - .15, 171.0, 3.4, z + .15, CHROME); K.box(170.82, 3.4, z - .03, 170.88, 3.6, z + .03, '#1f5a2a'); K.box(170.82, 3.6, z - .02, 170.88, 3.64, z + .02, '#e8c547'); }
      for (let z = -33.6; z < -32.6; z += .3) K.box(170.8, 3.16, z, 170.86, 3.32, z + .06, '#dff4ff');
      // DJ desk and speakers against the cabin
      K.box(171.8, D, -31.6, 174.2, 3.05, -31.0, '#141418', true); K.neon(171.8, 2.85, -31.64, 174.2, 2.9, -31.6, '#3fe6e0', false);
      for (const x of [171.2, 174.3]) K.box(x, D, -31.6, x + .5, 3.4, -31.0, '#0e0e12', true);
      // sofas on the stern wings
      for (const [a, b] of [[168.8, 171], [175, 177.2]]) { K.box(a, D, -40.9, b, D + .6, -40.3, '#f2eee6', true); K.box(a, D + .6, -41, b, D + 1.15, -40.8, '#f2eee6'); K.box(a + .1, D + .6, -40.85, b - .1, D + .64, -40.35, '#ff7eb6'); }
      // the name on the bow and the stern
      const nameTex = K.tex(512, 96, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#1c2a4a'; let fs = 60; g.font = 'italic bold 60px "Trebuchet MS", Arial, sans-serif'; while (g.measureText('LEHA NEPLOXO').width > w - 20) { fs -= 2; g.font = 'italic bold ' + fs + 'px "Trebuchet MS", Arial, sans-serif'; } g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('LEHA NEPLOXO', w / 2, h / 2 + 4); }, false);
      K.picture('-x', 168.42, 1.2, -19.5, 5, .95, nameTex, true); K.picture('+x', 177.58, 1.2, -19.5, 5, .95, nameTex, true); K.picture('-z', 173, 1.35, -41.08, 4.2, .8, nameTex, true);
      // string lights from the radar arch down to the bow and the stern
      const BULB = ['#ff4fa3', '#ffd84f', '#3fe6e0', '#ffffff'];
      for (const [x1, y1, z1] of [[173, 2.9, -8.4], [169.5, 5.2, -33], [176.5, 5.2, -33]]) for (let i = 1; i < 14; i++) { const t = i / 14, x = 173 + (x1 - 173) * t, y = 7.3 + (y1 - 7.3) * t - Math.sin(t * Math.PI) * .5, z = -19.15 + (z1 + 19.15) * t; K.neon(x - .06, y - .06, z - .06, x + .06, y + .06, z + .06, BULB[i % 4]); }
      // a pool of light in the water round the hull after dark
      const glowTex = K.tex(64, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * .9); gr.addColorStop(0, 'rgba(90,220,255,1)'); gr.addColorStop(.5, 'rgba(60,160,255,.5)'); gr.addColorStop(1, 'rgba(40,120,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
      underGlow = new THREE.Mesh(new THREE.PlaneGeometry(18, 46).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      underGlow.position.set(K.wx(173), .08, K.wz(-25.5)); scene.add(underGlow);
      mapShapes.push({ x0: K.wx(168.5), z0: K.wz(-41), x1: K.wx(177.5), z1: K.wz(-15), c: '#ffffff', k: 'b' }, { x0: K.wx(170.5), z0: K.wz(-15), x1: K.wx(175.5), z1: K.wz(-8.5), c: '#ffffff', k: 'b' });
      // the party
      const party = { yacht: true }, Y = (s, y) => Object.assign(s, { x: K.wx(s.x), z: K.wz(s.z), y, fixedY: true, home: true });
      for (const x of [172.3, 173.5, 174.7]) for (const z of [-38.7, -37.3, -35.9, -34.5]) if (Math.random() < .8) spots.push(Y({ kind: 'dance', x: x + rand(-.2, .2), z: z + rand(-.2, .2), heading: Math.PI + rand(-.8, .8), mix: 'yacht', grp: party }, D));
      spots.push(Y({ kind: 'dj', x: 173, z: -30.45, heading: Math.PI, type: 'tourist_m' }, D));
      spots.push(Y({ kind: 'idle', x: 169.75, z: -34.7, heading: Math.PI / 2, type: 'croupier' }, D));
      spots.push(Y({ kind: 'guard', x: 170.3, z: -39.25, heading: Math.PI, type: 'business_m' }, D));
      for (const x of [169.4, 170.4, 175.6, 176.6]) if (Math.random() < .8) spots.push(Y({ kind: 'sit', x, z: -40.6, heading: 0, mix: 'yacht' }, D + .66));
      for (const [x, z, h] of [[171.55, -26.3, Math.PI / 2], [174.45, -26.3, -Math.PI / 2], [173, -27.45, 0]]) spots.push(Y({ kind: 'sit', x, z, heading: h, type: pick(['beach_f', 'beach_f', 'beach_m']) }, UP + .18));
      for (const x of [170.6, 173, 175.4]) if (Math.random() < .85) spots.push(Y({ kind: 'lie', x, z: -21.9, heading: 0, type: 'beach_f' }, UP + .47));
      for (const x of [172, 174]) spots.push(Y({ kind: 'lie', x, z: -13.85, heading: 0, type: 'beach_f' }, D + .42));
      outdoor.push({ x: K.wx(171.95), z: K.wz(-34.7), y: D, r: 1.7, short: 'БАР', label: () => 'Бар яхты', use: () => G.ui.menu({ eyebrow: 'Яхта LEHA NEPLOXO', title: 'Бар', items: () => [
        { name: 'Шампанское', desc: 'Бокал из ведёрка со льдом · +20 здоровья, кружит голову', price: 60, buy: () => { G.player.hp = Math.min(100, G.player.hp + 20); G.drunk(40); return 'За удачу!'; } },
        { name: 'Мохито', desc: '+15 здоровья', price: 15, buy: () => { G.player.hp = Math.min(100, G.player.hp + 15); G.drunk(12); return 'Мята и лайм'; } },
        { name: 'Виски со льдом', desc: '+10 здоровья, крепко', price: 25, buy: () => { G.player.hp = Math.min(100, G.player.hp + 10); G.drunk(30); return 'Ух!'; } },
        { name: 'Вода с лимоном', desc: 'Протрезветь', price: 2, buy: () => { G.drunk(0); return 'Голова прояснилась'; } }
      ] }) });
    }

    K.at(0, 0);

    /* ---------------------------------------------------------------
       12. NEON BAY MARINA: a wooden pier out into the sea with speedboats and jet skis alongside,
           and a floating landing at the end to climb out of the water
       --------------------------------------------------------------- */
    const marina = { slots: [
      { id: 'jetski', x: 146, z: 49.2, h: Math.PI / 2 }, { id: 'jetski', x: 149.5, z: 49.2, h: Math.PI / 2 },
      { id: 'speedboat', x: 156, z: 49.85, h: Math.PI / 2 }, { id: 'speedboat', x: 153, z: 42.15, h: Math.PI / 2 }] };
    if (heliPad) marina.slots.push({ id: 'heli', x: heliPad.x, z: heliPad.z, h: Math.PI / 2 });   // the helicopter comes back to its pad the same way
    if (towerPad && towerPad.heli) marina.slots.push({ id: 'heli', ...towerPad.heli });   // and one on top of NEPLOXO TOWER
    {
      K.at(0, 0);
      const TEAK = '#a8743c', PILE = '#5a3a1e', Z0 = 44, Z1 = 48, DY = 1.0;
      // steps up from the sand, the deck, planks and pilings
      K.box(121.6, 0, Z0, 122.4, .34, Z1, TEAK, true); K.box(122.4, 0, Z0, 123.2, .67, Z1, TEAK, true);
      K.box(123.2, .7, Z0, 160.3, DY, Z1, TEAK, true);
      for (let x = 123.5; x < 160.3; x += .5) K.box(x, DY, Z0, x + .03, DY + .005, Z1, '#7a5028');
      for (let x = 125; x < 160.5; x += 3.5) for (const z of [Z0 - .15, Z1 + .15]) { K.box(x - .17, -3.6, z - .17, x + .17, DY + .45, z + .17, PILE, true); K.box(x - .2, DY + .45, z - .2, x + .2, DY + .5, z + .2, '#3a2a1a'); }
      // end of the pier: a step down onto a floating landing just above the water
      K.box(160.3, .25, Z0 - .5, 161, .72, Z1 + .5, TEAK, true);
      K.box(161, -.5, Z0 - .5, 164, .45, Z1 + .5, '#c9a06a', true);
      for (const z of [Z0 - .5, Z1 + .5]) K.box(161, .1, z - .06, 164, .3, z + .06, '#ff8a3d');
      NB.water.hole({ x0: 160.3, x1: 164.05, z0: Z0 - .55, z1: Z1 + .55 });
      // lamps along the pier, life rings, and an arch with the marina's name at the start
      for (let x = 128; x < 160; x += 8) { K.box(x - .06, DY, Z1 - .2, x + .06, DY + 2.6, Z1 - .08, '#2b2735'); K.neon(x - .15, DY + 2.6, Z1 - .3, x + .15, DY + 2.75, Z1, '#ffe2b0'); }
      for (const x of [136, 152]) { K.neon(x - .3, DY + .5, Z0 + .02, x + .3, DY + 1.1, Z0 + .08, '#ff5a3a', false); K.box(x - .12, DY + .68, Z0 + .01, x + .12, DY + .92, Z0 + .09, '#ffffff'); }
      for (const z of [Z0 - .1, Z1 + .1]) K.box(123.1, .7, z - .12, 123.35, 4.1, z + .12, '#f6f2ec', true);
      K.box(123.1, 3.8, Z0 - .2, 123.35, 4.4, Z1 + .2, '#f6f2ec');
      K.picture('-x', 123.08, 4.1, (Z0 + Z1) / 2, 4, .55, T.sign('NEON BAY MARINA', null, '#3fe6e0', '#10202a'));
      K.neon(123.05, 3.78, Z0 - .2, 123.1, 3.84, Z1 + .2, '#3fe6e0');
      mapShapes.push({ x0: 123.2, z0: Z0, x1: 164, z1: Z1, c: '#c9a06a', k: 'b' });
    }

    K.finish();

    /* =====================================================================
       runtime
       ===================================================================== */
    for (const pl of places) if (!pl.update) pl.update = () => {};
    const api = {
      list: places, spots, VILLA_PRICE, garage, tiki, heliPad, towerRoof, yacht,
      current: null,
      byId: id => places.find(p => p.id === id),
      // which interior a point is in
      at(x, z) { for (const p of places) { const b = p.bounds; if (x > b.x0 - 1 && x < b.x1 + 1 && z > b.z0 - 1 && z < b.z1 + 1) return p; } return null; },
      attach(g) {
        G = g; for (const p of places) if (p.attach) p.attach();
        for (const s of marina.slots) s.boat = G.vehicles.spawnParked(s.id, s.x, s.z, s.h);
      },
      // walking into a door circle: returns { place, dir } to go through
      doors(player, onFoot) {
        for (const m of markers) {
          const d = Math.hypot(player.x - m.x, player.z - m.z);
          if (d > 1.8) { m.armed = true; continue; }
          if (!m.armed || !onFoot || d > .85 || Math.abs(player.y - m.g.position.y) > 1.5) continue;
          m.armed = false;
          if (m.dir === 'in' && !m.place.enabled()) { G.flash(m.place.locked ? m.place.locked() : 'Закрыто', 2.4); continue; }
          return m;
        }
        return null;
      },
      disarm() { for (const m of markers) m.armed = false; },
      // things to use right here: inside the current interior, or out in the city
      interactions() { return api.current ? api.current.interactions : outdoor; },
      update(dt) {
        if (api.current) api.current.update(dt);
        // a boat taken from the marina is replaced once you're well away from the pier
        if (G && (marina.t = (marina.t || 0) - dt) <= 0) {
          marina.t = 2;
          const p = G.player;
          for (const s of marina.slots) {
            const b = s.boat, gone = !b || !G.vehicles.cars.includes(b) || Math.hypot(b.x - s.x, b.z - s.z) > 20;
            if (gone && Math.hypot(p.x - s.x, p.z - s.z) > 70 && G.vehicles.driving !== b) s.boat = G.vehicles.spawnParked(s.id, s.x, s.z, s.h);
          }
        }
        // the garage door rolls up for the owner
        if (G && garage) {
          const p = G.player, near = G.progress.villa && Math.hypot(p.x - 111.3, p.z - 84.7) < 13;
          garage.open = U.damp(garage.open, near ? 1 : 0, 3, dt);
          garage.doorMesh.scale.y = Math.max(.06, 1 - garage.open); garage.doorMesh.position.y = 2.8 * (1 - Math.max(.06, 1 - garage.open));
          garage.doorCol.maxY = garage.open > .85 ? -1 : 2.8;
          // a car left inside is kept: marked parked so the city never tidies it away
          const r = garage.rect;
          for (const c of G.vehicles.cars) if (!c.ai && c.driver !== 'player' && c.x > r.x0 && c.x < r.x1 && c.z > r.z0 && c.z < r.z1) c.parked = true;
        }
      },
      get hud() { return api.current && api.current.hudInfo; },
      render(t, env) {
        K.screenMat.uniforms.uTime.value = t;
        for (const m of markers) { m.beam.material.opacity = .08 + Math.sin(t * 3 + m.x) * .04; }
        for (const p of places) { if (p.render) p.render(t); if (p.renderRoof) p.renderRoof(t); if (p.renderOutdoor) p.renderOutdoor(t); }
        const night = env ? env.night : 0;
        if (jacuzziMat) jacuzziMat.uniforms.uTime.value = t;
        if (underGlow) underGlow.material.opacity = .15 + night * .55;
        for (const f of torches) { const k = 1 + Math.sin(t * 13 + f.position.x) * .12 + Math.sin(t * 7.3 + f.position.z) * .08; f.scale.set(.55 * k, .8 * k, 1); f.material.opacity = .6 + night * .4; }
      },
      // which in-city venue music is audible here
      venueAt(x, z) {
        const dy = Math.hypot(x - yacht.x, z - yacht.z);
        if (dy < 70) return { name: 'club', level: Math.max(0, 1 - dy / 70) * (dy < 16 ? 1 : .6) };   // the party on the yacht
        const d = Math.hypot(x - tiki.x, z - tiki.z); return d < 42 ? { name: 'tiki', level: Math.max(0, 1 - d / 42) * (d < 7 ? 1 : .6) } : null;
      }
    };
    return api;
  };
})(window.NB);
