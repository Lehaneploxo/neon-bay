// Keyboard + mouse on desktop, virtual joystick + swipe-to-look + buttons on touch screens.
// Switches automatically: touching the screen shows touch controls, pressing a key hides them.
(function (NB) {
  'use strict';
  const $ = id => document.getElementById(id);

  NB.createInput = function (canvas, hooks) {
    const I = { move: { x: 0, y: 0 }, sprint: false, jump: false, touch: false, action: false, throttle: 0, handbrake: false, horn: false, fire: false, aim: false, cycle: 0, select: -1 };
    const hold = { gas: false, brake: false, hand: false, horn: false, fire: false };
    const keys = {};
    let mouseDX = 0, mouseDY = 0, touchDX = 0, touchDY = 0;
    let stick = null, lookPtr = null, dragPtr = null, runOn = false, mouseFire = false, mouseAim = false;
    const base = $('stick'), knob = $('stickKnob'), btnRun = $('btnRun');
    const STICK_R = 56;

    function setTouch(on) {
      if (I.touch === on) return;
      I.touch = on; document.body.classList.toggle('touch', on);
      if (hooks.onMode) hooks.onMode(on);
    }
    function setRun(on) { runOn = on; btnRun.classList.toggle('on', on); }

    const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'KeyF', 'KeyH', 'KeyE', 'KeyQ', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'KeyM', 'Tab', 'KeyR', 'KeyG'];
    addEventListener('keydown', e => {
      if (!hooks.active()) return;
      if (GAME_KEYS.includes(e.code)) { e.preventDefault(); setTouch(false); }
      keys[e.code] = true;
      if (e.code === 'Space' && !e.repeat) I.jump = true;
      if ((e.code === 'KeyF' || e.code === 'KeyE') && !e.repeat) I.action = true;
      if (e.code === 'KeyQ' && !e.repeat) I.cycle = 1;
      if (e.code === 'KeyM' && !e.repeat && hooks.onMute) hooks.onMute();
      if (e.code === 'KeyR' && !e.repeat && hooks.onRadio) hooks.onRadio();
      if (e.code === 'KeyG' && !e.repeat && hooks.onSiren) hooks.onSiren();
      if (e.code === 'Tab' && !e.repeat && hooks.onMap) hooks.onMap();
      if (/^Digit[1-6]$/.test(e.code)) I.select = +e.code.slice(5) - 1;
      if (e.code === 'Escape' && hooks.onEscape) hooks.onEscape();
    });
    addEventListener('keyup', e => { keys[e.code] = false; });
    addEventListener('blur', () => { for (const k in keys) keys[k] = false; releaseAll(); });

    document.addEventListener('mousemove', e => {
      if (!hooks.active() || !hooks.locked()) return;
      mouseDX += Math.max(-300, Math.min(300, e.movementX || 0));
      mouseDY += Math.max(-300, Math.min(300, e.movementY || 0));
    });
    // mouse buttons: left fires, right aims over the shoulder
    canvas.addEventListener('mousedown', e => {
      if (!hooks.active() || !hooks.locked()) return;
      if (e.button === 0) mouseFire = true;
      if (e.button === 2) mouseAim = true;
    });
    addEventListener('mouseup', e => { if (e.button === 0) mouseFire = false; if (e.button === 2) mouseAim = false; });
    canvas.addEventListener('wheel', e => { if (hooks.active() && hooks.onZoom) { e.preventDefault(); hooks.onZoom(Math.sign(e.deltaY)); } }, { passive: false });

    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') {
        setTouch(true);
        if (!hooks.active()) return;
        e.preventDefault();
        if (!stick && e.clientX < innerWidth * .45) {
          stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
          base.style.transform = `translate(${e.clientX - 60}px, ${e.clientY - 60}px)`;
          knob.style.transform = 'translate(0px, 0px)';
          base.classList.add('on');
        } else if (!lookPtr) lookPtr = { id: e.pointerId, x: e.clientX, y: e.clientY };
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      } else {
        setTouch(false);
        if (!hooks.active()) return;
        if (!hooks.locked()) { hooks.requestLock(); dragPtr = { id: e.pointerId, x: e.clientX, y: e.clientY }; }
      }
    });
    canvas.addEventListener('pointermove', e => {
      if (stick && e.pointerId === stick.id) {
        let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy; const d = Math.hypot(dx, dy);
        if (d > STICK_R) { dx = dx / d * STICK_R; dy = dy / d * STICK_R; }
        stick.x = dx / STICK_R; stick.y = -dy / STICK_R;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (lookPtr && e.pointerId === lookPtr.id) {
        touchDX += e.clientX - lookPtr.x; touchDY += e.clientY - lookPtr.y; lookPtr.x = e.clientX; lookPtr.y = e.clientY;
      } else if (dragPtr && e.pointerId === dragPtr.id && !hooks.locked()) {
        mouseDX += e.clientX - dragPtr.x; mouseDY += e.clientY - dragPtr.y; dragPtr.x = e.clientX; dragPtr.y = e.clientY;
      }
    });
    const up = e => {
      if (stick && e.pointerId === stick.id) { stick = null; base.classList.remove('on'); setRun(false); }
      if (lookPtr && e.pointerId === lookPtr.id) lookPtr = null;
      if (dragPtr && e.pointerId === dragPtr.id) dragPtr = null;
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('lostpointercapture', up);
    // a finger lifted anywhere on the page (over a button, the map, the edge of the screen) still lets go of the stick
    addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
    // and once no finger at all is on the screen, nothing can still be held: the stick, the look, the driving buttons
    const noFingers = e => { if (e.touches && e.touches.length === 0) { if (stick) setRun(false); stick = null; lookPtr = null; base.classList.remove('on'); for (const k in hold) hold[k] = false; document.querySelectorAll('.tbtn.on').forEach(b => { if (b !== btnRun) b.classList.remove('on'); }); } };
    addEventListener('touchend', noFingers, true); addEventListener('touchcancel', noFingers, true);
    function releaseAll() { stick = null; lookPtr = null; dragPtr = null; base.classList.remove('on'); setRun(false); for (const k in hold) hold[k] = false; mouseFire = mouseAim = false; }

    const btn = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); setTouch(true); fn(); });
    btn('btnJump', () => { I.jump = true; });
    btn('btnRun', () => setRun(!runOn));
    btn('btnEnter', () => { I.action = true; });
    btn('btnWeapon', () => { I.cycle = 1; });
    btn('btnSiren', () => { if (hooks.onSiren) hooks.onSiren(); });
    // hold-to-use buttons for driving
    for (const [id, k] of [['btnGas', 'gas'], ['btnBrake', 'brake'], ['btnHand', 'hand'], ['btnHorn', 'horn'], ['btnFire', 'fire'], ['btnCannon', 'fire']]) {
      const el = $(id);
      el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); setTouch(true); hold[k] = true; el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch (err) {} });
      const off = () => { hold[k] = false; el.classList.remove('on'); };
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
    }

    I.poll = function () {
      let x = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
      let y = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
      if (stick) { x = stick.x; y = stick.y; }
      else { const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } }
      I.move.x = x; I.move.y = y;
      I.sprint = !!(keys.ShiftLeft || keys.ShiftRight || runOn);
      I.throttle = hold.gas ? 1 : hold.brake ? -1 : (stick ? 0 : y);
      I.handbrake = !!(keys.Space || hold.hand);
      I.horn = !!(keys.KeyH || hold.horn);
      I.fire = mouseFire || hold.fire;
      I.aim = mouseAim;
    };
    // Look deltas in radians since the last call.
    I.takeLook = function (sens) {
      const dx = mouseDX * .0024 * sens + touchDX * .0065 * sens, dy = mouseDY * .0024 * sens + touchDY * .0065 * sens;
      mouseDX = mouseDY = touchDX = touchDY = 0;
      return [dx, dy];
    };
    I.reset = function () { for (const k in keys) keys[k] = false; releaseAll(); I.jump = false; I.action = false; mouseDX = mouseDY = touchDX = touchDY = 0; };
    I.setTouch = setTouch;
    return I;
  };
})(window.NB);
