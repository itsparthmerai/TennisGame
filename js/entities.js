// Ball physics, player/AI entities, and the shared shot-aiming math used by
// both the human player and the AI so their shots feel consistent.
(function (global) {
  'use strict';

  const COURT = Court.COURT;
  const G = 9.8;
  const BALL_RADIUS = 0.033;
  const HIT_RADIUS = 1.45;
  const HIT_REACH_Z = 2.4;
  const BOUNCE_DAMP = 0.52;
  const GROUND_FRICTION = 0.78;
  const NET_FAULT_DAMP = { vx: -0.15, vy: -0.35, vzAbsScale: 0.25 };
  const OUT_OF_PLAY_MARGIN = 7;

  // ---------- Ball ----------
  class Ball {
    constructor() {
      this.x = COURT.W / 2;
      this.y = 2;
      this.z = 1;
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.state = 'idle'; // 'idle' | 'inFlight' | 'dead'
      this.lastHitBy = null;
      this.bounces = 0;
      this.trail = [];
      this.spin = 0; // cosmetic only, [-1,1] for curve visuals
    }

    place(x, y, z) {
      this.x = x; this.y = y; this.z = z;
      this.vx = this.vy = this.vz = 0;
      this.state = 'idle';
      this.trail.length = 0;
    }

    static solveVelocity(start, target, T) {
      const vx = (target.x - start.x) / T;
      const vy = (target.y - start.y) / T;
      const vz = (target.z - start.z + 0.5 * G * T * T) / T;
      return { vx, vy, vz };
    }

    hit(start, target, T, hitterSide, spin) {
      this.x = start.x; this.y = start.y; this.z = start.z;
      const v = Ball.solveVelocity(start, target, T);
      this.vx = v.vx; this.vy = v.vy; this.vz = v.vz;
      this.lastHitBy = hitterSide;
      this.bounces = 0;
      this.state = 'inFlight';
      this.spin = spin || 0;
      this.trail.length = 0;
    }

    // Predicts where the ball (from its current pos/vel) will next touch the ground.
    predictLanding() {
      const { x, y, z, vx, vy, vz } = this;
      const disc = vz * vz + 2 * G * z;
      const t = disc > 0 ? (vz + Math.sqrt(disc)) / G : 0;
      return { x: x + vx * t, y: y + vy * t, t: Math.max(t, 0) };
    }

    isHittableBy(side) {
      if (this.state !== 'inFlight') return false;
      if (this.lastHitBy === side) return false;
      if (this.bounces >= 2) return false;
      const onSide = side === 'player' ? this.y <= COURT.NET_Y : this.y >= COURT.NET_Y;
      return onSide && this.z <= HIT_REACH_Z;
    }

    distanceTo(px, py) {
      const dx = this.x - px, dy = this.y - py;
      return Math.sqrt(dx * dx + dy * dy);
    }

    update(dt, onEvent) {
      if (this.state !== 'inFlight') return;
      const prevY = this.y, prevZ = this.z;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;
      this.vz -= G * dt;

      this.trail.push({ x: this.x, y: this.y, z: this.z });
      if (this.trail.length > 14) this.trail.shift();

      // Out-of-play safety net so huge mishits/rolling balls resolve quickly.
      if (
        this.z > 0 &&
        (this.x < -OUT_OF_PLAY_MARGIN || this.x > COURT.W + OUT_OF_PLAY_MARGIN ||
          this.y < -OUT_OF_PLAY_MARGIN || this.y > COURT.L + OUT_OF_PLAY_MARGIN)
      ) {
        this.state = 'dead';
        if (this.bounces >= 1) {
          // It already bounced in play once and nobody returned it -- that
          // point is already won regardless of where this far-flung, still
          // airborne ball between bounces eventually ends up.
          const side = this.y < COURT.NET_Y ? 'player' : 'ai';
          onEvent('doubleBounce', { side, lastHitBy: this.lastHitBy });
        } else {
          onEvent('out', { lastHitBy: this.lastHitBy });
        }
        return;
      }

      // Net collision: did we cross the net plane this frame while too low?
      const netY = COURT.NET_Y;
      if ((prevY - netY) * (this.y - netY) < 0 && this.vy !== 0) {
        const t = (netY - prevY) / (this.y - prevY);
        const zAtNet = prevZ + (this.z - prevZ) * t;
        if (zAtNet < COURT.NET_H + BALL_RADIUS) {
          this.y = netY;
          this.vx *= NET_FAULT_DAMP.vx;
          this.vy *= NET_FAULT_DAMP.vy;
          this.vz = Math.abs(this.vz) * NET_FAULT_DAMP.vzAbsScale;
          this.z = Math.max(zAtNet, 0.05);
          this.state = 'dead';
          onEvent('net', { lastHitBy: this.lastHitBy });
          return;
        }
      }

      // Ground bounce.
      if (this.z <= 0 && this.vz < 0) {
        this.z = 0;
        this.vz = -this.vz * BOUNCE_DAMP;
        this.vx *= GROUND_FRICTION;
        this.vy *= GROUND_FRICTION;
        this.bounces++;
        const inBounds = this.x >= 0 && this.x <= COURT.W && this.y >= 0 && this.y <= COURT.L;
        const side = this.y < netY ? 'player' : 'ai';
        onEvent('bounce', { x: this.x, y: this.y, inBounds, bounces: this.bounces, side, lastHitBy: this.lastHitBy });
        if (this.bounces >= 2) {
          // The opponent already failed to return it after a legal first
          // bounce -- the point is won right here, regardless of where this
          // second bounce (often a skidding/rolling ball) happens to land.
          this.state = 'dead';
          onEvent('doubleBounce', { side, lastHitBy: this.lastHitBy });
        } else if (!inBounds) {
          this.state = 'dead';
          onEvent('out', { lastHitBy: this.lastHitBy, side });
        }
      }
    }
  }

  // ---------- Shared shot-aiming math ----------
  // aimX in [-1,1] (left..right), aimY in [0,1.2] (0=short/net-hugging, 1=deep near baseline, >1=risking long)
  // power in [0,1] (0=loopy & safe, 1=flat & fast)
  function pickShotTarget(hitterSide, aimX, aimY, power) {
    const halfW = COURT.W / 2;
    // Even at full left/right aim this must stay inside the sidelines -- it's
    // driven directly by joystick tilt, which is often maxed out just from
    // moving toward the ball, not a deliberate "aim out" risk shot.
    const sideMargin = 0.25;
    const targetX = halfW + clamp(aimX, -1, 1) * (halfW - sideMargin);
    let targetY;
    if (hitterSide === 'player') {
      const near = COURT.NET_Y + 1.5;
      const far = COURT.L - 0.25;
      targetY = near + clamp(aimY, 0, 1.3) * (far - near);
    } else {
      const near = COURT.NET_Y - 1.5;
      const far = 0.25;
      targetY = near - clamp(aimY, 0, 1.3) * (near - far);
    }
    // Short/soft shots need more hang time to clear the net (real drop shots are
    // slow, not fast) -- 1.4s lazy lob .. 0.54s flat power drive.
    const T = 1.4 - clamp(power, 0, 1) * 0.86;
    return { x: targetX, y: targetY, T };
  }

  function contactHeight(ballZ) {
    return clamp(ballZ, 0.35, 2.1);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // ---------- Characters ----------
  const SWING_DURATION = 0.5; // groundstroke, seconds
  const SERVE_SWING_DURATION = 0.62;
  const VOLLEY_SWING_DURATION = 0.22; // a volley is a short compact punch, not a full swing
  const SPLIT_STEP_DURATION = 0.22; // quick reactive hop the instant the opponent makes contact
  const VOLLEY_ZONE_DEPTH = 3.0; // meters from the net -- contact made this close is a volley, not a groundstroke

  // Canonical swing shapes for a left-to-right sweep (screen-space degrees,
  // 0=right/90=up/180=left/270=down). Mirrored at draw time for the other
  // sweep direction. Each shot type gets its own backswing/finish shape.
  const SWING_SHAPES = {
    flat: { back: 185, contact: 355, follow: 40 },
    topspin: { back: 205, contact: 355, follow: 78 },
    slice: { back: 160, contact: 350, follow: 12 },
    lob: { back: 210, contact: 350, follow: 95 },
    serve: { back: 255, contact: 97, follow: 15 },
    // Almost no backswing and a short punch through -- a volley is a block,
    // not a swing.
    volley: { back: 335, contact: 358, follow: 15 },
  };

  // A shot struck this close to the net is played as a volley (a compact
  // punch/block) rather than a full groundstroke swing, regardless of which
  // shot button was tapped for aim/power.
  function isVolleyRange(side, y) {
    return side === 'player' ? y > COURT.NET_Y - VOLLEY_ZONE_DEPTH : y < COURT.NET_Y + VOLLEY_ZONE_DEPTH;
  }

  class Actor {
    constructor(side) {
      this.side = side;
      this.x = COURT.W / 2;
      this.y = side === 'player' ? COURT.playerMaxY - 2.5 : COURT.aiMinY + 2.5;
      this.renderX = this.x;
      this.renderY = this.y;
      this.vx = 0;
      this.vy = 0;
      this.facing = side === 'player' ? 1 : -1; // dominant (racket) shoulder side, cosmetic
      this.anim = 'idle';
      this.animTimer = 0;
      this.swingTimer = 0;
      this.swingDuration = SWING_DURATION;
      this.swingType = 'flat';
      this.isForehand = true;
      this.splitStepTimer = 0;
    }

    boundsX() { return [COURT.playerMinX, COURT.playerMaxX]; }
    boundsY() { return this.side === 'player' ? [COURT.playerMinY, COURT.playerMaxY] : [COURT.aiMinY, COURT.aiMaxY]; }

    clamp() {
      const [minX, maxX] = this.boundsX();
      const [minY, maxY] = this.boundsY();
      this.x = clamp(this.x, minX, maxX);
      this.y = clamp(this.y, minY, maxY);
    }

    triggerSwing(shotType, isForehand) {
      this.anim = 'swing';
      this.swingType = SWING_SHAPES[shotType] ? shotType : 'flat';
      this.isForehand = isForehand !== false;
      this.animTimer = 0;
      this.swingDuration = this.swingType === 'volley' ? VOLLEY_SWING_DURATION : SWING_DURATION;
      this.swingTimer = this.swingDuration;
      this.splitStepTimer = 0;
    }

    // Called the instant the opponent makes contact -- a real player's feet
    // are already moving before the ball arrives, not frozen until it does.
    triggerSplitStep() {
      if (this.swingTimer > 0) return; // don't stomp an in-progress swing pose
      this.splitStepTimer = SPLIT_STEP_DURATION;
    }

    triggerServe() {
      this.anim = 'swing';
      this.swingType = 'serve';
      this.isForehand = true;
      this.animTimer = 0;
      this.swingDuration = SERVE_SWING_DURATION;
      this.swingTimer = SERVE_SWING_DURATION;
    }

    teleportTo(x, y) {
      this.x = x; this.y = y;
      this.renderX = x; this.renderY = y;
      this.vx = 0; this.vy = 0;
    }

    updateAnim(dt, moving) {
      this.animTimer += dt;
      if (this.swingTimer > 0) {
        this.swingTimer -= dt;
        if (this.swingTimer <= 0) this.anim = 'idle';
      } else {
        this.anim = moving ? 'run' : 'idle';
      }
      if (this.splitStepTimer > 0) this.splitStepTimer -= dt;
      const followRate = 1 - Math.exp(-20 * dt);
      this.renderX += (this.x - this.renderX) * followRate;
      this.renderY += (this.y - this.renderY) * followRate;
    }
  }

  class Player extends Actor {
    constructor() {
      super('player');
      this.moveX = 0; // desired move direction, world-space, magnitude <= 1
      this.moveY = 0;
    }

    // Called every frame with the current joystick tilt (world-space axes,
    // magnitude 0-1); actual acceleration/top-speed is handled in update().
    setMoveInput(x, y) {
      this.moveX = x;
      this.moveY = y;
    }

    update(dt) {
      const MAX_SPEED = 6.8; // m/s -- snappy arcade running speed
      const ACCEL = 32; // m/s^2 while actively steering
      const DECEL = 44; // m/s^2 when the stick is released/centered

      const mag = Math.min(1, Math.hypot(this.moveX, this.moveY));
      const targetVX = mag > 0.001 ? (this.moveX / Math.hypot(this.moveX, this.moveY)) * mag * MAX_SPEED : 0;
      const targetVY = mag > 0.001 ? (this.moveY / Math.hypot(this.moveX, this.moveY)) * mag * MAX_SPEED : 0;
      const rate = mag > 0.001 ? ACCEL : DECEL;
      this.vx += clamp(targetVX - this.vx, -rate * dt, rate * dt);
      this.vy += clamp(targetVY - this.vy, -rate * dt, rate * dt);

      const prevX = this.x, prevY = this.y;
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      const [minX, maxX] = this.boundsX();
      const [minY, maxY] = this.boundsY();
      if (this.x < minX) { this.x = minX; if (this.vx < 0) this.vx = 0; }
      else if (this.x > maxX) { this.x = maxX; if (this.vx > 0) this.vx = 0; }
      if (this.y < minY) { this.y = minY; if (this.vy < 0) this.vy = 0; }
      else if (this.y > maxY) { this.y = maxY; if (this.vy > 0) this.vy = 0; }

      const moved = Math.hypot(this.x - prevX, this.y - prevY) > 0.0015;
      this.updateAnim(dt, moved && this.swingTimer <= 0);
    }
  }

  class AIPlayer extends Actor {
    constructor(difficulty) {
      super('ai');
      this.setDifficulty(difficulty);
      this.targetX = this.x;
      this.targetY = this.y;
      this.homeY = COURT.aiMinY + 2.4;
      this.approaching = false; // committed to rushing the net for this point
    }

    setDifficulty(level) {
      const table = {
        easy: { speed: 3.1, error: 1.1, reaction: 0.28, missChance: 0.16, aimSpread: 0.55, faultChance: 0.22 },
        medium: { speed: 4.0, error: 0.55, reaction: 0.16, missChance: 0.07, aimSpread: 0.75, faultChance: 0.12 },
        hard: { speed: 4.9, error: 0.22, reaction: 0.08, missChance: 0.02, aimSpread: 0.95, faultChance: 0.06 },
      };
      this.diff = table[level] || table.medium;
      this.difficultyName = table[level] ? level : 'medium';
    }

    // Called the instant the opponent strikes the ball -- a real player starts
    // moving right away, not once the ball happens to cross the net.
    startReaction() {
      this._pendingReact = true;
      this._reactionTimer = this.diff.reaction;
      this._errX = (Math.random() * 2 - 1) * this.diff.error;
      this._errY = (Math.random() * 2 - 1) * this.diff.error * 0.5;
      this._willMiss = Math.random() < this.diff.missChance;
      // Where a shot lands relative to this (pre-move) spot decides forehand vs backhand.
      this.preShotX = this.x;
    }

    _trackBall(ball) {
      // Committed to the net this point: meet the ball on the way in, near
      // the net, for a volley -- not where it would eventually bounce deep.
      if (this.approaching && ball.vy > 0.1) {
        const interceptY = clamp(COURT.NET_Y + 1.6, COURT.aiMinY, COURT.aiMaxY);
        const t = (interceptY - ball.y) / ball.vy;
        if (t > 0) {
          const ix = ball.x + ball.vx * t;
          this.targetX = clamp(ix + this._errX, COURT.playerMinX + 0.5, COURT.playerMaxX - 0.5);
          this.targetY = clamp(interceptY + this._errY, COURT.aiMinY, COURT.aiMaxY);
          return;
        }
      }
      const land = ball.predictLanding();
      this.targetX = clamp(land.x + this._errX, COURT.playerMinX + 0.5, COURT.playerMaxX - 0.5);
      this.targetY = clamp(land.y + 0.9 + this._errY, COURT.aiMinY, COURT.aiMaxY);
    }

    update(dt, ball, onSwing) {
      if (this._pendingReact) {
        this._reactionTimer -= dt;
        if (this._reactionTimer <= 0) this._pendingReact = false;
      }
      const tracking = ball.state === 'inFlight' && ball.lastHitBy === 'player' && !this._pendingReact;
      if (tracking) this._trackBall(ball);

      let goalX, goalY;
      if (tracking) {
        goalX = this.targetX;
        goalY = this.targetY;
      } else {
        goalX = COURT.W / 2 + (this.x - COURT.W / 2) * 0.3;
        // Between shots this point, a net-rush plan means holding position
        // near the net (in volley range) instead of drifting back home.
        goalY = this.approaching ? clamp(COURT.NET_Y + 1.8, COURT.aiMinY, COURT.aiMaxY) : this.homeY;
      }
      const dx = goalX - this.x, dy = goalY - this.y;
      const dist = Math.hypot(dx, dy);
      const maxStep = this.diff.speed * dt;
      const prevX = this.x, prevY = this.y;
      if (dist > maxStep && dist > 0.0001) {
        this.x += (dx / dist) * maxStep;
        this.y += (dy / dist) * maxStep;
      } else {
        this.x = goalX; this.y = goalY;
      }
      this.clamp();
      if (dt > 0) {
        this.vx = (this.x - prevX) / dt;
        this.vy = (this.y - prevY) / dt;
      }
      this.updateAnim(dt, dist > 0.05 && this.swingTimer <= 0);

      const mustLetBounce = ball.requireBounceFor === 'ai' && ball.bounces < 1;
      if (!this._pendingReact && !mustLetBounce && ball.isHittableBy('ai') && !this._willMiss && this.swingTimer <= 0) {
        const dToBall = ball.distanceTo(this.x, this.y);
        if (dToBall <= HIT_RADIUS) {
          onSwing(this);
        }
      }
    }
  }

  global.TennisPhysics = {
    G, BALL_RADIUS, HIT_RADIUS, HIT_REACH_Z, OUT_OF_PLAY_MARGIN,
    Ball, Player, AIPlayer,
    pickShotTarget, contactHeight, clamp,
    SWING_SHAPES, isVolleyRange,
    SPLIT_STEP_DURATION,
  };
})(window);
