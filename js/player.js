// The hero: a jointed low-poly model, walk/run/jump animation, physics against the city, and the follow camera.
(function (NB) {
  'use strict';
  const { U } = NB;
  const STEP = .42, RADIUS = .34, HEIGHT = 1.8;
  const JOG = 4.6, SPRINT = 7.6, GRAVITY = 20, JUMP = 7.2;

  function shirtTexture() {
    return U.canvasTex(128, 128, (g, s) => {
      g.fillStyle = '#17b3a6'; g.fillRect(0, 0, s, s);
      const flower = (x, y, r, c) => {
        g.fillStyle = c;
        for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * r * .55, y + Math.sin(a) * r * .55, r * .5, 0, 7); g.fill(); }
        g.fillStyle = '#ffe36e'; g.beginPath(); g.arc(x, y, r * .25, 0, 7); g.fill();
      };
      g.fillStyle = '#0d7f6f';
      for (let k = 0; k < 14; k++) { g.save(); g.translate(Math.random() * s, Math.random() * s); g.rotate(Math.random() * 6); g.fillRect(-10, -3, 20, 6); g.restore(); }
      for (let k = 0; k < 9; k++) flower(Math.random() * s, Math.random() * s, U.rand(9, 15), k % 2 ? '#ff5fa2' : '#ffffff');
    }, true, 4);
  }

  function makeHero() {
    const L = c => new THREE.MeshLambertMaterial(c);
    const shirt = L({ map: shirtTexture() }), skin = L({ color: 0xc98f65 }), jeans = L({ color: 0x3b5a8a }),
      shoe = L({ color: 0xf2f2f2 }), hair = L({ color: 0x2a1c14 }), shades = L({ color: 0x141018 }), belt = L({ color: 0x3a2a1c });
    const root = new THREE.Group();
    const B = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    const G = (x, y, z, parent) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

    const hips = G(0, .95, 0, root);
    B(.34, .14, .21, jeans, 0, .01, 0, hips);
    B(.35, .04, .22, belt, 0, .08, 0, hips);
    const torso = G(0, .08, 0, hips);
    B(.4, .5, .23, shirt, 0, .27, 0, torso);
    B(.12, .1, .02, skin, 0, .46, .112, torso);
    const head = G(0, .52, 0, torso);
    B(.1, .08, .1, skin, 0, .04, 0, head);
    B(.22, .25, .23, skin, 0, .2, .005, head);
    B(.235, .07, .245, hair, 0, .33, -.005, head);
    B(.235, .17, .07, hair, 0, .24, -.095, head);
    B(.21, .055, .02, shades, 0, .225, .122, head);
    const arm = side => {
      const sh = G(side * .255, .46, 0, torso);
      B(.13, .2, .14, shirt, 0, -.08, 0, sh);
      B(.09, .1, .09, skin, 0, -.22, 0, sh);
      const el = G(0, -.27, 0, sh);
      B(.085, .24, .085, skin, 0, -.12, 0, el);
      B(.09, .09, .065, skin, 0, -.28, 0, el);
      const hand = G(0, -.3, 0, el);
      return { sh, el, hand };
    };
    const leg = side => {
      const hip = G(side * .1, 0, 0, hips);
      B(.15, .46, .17, jeans, 0, -.23, 0, hip);
      const kn = G(0, -.46, 0, hip);
      B(.13, .42, .15, jeans, 0, -.21, 0, kn);
      B(.14, .08, .27, shoe, 0, -.45, .05, kn);
      return { hip, kn };
    };
    const aL = arm(-1), aR = arm(1), lL = leg(-1), lR = leg(1);
    root.rotation.order = 'YXZ';
    // guns held in the right hand, pointing forward when the arm is raised
    const metal = L({ color: 0x1e1e22 }), wood = L({ color: 0x6b4226 });
    const guns = {};
    const gun = (id, parts, tip) => { const g = G(0, 0, 0, aR.hand); for (const [w, h, d, mat, x, y, z] of parts) B(w, h, d, mat, x, y, z, g); g.visible = false; g.tip = tip; guns[id] = g; };
    gun('pistol', [[.05, .07, .2, metal, 0, -.02, .08], [.045, .1, .05, metal, 0, -.07, 0]], [0, -.02, .19]);
    gun('smg', [[.06, .08, .3, metal, 0, -.02, .1], [.04, .16, .05, metal, 0, -.1, .08], [.04, .08, .05, metal, 0, -.06, -.02]], [0, -.02, .26]);
    gun('shotgun', [[.05, .06, .7, metal, 0, -.01, .2], [.06, .08, .28, wood, 0, -.04, -.18], [.06, .05, .25, wood, 0, -.06, .3]], [0, -.01, .56]);
    return { root, hips, torso, head, aL, aR, lL, lR, guns };
  }

  class Player {
    constructor(scene, col) {
      this.col = col;
      this.m = makeHero(); scene.add(this.m.root);
      this.blob = new THREE.Mesh(new THREE.CircleGeometry(.45, 16).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .28, depthWrite: false }));
      scene.add(this.blob);
      this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vz = 0; this.vy = 0;
      this.heading = 0; this.onGround = true; this.phase = 0; this.run = 0; this.air = 0; this.tmp = [];
      this.hp = 100; this.dead = false; this.deadT = 0; this.punchT = 0; this.aimT = 0; this.aimYaw = 0; this.aimPitch = 0; this.recoil = 0; this.weapon = 'fists';
    }
    place(x, z, heading) { this.x = x; this.z = z; this.y = this.floorAt(x, z, 10); this.vx = this.vz = this.vy = 0; this.heading = heading; }
    get speed() { return Math.hypot(this.vx, this.vz); }
    setWeapon(id) { this.weapon = id; for (const k in this.m.guns) this.m.guns[k].visible = k === id; }
    punch() { this.punchT = .3; }
    fired() { this.recoil = 1; this.aimT = Math.max(this.aimT, .8); }
    // world position of the gun barrel (or the fist)
    muzzle(out) {
      this.m.root.updateMatrixWorld(true);
      const g = this.m.guns[this.weapon];
      if (g) { out.set(g.tip[0], g.tip[1], g.tip[2]); return g.localToWorld(out); }
      out.set(0, 0, 0); return this.m.aR.hand.localToWorld(out);
    }

    floorAt(x, z, fromY) {
      let f = 0; const r = RADIUS * .6;
      for (const b of this.col.query(x - 1, z - 1, x + 1, z + 1, this.tmp)) {
        if (b.maxY > fromY + STEP) continue;
        if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && b.maxY > f) f = b.maxY;
      }
      return f;
    }
    // Push the body circle out of any box that is too tall to step onto.
    collide() {
      for (let it = 0; it < 2; it++) {
        for (const b of this.col.query(this.x - 1.5, this.z - 1.5, this.x + 1.5, this.z + 1.5, this.tmp)) {
          if (b.maxY <= this.y + STEP || b.minY >= this.y + HEIGHT) continue;
          const cx = U.clamp(this.x, b.minX, b.maxX), cz = U.clamp(this.z, b.minZ, b.maxZ);
          let dx = this.x - cx, dz = this.z - cz; const d = Math.hypot(dx, dz);
          if (d >= RADIUS) continue;
          if (d > 1e-6) { this.x += dx / d * (RADIUS - d); this.z += dz / d * (RADIUS - d); }
          else { // centre inside the box: leave by the nearest side
            const pen = [this.x - b.minX, b.maxX - this.x, this.z - b.minZ, b.maxZ - this.z], k = pen.indexOf(Math.min(...pen));
            if (k === 0) this.x = b.minX - RADIUS; else if (k === 1) this.x = b.maxX + RADIUS; else if (k === 2) this.z = b.minZ - RADIUS; else this.z = b.maxZ + RADIUS;
          }
        }
      }
    }

    update(dt, input, camYaw) {
      if (this.dead) {
        this.deadT += dt; this.vx = this.vz = 0;
        const f = Math.min(1, this.deadT / .6);
        this.m.root.rotation.x = -Math.PI / 2 * f * f;
        this.m.root.position.set(this.x, this.y + .12 * f, this.z);
        this.blob.visible = false;
        return;
      }
      this.m.root.rotation.x = 0;
      if (this.aimT > 0) this.aimT -= dt;
      if (this.punchT > 0) this.punchT -= dt;
      this.recoil = Math.max(0, this.recoil - dt * 8);
      // desired velocity relative to the camera
      const mx = input.move.x, my = input.move.y, mag = Math.min(1, Math.hypot(mx, my));
      const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
      let wx = mx * cy - my * sy, wz = -mx * sy - my * cy;
      const wl = Math.hypot(wx, wz);
      const top = input.sprint ? SPRINT : JOG;
      if (wl > 1e-4) { wx = wx / wl * top * mag; wz = wz / wl * top * mag; }
      const k = this.onGround ? 10 : 2.5;
      this.vx = U.damp(this.vx, wx, k, dt); this.vz = U.damp(this.vz, wz, k, dt);
      if (input.jump && this.onGround) { this.vy = JUMP; this.onGround = false; }
      input.jump = false;

      // horizontal move, then walls
      this.x += this.vx * dt; this.z += this.vz * dt;
      this.collide();
      // vertical: gravity, landing, stepping onto curbs
      const floor = this.floorAt(this.x, this.z, this.y);
      this.vy -= GRAVITY * dt; this.y += this.vy * dt;
      const was = this.onGround;
      if (this.y <= floor || (was && this.vy <= 0 && this.y - floor < .25)) { this.y = floor; this.vy = 0; this.onGround = true; }
      else this.onGround = false;
      this.air = this.onGround ? 0 : this.air + dt;

      // face the direction of travel
      const sp = this.speed;
      if (this.aimT > 0 && this.weapon !== 'fists') this.heading += U.angDiff(this.heading, this.aimYaw) * Math.min(1, dt * 16);
      else if (sp > .4) this.heading += U.angDiff(this.heading, Math.atan2(this.vx, this.vz)) * Math.min(1, dt * 12);
      this.animate(dt, sp);
    }

    animate(dt, sp) {
      const m = this.m;
      this.run = U.damp(this.run, U.clamp((sp - JOG * .6) / (SPRINT - JOG * .6), 0, 1), 6, dt);
      const moving = U.clamp(sp / 2, 0, 1);
      this.phase += dt * (sp < .1 ? 0 : 2.6 + sp * 1.25);
      const ph = this.phase, s = Math.sin(ph), c = Math.cos(ph);
      const A = (.55 + this.run * .45) * moving;
      let thL = -s * A, thR = s * A;
      let knL = (.08 + Math.max(0, c) * (.7 + this.run * .7)) * moving, knR = (.08 + Math.max(0, -c) * (.7 + this.run * .7)) * moving;
      let arL = s * A * .9, arR = -s * A * .9, elb = -(.25 + this.run * 1.0) * moving - .12;
      let bob = Math.abs(s) * .045 * moving * (1 + this.run), lean = .06 * moving + .16 * this.run;
      if (!this.onGround && this.air > .08) { thL = -.7; thR = .15; knL = 1.0; knR = .5; arL = -.6; arR = .5; elb = -.8; bob = 0; lean = .05; }
      const t = performance.now() / 1000;
      const idle = (1 - moving) * Math.sin(t * 1.8) * .012;
      const L = (a, b) => a + (b - a) * Math.min(1, dt * 16);
      m.lL.hip.rotation.x = L(m.lL.hip.rotation.x, thL); m.lR.hip.rotation.x = L(m.lR.hip.rotation.x, thR);
      m.lL.kn.rotation.x = L(m.lL.kn.rotation.x, knL); m.lR.kn.rotation.x = L(m.lR.kn.rotation.x, knR);
      m.aL.sh.rotation.x = L(m.aL.sh.rotation.x, arL); m.aR.sh.rotation.x = L(m.aR.sh.rotation.x, arR);
      m.aL.el.rotation.x = L(m.aL.el.rotation.x, elb); m.aR.el.rotation.x = L(m.aR.el.rotation.x, elb);
      m.aL.sh.rotation.z = -.07; m.aR.sh.rotation.z = .07;
      // arms: aiming a gun, or throwing a punch
      if (this.aimT > 0 && this.weapon !== 'fists') {
        const up = -Math.PI / 2 - this.aimPitch - this.recoil * .15;
        m.aR.sh.rotation.x = up; m.aR.el.rotation.x = -.05; m.aR.sh.rotation.z = .05;
        if (this.weapon !== 'pistol') { m.aL.sh.rotation.x = up + .25; m.aL.el.rotation.x = -.7; m.aL.sh.rotation.z = .55; }
        m.torso.rotation.y = 0;
      } else if (this.punchT > 0) {
        const k = Math.sin((1 - this.punchT / .3) * Math.PI);
        m.aR.sh.rotation.x = -.4 - 1.25 * k; m.aR.el.rotation.x = -1.3 + 1.2 * k; m.aL.sh.rotation.x = -1; m.aL.el.rotation.x = -1.6;
        m.torso.rotation.y = -.3 * k;
      }
      m.torso.rotation.x = L(m.torso.rotation.x, lean); m.torso.rotation.y = s * .08 * moving;
      m.hips.position.y = .95 + bob - (1 - moving) * 0 + idle;
      m.head.rotation.x = -lean * .6;
      m.root.position.set(this.x, this.y, this.z); m.root.rotation.y = this.heading;
      this.blob.visible = m.root.visible;
      this.blob.position.set(this.x, this.floorAt(this.x, this.z, this.y) + .025, this.z);
    }
  }

  // Third-person camera: orbits the hero, never passes through walls, drifts behind while running.
  class CameraRig {
    constructor(camera, col) {
      this.cam = camera; this.col = col; this.yaw = 0; this.pitch = .28; this.dist = 4.8; this.cur = 4.8;
      this.py = 0; this.idle = 0; this.aimBlend = 0;
    }
    look(dx, dy) { if (dx || dy) { this.yaw -= dx; this.pitch = U.clamp(this.pitch + dy, -.35, 1.15); this.idle = 0; } }
    snap(p) { this.yaw = p.heading + Math.PI; this.py = p.y; }
    update(dt, p) {
      this.idle += dt;
      // in a car the camera swings behind quickly; on foot it waits until you stop steering it
      const car = !!p.camDist;
      if (car ? (this.idle > .6 && Math.abs(p.speed) > 1.5) : (this.idle > 1.6 && p.speed > 1.5)) {
        const behind = car && p.speed < -1 ? p.heading : p.heading + Math.PI;
        this.yaw += U.angDiff(this.yaw, behind) * Math.min(1, dt * (car ? 2.4 : 1.3));
        if (car) this.pitch = U.damp(this.pitch, .2, 1.5, dt);
      }
      this.py = U.damp(this.py, p.y, 12, dt);
      const px = p.x, py = this.py + (p.camH || 1.55), pz = p.z;
      const cp = Math.cos(this.pitch);
      const dx = Math.sin(this.yaw) * cp, dy = Math.sin(this.pitch), dz = Math.cos(this.yaw) * cp;
      const want = car ? p.camDist + (this.dist - 4.8) * .6 : this.dist + (p.run || 0) * .9;
      const hit = this.col.raycast(px, py, pz, dx, dy, dz, want + .4);
      const allowed = Math.max(.6, Math.min(want, hit - .35));
      this.cur = allowed < this.cur ? allowed : U.damp(this.cur, allowed, 3, dt);
      const ab = this.aimBlend, rx = Math.cos(this.yaw) * .6 * ab, rz = -Math.sin(this.yaw) * .6 * ab;
      const dist = this.cur + (Math.min(this.cur, 2.4) - this.cur) * ab;
      let x = px + rx + dx * dist, y = py + dy * dist + .1 * ab, z = pz + rz + dz * dist;
      if (y < .35) y = .35;
      this.cam.position.set(x, y, z);
      this.cam.lookAt(px + rx, py + .15 + .1 * ab, pz + rz);
    }
  }

  NB.Player = Player;
  NB.CameraRig = CameraRig;
})(window.NB);
