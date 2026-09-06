// Multi-touch pointer tracking shared by menus and gameplay. Keeps every
// active pointer (by id) with its live + start position so callers can
// implement a persistent joystick (read live position each frame) and
// discrete buttons/menu taps (classified on release) at the same time.
(function (global) {
  'use strict';

  const TAP_MAX_DIST = 14; // px
  const TAP_MAX_DURATION = 320; // ms

  class InputTracker {
    constructor() {
      this.canvas = null;
      this.getLogicalSize = () => ({ width: 960, height: 540 });
      this.handlers = { onDown: null, onUp: null };
      this.pointers = new Map(); // id -> { x, y, startX, startY, startT }

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
      e.preventDefault();
      const p = this._toLogical(e.clientX, e.clientY);
      const t = performance.now();
      const rec = { x: p.x, y: p.y, startX: p.x, startY: p.y, startT: t };
      this.pointers.set(e.pointerId, rec);
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      if (this.handlers.onDown) this.handlers.onDown(e.pointerId, p.x, p.y);
    }

    _onMove(e) {
      const rec = this.pointers.get(e.pointerId);
      if (!rec) return;
      e.preventDefault();
      const p = this._toLogical(e.clientX, e.clientY);
      rec.x = p.x;
      rec.y = p.y;
    }

    _onUp(e) {
      const rec = this.pointers.get(e.pointerId);
      if (!rec) return;
      e.preventDefault();
      const p = this._toLogical(e.clientX, e.clientY);
      this.pointers.delete(e.pointerId);
      const dist = Math.hypot(p.x - rec.startX, p.y - rec.startY);
      const duration = performance.now() - rec.startT;
      const isTap = dist < TAP_MAX_DIST && duration < TAP_MAX_DURATION;
      if (this.handlers.onUp) this.handlers.onUp(e.pointerId, p.x, p.y, { ...rec, isTap });
    }
  }

  global.RetroInput = new InputTracker();
})(window);
