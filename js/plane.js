// A little propeller plane circling over the city and Palm Island, towing a long banner that ripples in the
// wind: CREATED BY LEHA NEPLOXO. Readable from both sides, lit a little so it still shows at dusk.
(function (NB) {
  'use strict';
  const { U } = NB;
  NB.createPlane = function (scene) {
    const CX = 20, CZ = -30, RX = 150, RZ = 130, ALT = 42, SPEED = 26;   // an oval over the city, the bay and the strait, clear of the tall buildings
    const M = hex => new THREE.MeshLambertMaterial({ color: hex });
    const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); return b; };

    /* ---------- the plane: nose along +z ---------- */
    const plane = new THREE.Group(), body = new THREE.Group(); plane.add(body);
    const WHITE = M(0xf5f5f0), PINK = M(0xff4fa3), CYAN = M(0x3fe6e0), DARK = M(0x1c2a3e);
    body.add(box(1.3, 1.4, 7, 0, 0, 0, WHITE), box(1.32, .35, 7.02, 0, -.2, 0, PINK),
      box(1.1, .75, 1.6, 0, .75, 1.2, DARK),                                   // cockpit glass
      box(11, .18, 1.8, 0, .45, .9, WHITE), box(11.02, .06, .5, 0, .56, .5, PINK),   // high wing with a stripe
      box(4, .14, 1.2, 0, .1, -3.2, WHITE), box(.14, 1.7, 1.3, 0, .9, -3.3, PINK),     // tail
      box(.9, .9, .6, 0, 0, 3.7, CYAN),                                           // nose
      box(.12, 1.1, .12, .9, -1.1, 1.3, DARK), box(.12, 1.1, .12, -.9, -1.1, 1.3, DARK),   // landing gear
      box(.4, .4, .5, .9, -1.65, 1.3, DARK), box(.4, .4, .5, -.9, -1.65, 1.3, DARK));
    const prop = new THREE.Group(); prop.position.set(0, 0, 4.05);
    prop.add(box(.2, 3, .08, 0, 0, 0, DARK), box(3, .2, .08, 0, 0, 0, DARK)); body.add(prop);
    // wing-tip lights: red on the left, green on the right, a white strobe on the tail
    const lamp = (hex, x, y, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(.18, 8, 6), new THREE.MeshBasicMaterial({ color: hex })); m.position.set(x, y, z); body.add(m); return m; };
    lamp(0xff2233, 5.5, .45, .9); lamp(0x22ff66, -5.5, .45, .9); const strobe = lamp(0xffffff, 0, 1.8, -3.4);
    plane.traverse(o => { if (o.isMesh) o.castShadow = false; });
    scene.add(plane);

    /* ---------- the banner ---------- */
    const TEXT = 'CREATED BY LEHA NEPLOXO', BW = 42, BH = 5.8, SEG = 28;
    const tex = U.canvasTex(2048, 272, (g, w, h) => {
      g.fillStyle = '#fdf8f0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ff4fa3'; g.fillRect(0, 0, w, 16); g.fillRect(0, h - 16, w, 16);
      g.font = '900 170px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 10; g.strokeStyle = '#1c2a3e'; g.strokeText(TEXT, w / 2, h / 2 + 6);
      const gr = g.createLinearGradient(0, 40, 0, h - 40); gr.addColorStop(0, '#ff4fa3'); gr.addColorStop(1, '#9b5cff');
      g.fillStyle = gr; g.fillText(TEXT, w / 2, h / 2 + 6);
    }, false, 8);
    // two sheets back to back so the words read the right way round from either side
    // (the front sheet faces -x with its left edge at the tail; the back one faces +x with its left edge at the rope)
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .35 });
    const banner = new THREE.Group(), sheets = [];
    for (const [ry, dir] of [[-Math.PI / 2, 1], [Math.PI / 2, -1]]) {
      const geo = new THREE.PlaneGeometry(BW, BH, SEG, 1), m = new THREE.Mesh(geo, mat); m.rotation.y = ry;
      banner.add(m); sheets.push({ geo, base: geo.attributes.position.array.slice(), dir });   // dir: which end of x is at the rope
    }
    scene.add(banner);
    // the tow rope from the tail to the front edge of the banner
    const ropeGeo = new THREE.BufferGeometry(); ropeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0x2a2a30 })); rope.frustumCulled = false; scene.add(rope);
    banner.traverse(o => { o.frustumCulled = false; });

    let a = Math.random() * Math.PI * 2, t = 0;
    const at = u => [CX + Math.cos(u) * RX, ALT + Math.sin(u * 2) * 4, CZ + Math.sin(u) * RZ];
    const V = new THREE.Vector3();
    function update(dt) {
      t += dt;
      const r = Math.hypot(RX * Math.sin(a), RZ * Math.cos(a));
      a += SPEED / r * dt;
      const p = at(a), p2 = at(a + .01), h = Math.atan2(p2[0] - p[0], p2[2] - p[2]);
      plane.position.set(p[0], p[1], p[2]); plane.rotation.y = h;
      body.rotation.z = -.2; body.rotation.x = -(p2[1] - p[1]) * .02;   // banking into the endless left turn
      prop.rotation.z += dt * 40;
      strobe.visible = (t % 1.2) < .08;
      // the banner trails behind on a 12 m rope, following the plane's path, and ripples
      const back = BW / 2 + 12;
      const bu = a - back / r, bp = at(bu), bp2 = at(bu + .01), bh = Math.atan2(bp2[0] - bp[0], bp2[2] - bp[2]);
      banner.position.set(bp[0], bp[1] - 2.2, bp[2]); banner.rotation.y = bh;
      for (const { geo, base, dir } of sheets) {
        const pos = geo.attributes.position.array;
        for (let i = 0; i < pos.length; i += 3) {
          const k = (BW / 2 - base[i] * dir) / BW;                     // 0 at the rope end, 1 at the far end
          pos[i + 2] = Math.sin(t * 7 - k * 9) * (.15 + k * .9) * dir;
          pos[i + 1] = base[i + 1] - k * k * .8;
        }
        geo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
      }
      // rope: from under the tail to the leading edge of the banner, sagging a little in the middle
      V.set(0, -.6, -3.6).applyMatrix4(plane.matrixWorld);
      const fx = bp[0] + Math.sin(bh) * BW / 2, fz = bp[2] + Math.cos(bh) * BW / 2;
      const rp = ropeGeo.attributes.position.array;
      rp[0] = V.x; rp[1] = V.y; rp[2] = V.z; rp[6] = fx; rp[7] = bp[1] - 2.2 + BH / 2 - .3; rp[8] = fz;
      rp[3] = (V.x + fx) / 2; rp[4] = (V.y + rp[7]) / 2 - 1.2; rp[5] = (V.z + fz) / 2;
      ropeGeo.attributes.position.needsUpdate = true;
    }
    update(0);
    return { update, plane, banner };
  };
})(window.NB);
