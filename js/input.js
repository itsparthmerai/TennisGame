// Low-level pointer/touch tracking shared by menus and gameplay. Emits
// down/move/up with logical canvas coordinates + a classified gesture
// (tap vs swipe, with direction/speed) on release.
(function (global) {
  'use strict';

  const TAP_MAX_DIST = 14; // px
  const TAP_MAX_DURATION = 320; // ms
  const SWIPE_MIN_SPEED = 0.35; // px/ms measured over the recent window
  const SAMPLE_WINDOW_MS = 130;

  class InputTracker {
    constructor() {
      this.canvas = null;
      this.getLogicalSize = () => ({ width: 960, height: 540 });
      this.handlers = { onDown: null, onMove: null, onUp: null };
      this.activePointerId = null;
      this.samples = [];
      this.startX = 0; this.startY = 0; this.startT = 0;
      this.lastX = 0; this.lastY = 0;

      this._onDown = this._onDown.bind(this);
      this._onMove = this._onMove.bind(this);
      this._onUp = this._onUp.bind(this);
    }

    setCanvas(canvas, getLogicalSize) {
      if (this.canvas) this._detach();
      this.canvas = canvas;
      if (getLogicalSize) this.getLogicalSize = getLogicalSize;
      this._attach();
    }

    on(handlers) {
      Object.assign(this.handlers, handlers);
    }

    _attach() {
      const c = this.canvas;
      c.addEventListener('pointerdown', this._onDown, { passive: false });
      c.addEventListener('pointermove', this._onMove, { passive: false });
      c.addEventListener('pointerup', this._onUp, { passive: false });
      c.addEventListener('pointercancel', this._onUp, { passive: false });
      c.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _detach() {
      const c = this.canvas;
      c.removeEventListener('pointerdown', this._onDown);
      c.removeEventListener('pointermove', this._onMove);
      c.removeEventListener('pointerup', this._onUp);
      c.removeEventListener('pointercancel', this._onUp);
    }

    _toLogical(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const { width, height } = this.getLogicalSize();
      const x = ((clientX - rect.left) / rect.width) * width;
      const y = ((clientY - rect.top) / rect.height) * height;
      return { x, y };
    }

    _onDown(e) {
      if (this.activePointerId !== null) return; // single-touch gameplay
      e.preventDefault();
      this.activePointerId = e.pointerId;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      const p = this._toLogical(e.clientX, e.clientY);
      const t = performance.now();
      this.startX = p.x; this.startY = p.y; this.startT = t;
      this.lastX = p.x; this.lastY = p.y;
      this.samples = [{ x: p.x, y: p.y, t }];
      if (this.handlers.onDown) this.handlers.onDown({ x: p.x, y: p.y });
    }

    _onMove(e) {
      if (e.pointerId !== this.activePointerId) return;
      e.preventDefault();
      const p = this._toLogical(e.clientX, e.clientY);
      const t = performance.now();
      const dx = p.x - this.lastX, dy = p.y - this.lastY;
      this.lastX = p.x; this.lastY = p.y;
      this.samples.push({ x: p.x, y: p.y, t });
      while (this.samples.length > 1 && t - this.samples[0].t > SAMPLE_WINDOW_MS) this.samples.shift();
      if (this.handlers.onMove) this.handlers.onMove({ x: p.x, y: p.y, dx, dy });
    }

    _onUp(e) {
      if (e.pointerId !== this.activePointerId) return;
      e.preventDefault();
      const p = this._toLogical(e.clientX, e.clientY);
      const t = performance.now();
      const totalDx = p.x - this.startX;
      const totalDy = p.y - this.startY;
      const duration = t - this.startT;

      const win = this.samples.filter((s) => t - s.t <= SAMPLE_WINDOW_MS);
      const ref = win.length ? win[0] : { x: p.x, y: p.y, t: t - 1 };
      const dtWin = Math.max(1, t - ref.t);
      const vx = (p.x - ref.x) / dtWin;
      const vy = (p.y - ref.y) / dtWin;
      const speed = Math.hypot(vx, vy);

      const dist = Math.hypot(totalDx, totalDy);
      const isTap = dist < TAP_MAX_DIST && duration < TAP_MAX_DURATION;
      const isSwipe = speed >= SWIPE_MIN_SPEED && !isTap;

      this.activePointerId = null;
      if (this.handlers.onUp) {
        this.handlers.onUp({
          x: p.x, y: p.y, totalDx, totalDy, duration, vx, vy, speed, isTap, isSwipe,
        });
      }
    }
  }

  global.RetroInput = new InputTracker();
})(window);
