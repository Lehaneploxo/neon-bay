// Car models: fictional 80s cars and motorbikes built from boxes and tapered prisms.
// Each model is one merged geometry with vertex colours; per car we clone it and repaint the body.
(function (NB) {
  'use strict';
  const M4 = () => new THREE.Matrix4();
  const FIXED = {
    glass: '#1c2a3e', chrome: '#d9d9e2', black: '#1a1a1e', grille: '#2a2a30', interior: '#3a2e28',
    seat: '#e8dcc8', tyre: '#1c1c1f', hub: '#c9c9d2', white: '#f5f5f0', skin: '#c98f65', shirt: '#17b3a6'
  };

  // Box with a smaller, possibly shifted, top face: windscreens, wedges, fastbacks.
  function prism(wb, lb, wt, lt, h, zt) {
    const b = [[-wb / 2, 0, -lb / 2], [wb / 2, 0, -lb / 2], [wb / 2, 0, lb / 2], [-wb / 2, 0, lb / 2]];
    const t = [[-wt / 2, h, zt - lt / 2], [wt / 2, h, zt - lt / 2], [wt / 2, h, zt + lt / 2], [-wt / 2, h, zt + lt / 2]];
    const quads = [[b[3], b[2], t[2], t[3]], [b[1], b[0], t[0], t[1]], [b[2], b[1], t[1], t[2]], [b[0], b[3], t[3], t[0]], [t[3], t[2], t[1], t[0]], [b[0], b[1], b[2], b[3]]];
    const pos = [];
    for (const [a, c, d, e] of quads) pos.push(...a, ...c, ...d, ...a, ...d, ...e);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    return g;
  }

  // Part helpers: [geometry, matrix, colourKey]. Keys 'body' and 'accent' are repainted per car.
  const B = (w, h, d, x, y, z, key, rx = 0) => [new THREE.BoxGeometry(w, h, d), M4().makeRotationX(rx).setPosition(x, y, z), key];
  const P = (wb, lb, wt, lt, h, zt, x, y, z, key) => [prism(wb, lb, wt, lt, h, zt), M4().makeTranslation(x, y, z), key];
  const lights = (w, l, yF, yR, spread, hw = .36, hh = .13) => [
    B(hw, hh, .05, spread, yF, l / 2 + .01, '#fff6d8'), B(hw, hh, .05, -spread, yF, l / 2 + .01, '#fff6d8'),
    B(hw + .08, hh, .05, spread, yR, -l / 2 - .01, '#ff2a3a'), B(hw + .08, hh, .05, -spread, yR, -l / 2 - .01, '#ff2a3a')];

  const MODELS = [
    { id: 'zefiro', name: 'Zefiro GT', w: 1.95, l: 4.3, r: .33, seat: [.4, .22, -.25],
      perf: { accel: 11, top: 40, grip: 9, steer: .55, brake: 16 },
      palette: ['#e8202a', '#f5f5f0', '#141418', '#ffd23d', '#ff4fa3', '#2a6fe8'], accent: ['#141418'],
      parts: () => [
        P(1.95, 4.3, 1.85, 4.0, .45, 0, 0, .2, 0, 'body'),
        P(1.85, 1.6, 1.7, 1.3, .12, -.12, 0, .65, 1.25, 'body'),
        P(1.72, 1.95, 1.28, .95, .42, -.35, 0, .65, -.2, 'glass'),
        B(1.26, .035, .9, 0, 1.085, -.56, 'body'),
        B(1.8, .1, 1.1, 0, .7, -1.55, 'body'),
        B(1.9, .05, .42, 0, 1.03, -2.0, 'accent'), B(.06, .3, .1, .7, .86, -1.95, 'black'), B(.06, .3, .1, -.7, .86, -1.95, 'black'),
        B(.03, .2, .6, .98, .52, -.6, 'black'), B(.03, .2, .6, -.98, .52, -.6, 'black'),
        B(1.9, .12, .1, 0, .28, 2.16, 'black'), B(1.9, .14, .1, 0, .3, -2.16, 'black'),
        ...lights(1.95, 4.3, .6, .52, .6, .38, .07)] },
    { id: 'meridian', name: 'Meridian', w: 1.85, l: 4.8, r: .33, seat: [.4, .5, -.2],
      perf: { accel: 7, top: 30, grip: 8, steer: .5, brake: 13 },
      palette: ['#8a1f2a', '#2a3f6b', '#d9d4cc', '#3b5a3a', '#7a6a5a', '#b8b8c0', '#e8d9b0', '#5a2a4a', '#1a1a1e', '#a0c4e8'], accent: ['chrome'],
      parts: () => sedan() },
    { id: 'cab', name: 'Downtown Cab', w: 1.85, l: 4.8, r: .33, seat: [.4, .5, -.2],
      perf: { accel: 7, top: 30, grip: 8, steer: .5, brake: 13 },
      palette: ['#ffc81e'], accent: ['#1a1a1e'],
      parts: () => [...sedan(), B(.62, .22, .28, 0, 1.49, -.25, 'white'), B(1.87, .1, 2.4, 0, .72, -.1, 'accent')] },
    { id: 'police', name: 'Police Cruiser', w: 1.85, l: 4.8, r: .33, seat: [.4, .5, -.2], police: true,
      perf: { accel: 10.5, top: 38, grip: 9, steer: .52, brake: 15 },
      palette: ['#141820'], accent: ['#f5f5f0'], bar: [0xff2244, 0x2266ff],
      parts: () => [...sedan(), B(1.87, .42, 2.3, 0, .62, -.1, 'accent'), B(1.25, .08, .36, 0, 1.42, -.25, 'black')] },
    { id: 'ambulance', name: 'Ambulance', w: 2.0, l: 5.2, r: .36, seat: [.45, .9, 1.45], ems: true, barZ: 1.2, barY: 1.92,
      perf: { accel: 7, top: 30, grip: 7.5, steer: .47, brake: 12 },
      palette: ['#f5f5f0'], accent: ['#d42a2a'], bar: [0xff2244, 0xffffff],
      parts: () => [
        B(2.0, 1.6, 4.4, 0, 1.05, -.4, 'body'), B(2.0, .55, .8, 0, .55, 2.2, 'body'),
        P(1.95, .7, 1.95, .12, .95, -.28, 0, .82, 1.92, 'glass'),
        B(2.02, .28, 4.42, 0, .95, -.4, 'accent'), B(2.02, .08, 4.42, 0, 1.55, -.4, 'accent'),
        B(.03, .56, .16, 1.01, 1.3, -.9, '#d42a2a'), B(.03, .16, .56, 1.01, 1.3, -.9, '#d42a2a'),
        B(.03, .56, .16, -1.01, 1.3, -.9, '#d42a2a'), B(.03, .16, .56, -1.01, 1.3, -.9, '#d42a2a'),
        B(1.2, .1, .4, 0, 1.9, 1.2, 'black'),
        B(2.05, .16, .14, 0, .34, 2.62, 'chrome'), B(2.05, .16, .14, 0, .34, -2.62, 'black'), B(1.1, .22, .04, 0, .62, 2.61, 'grille'),
        ...lights(2.0, 5.2, .64, .72, .7)] },
    { id: 'maldiva', name: 'Maldiva', w: 1.85, l: 4.6, r: .33, seat: [.42, .62, -.2],
      perf: { accel: 8.5, top: 34, grip: 8.5, steer: .52, brake: 14 },
      palette: ['#f5f5f0', '#a9d8f5', '#ff9fc3', '#aee8d3', '#e8202a', '#ffd23d', '#1a1a1e'], accent: ['#e8dcc8', '#8a1f2a', '#f5f5f0', '#3a2e28'],
      parts: () => [
        B(1.85, .6, 4.6, 0, .5, 0, 'body'),
        B(1.62, .02, 2.1, 0, .81, -.45, 'interior'),
        B(.6, .38, .5, .42, .99, -.2, 'accent'), B(.6, .38, .5, -.42, .99, -.2, 'accent'),
        B(.6, .45, .12, .42, 1.1, -.46, 'accent'), B(.6, .45, .12, -.42, 1.1, -.46, 'accent'),
        B(1.4, .3, .5, 0, .95, -1.05, 'accent'),
        P(1.7, .12, 1.62, .06, .42, -.14, 0, .8, .75, 'glass'), B(1.64, .04, .06, 0, 1.22, .61, 'chrome'),
        B(.08, .2, .8, .88, .88, -1.9, 'body'), B(.08, .2, .8, -.88, .88, -1.9, 'body'),
        B(1.9, .16, .14, 0, .32, 2.32, 'chrome'), B(1.9, .16, .14, 0, .32, -2.32, 'chrome'), B(1.1, .22, .04, 0, .58, 2.31, 'grille'),
        B(1.87, .04, 4.4, 0, .64, 0, 'chrome'),
        ...lights(1.85, 4.6, .62, .64, .64)] },
    { id: 'hayride', name: 'Hayride', w: 1.95, l: 5.0, r: .4, seat: [.42, .78, .5],
      perf: { accel: 6.5, top: 27, grip: 7, steer: .48, brake: 12 },
      palette: ['#7a4a2a', '#2f4a2a', '#8a1f2a', '#e8e2d4', '#2a3f6b', '#c9a27a', '#1a1a1e'], accent: ['#e8e2d4', '#1a1a1e', '#c9a27a'],
      parts: () => [
        B(1.95, .7, 5.0, 0, .67, 0, 'body'), B(1.97, .18, 5.02, 0, .45, 0, 'accent'),
        P(1.86, 1.5, 1.76, 1.25, .6, -.08, 0, 1.02, .6, 'glass'), B(1.78, .05, 1.28, 0, 1.645, .54, 'body'),
        B(.08, .45, 2.2, .94, 1.245, -1.35, 'body'), B(.08, .45, 2.2, -.94, 1.245, -1.35, 'body'), B(1.95, .45, .08, 0, 1.245, -2.46, 'body'),
        B(1.78, .02, 2.2, 0, 1.03, -1.35, 'black'),
        B(2.0, .2, .16, 0, .42, 2.5, 'chrome'), B(2.0, .2, .16, 0, .42, -2.5, 'chrome'), B(1.5, .35, .04, 0, .86, 2.51, 'chrome'),
        ...lights(1.95, 5.0, .86, .86, .7)] },
    { id: 'beachcomber', name: 'Beachcomber', w: 1.95, l: 4.9, r: .34, seat: [.45, .9, 1.3],
      perf: { accel: 5.5, top: 24, grip: 6.5, steer: .45, brake: 11 },
      palette: ['#f5f5f0', '#e8d9b0', '#a9d8f5', '#7a2a2a', '#2a5a7a', '#ffcf5c'], accent: ['#ff4fa3', '#3fe6e0', '#ff8a3d', '#8a1f2a', '#2a3f6b'],
      parts: () => [
        B(1.95, 1.55, 4.3, 0, 1.025, -.3, 'body'), B(1.95, .55, .6, 0, .53, 2.15, 'body'),
        P(1.9, .6, 1.9, .12, .95, -.24, 0, .8, 1.88, 'glass'),
        B(1.97, .45, 2.6, 0, 1.45, -.4, 'glass'), B(1.97, .14, 4.32, 0, .95, -.3, 'accent'),
        B(2.0, .16, .14, 0, .33, 2.46, 'black'), B(2.0, .16, .14, 0, .33, -2.46, 'black'), B(1.1, .2, .04, 0, .6, 2.46, 'grille'),
        ...lights(1.95, 4.9, .62, .7, .66)] },
    { id: 'corsaro', name: 'Corsaro SS', w: 1.9, l: 4.7, r: .35, seat: [.4, .48, -.3],
      perf: { accel: 10, top: 37, grip: 7.2, steer: .5, brake: 14 },
      palette: ['#ff7a1a', '#1a1a1e', '#2a6fe8', '#2e8a4a', '#c81e2a', '#ffd23d', '#f5f5f0'], accent: ['#f5f5f0', '#1a1a1e'],
      parts: () => [
        B(1.9, .6, 4.7, 0, .54, 0, 'body'), B(.6, .12, .8, 0, .9, 1.2, 'black'),
        P(1.75, 2.2, 1.4, 1.15, .48, -.4, 0, .84, -.35, 'glass'), B(1.4, .04, 1.1, 0, 1.34, -.58, 'body'),
        B(.22, .02, 4.72, .2, .845, 0, 'accent'), B(.22, .02, 4.72, -.2, .845, 0, 'accent'),
        B(.22, .02, 1.1, .2, 1.365, -.58, 'accent'), B(.22, .02, 1.1, -.2, 1.365, -.58, 'accent'),
        B(1.7, .06, .22, 0, .9, -2.24, 'body'),
        B(1.95, .14, .12, 0, .32, 2.36, 'chrome'), B(1.95, .14, .12, 0, .32, -2.36, 'chrome'), B(1.3, .24, .04, 0, .6, 2.36, 'black'),
        ...lights(1.9, 4.7, .62, .66, .66)] },
    { id: 'piccolo', name: 'Piccolo', w: 1.7, l: 3.7, r: .3, seat: [.36, .48, -.1],
      perf: { accel: 7.5, top: 28, grip: 9, steer: .58, brake: 13 },
      palette: ['#ffd23d', '#ff4fa3', '#3fe6e0', '#e8202a', '#8cff6b', '#f5f5f0', '#ff8a3d', '#9b5cff'], accent: ['#1a1a1e'],
      parts: () => [
        B(1.7, .6, 3.7, 0, .48, 0, 'body'),
        P(1.6, 2.3, 1.45, 2.0, .55, -.12, 0, .78, -.35, 'glass'), B(1.46, .04, 1.98, 0, 1.35, -.47, 'body'),
        B(1.74, .14, .12, 0, .26, 1.86, 'accent'), B(1.74, .14, .12, 0, .26, -1.86, 'accent'),
        ...lights(1.7, 3.7, .56, .6, .56, .3)] },
    { id: 'outbacker', name: 'Outbacker', w: 1.85, l: 4.1, r: .42, seat: [.4, 1.0, -.2],
      perf: { accel: 7, top: 27, grip: 8, steer: .52, brake: 12 },
      palette: ['#4a5a2a', '#c9b08a', '#1a1a1e', '#c81e2a', '#f5f5f0', '#2a6fe8'], accent: ['#3a2e28', '#e8dcc8', '#1a1a1e'],
      parts: () => [
        B(1.85, .75, 4.1, 0, .75, 0, 'body'), B(1.8, .1, 1.3, 0, 1.17, 1.3, 'body'),
        P(1.75, .1, 1.75, .06, .55, -.1, 0, 1.12, .6, 'glass'),
        B(.08, .7, .08, .82, 1.47, -.6, 'black'), B(.08, .7, .08, -.82, 1.47, -.6, 'black'), B(1.72, .08, .08, 0, 1.82, -.6, 'black'),
        B(1.7, .02, 2.4, 0, 1.13, -.5, 'interior'),
        B(.6, .4, .5, .4, 1.3, -.2, 'accent'), B(.6, .4, .5, -.4, 1.3, -.2, 'accent'), B(1.4, .35, .5, 0, 1.28, -1.2, 'accent'),
        B(.7, .7, .22, 0, 1.0, -2.16, 'black'),
        B(.3, .12, .95, .95, 1.02, 1.35, 'black'), B(.3, .12, .95, -.95, 1.02, 1.35, 'black'), B(.3, .12, .95, .95, 1.02, -1.35, 'black'), B(.3, .12, .95, -.95, 1.02, -1.35, 'black'),
        B(1.9, .2, .16, 0, .45, 2.08, 'black'),
        ...lights(1.85, 4.1, .98, .98, .62, .3, .16)] },
    { id: 'royale', name: 'Royale Limo', w: 1.95, l: 7.0, r: .35, seat: [.42, .5, 1.4],
      perf: { accel: 6, top: 30, grip: 7.5, steer: .42, brake: 12 },
      palette: ['#f5f5f0', '#1a1a1e', '#e8c0d0'], accent: ['chrome'],
      parts: () => [
        B(1.95, .62, 7.0, 0, .52, 0, 'body'),
        P(1.85, 4.6, 1.6, 4.2, .52, -.1, 0, .83, -.4, 'glass'), B(1.62, .04, 4.2, 0, 1.37, -.5, 'body'),
        B(1.97, .05, 6.8, 0, .6, 0, 'accent'),
        B(2.0, .16, .14, 0, .33, 3.52, 'chrome'), B(2.0, .16, .14, 0, .33, -3.52, 'chrome'), B(1.2, .26, .04, 0, .6, 3.51, 'chrome'),
        ...lights(1.95, 7.0, .64, .66, .7)] }
  ];
  // Boats: an offshore racer straight out of an 80s cop show, and a jet ski. No wheels; they float.
  const bowSteps = (w, z0, n, h, key, y0 = .1) => Array.from({ length: n }, (_, k) => { const f = (k + 1) / (n + .6); return B(w * (1 - f), h - k * .06, .6, 0, y0 + (h - k * .06) / 2 + k * .08, z0 + k * .6 + .3, key); });
  MODELS.push(
    { id: 'speedboat', name: 'Vice Cigarette', boat: true, draft: .42, w: 2.3, l: 9, r: .3, seat: [.45, .82, -1.4],
      perf: { accel: 9.5, top: 34, grip: 1.3, steer: .42, brake: 6 },
      palette: ['#f5f5f0', '#141418', '#ff4fa3'], accent: ['#ff4fa3', '#3fe6e0', '#ffd23d', '#8a1f2a'],
      parts: () => [
        B(2.3, .7, 6.2, 0, .45, -1.0, 'body'), ...bowSteps(2.3, 2.1, 4, .7, 'body'),
        B(2.32, .1, 6.2, 0, .6, -1.0, 'accent'), B(2.32, .05, 6.2, 0, .25, -1.0, 'black'),
        B(1.8, .06, 2.4, 0, .82, -1.7, 'interior'), B(1.6, .3, .55, 0, .95, -2.5, 'seat'), B(1.6, .3, .55, 0, .95, -1.2, 'seat'),
        P(1.9, .14, 1.5, .08, .42, -.12, 0, .8, -.2, 'glass'), B(1.9, .05, .16, 0, .82, -.2, 'chrome'),
        B(1.7, .16, 1.5, 0, .88, -3.4, 'body'), B(.14, .14, .5, .5, .5, -4.2, 'chrome'), B(.14, .14, .5, -.5, .5, -4.2, 'chrome'),
        B(.12, .07, .05, .8, .88, 1.9, '#fff6d8'), B(.12, .07, .05, -.8, .88, 1.9, '#fff6d8'), B(.3, .08, .05, 0, .88, -4.12, '#ff2a3a')] },
    { id: 'jetski', name: 'Wave Rider', boat: true, draft: .22, w: 1.1, l: 3, r: .2, seat: [0, .5, -.35],
      perf: { accel: 12, top: 25, grip: 1.8, steer: .72, brake: 8 },
      palette: ['#ffd23d', '#ff4fa3', '#3fe6e0', '#f5f5f0', '#8cff6b'], accent: ['#141418', '#f5f5f0'],
      parts: () => [
        B(1.05, .42, 2.2, 0, .25, -.3, 'body'), ...bowSteps(1.05, .8, 2, .42, 'body'),
        B(1.07, .06, 2.2, 0, .4, -.3, 'accent'), B(.42, .18, 1.1, 0, .55, -.55, 'seat'),
        B(.1, .42, .1, 0, .68, .45, 'black'), B(.72, .05, .06, 0, .9, .5, 'black'),
        B(.14, .06, .05, 0, .5, 1.75, '#fff6d8'), B(.2, .06, .05, 0, .45, -1.42, '#ff2a3a')] }
  );
  // Boats out at sea (not in the marina): a sailing yacht, a motor cruiser and the coast guard's launch
  MODELS.push(
    { id: 'sailboat', name: 'Sea Breeze', boat: true, draft: .5, w: 2.4, l: 7.5, r: .3, seat: [.4, .9, -2.4],
      perf: { accel: 4, top: 9, grip: 1.2, steer: .35, brake: 3 },
      palette: ['#f5f5f0', '#1c2a4a', '#8a1f2a'], accent: ['#f5f5f0', '#ff4fa3', '#3fe6e0', '#ffd23d'],
      parts: () => [
        B(2.4, .8, 5.6, 0, .4, -.8, 'body'), ...bowSteps(2.4, 1.9, 4, .8, 'body'),
        B(2.2, .06, 6.2, 0, .82, -.4, 'seat'), B(1.4, .6, 2, 0, 1.1, -.9, 'body'), B(1.42, .2, 1.6, 0, 1.2, -.9, 'glass'),
        B(.14, 9, .14, 0, 5.3, .6, 'chrome'), B(.1, .1, 3.2, 0, 1.6, -1, 'chrome'),
        P(.04, 3.2, .04, .2, 7.2, 1.4, 0, 1.7, -.9, 'accent'), P(.04, 2.2, .04, .15, 6.8, -1.1, 0, 1.0, 2.1, 'white'),
        B(.12, .07, .05, .6, .88, 2.9, '#fff6d8'), B(.12, .07, .05, -.6, .88, 2.9, '#fff6d8'), B(.3, .08, .05, 0, .7, -3.62, '#ff2a3a')] },
    { id: 'cruiser', name: 'Ocean Queen', boat: true, draft: .7, w: 3.2, l: 11, r: .3, seat: [.6, 2.35, -1.3],
      perf: { accel: 5, top: 16, grip: 1.1, steer: .3, brake: 4 },
      palette: ['#f5f5f0', '#e8e2d4'], accent: ['#1c2a4a', '#8a1f2a', '#3fe6e0', '#ff4fa3'],
      parts: () => [
        B(3.2, 1.2, 8, 0, .6, -1.4, 'body'), ...bowSteps(3.2, 2.6, 5, 1.2, 'body'), B(3.22, .18, 8, 0, .95, -1.4, 'accent'),
        B(2.6, 1.1, 4.8, 0, 1.75, -1.3, 'body'), B(2.62, .38, 4.2, 0, 1.85, -1.3, 'glass'),
        B(2.2, .5, 2.4, 0, 2.55, -1.8, 'body'), B(2.0, .06, 1.8, 0, 2.82, -1.8, 'seat'), B(.1, 1.3, .1, 0, 3.4, -1.1, 'chrome'), B(.8, .08, .08, 0, 3.95, -1.1, 'chrome'),
        B(3.0, .06, 2.4, 0, 1.22, -4.6, 'seat'),
        B(.14, .08, .05, .9, 1.1, 4.3, '#fff6d8'), B(.14, .08, .05, -.9, 1.1, 4.3, '#fff6d8'), B(.3, .08, .05, 0, 1.1, -5.42, '#ff2a3a')] },
    { id: 'policeboat', name: 'Coast Guard', boat: true, police: true, draft: .45, w: 2.4, l: 8.5, r: .3, seat: [.45, 1.0, -.8], barY: 1.95, barZ: -.6,
      perf: { accel: 10, top: 33, grip: 1.4, steer: .45, brake: 6 },
      palette: ['#1c2a4a'], accent: ['#f5f5f0'], bar: [0xff2244, 0x2266ff],
      parts: () => [
        B(2.4, .75, 5.8, 0, .45, -1.2, 'body'), ...bowSteps(2.4, 1.7, 4, .75, 'body'), B(2.42, .22, 5.8, 0, .7, -1.2, 'accent'),
        B(1.8, .9, 2.2, 0, 1.25, -.6, 'accent'), B(1.82, .4, 1.8, 0, 1.4, -.6, 'glass'), B(1.9, .06, 2.4, 0, 1.72, -.6, 'body'),
        B(.12, .07, .05, .8, .9, 2.6, '#fff6d8'), B(.12, .07, .05, -.8, .9, 2.6, '#fff6d8'), B(.3, .08, .05, 0, .7, -4.12, '#ff2a3a')] }
  );
  // The fire engine: a red cab and body with lockers, a white band and a ladder on the roof. Never in traffic.
  MODELS.push({ id: 'firetruck', name: 'Fire Engine', fire: true, w: 2.3, l: 7.4, r: .45, seat: [.5, 1.1, 2.55], barZ: 2.6, barY: 2.42,
    perf: { accel: 6, top: 27, grip: 7, steer: .42, brake: 11 },
    palette: ['#c81e1e'], accent: ['#f5f5f0'], bar: [0xff2244, 0xffffff],
    parts: () => {
      const out = [
        B(2.1, .45, 7.2, 0, .6, 0, 'black'),
        B(2.3, 1.75, 2.0, 0, 1.45, 2.6, 'body'), B(2.12, .75, .06, 0, 1.8, 3.62, 'glass'), B(2.32, .55, 1.3, 0, 1.85, 2.7, 'glass'),
        B(2.3, 1.95, 5.1, 0, 1.55, -1.05, 'body'), B(2.33, .2, 7.3, 0, 1.0, -.05, 'accent'),
        B(2.3, .3, .2, 0, .55, 3.7, 'chrome'), B(2.3, .3, .2, 0, .55, -3.7, 'black'), B(1.3, .35, .04, 0, 1.05, 3.62, 'grille')];
      for (let z = -3; z < 1.2; z += 1.4) for (const x of [1.16, -1.16]) out.push(B(.03, .85, 1.2, x, 1.75, z, 'chrome'));
      for (const x of [.45, -.45]) out.push(B(.08, .08, 6.2, x, 2.62, -.8, 'chrome'));
      for (let z = -3.7; z < 2.2; z += .5) out.push(B(.9, .05, .05, 0, 2.62, z, 'chrome'));
      out.push(B(.3, .3, .3, 0, 2.7, -3.9, 'chrome'), ...lights(2.3, 7.4, .95, 1.05, .82));
      return out;
    } });
  // Two expensive ones: a boxy German off-roader and a long, low four-door sports saloon
  MODELS.push(
    { id: 'gwagon', name: 'Gelendwagen', w: 2.0, l: 4.8, r: .42, seat: [.42, .78, -.25],
      perf: { accel: 8.5, top: 36, grip: 8.5, steer: .48, brake: 14 },
      palette: ['#141418', '#f5f5f0', '#5a6a4a', '#8a8f98', '#1c2a4a', '#6a1e2a'], accent: ['#141418'],
      parts: () => [
        B(1.98, .8, 4.62, 0, .74, 0, 'body'),
        B(1.9, .78, 2.95, 0, 1.52, -.4, 'body'), B(1.93, .44, 2.75, 0, 1.55, -.4, 'glass'), B(1.72, .5, .05, 0, 1.55, 1.08, 'glass'),
        B(1.92, .06, 3.0, 0, 1.93, -.4, 'body'), B(1.4, .05, .7, 0, 1.97, -1.2, 'black'),
        B(1.9, .05, 1.35, 0, 1.15, 1.6, 'body'),
        B(1.2, .38, .04, 0, .86, 2.32, 'grille'), B(1.2, .04, .05, 0, .98, 2.34, 'chrome'), B(1.2, .04, .05, 0, .82, 2.34, 'chrome'),
        B(.27, .27, .05, .72, .92, 2.33, '#fff6d8'), B(.27, .27, .05, -.72, .92, 2.33, '#fff6d8'),
        B(.18, .08, .16, .86, 1.2, 2.05, '#ffb52e'), B(.18, .08, .16, -.86, 1.2, 2.05, '#ffb52e'),
        B(.15, .42, .05, .88, .98, -2.33, '#ff2a3a'), B(.15, .42, .05, -.88, .98, -2.33, '#ff2a3a'),
        B(2.02, .24, .22, 0, .44, 2.38, 'black'), B(2.02, .24, .22, 0, .44, -2.38, 'black'),
        B(.8, .8, .26, 0, 1.05, -2.47, 'black'), B(.4, .4, .28, 0, 1.05, -2.47, 'chrome'),
        B(.12, .08, 2.5, 1.04, .44, 0, 'black'), B(.12, .08, 2.5, -1.04, .44, 0, 'black'),
        B(.1, .24, 1.1, 1.0, .64, 1.55, 'black'), B(.1, .24, 1.1, -1.0, .64, 1.55, 'black'), B(.1, .24, 1.1, 1.0, .64, -1.55, 'black'), B(.1, .24, 1.1, -1.0, .64, -1.55, 'black'),
        B(.1, .16, .24, 1.03, 1.45, .9, 'black'), B(.1, .16, .24, -1.03, 1.45, .9, 'black')] },
    { id: 'panamo', name: 'Porta Panamo', w: 1.96, l: 5.0, r: .36, seat: [.4, .2, -.35],
      perf: { accel: 12.5, top: 45, grip: 9.5, steer: .54, brake: 17 },
      palette: ['#1a1a1e', '#f5f5f0', '#8a8f98', '#2a6fe8', '#8a1f2a', '#3b5a3a', '#c9a227'], accent: ['#141418'],
      parts: () => [
        P(1.96, 5.0, 1.9, 4.8, .5, 0, 0, .22, 0, 'body'),
        P(1.86, 1.7, 1.76, 1.5, .1, -.1, 0, .72, 1.6, 'body'),
        P(1.78, 3.0, 1.28, 1.2, .55, -.4, 0, .72, -.45, 'glass'), B(1.26, .04, 1.2, 0, 1.285, -.85, 'body'),
        P(1.86, 1.5, 1.6, 1.0, .12, -.15, 0, .72, -1.85, 'body'), B(1.5, .04, .32, 0, .9, -2.3, 'accent'),
        B(1.7, .07, .05, 0, .66, -2.51, '#ff2a3a'), B(.42, .1, .05, .62, .6, 2.51, '#fff6d8'), B(.42, .1, .05, -.62, .6, 2.51, '#fff6d8'),
        B(1.4, .2, .04, 0, .38, 2.5, 'black'), B(.5, .15, .04, .72, .33, 2.49, 'black'), B(.5, .15, .04, -.72, .33, 2.49, 'black'),
        B(.06, .12, 3.2, .99, .3, 0, 'black'), B(.06, .12, 3.2, -.99, .3, 0, 'black'),
        B(.5, .12, .04, .45, .3, -2.5, 'chrome'), B(.5, .12, .04, -.45, .3, -2.5, 'chrome'),
        B(.1, .12, .22, 1.0, .95, .75, 'body'), B(.1, .12, .22, -1.0, .95, .75, 'body')] }
  );
  // Motorbikes: a sports bike, a long chopper and a little scooter. Two wheels in line; they lean into turns (vehicles.js).
  const R = (w, h, d, x, y, z, key, rx) => B(w, h, d, x, y, z, key, rx || 0);
  MODELS.push(
    { id: 'vento', name: 'Vento RS', bike: true, w: .8, l: 2.1, r: .32, wz: .72, seat: [0, .82, -.28], lean: .45,
      perf: { accel: 14, top: 46, grip: 9, steer: .62, brake: 18 },
      palette: ['#e8202a', '#2a6fe8', '#ffd23d', '#f5f5f0', '#141418', '#8cff6b'], accent: ['#f5f5f0', '#141418'],
      parts: () => [
        R(.34, .34, .6, 0, .46, .02, 'black'), R(.38, .24, .56, 0, .84, .2, 'body'), R(.4, .06, .5, 0, .72, .2, 'accent'),
        P(.44, .46, .3, .26, .46, .06, 0, .6, .62, 'body'), R(.3, .22, .04, 0, 1.14, .78, 'glass', -.55),
        R(.3, .1, .56, 0, .8, -.3, 'black'), P(.32, .5, .12, .3, .2, -.12, 0, .74, -.66, 'body'),
        R(.06, .62, .06, .12, .56, .66, 'chrome', .35), R(.06, .62, .06, -.12, .56, .66, 'chrome', .35),
        R(.06, .08, .72, .14, .36, -.4, 'chrome'), R(.06, .08, .72, -.14, .36, -.4, 'chrome'),
        R(.62, .04, .04, 0, 1.02, .52, 'black'), R(.11, .11, .62, .22, .42, -.46, 'chrome'),
        R(.2, .12, .05, 0, .86, .9, '#fff6d8'), R(.16, .06, .05, 0, .86, -.93, '#ff2a3a')] },
    { id: 'hog', name: 'Freeway Hog', bike: true, w: .9, l: 2.5, r: .34, wz: .92, seat: [0, .66, -.36], lean: .1,
      perf: { accel: 9.5, top: 37, grip: 8.5, steer: .5, brake: 14 },
      palette: ['#141418', '#8a1f2a', '#2a3f6b', '#5a2a4a', '#c9a227'], accent: ['chrome'],
      parts: () => [
        R(.08, .08, 1.5, 0, .55, 0, 'chrome'), R(.34, .38, .46, 0, .46, -.04, 'chrome'), R(.2, .2, .2, 0, .72, -.04, 'black'),
        R(.32, .2, .48, 0, .86, .26, 'body'), R(.34, .08, .5, 0, .64, -.38, 'black'), R(.3, .06, .3, 0, .7, -.62, 'black'),
        R(.04, .5, .04, 0, .94, -.66, 'chrome'), R(.24, .08, .56, 0, .72, -.92, 'body'), R(.2, .08, .4, 0, .72, .98, 'body'),
        R(.05, 1.0, .05, .1, .8, .78, 'chrome', .55), R(.05, 1.0, .05, -.1, .8, .78, 'chrome', .55),
        R(.04, .34, .04, .3, 1.24, .5, 'chrome'), R(.04, .34, .04, -.3, 1.24, .5, 'chrome'), R(.72, .05, .05, 0, 1.41, .5, 'chrome'),
        R(.08, .08, 1.1, .22, .34, -.42, 'chrome'), R(.08, .08, 1.1, -.22, .34, -.42, 'chrome'),
        R(.22, .22, .08, 0, 1.02, 1.08, '#fff6d8'), R(.14, .06, .05, 0, .8, -1.22, '#ff2a3a')] },
    { id: 'vespino', name: 'Vespino', bike: true, w: .7, l: 1.7, r: .22, wz: .6, seat: [0, .74, -.3], lean: 0,
      perf: { accel: 7, top: 22, grip: 8, steer: .62, brake: 12 },
      palette: ['#3fe6e0', '#ff4fa3', '#f5f5f0', '#ffd23d', '#8cff6b', '#e8202a'], accent: ['#f5f5f0'],
      parts: () => [
        R(.4, .08, .64, 0, .3, .02, 'body'), R(.46, .74, .1, 0, .66, .42, 'body', -.2), R(.44, .38, .64, 0, .54, -.36, 'body'),
        R(.46, .06, .66, 0, .72, -.36, 'accent'), R(.32, .1, .56, 0, .8, -.32, 'black'),
        R(.06, .52, .06, 0, .96, .5, 'chrome', -.2), R(.56, .05, .05, 0, 1.2, .45, 'black'), R(.2, .1, .14, 0, 1.2, .5, 'body'),
        R(.24, .08, .36, 0, .5, .62, 'body'),
        R(.14, .1, .05, 0, 1.14, .58, '#fff6d8'), R(.12, .06, .05, 0, .62, -.69, '#ff2a3a')] }
  );
  // A light helicopter. The main and tail rotors are separate meshes added in vehicles.js so they can spin.
  MODELS.push({ id: 'heli', name: 'Neon Hawk', heli: true, w: 1.8, l: 7, r: .3, seat: [.35, .95, .9],
    perf: { accel: 7, top: 30, grip: 1, steer: 1.4, brake: 6 },
    palette: ['#f5f5f0', '#141418', '#2a6fe8', '#ff4fa3'], accent: ['#ff4fa3', '#3fe6e0', '#ffd23d'],
    parts: () => [
      B(1.6, 1.3, 3.0, 0, 1.25, .1, 'body'), B(1.62, .16, 3.0, 0, 1.0, .1, 'accent'),
      P(1.55, 1.3, 1.1, .5, 1.0, .35, 0, .6, 1.95, 'glass'), B(1.3, .5, .9, 0, .85, 2.0, 'body'),
      B(1.05, .45, 1.7, 0, 2.1, -.25, 'body'), B(.14, .4, .14, 0, 2.5, 0, 'black'),
      B(.36, .36, 4.2, 0, 1.55, -3.5, 'body'), B(.38, .08, 4.2, 0, 1.45, -3.5, 'accent'),
      B(.08, 1.1, .75, 0, 2.05, -5.35, 'accent'), B(1.2, .06, .4, 0, 1.6, -5.2, 'body'),
      B(.08, .08, 3.2, .78, .08, .1, 'chrome'), B(.08, .08, 3.2, -.78, .08, .1, 'chrome'),
      B(.06, .55, .06, .72, .38, .9, 'chrome'), B(.06, .55, .06, -.72, .38, .9, 'chrome'), B(.06, .55, .06, .72, .38, -.8, 'chrome'), B(.06, .55, .06, -.72, .38, -.8, 'chrome'),
      B(.5, .3, .05, 0, 1.55, 1.62, 'interior'),
      B(.14, .1, .05, .5, .75, 2.46, '#fff6d8'), B(.14, .1, .05, -.5, .75, 2.46, '#fff6d8'), B(.12, .12, .12, 0, 2.62, -5.72, '#ff2a3a')] });
  function sedan() {
    return [
      B(1.85, .62, 4.8, 0, .51, 0, 'body'),
      P(1.75, 2.3, 1.5, 1.7, .52, -.05, 0, .82, -.2, 'glass'), B(1.52, .04, 1.72, 0, 1.36, -.25, 'body'),
      B(1.9, .16, .14, 0, .33, 2.42, 'chrome'), B(1.9, .16, .14, 0, .33, -2.42, 'chrome'), B(1.2, .25, .04, 0, .6, 2.41, 'grille'),
      B(1.87, .05, 4.6, 0, .6, 0, 'accent'),
      ...lights(1.85, 4.8, .62, .66, .68)];
  }

  const hex = new THREE.Color();
  function build(model) {
    const pos = [], nor = [], col = [], ranges = { body: [], accent: [] };
    for (const [geo, mat, key] of model.parts()) {
      const g = geo.index ? geo.toNonIndexed() : geo; g.applyMatrix4(mat);
      const p = g.attributes.position.array, n = g.attributes.normal.array, start = pos.length / 3;
      hex.set(key === 'body' || key === 'accent' ? '#ffffff' : (FIXED[key] || key));
      for (let i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n[i], n[i + 1], n[i + 2]); col.push(hex.r, hex.g, hex.b); }
      if (ranges[key]) ranges[key].push([start, pos.length / 3]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    model.geo = g; model.ranges = ranges;
    if (model.boat || model.heli) { model.wheels = []; model.wheelbase = model.l * .55; return; }
    // wheel: tyre plus hub cap, axis along x
    const tw = model.bike ? .12 : .26;
    const tyre = new THREE.CylinderGeometry(model.r, model.r, tw, 14).rotateZ(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(model.r * .55, model.r * .55, tw + .02, 10).rotateZ(Math.PI / 2);
    model.wheelGeo = NB.mergeParts([[tyre, M4(), new THREE.Color(FIXED.tyre)], [hub, M4(), new THREE.Color(FIXED.hub)]]);
    const wz = model.l / 2 - (model.l > 6 ? 1.2 : .85);
    model.wheels = [[model.w / 2 - .14, wz, true], [-model.w / 2 + .14, wz, true], [model.w / 2 - .14, -wz, false], [-model.w / 2 + .14, -wz, false]];
    model.wheelbase = wz * 2;
    if (model.bike) { model.wheels = [[0, model.wz, true], [0, -model.wz, false]]; model.wheelbase = model.wz * 2; }
  }
  MODELS.forEach(build);

  // The seated driver: torso and head, shared by every car.
  const driverGeo = NB.mergeParts([
    [new THREE.BoxGeometry(.4, .5, .24), M4().makeTranslation(0, .25, 0), new THREE.Color(FIXED.shirt)],
    [new THREE.BoxGeometry(.22, .25, .23), M4().makeTranslation(0, .66, 0), new THREE.Color(FIXED.skin)],
    [new THREE.BoxGeometry(.235, .07, .245), M4().makeTranslation(0, .79, 0), new THREE.Color('#2a1c14')]]);

  // Someone riding a motorbike: leaning forward, knees on the tank, feet on the pegs, hands on the bars
  const riderGeo = NB.mergeParts([
    [new THREE.BoxGeometry(.4, .5, .24), M4().makeRotationX(.32).setPosition(0, .24, .08), new THREE.Color(FIXED.shirt)],
    [new THREE.BoxGeometry(.22, .25, .23), M4().makeTranslation(0, .64, .24), new THREE.Color(FIXED.skin)],
    [new THREE.BoxGeometry(.235, .07, .245), M4().makeTranslation(0, .77, .24), new THREE.Color('#2a1c14')],
    [new THREE.BoxGeometry(.15, .15, .5), M4().makeTranslation(.13, .02, .2), new THREE.Color('#2a2a3a')],
    [new THREE.BoxGeometry(.15, .15, .5), M4().makeTranslation(-.13, .02, .2), new THREE.Color('#2a2a3a')],
    [new THREE.BoxGeometry(.13, .42, .14), M4().makeTranslation(.15, -.2, .42), new THREE.Color('#2a2a3a')],
    [new THREE.BoxGeometry(.13, .42, .14), M4().makeTranslation(-.15, -.2, .42), new THREE.Color('#2a2a3a')],
    [new THREE.BoxGeometry(.1, .1, .5), M4().makeRotationX(.35).setPosition(.25, .38, .4), new THREE.Color(FIXED.shirt)],
    [new THREE.BoxGeometry(.1, .1, .5), M4().makeRotationX(.35).setPosition(-.25, .38, .4), new THREE.Color(FIXED.shirt)]]);
  NB.riderGeo = riderGeo;
  NB.CAR_MODELS = MODELS;
  NB.CAR_FIXED = FIXED;
  NB.driverGeo = driverGeo;
  // Traffic mix: common cars often, exotic ones rarely.
  NB.CAR_WEIGHTS = { zefiro: .06, meridian: .16, cab: .1, maldiva: .1, hayride: .1, beachcomber: .1, corsaro: .1, piccolo: .12, outbacker: .06, royale: .02, gwagon: .04, panamo: .04, vento: .04, hog: .03, vespino: .05 };
})(window.NB);
