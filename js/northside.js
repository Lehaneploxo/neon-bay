// North Side: the working-class island across the strait north of the city. A short low bridge from the
// end of the city's middle street, a grid of streets, and blocks of brick tenements with fire escapes,
// cheap shops (liquor, pawn, laundry, garage), warehouses with roller doors, factories with smoking
// chimneys, a container port with a crane on the north shore, a junkyard, empty lots with fires burning
// in oil drums, and two basketball courts where the gangs hang out: the Cobras (red) in the west, the
// Skulls (green) in the east, with the blocks between them a no man's land. Graffiti everywhere, few
// neon signs, few lamps. Built with the city's own builders and its own random numbers.
(function (NB) {
  'use strict';

  NB.buildNorthside = function (k) {
    const { C, U, col, scene, bPlain, bFacade, bNeon, bGlow, bAsphalt, bPaving, building, sign, awning, neonRing, mapShapes, palms, lamps, FT } = k;
    const R = U.rng(5150), rr = (a, b) => a + R() * (b - a), pick = a => a[(R() * a.length) | 0], chance = p => R() < p;
    const G0 = .45;                                         // ground level on the island (above the sea)
    const XS = [-100, -50, 0, 50, 100, 150, 200, 250], ZS = [-190, -240, -290, -340, -390], RH = 6, SW = 3;
    const B = { x0: XS[0] - RH - 4, x1: XS[XS.length - 1] + RH + 4, z0: ZS[ZS.length - 1] - RH - 4, z1: ZS[0] + RH + 4 };
    const BRICK = ['#8a3b2e', '#9c5a3c', '#6e4a3a', '#7a4636', '#a0664a'], CONCRETE = ['#8e8a86', '#7a7672', '#9a958c', '#6f6c6a'], FADED = ['#b8a88a', '#a8b0a0', '#b09a98', '#9aa4b0'];
    const spots = [], parking = [], blocks = [], barrels = [], chimneys = [];

    /* ---------- the land: a slab above the water with a sea wall round it ---------- */
    col.add(B.x0, -4, B.z0, B.x1, G0, B.z1);
    bPlain.box(B.x0, -3.6, B.z0, B.x1, G0, B.z1, C('#7c7872'));
    NB.water.hole({ x0: B.x0, x1: B.x1, z0: B.z0, z1: B.z1 });
    bAsphalt.flat(B.x0 + 4, B.z0 + 4, B.x1 - 4, B.z1 - 4, G0 + .004, C('#ffffff'), 8);
    // a strip of pavement round the edge, a kerb stone, lamps now and then
    for (const [x0, z0, x1, z1] of [[B.x0, B.z0, B.x0 + 4, B.z1], [B.x1 - 4, B.z0, B.x1, B.z1], [B.x0 + 4, B.z0, B.x1 - 4, B.z0 + 4], [B.x0 + 4, B.z1 - 4, B.x1 - 4, B.z1]]) {
      bPaving.box(x0, G0, z0, x1, G0 + .15, z1, C('#cfc8bc'), { tile: 2, topTile: 2 }); col.add(x0, 0, z0, x1, G0 + .15, z1);
    }
    mapShapes.push({ x0: B.x0, z0: B.z0, x1: B.x1, z1: B.z1, c: '#4a4452', k: 's' });
    // road markings: a dashed yellow line down the middle of every street
    for (const x of XS) for (let z = B.z0 + 6; z < B.z1 - 6; z += 6) if (!ZS.some(L => Math.abs(z + 1.5 - L) < RH + 1)) bPlain.flat(x - .1, z, x + .1, z + 3, G0 + .02, C('#c9a43e'));
    for (const zz of ZS) for (let x = B.x0 + 6; x < B.x1 - 6; x += 6) if (!XS.some(L => Math.abs(x + 1.5 - L) < RH + 1)) bPlain.flat(x, zz - .1, x + 3, zz + .1, G0 + .02, C('#c9a43e'));

    /* ---------- the bridge from the city: short, low, concrete ---------- */
    const BX = 0, BZ0 = -106, BZ1 = B.z1, DECK = 3.2, RAMP = 16, RW = 5.2, PW = 7.5;   // road half-width, pavement to 7.5
    const deckY = z => { const t0 = U.clamp((BZ0 - z) / RAMP, 0, 1), t1 = U.clamp((z - BZ1) / RAMP, 0, 1); return Math.min(.15 + (DECK - .15) * t0, G0 + (DECK - G0) * t1); };
    // a smooth sloped slab from (za, ya) to (zb, yb), za < zb, across x0..x1: top, underside and both sides
    const FLAT = [.03, .5];
    function slabZ(x0, x1, za, ya, zb, yb, th, hex) {
      const c = C(hex), s = (yb - ya) / (zb - za), n = 1 / Math.hypot(s, 1), d = c.clone().multiplyScalar(.7), e = c.clone().multiplyScalar(.85);
      bPlain.quad([x0, yb, zb], [x1, yb, zb], [x1, ya, za], [x0, ya, za], 0, n, -s * n, c, FLAT, FLAT, FLAT, FLAT);
      bPlain.quad([x0, ya - th, za], [x1, ya - th, za], [x1, yb - th, zb], [x0, yb - th, zb], 0, -n, s * n, d, FLAT, FLAT, FLAT, FLAT);
      bPlain.quad([x1, yb - th, zb], [x1, ya - th, za], [x1, ya, za], [x1, yb, zb], 1, 0, 0, e, FLAT, FLAT, FLAT, FLAT);
      bPlain.quad([x0, ya - th, za], [x0, yb - th, zb], [x0, yb, zb], [x0, ya, za], -1, 0, 0, e, FLAT, FLAT, FLAT, FLAT);
    }
    // what you see: a smooth road with a raised pavement for people on each side and parapets, in three pieces
    const ZK = [BZ1, BZ1 + RAMP, BZ0 - RAMP, BZ0];
    for (let k = 0; k < 3; k++) {
      const za = ZK[k], zb = ZK[k + 1], ya = deckY(za), yb = deckY(zb);
      slabZ(BX - RW, BX + RW, za, ya, zb, yb, .6, '#4a4652');
      slabZ(BX - PW, BX - RW, za, ya + .15, zb, yb + .15, .75, '#b9b2a6'); slabZ(BX + RW, BX + PW, za, ya + .15, zb, yb + .15, .75, '#b9b2a6');
      slabZ(BX - PW - .3, BX - PW, za, ya + 1.15, zb, yb + 1.15, 1.15, '#a8a298'); slabZ(BX + PW, BX + PW + .3, za, ya + 1.15, zb, yb + 1.15, 1.15, '#a8a298');
      // kerb lines and a dashed yellow middle line
      for (const x of [BX - RW - .04, BX + RW - .08]) slabZ(x, x + .12, za, ya + .16, zb, yb + .16, .02, '#e8e2d6');
      for (let z = za; z < zb - 1; z += 6) { const z2 = Math.min(zb, z + 3); slabZ(BX - .1, BX + .1, z, deckY(z) + .015, z2, deckY(z2) + .015, .01, '#c9a43e'); }
    }
    // what you walk and drive on: small invisible steps (ramps for cars)
    for (let z = BZ0; z > BZ1; z -= .7) {
      const z1 = Math.max(BZ1, z - .7), y = deckY((z + z1) / 2);
      for (const b of [col.add(BX - RW, y - .6, z1, BX + RW, y, z), col.add(BX - PW, y - .6, z1, BX - RW, y + .15, z), col.add(BX + RW, y - .6, z1, BX + PW, y + .15, z)]) b.ramp = true;
      col.add(BX - PW - .3, y, z1, BX - PW, y + 1.15, z); col.add(BX + PW, y, z1, BX + PW + .3, y + 1.15, z);
    }
    for (const z of [-122, -140, -158]) for (const x of [BX - 4.5, BX + 3]) { bPlain.box(x, -4, z - .75, x + 1.5, deckY(z) - .6, z + .75, C('#9a948a')); col.add(x, -4, z - .75, x + 1.5, deckY(z) - .6, z + .75); }
    for (let z = BZ0 - 6; z > BZ1 + 4; z -= 18) lamps.push([BX - 7, z, Math.PI / 2, deckY(z) + .15], [BX + 7, z - 9, -Math.PI / 2, deckY(z - 9) + .15]);
    mapShapes.push({ x0: BX - 7.8, z0: BZ1, x1: BX + 7.8, z1: BZ0, c: '#6a6474', k: 's' });
    // guard rails along the sea wall either side of both ends, so nothing drives off into the water there
    for (const s of [-1, 1]) for (const [z0, z1, y] of [[-112, -111.6, .15], [BZ1 - .4, BZ1, G0 + .15]]) {
      const x0 = s < 0 ? BX - 30 : BX + 7.8, x1 = s < 0 ? BX - 7.8 : BX + 30;
      bPlain.box(x0, y, z0, x1, y + .9, z1, C('#c8c4bc')); bPlain.box(x0, y + .75, z0 - .05, x1, y + .9, z1 + .05, C('#e8202a')); col.add(x0, 0, z0, x1, y + .9, z1);
    }

    /* ---------- graffiti: a sheet of tags sprayed onto walls ---------- */
    const TAGS = ['COBRAS', 'SKULLS', 'N-SIDE', 'RUST', 'KINGS', 'ZERO', 'WILD', 'NO COPS'];
    const tagTex = U.canvasTex(512, 256, (g) => {
      TAGS.forEach((t, i) => {
        const x = (i % 4) * 128, y = ((i / 4) | 0) * 128, c = t === 'COBRAS' ? '#e8202a' : t === 'SKULLS' ? '#2bd67b' : pick(['#ff4fa3', '#3fe6e0', '#ffd23d', '#f5f5f0', '#9b5cff']);
        g.save(); g.translate(x + 64, y + 64); g.rotate(rr(-.25, .25));
        g.font = 'italic 900 30px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 7; g.strokeStyle = '#141018'; g.strokeText(t, 0, 0); g.fillStyle = c; g.fillText(t, 0, 0);
        g.fillStyle = c; for (let k = 0; k < 5; k++) g.fillRect(rr(-50, 50), rr(8, 14), 2, rr(6, 20));   // drips
        g.restore();
      });
    }, false);
    const tagMat = new THREE.MeshBasicMaterial({ map: tagTex, transparent: true, alphaTest: .1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    function tag(face, b, off, word) {
      const i = word ? TAGS.indexOf(word) : (R() * TAGS.length) | 0, c = i % 4, r = (i / 4) | 0;
      const g = new THREE.PlaneGeometry(3.2, 1.6), uv = g.attributes.uv;
      for (let q = 0; q < uv.count; q++) uv.setXY(q, (c + uv.getX(q)) / 4, 1 - (r + 1 - uv.getY(q)) / 2);
      const m = new THREE.Mesh(g, tagMat), cx = (b.x0 + b.x1) / 2 + (face[1] === 'z' ? off : 0), cz = (b.z0 + b.z1) / 2 + (face[1] === 'x' ? off : 0);
      const n = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[face];
      m.position.set(face === '+x' ? b.x1 + .02 : face === '-x' ? b.x0 - .02 : cx, G0 + 1.3, face === '+z' ? b.z1 + .02 : face === '-z' ? b.z0 - .02 : cz);
      m.rotation.y = Math.atan2(n[0], n[1]); scene.add(m);
    }
    const faceOf = (b, cx, cz) => { const dx = (b.x0 + b.x1) / 2 - cx, dz = (b.z0 + b.z1) / 2 - cz; return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? '+x' : '-x') : (dz > 0 ? '+z' : '-z'); };
    const barrel = (x, z) => { bPlain.box(x - .3, G0 + .15, z - .3, x + .3, G0 + 1.05, z + .3, C('#5a3a2a')); col.add(x - .3, 0, z - .3, x + .3, G0 + 1.05, z + .3); barrels.push([x, G0 + 1.1, z]); };
    const talk = (x, z, type, y, gang) => { const grp = {}, n = chance(.4) ? 3 : 2, seed = R() * 10; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; spots.push({ kind: 'talk', x: x + Math.sin(a) * .6, z: z + Math.cos(a) * .6, y, fixedY: true, heading: Math.atan2(-Math.sin(a), -Math.cos(a)), mix: 'north', type: typeof type === 'function' ? type() : type, seed, idx: i, n, grp, home: true, gang }); } };
    const gangType = g => () => g === 'red' ? 'gang_red' : 'gang_green';

    /* ---------- the blocks ---------- */
    // what stands where: the docks along the north shore, factories and a junkyard behind them, tenements and shops
    // towards the bridge; each gang's court in the middle of its turf
    const PLAN = [
      ['shops', 'lot', 'shops', 'tenements', 'lot', 'tenements', 'warehouse'],
      ['tenements', 'court', 'tenements', 'shops', 'tenements', 'court', 'tenements'],
      ['factory', 'factory', 'tenements', 'tenements', 'warehouse', 'junkyard', 'factory'],
      ['warehouse', 'warehouse', 'containers', 'containers', 'containers', 'containers', 'warehouse']
    ];
    const turf = x => x < 50 ? 'red' : x > 100 ? 'green' : null;
    for (let j = 0; j < ZS.length - 1; j++) for (let i = 0; i < XS.length - 1; i++) {
      const bx0 = XS[i] + RH, bx1 = XS[i + 1] - RH, bz1 = ZS[j] - RH, bz0 = ZS[j + 1] + RH;
      const lx0 = bx0 + SW, lx1 = bx1 - SW, lz0 = bz0 + SW, lz1 = bz1 - SW, cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
      const type = PLAN[j][i], gang = turf(cx), Y = G0 + .15;
      bPaving.box(bx0, G0, bz0, bx1, Y, bz1, C('#c8c0b4'), { tile: 2, topTile: 2 }); col.add(bx0, 0, bz0, bx1, Y, bz1);
      mapShapes.push({ x0: bx0, z0: bz0, x1: bx1, z1: bz1, c: '#7e7888', k: 's' });
      blocks.push({ i: 100 + i, j: 100 + j, bx0, bx1, bz0, bz1, type: 'north', north: true });
      // a lamp or two on the corners (some of them broken)
      for (const [x, z, r] of [[bx0 + .9, bz0 + 10, -Math.PI / 2], [bx1 - .9, bz1 - 10, Math.PI / 2]]) if (chance(.65)) lamps.push([x, z, r, Y]);

      if (type === 'tenements') {
        // three or four brick walk-ups round the block, fire escapes zigzagging down their fronts
        const half = [[lx0, lz0, cx - 1, cz - 1], [cx + 1, lz0, lx1, cz - 1], [lx0, cz + 1, cx - 1, lz1], [cx + 1, cz + 1, lx1, lz1]];
        for (const [x0, z0, x1, z1] of half) {
          if (chance(.15)) { barrel(rr(x0 + 3, x1 - 3), rr(z0 + 3, z1 - 3)); continue; }   // a gap: a yard with a fire
          const h = G0 + 4 * (2 + ((R() * 3) | 0)) + .4, b = building(x0, z0, x1, z1, h, pick(BRICK), Y);
          bPlain.box(x0 - .1, h - .6, z0 - .1, x1 + .1, h, z1 + .1, C('#5a3a30'));
          const f = faceOf(b, cx, cz);
          for (let y = Y + 3.4; y < h - 1; y += 4) {
            const [a0, c0, a1, c1] = f === '+x' ? [x1, cz - 4, x1 + 1.1, cz + 4] : f === '-x' ? [x0 - 1.1, cz - 4, x0, cz + 4] : f === '+z' ? [(x0 + x1) / 2 - 4, z1, (x0 + x1) / 2 + 4, z1 + 1.1] : [(x0 + x1) / 2 - 4, z0 - 1.1, (x0 + x1) / 2 + 4, z0];
            const [px0, pz0, px1, pz1] = f[1] === 'x' ? [a0, (z0 + z1) / 2 - 3, a1, (z0 + z1) / 2 + 3] : [(x0 + x1) / 2 - 3, c0, (x0 + x1) / 2 + 3, c1];
            bPlain.box(px0, y, pz0, px1, y + .08, pz1, C('#2a2426')); bPlain.box(px0, y + .9, pz0, px1, y + .95, pz1, C('#2a2426'));
          }
          bPlain.box((x0 + x1) / 2 - 1, h, (z0 + z1) / 2 - 1, (x0 + x1) / 2 + 1, h + 2.4, (z0 + z1) / 2 + 1, C('#6a5040'));   // the water tank
          if (chance(.8)) tag(f, b, rr(-3, 3));
          // a stoop to sit on
          if (chance(.6)) { const [sx, sz] = f === '+x' ? [x1 + .9, (z0 + z1) / 2] : f === '-x' ? [x0 - .9, (z0 + z1) / 2] : f === '+z' ? [(x0 + x1) / 2, z1 + .9] : [(x0 + x1) / 2, z0 - .9]; spots.push({ kind: 'sit', x: sx, z: sz, y: Y + .45, fixedY: true, heading: f === '+x' ? Math.PI / 2 : f === '-x' ? -Math.PI / 2 : f === '+z' ? 0 : Math.PI, mix: 'north', home: true }); bPlain.box(sx - .8, Y, sz - .8, sx + .8, Y + .4, sz + .8, C('#a09a90')); }
        }
        if (chance(.5)) talk(bx0 + 1.8, cz + rr(-8, 8), gang ? gangType(gang) : null, Y, gang);
      } else if (type === 'shops') {
        const words = ['LIQUOR', 'PAWN', 'LAUNDRY', 'GARAGE', 'PIZZA', 'VIDEO', 'DINER', 'TATTOO'];
        for (const [x0, z0, x1, z1] of [[lx0, lz0, cx - 1, cz - 1], [cx + 1, lz0, lx1, cz - 1], [lx0, cz + 1, cx - 1, lz1], [cx + 1, cz + 1, lx1, lz1]]) {
          const b = building(x0, z0, x1, z1, G0 + rr(5, 8), pick(FADED), Y), f = faceOf(b, cx, cz);
          awning(f, b, pick(['#8a1f2a', '#2a3f6b', '#3b5a3a', '#6b4423']), 5);
          sign(f, b, Y + 3.3, Y + 4.7, 1.5, pick(words));
          // bars on the shop windows
          if (chance(.7)) for (let q = -2; q <= 2; q++) { const [px, pz] = f === '+x' ? [b.x1 + .05, (z0 + z1) / 2 + q * .5] : f === '-x' ? [b.x0 - .05, (z0 + z1) / 2 + q * .5] : f === '+z' ? [(x0 + x1) / 2 + q * .5, b.z1 + .05] : [(x0 + x1) / 2 + q * .5, b.z0 - .05]; bPlain.box(px - .03, Y + .9, pz - .03, px + .03, Y + 2.6, pz + .03, C('#2a2a2e')); }
          if (chance(.6)) tag(f, b, rr(-4, 4));
        }
        talk(bx1 - 1.8, cz + rr(-6, 6), gang && chance(.4) ? gangType(gang) : null, Y, gang && chance(.4) ? gang : undefined);
      } else if (type === 'warehouse') {
        const b = building(lx0, lz0, lx1, lz1, G0 + rr(8, 11), pick(CONCRETE), Y), f = faceOf(b, i === 0 ? cx + 50 : cx - 50, cz);
        bPlain.box(b.x0 - .1, b.h - .5, b.z0 - .1, b.x1 + .1, b.h, b.z1 + .1, C('#5a5854'));
        for (const off of [-8, 0, 8]) { const [dx0, dz0, dx1, dz1] = f === '+x' ? [b.x1, (lz0 + lz1) / 2 + off - 2.2, b.x1 + .08, (lz0 + lz1) / 2 + off + 2.2] : f === '-x' ? [b.x0 - .08, (lz0 + lz1) / 2 + off - 2.2, b.x0, (lz0 + lz1) / 2 + off + 2.2] : f === '+z' ? [(lx0 + lx1) / 2 + off - 2.2, b.z1, (lx0 + lx1) / 2 + off + 2.2, b.z1 + .08] : [(lx0 + lx1) / 2 + off - 2.2, b.z0 - .08, (lx0 + lx1) / 2 + off + 2.2, b.z0]; bPlain.box(dx0, Y, dz0, dx1, Y + 4, dz1, C(pick(['#6a7078', '#8a7a4a', '#5a6a5a']))); }
        tag(f, b, rr(-10, 10)); if (chance(.6)) tag(f, b, rr(-10, 10));
      } else if (type === 'factory') {
        const b = building(lx0, lz0, lx1, lz1 - 6, G0 + rr(9, 12), pick(BRICK), Y);
        // a saw-tooth roof and a tall striped chimney
        for (let x = b.x0 + 1; x < b.x1 - 3; x += 5) bPlain.box(x, b.h, b.z0 + 1, x + 3, b.h + 2, b.z1 - 1, C('#6a6a70'));
        const chx = b.x1 - 4, chz = b.z1 + 2.5;
        bPlain.box(chx - 1.3, Y, chz - 1.3, chx + 1.3, G0 + 28, chz + 1.3, C('#8a3b2e')); col.add(chx - 1.3, 0, chz - 1.3, chx + 1.3, G0 + 28, chz + 1.3);
        for (const y of [G0 + 22, G0 + 25.5]) bPlain.box(chx - 1.35, y, chz - 1.35, chx + 1.35, y + 1.2, chz + 1.35, C('#e8e2da'));
        chimneys.push([chx, G0 + 28.5, chz]);
        tag(faceOf(b, cx, cz - 30), b, rr(-6, 6));
        barrel(lx0 + 3, lz1 - 2);
      } else if (type === 'containers') {
        // stacks of shipping containers, and a gantry crane on the quay
        const CC = ['#b8452a', '#2f6e9e', '#c9a227', '#3c7d4f', '#8a3b6a', '#5a5f6a'];
        for (let x = lx0 + 1; x < lx1 - 12; x += 13) for (let z = lz0 + 1; z < lz1 - 2; z += 3.2) {
          const n = 1 + ((R() * 3) | 0);
          for (let s = 0; s < n; s++) bPlain.box(x, Y + s * 2.6, z, x + 12, Y + (s + 1) * 2.6, z + 2.5, C(pick(CC)));
          col.add(x, 0, z, x + 12, Y + n * 2.6, z + 2.5);
        }
        if (i === 3) {
          const qx = cx, qz = bz0 + .5;
          for (const dx of [-5, 5]) for (const dz of [0, 8]) { bPlain.box(qx + dx - .4, Y, qz + dz - .4, qx + dx + .4, G0 + 22, qz + dz + .4, C('#d8a02a')); col.add(qx + dx - .4, 0, qz + dz - .4, qx + dx + .4, G0 + 22, qz + dz + .4); }
          bPlain.box(qx - 5.5, G0 + 22, qz - 22, qx + 5.5, G0 + 24, qz + 9, C('#d8a02a')); bPlain.box(qx - 2, G0 + 24, qz - 2, qx + 2, G0 + 27, qz + 4, C('#e8e2da'));
        }
      } else if (type === 'junkyard') {
        // a corrugated fence round piles of wrecked cars
        for (const [x0, z0, x1, z1] of [[lx0, lz0, lx1, lz0 + .2], [lx0, lz1 - .2, lx1 - 8, lz1], [lx0, lz0, lx0 + .2, lz1], [lx1 - .2, lz0, lx1, lz1]]) { bPlain.box(x0, Y, z0, x1, Y + 2.6, z1, C('#6a6058')); col.add(x0, 0, z0, x1, Y + 2.6, z1); }
        for (let n = 0; n < 16; n++) { const x = rr(lx0 + 2, lx1 - 5), z = rr(lz0 + 2, lz1 - 4), h = rr(1, 3.5); bPlain.box(x, Y, z, x + rr(3, 4.5), Y + h, z + rr(1.8, 2.4), C(pick(['#6a3a2a', '#4a4a50', '#7a5a3a', '#3a4a5a']))); col.add(x, 0, z, x + 4.5, Y + h, z + 2.4); }
        const wall = { x0: lx0, x1: lx1, z0: lz0, z1: lz0 + .2 }; tag('-z', wall, -6, 'RUST'); tag('-z', wall, 6);
      } else if (type === 'court') {
        // a basketball court behind a chain-link fence: the gang's corner
        const Yc = Y + .01;
        bPlain.box(lx0 + 2, Y, lz0 + 2, lx1 - 2, Yc, lz1 - 2, C('#5a5a64'));
        const lc = gang === 'red' ? '#e8202a' : '#2bd67b';
        for (const [a, b2, c2, d] of [[lx0 + 5, lz0 + 5, lx1 - 5, lz0 + 5.12], [lx0 + 5, lz1 - 5.12, lx1 - 5, lz1 - 5], [lx0 + 5, lz0 + 5, lx0 + 5.12, lz1 - 5], [lx1 - 5.12, lz0 + 5, lx1 - 5, lz1 - 5], [lx0 + 5, cz - .06, lx1 - 5, cz + .06]]) bPlain.flat(a, b2, c2, d, Yc + .005, C(lc));
        for (const z of [lz0 + 5.5, lz1 - 5.5]) { bPlain.box(cx - .1, Y, z - .1, cx + .1, Y + 3.3, z + .1, C('#d0d0d4')); bPlain.box(cx - .9, Y + 3, z - .05 + (z < cz ? .1 : -.1), cx + .9, Y + 4.1, z + .05 + (z < cz ? .1 : -.1), C('#f5f5f0')); col.add(cx - .15, 0, z - .15, cx + .15, Y + 3.3, z + .15); }
        for (let x = lx0 + 2; x <= lx1 - 2; x += 3.2) for (const z of [lz0 + 2, lz1 - 2]) bPlain.box(x - .04, Y, z - .04, x + .04, Y + 3, z + .04, C('#9a9aa2'));
        for (let z = lz0 + 2; z <= lz1 - 2; z += 3.2) for (const x of [lx0 + 2, lx1 - 2]) bPlain.box(x - .04, Y, z - .04, x + .04, Y + 3, z + .04, C('#9a9aa2'));
        for (const [a, b2, c2, d] of [[lx0 + 2, lz0 + 1.96, lx1 - 2, lz0 + 2.04], [lx0 + 2, lz1 - 2.04, lx1 - 2, lz1 - 1.96], [lx0 + 1.96, lz0 + 2, lx0 + 2.04, lz1 - 2], [lx1 - 2.04, lz0 + 2, lx1 - 1.96, lz1 - 2]]) bPlain.box(a, Y + 2.95, b2, c2, Y + 3.05, d, C('#9a9aa2'));
        barrel(lx0 + 4, lz0 + 4); barrel(lx1 - 4, lz1 - 4);
        talk(cx - 4, cz - 7, gangType(gang), Y, gang); talk(cx + 5, cz + 6, gangType(gang), Y, gang); talk(cx + 3, cz - 2, gangType(gang), Y, gang);
      } else {
        // an empty lot: dirt, a burnt-out car, oil drums with fires in them, a wall covered in tags
        bPlain.box(lx0, Y, lz0, lx1, Y + .01, lz1, C('#6e5e48'));
        bPlain.box(cx - 2.2, Y, cz - 1, cx + 2.2, Y + 1.3, cz + 1, C('#2a2624')); col.add(cx - 2.2, 0, cz - 1, cx + 2.2, Y + 1.3, cz + 1);
        barrel(cx - 5, cz + 4); barrel(cx + 6, cz - 5); if (chance(.5)) barrel(cx + 3, cz + 7);
        const w = { x0: lx0 + 1, x1: lx1 - 1, z0: lz1 - .6, z1: lz1 }; bPlain.box(w.x0, Y, w.z0, w.x1, Y + 3, w.z1, C('#8e8a86')); col.add(w.x0, 0, w.z0, w.x1, Y + 3, w.z1);
        tag('-z', w, -9); tag('-z', w, 0, gang === 'red' ? 'COBRAS' : gang === 'green' ? 'SKULLS' : 'N-SIDE'); tag('-z', w, 9);
        talk(cx - 4, cz + 4, gang ? gangType(gang) : null, Y, gang);
      }
      // cars parked at the kerb, old and cheap
      for (const side of [-1, 1]) if (chance(.5)) parking.push({ id: pick(['meridian', 'hayride', 'outbacker', 'piccolo', 'meridian']), x: side < 0 ? bx0 - 1.1 : bx1 + 1.1, z: cz + rr(-12, 12), h: side < 0 ? 0 : Math.PI });
    }

    /* ---------- fires in the oil drums, smoke from the chimneys ---------- */
    const fireTex = U.canvasTex(64, 64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(255,240,190,1)'); gr.addColorStop(.4, 'rgba(255,150,50,.9)'); gr.addColorStop(1, 'rgba(200,40,10,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }, false);
    const fires = barrels.map(([x, y, z]) => { const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); f.position.set(x, y + .35, z); scene.add(f); return f; });
    const smokeTex = U.canvasTex(64, 64, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(120,115,120,.8)'); gr.addColorStop(1, 'rgba(120,115,120,0)'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }, false);
    const smoke = [];
    for (let k = 0; k < chimneys.length * 8; k++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false })); s.chim = chimneys[k % chimneys.length]; s.t = (k / 8 | 0) * .1 + (k % 8) / 8; scene.add(s); smoke.push(s); }

    // gang turf on the map, and where each gang hangs out
    const territories = [
      { gang: 'red', name: 'Кобры', color: '#e8202a', x0: B.x0, x1: 50, z0: B.z0, z1: B.z1 },
      { gang: 'green', name: 'Черепа', color: '#2bd67b', x0: 100, x1: B.x1, z0: B.z0, z1: B.z1 }
    ];
    const hangouts = [{ gang: 'red', name: 'Банда «Кобры»', x: -25, z: -265 }, { gang: 'green', name: 'Банда «Черепа»', x: 175, z: -265 }];

    const districtAt = (x, z) => {
      if (Math.abs(x - BX) < 9 && z < BZ0 && z > BZ1) return 'Северный мост';
      if (x < B.x0 || x > B.x1 || z < B.z0 || z > B.z1) return null;
      if (z < ZS[3]) return 'Доки Норт-Сайда';
      return x < 50 ? 'Норт-Сайд: земля Кобр' : x > 100 ? 'Норт-Сайд: земля Черепов' : 'Норт-Сайд';
    };
    // streets for traffic: the grid, joined to the city at the end of its middle street
    const nodes = [], links = [];
    for (const z of ZS) for (const x of XS) nodes.push([x, z]);
    const id = (i, j) => j * XS.length + i;
    for (let j = 0; j < ZS.length; j++) for (let i = 0; i < XS.length; i++) { if (i + 1 < XS.length) links.push([id(i, j), id(i + 1, j)]); if (j + 1 < ZS.length) links.push([id(i, j), id(i, j + 1)]); }
    return {
      spots, parking, blocks, territories, hangouts, bounds: B, districtAt,
      walkways: [BX - (RW + PW) / 2, BX + (RW + PW) / 2].map(x => [[x, BZ0 + 2], [x, BZ1 - 2]]),
      roads: { lane: 2.6, nodes, links, bridge: { city: [BX, -100], island: id(XS.indexOf(BX), 0) }, north: true },
      update(t, env) {
        const n = env ? env.night : 0;
        fires.forEach((f, i) => { const k = 1 + Math.sin(t * 11 + i) * .15 + Math.sin(t * 7 + i * 2) * .1; f.scale.set(.9 * k, 1.3 * k, 1); f.material.opacity = .75 + n * .25; });
        for (const s of smoke) {
          const u = (t * .08 + s.t) % 1, [x, y, z] = s.chim;
          s.position.set(x + u * 6, y + u * 14, z - u * 2); const k = 2 + u * 7; s.scale.set(k, k, 1); s.material.opacity = (1 - u) * .45;
        }
      }
    };
  };
})(window.NB);
