// Entrances you can't miss. Every door the hero can walk into (or use, like the bodyguard agency) gets the
// same dress: a neon frame round a lit glass door, a canopy, a big signboard with the name, a blade sign
// sticking out from the wall so it reads from along the street, a mat on the pavement, a bouncing arrow
// over the door and a floating name tag that shows from far away.
(function (NB) {
  'use strict';
  const { U, GeoBuilder } = NB;
  const FONT = 'Rubik, "Trebuchet MS", Arial, sans-serif';

  NB.buildEntrances = function (scene, col) {
    const C = h => new THREE.Color(h);
    const P = new GeoBuilder(), N = new GeoBuilder(), GL = new GeoBuilder();
    const list = [];
    let built = false, meshes = [];

    // the ground under a point: the top of a low slab (sidewalks, island ground) or the city pavement
    function groundAt(x, z) {
      let y = .15;
      for (const b of col.query(x - .2, z - .2, x + .2, z + .2, [])) if (b.maxY < 1.05 && b.maxY > y && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && !b.npcOnly) y = b.maxY;
      return y;
    }
    // how far the wall is behind a door spot (looking back in along the normal)
    function wallBehind(d) {
      const y = (d.y != null ? d.y : .15) + 1.2;
      return col.raycast(d.x, y, d.z, -d.nx, 0, -d.nz, 5);
    }

    /* ---------- textures ---------- */
    const tex = (w, h, draw) => { const t = U.canvasTex(w, h, draw, false, 4); return t; };
    function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function fit(g, text, max, size, weight) { let s = size; g.font = `${weight} ${s}px ${FONT}`; while (g.measureText(text).width > max && s > 12) { s -= 2; g.font = `${weight} ${s}px ${FONT}`; } return s; }
    // the big board over the door: icon in a disc, the name in neon, a line under it
    function boardDraw(e) {
      return (g, w, h) => {
        g.clearRect(0, 0, w, h);
        const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#1d1230'); bg.addColorStop(1, '#0d0818');
        rr(g, 6, 6, w - 12, h - 12, 26); g.fillStyle = bg; g.fill();
        g.lineWidth = 9; g.strokeStyle = e.hex; g.shadowColor = e.hex; g.shadowBlur = 24; rr(g, 16, 16, w - 32, h - 32, 20); g.stroke();
        g.shadowBlur = 0;
        const cx = 128, cy = h / 2;
        g.fillStyle = e.hex; g.beginPath(); g.arc(cx, cy, 84, 0, 7); g.fill();
        g.fillStyle = '#ffffff'; g.font = `110px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e.icon || '★', cx, cy + 6);
        const tx = 240, tw = w - tx - 50;
        g.textAlign = 'left';
        fit(g, e.title, tw, e.sub ? 92 : 110, '800');
        g.shadowColor = e.hex; g.shadowBlur = 22; g.fillStyle = e.hex; g.fillText(e.title, tx, e.sub ? cy - 36 : cy + 4);
        g.shadowBlur = 4; g.fillStyle = '#ffffff'; g.globalAlpha = .82; g.fillText(e.title, tx, e.sub ? cy - 36 : cy + 4); g.globalAlpha = 1;
        if (e.sub) { g.shadowBlur = 0; fit(g, e.sub, tw, 50, '600'); g.fillStyle = '#fff1e4'; g.fillText(e.sub, tx, cy + 56); }
        g.shadowBlur = 0;
      };
    }
    // the blade sign: a big icon and one short word, the same on both sides
    function bladeDraw(e) {
      return (g, w, h) => {
        g.clearRect(0, 0, w, h);
        rr(g, 6, 6, w - 12, h - 12, 22); g.fillStyle = '#140b22'; g.fill();
        g.lineWidth = 8; g.strokeStyle = e.hex; g.shadowColor = e.hex; g.shadowBlur = 20; rr(g, 14, 14, w - 28, h - 28, 16); g.stroke(); g.shadowBlur = 0;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `150px ${FONT}`; g.fillStyle = '#fff'; g.fillText(e.icon || '★', w / 2, h * .38);
        fit(g, e.tag, w - 44, 64, '800'); g.shadowColor = e.hex; g.shadowBlur = 16; g.fillStyle = e.hex; g.fillText(e.tag, w / 2, h * .8);
        g.shadowBlur = 0; g.globalAlpha = .7; g.fillStyle = '#fff'; g.fillText(e.tag, w / 2, h * .8); g.globalAlpha = 1;
      };
    }
    // the floating tag: a pill with the icon, the name and a small "ВХОД"
    function tagDraw(e) {
      return (g, w, h) => {
        g.clearRect(0, 0, w, h);
        rr(g, 4, 4, w - 8, h - 8, (h - 8) / 2); g.fillStyle = 'rgba(16,10,30,.86)'; g.fill();
        g.lineWidth = 6; g.strokeStyle = e.hex; rr(g, 7, 7, w - 14, h - 14, (h - 14) / 2); g.stroke();
        g.fillStyle = e.hex; g.beginPath(); g.arc(h / 2, h / 2, h / 2 - 16, 0, 7); g.fill();
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${Math.round(h * .42)}px ${FONT}`; g.fillStyle = '#fff'; g.fillText(e.icon || '★', h / 2, h / 2 + 3);
        g.textAlign = 'left'; const tx = h + 2, tw = w - tx - 34;
        fit(g, e.title, tw, Math.round(h * .36), '800'); g.fillStyle = '#ffffff'; g.fillText(e.title, tx, h * .4);
        fit(g, e.hint || 'ВХОД', tw, Math.round(h * .22), '700'); g.fillStyle = e.hex; g.fillText(e.hint || 'ВХОД', tx, h * .74);
      };
    }
    const chevronTex = tex(64, 64, (g, w) => {
      g.clearRect(0, 0, w, w); g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 6;
      g.beginPath(); g.moveTo(8, 14); g.lineTo(32, 40); g.lineTo(56, 14); g.lineTo(56, 26); g.lineTo(32, 54); g.lineTo(8, 26); g.closePath(); g.fill();
    });
    const ringTex = tex(128, 128, (g, w) => {
      g.clearRect(0, 0, w, w); g.strokeStyle = '#fff'; g.lineWidth = 9; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke();
      g.globalAlpha = .18; g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 48, 0, 7); g.fill();
    });

    /* ---------- geometry ---------- */
    // a box in the door's frame: u along the wall (to the right looking at the door), v out from the wall
    function frame(e) {
      const nx = e.nx, nz = e.nz, rx = nz, rz = -nx;
      const at = (u, v) => [e.wx + rx * u + nx * v, e.wz + rz * u + nz * v];
      return (b, u0, u1, v0, v1, y0, y1, c, o) => {
        const [ax, az] = at(u0, v0), [bx, bz] = at(u1, v1);
        b.box(Math.min(ax, bx), e.y0 + y0, Math.min(az, bz), Math.max(ax, bx), e.y0 + y1, Math.max(az, bz), c, o);
      };
    }
    function plane(w, h, map, x, y, z, rotY, opts) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial(Object.assign({ map, transparent: true }, opts || {})));
      m.position.set(x, y, z); m.rotation.y = rotY; m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m); return m;
    }

    // e: { x, z, y, nx, nz, hex, title, sub, icon, tag, hint, canopy, board, blade, mat, ring, wall (metres from the spot to the wall) }
    function add(e) {
      e.y0 = e.y != null ? e.y : groundAt(e.x, e.z);
      if (e.wall == null) e.wall = wallBehind(e);
      e.hasWall = e.wall < 4.5;
      e.wx = e.x - e.nx * (e.hasWall ? e.wall : 1.3); e.wz = e.z - e.nz * (e.hasWall ? e.wall : 1.3);
      e.tag = e.tag || e.title;
      const B = frame(e), c = C(e.hex), dark = c.clone().multiplyScalar(.35), rotY = Math.atan2(e.nx, e.nz);
      const rx = e.nz, rz = -e.nx;
      const W = (u, v, y) => [e.wx + rx * u + e.nx * v, e.y0 + y, e.wz + rz * u + e.nz * v];
      if (e.hasWall) {
        // the door: a dark frame, two leaves of glass lit from inside, chrome handles
        B(P, -1.0, 1.0, 0, .08, 0, 2.62, C('#1a1424'));
        const glass = c.clone().lerp(C('#ffffff'), .45).multiplyScalar(.85);
        B(N, -.9, -.04, .08, .1, .06, 2.5, glass); B(N, .04, .9, .08, .1, .06, 2.5, glass);
        B(P, -.06, .06, .08, .12, .06, 2.5, C('#1a1424'));
        for (const s of [-1, 1]) B(P, s * .2 - .03, s * .2 + .03, .1, .16, 1.0, 1.25, C('#e6e6ee'));
        // the neon frame round it, glowing
        for (const s of [-1, 1]) { B(N, s * 1.08 - .06, s * 1.08 + .06, .06, .18, 0, 2.86, c); B(GL, s * 1.08 - .3, s * 1.08 + .3, 0, .4, -.1, 3.0, c.clone().multiplyScalar(.9), { noTop: true }); }
        B(N, -1.14, 1.14, .06, .18, 2.74, 2.86, c); B(GL, -1.4, 1.4, 0, .45, 2.5, 3.1, c.clone().multiplyScalar(.9), { noTop: true });
        // canopy over the door, its front edge in neon, a warm light spilling under it
        if (e.canopy !== false) {
          B(P, -1.9, 1.9, 0, 1.7, 3.0, 3.18, dark, { top: dark.clone().multiplyScalar(.8) });
          B(N, -1.92, 1.92, 1.66, 1.74, 2.96, 3.2, c);
          for (const s of [-1, 1]) B(N, s * 1.9 - .04, s * 1.9 + .04, 0, 1.74, 2.96, 3.0, c);
          B(GL, -1.9, 1.9, .1, 1.7, .05, 2.95, c.clone().multiplyScalar(.28), { noTop: true });
          for (const s of [-1, 1]) B(P, s * 1.86 - .03, s * 1.86 + .03, 1.6, 1.66, 0, 3.0, C('#d8d8e0'));
        }
        // the big board
        if (e.board !== false) {
          const bw = e.boardW || 5.6, bh = bw / 4;
          B(P, -bw / 2 - .1, bw / 2 + .1, 0, .16, 3.3, 3.5 + bh, C('#120a1c'));
          const t = tex(1024, 256, boardDraw(e));
          e.boardMesh = plane(bw, bh, t, ...W(0, .18, 3.4 + bh / 2), rotY);
          e.boardTex = t;
          B(GL, -bw / 2 - .5, bw / 2 + .5, 0, .3, 3.1, 3.7 + bh, c.clone().multiplyScalar(.55), { noTop: true });
          // a gate in a garden wall: the board stands on two pillars, like an arch
          if (e.pillars) for (const s of [-1, 1]) { B(P, s * (bw / 2 + .1) - .25, s * (bw / 2 + .1) + .25, -.25, .25, 0, 3.6 + bh, C('#f3ece2')); B(N, s * (bw / 2 + .1) - .27, s * (bw / 2 + .1) + .27, -.27, .27, 3.6 + bh, 3.68 + bh, c); }
        }
        // the blade sign, out from the wall beside the door, readable up and down the street
        if (e.blade !== false) {
          const u = e.bladeU || 2.55, bw = 1.25, bh = 1.56, y = e.board !== false ? 3.4 : 3.3;
          B(P, u - .05, u + .05, 0, 1.75, y + bh + .02, y + bh + .1, C('#d8d8e0'));
          B(P, u - .06, u + .06, .1, 1.62, y - .04, y + bh + .04, C('#120a1c'));
          const t = tex(256, 320, bladeDraw(e)); e.bladeTex = t;
          for (const s of [-1, 1]) {
            const [x, yy, z] = W(u + s * .07, .2 + bw / 2 + .2, y + bh / 2);
            plane(bw, bh, t, x, yy, z, Math.atan2(rx * s, rz * s));
          }
          B(N, u - .09, u + .09, .12, .2 + bw + .25, y - .08, y - .02, c);
          B(N, u - .09, u + .09, .12, .2 + bw + .25, y + bh + .02, y + bh + .08, c);
        }
      }
      // a mat on the pavement, edged in the place's colour
      if (e.mat !== false) {
        const L = Math.max(1.6, (e.hasWall ? e.wall : 1.3) + .9);
        B(P, -.95, .95, e.hasWall ? .05 : 0, L, 0, .025, c.clone().multiplyScalar(.55));
        B(N, -1.0, -.92, e.hasWall ? .05 : 0, L, 0, .03, c); B(N, .92, 1.0, e.hasWall ? .05 : 0, L, 0, .03, c); B(N, -1.0, 1.0, L - .08, L, 0, .03, c);
      }
      // the arrow bouncing over the door spot, the ring on the ground (for doors without one), the floating tag
      e.chev = new THREE.Sprite(new THREE.SpriteMaterial({ map: chevronTex, color: c, transparent: true, depthWrite: false }));
      e.chev.scale.set(.75, .75, 1); scene.add(e.chev);
      if (e.ring) {
        e.ringMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ringTex, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        e.ringMesh.position.set(e.x, e.y0 + .04, e.z); scene.add(e.ringMesh);
      }
      e.tagTex = tex(640, 160, tagDraw(e));
      e.tagSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: e.tagTex, transparent: true, depthWrite: false }));
      const [tx, ty, tz] = W(0, 1.1, e.hasWall ? (e.board !== false ? 6.5 : 4.4) : 3.4);
      e.tagSprite.position.set(tx, ty, tz); e.tagBase = ty; e.tagSprite.scale.set(5.2, 1.3, 1); scene.add(e.tagSprite);
      e.redraw = () => { if (e.bladeTex) { const cv = e.bladeTex.image; bladeDraw(e)(cv.getContext('2d'), cv.width, cv.height); e.bladeTex.needsUpdate = true; } if (e.boardTex) { const cv = e.boardTex.image; boardDraw(e)(cv.getContext('2d'), cv.width, cv.height); e.boardTex.needsUpdate = true; } const cv = e.tagTex.image; tagDraw(e)(cv.getContext('2d'), cv.width, cv.height); e.tagTex.needsUpdate = true; };
      list.push(e);
      if (built) rebuild();
      return e;
    }
    let glowMat = null;
    function rebuild() {
      for (const m of meshes) { scene.remove(m); m.geometry.dispose(); }
      const mk = (b, mat) => { const m = new THREE.Mesh(b.build(), mat); m.matrixAutoUpdate = false; scene.add(m); return m; };
      glowMat = glowMat || new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false });
      meshes = [mk(P, new THREE.MeshLambertMaterial({ vertexColors: true })), mk(N, new THREE.MeshBasicMaterial({ vertexColors: true })), mk(GL, glowMat)];
    }

    return {
      list, add, groundAt,
      finish() {
        built = true; rebuild();
        // the signs were drawn before the web font arrived: draw them again with it
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { for (const e of list) e.redraw(); });
        if (document.fonts && document.fonts.load) document.fonts.load('800 40px Rubik').then(() => { for (const e of list) e.redraw(); }).catch(() => {});
      },
      // t: seconds; cam: the camera position; inside: the hero is in an interior (the city tags hide)
      update(t, cam, night, inside) {
        if (glowMat) glowMat.opacity = .24 + night * .22 + Math.sin(t * 2.1) * .03;
        const check = (t | 0) !== (this.lastT | 0); this.lastT = t;
        for (const e of list) {
          if (check && e.hintFn) { const h = e.hintFn(); if (h !== e.hint) { e.hint = h; e.redraw(); } }
          const d = Math.hypot(cam.x - e.x, cam.z - e.z), vis = !inside && d < 170;
          e.chev.visible = vis && d < 60;
          if (e.chev.visible) e.chev.position.set(e.x, e.y0 + 2.15 + Math.abs(Math.sin(t * 3 + e.x)) * .35, e.z);
          if (e.ringMesh) { e.ringMesh.visible = vis && d < 60; const k = 1 + Math.sin(t * 3 + e.z) * .08; e.ringMesh.scale.set(k, 1, k); }
          const s = e.tagSprite; s.visible = vis && d > (e.hasWall && e.board !== false ? 16 : 6);
          if (s.visible) {
            const k = 1 + Math.max(0, d - 25) / 55;
            s.scale.set(5.2 * k, 1.3 * k, 1); s.position.y = e.tagBase + Math.sin(t * 1.6 + e.x) * .12 + (k - 1) * 1.2;
            s.material.opacity = Math.min(1, (170 - d) / 40);
          }
        }
      }
    };
  };
})(window.NB);
