// Weather: clear skies, clouds, morning fog, rain and thunderstorms, changing every few game hours.
// Rain falls as streaks round the camera, the sky and the fog turn grey, the sun goes in, roads and
// pavements darken with wet and the neon glows brighter in it, lightning flashes over the bay and the
// thunder follows. Cars slide more on wet roads, people hurry and the beach empties.
(function (NB) {
  'use strict';
  const { U } = NB;
  // per kind: clouds (0..1), rain (0..1), fog (how far you see, 1 = normal), lightning, name and icon for the HUD
  const KINDS = {
    clear: { cloud: 0, rain: 0, fog: 1, bolts: false, name: 'Ясно', icon: '☀' },
    cloudy: { cloud: .55, rain: 0, fog: .95, bolts: false, name: 'Облачно', icon: '☁' },
    fog: { cloud: .45, rain: 0, fog: .5, bolts: false, name: 'Туман', icon: '🌫' },
    rain: { cloud: .85, rain: .75, fog: .72, bolts: false, name: 'Дождь', icon: '🌧' },
    storm: { cloud: 1, rain: 1, fog: .62, bolts: true, name: 'Гроза', icon: '⛈' }
  };
  const GREY_DAY = new THREE.Color('#9097a6'), GREY_NIGHT = new THREE.Color('#1b1d2a'), FOG_DAY = new THREE.Color('#b8bcc4'), SEA_GREY = new THREE.Color('#3f5a6e');

  NB.createWeather = function (scene, camera, o) {
    // what's happening now, blended smoothly towards the target over half a minute
    const W = { kind: 'clear', cloud: 0, rain: 0, fog: 1, wet: 0, next: 300 + Math.random() * 240, boltT: 8, flashT: 0 };
    let target = KINDS.clear;
    function pickNext(hour) {
      const morning = hour > 4.5 && hour < 9.5, r = Math.random();
      if (morning && r < .25) return 'fog';
      return r < .45 ? 'clear' : r < .65 ? 'cloudy' : r < .87 ? 'rain' : 'storm';
    }
    function set(kind) { if (!KINDS[kind]) return; W.kind = kind; target = KINDS[kind]; }

    /* ---------- rain: streaks in a box that follows the camera ---------- */
    const N = o.lowQuality() ? 700 : 1500, BOX = 30, TOP = 22;
    const pos = new Float32Array(N * 6), drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { drops[i * 3] = U.rand(-BOX, BOX); drops[i * 3 + 1] = U.rand(-4, TOP); drops[i * 3 + 2] = U.rand(-BOX, BOX); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const rainMat = new THREE.LineBasicMaterial({ color: 0xb8c4d8, transparent: true, opacity: 0, depthWrite: false });
    const rain = new THREE.LineSegments(rg, rainMat); rain.frustumCulled = false; rain.visible = false; scene.add(rain);
    // lightning: a jagged bolt far out over the water, and a white flash on the screen
    const boltPos = new Float32Array(14 * 6), bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(boltPos, 3));
    const bolt = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0xeef2ff, fog: false })); bolt.frustumCulled = false; bolt.visible = false; scene.add(bolt);
    function strike() {
      const a = Math.random() * Math.PI * 2, d = U.rand(150, 260), x0 = camera.position.x + Math.cos(a) * d, z0 = camera.position.z + Math.sin(a) * d;
      let x = x0, y = 140, z = z0;
      for (let k = 0; k < 14; k++) {
        const nx = x + U.rand(-9, 9), ny = y - 10, nz = z + U.rand(-9, 9);
        boltPos.set([x, y, z, nx, ny, nz], k * 6); x = nx; y = ny; z = nz;
      }
      bg.attributes.position.needsUpdate = true; bolt.visible = true; W.flashT = .22;
      const dist = Math.hypot(x0 - camera.position.x, z0 - camera.position.z);
      setTimeout(() => o.audio.thunder(dist), 300 + dist * 6);
    }

    const tmpC = new THREE.Color();
    return {
      get kind() { return W.kind; },
      get info() { return KINDS[W.kind]; },
      get rain() { return W.rain; },
      get wet() { return W.wet; },
      set,
      // how much grip the tyres lose on a wet road (0..0.35)
      slip() { return W.wet * .35; },
      update(dt, hour, outdoors) {
        if ((W.next -= dt) <= 0) { W.next = U.rand(240, 540); set(pickNext(hour)); }
        W.cloud = U.damp(W.cloud, target.cloud, .12, dt); W.rain = U.damp(W.rain, target.rain, .15, dt); W.fog = U.damp(W.fog, target.fog, .1, dt);
        // roads get wet quickly and dry slowly
        W.wet = W.rain > W.wet ? U.damp(W.wet, W.rain, .3, dt) : U.damp(W.wet, W.rain, .02, dt);
        // the rain streaks
        const r = outdoors ? W.rain : 0;
        rain.visible = r > .02; rainMat.opacity = r * .8;
        if (rain.visible) {
          const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, fall = 24 * dt, wind = 5 * dt, len = 1.4, count = (N * r) | 0;
          for (let i = 0; i < N; i++) {
            let x = drops[i * 3], y = drops[i * 3 + 1], z = drops[i * 3 + 2];
            y -= fall; x += wind;
            if (y < -4) { y = TOP - ((-4 - y) % (TOP + 4)); x = U.rand(-BOX, BOX); z = U.rand(-BOX, BOX); }
            if (x > BOX) x -= BOX * 2;
            drops[i * 3] = x; drops[i * 3 + 1] = y; drops[i * 3 + 2] = z;
            const k = i * 6;
            if (i >= count) { pos[k] = pos[k + 3] = cx; pos[k + 1] = pos[k + 4] = -99; pos[k + 2] = pos[k + 5] = cz; continue; }
            pos[k] = cx + x; pos[k + 1] = cy + y; pos[k + 2] = cz + z;
            pos[k + 3] = cx + x - .2; pos[k + 4] = cy + y + len; pos[k + 5] = cz + z;
          }
          rg.attributes.position.needsUpdate = true;
        }
        // lightning in a storm
        if (target.bolts && outdoors && W.rain > .6 && (W.boltT -= dt) <= 0) { W.boltT = U.rand(5, 14); strike(); }
        if (W.flashT > 0) { W.flashT -= dt; if (W.flashT <= 0) bolt.visible = false; }
        o.audio.rain(outdoors ? W.rain : W.rain * .25);
        return W.flashT > 0 ? Math.min(1, W.flashT / .22) : 0;
      },
      // grey the sky and the light, bring the fog in, wet the streets; called after the day/night cycle each frame
      apply(env, ctx) {
        const c = W.cloud, night = env.night, su = ctx.sky.material.uniforms, grey = tmpC.copy(GREY_DAY).lerp(GREY_NIGHT, night);
        su.uHor.value.lerp(grey, c * .8); su.uMid.value.lerp(grey, c * .85); su.uTop.value.lerp(grey, c * .7); su.uGround.value.lerp(grey, c * .8);
        su.uSunVis.value *= 1 - c; su.uStars.value *= 1 - c * .95; env.stars *= 1 - c * .95;
        ctx.scene.fog.color.lerp(tmpC.copy(FOG_DAY).lerp(GREY_NIGHT, night), c * .6);
        ctx.hemi.intensity *= 1 - c * .25; ctx.sun.intensity *= 1 - c * .8;
        env.spec.multiplyScalar(1 - c * .9); env.seaA.lerp(SEA_GREY, c * .5); env.seaB.lerp(SEA_GREY, c * .4);
        // a dark afternoon switches the lamps on; the neon glows harder in the wet
        env.lamps = Math.max(env.lamps, c * .7); env.windows = Math.max(env.windows, c * .5);
        env.glow += W.wet * .14;
        const k = W.fog, near = ctx.fogNear * k, far = ctx.fogFar * (.5 + .5 * k);
        ctx.scene.fog.near = near; ctx.scene.fog.far = far; ctx.world.setFog(near, far);
        ctx.world.setWet(W.wet);
        // the lightning lights the whole city for an instant
        if (W.flashT > 0) { const f = Math.min(1, W.flashT / .22); ctx.hemi.intensity += f * 1.4; ctx.scene.fog.color.lerp(tmpC.set(0xdde4ff), f * .5); }
      }
    };
  };
})(window.NB);
