(function () {
  'use strict';

  const { COURT } = Court;
  const Phys = TennisPhysics;
  const Font = RetroFont;

  // ---------- Canvas / viewport ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let logicalW = 960, logicalH = 540;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    logicalW = window.innerWidth;
    logicalH = window.innerHeight;
    canvas.width = Math.round(logicalW * dpr);
    canvas.height = Math.round(logicalH * dpr);
    canvas.style.width = logicalW + 'px';
    canvas.style.height = logicalH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Court.setViewport(logicalW, logicalH);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 60));
  resize();

  document.getElementById('rotate-hint').classList.add('active');

  RetroInput.setCanvas(canvas, () => ({ width: logicalW, height: logicalH }));

  // ---------- Settings ----------
  const Settings = {
    difficulty: 'medium',
    matchMode: 'quick', // 'quick' (4 games, no-ad) | 'full' (6 games, ad) | 'best3' (best of 3 sets, 6 games)
    muted: false,
  };

  function matchConfigFor(mode) {
    if (mode === 'quick') return { bestOfSets: 1, gamesPerSet: 4, tiebreakTo: 7, noAd: true };
    if (mode === 'full') return { bestOfSets: 1, gamesPerSet: 6, tiebreakTo: 7, noAd: false };
    return { bestOfSets: 3, gamesPerSet: 6, tiebreakTo: 7, noAd: false };
  }

  function matchModeLabel(mode) {
    return { quick: 'QUICK SET (TO 4)', full: 'FULL SET (TO 6)', best3: 'BEST OF 3 SETS' }[mode];
  }

  const SERVE_CONTACT_Z = 2.8; // high toss + reach, needed for reliable net clearance

  // Each shot button maps to a fixed (depth, power) preset; left/right placement
  // comes from the joystick's current horizontal tilt at the moment of the swing.
  const SHOT_PRESETS = {
    topspin: { aimY: 0.85, power: 0.50, label: 'TOPSPIN', color: '#2fae5c' },
    lob: { aimY: 0.95, power: 0.02, label: 'LOB', color: '#3a6fb0' },
    flat: { aimY: 0.75, power: 0.80, label: 'FLAT', color: '#a3341c' },
    slice: { aimY: 0.15, power: 0.20, label: 'SLICE', color: '#c98a2c' },
  };

  // ---------- Service box geometry ----------
  function getServiceBoxTarget(server, court) {
    const halfNear = { yMin: COURT.NET_Y - COURT.SERVICE_LINE_FROM_NET, yMax: COURT.NET_Y };
    const halfFar = { yMin: COURT.NET_Y, yMax: COURT.NET_Y + COURT.SERVICE_LINE_FROM_NET };
    const leftX = { xMin: 0, xMax: COURT.W / 2 };
    const rightX = { xMin: COURT.W / 2, xMax: COURT.W };
    if (server === 'player') {
      const xh = court === 'deuce' ? leftX : rightX;
      return Object.assign({}, xh, halfFar);
    } else {
      const xh = court === 'deuce' ? rightX : leftX;
      return Object.assign({}, xh, halfNear);
    }
  }

  function serverStanceX(server, court) {
    if (server === 'player') return court === 'deuce' ? COURT.W * 0.75 : COURT.W * 0.25;
    return court === 'deuce' ? COURT.W * 0.25 : COURT.W * 0.75;
  }

  // ---------- Game object ----------
  const G = {
    state: 'menu', // menu | howto | serveAimPlayer | serveAI | rally | pointEnd | paused | matchEnd
    prevState: null,
    match: null,
    ball: null,
    player: null,
    ai: null,
    reticle: { x: 0, y: 0 },
    serveAttempt: 1,
    servePhase: false,
    aiReacted: false,
    banner: null, // { text, sub, t, dur }
    pointEndTimer: 0,
    pointEndNext: null,
    serveDelayTimer: 0,
    lastTime: 0,
    buttons: [],
    lastPointEvent: null,
    frame: 0,
    joystick: { pointerId: null, nx: 0, ny: 0, baseX: 0, baseY: 0, radius: 60, knobRadius: 28 },
    shotButtons: [],
  };

  function setBanner(text, sub, dur) {
    G.banner = { text, sub: sub || '', t: 0, dur: dur || 1.2 };
  }

  function newMatch() {
    G.match = new TennisMatch(Object.assign({ firstServer: 'player' }, matchConfigFor(Settings.matchMode)));
    G.player = new Phys.Player();
    G.ai = new Phys.AIPlayer(Settings.difficulty);
    G.ball = new Phys.Ball();
    G.aiReacted = false;
  }

  function resetReadyPositions() {
    G.player.x = G.player.inputX = COURT.W / 2;
    G.player.y = G.player.inputY = COURT.playerMaxY - 2.2;
    G.ai.x = COURT.W / 2;
    G.ai.y = G.ai.homeY;
    G.ai.targetX = G.ai.x;
    G.ai.targetY = G.ai.y;
  }

  function startPoint() {
    resetReadyPositions();
    G.serveAttempt = 1;
    G.servePhase = true;
    G.aiReacted = false;
    beginServeSetup();
  }

  function beginServeSetup() {
    const server = G.match.getServer();
    const court = G.match.getServeCourt();
    const box = getServiceBoxTarget(server, court);
    G.serviceBox = box;
    const standX = serverStanceX(server, court);
    if (server === 'player') {
      G.player.x = G.player.inputX = standX;
      G.player.y = G.player.inputY = -0.5;
      G.ball.place(standX, -0.5, SERVE_CONTACT_Z);
      G.reticle.x = (box.xMin + box.xMax) / 2;
      G.reticle.y = box.yMin + (box.yMax - box.yMin) * 0.35;
      G.state = 'serveAimPlayer';
    } else {
      G.ai.x = standX;
      G.ai.y = COURT.L + 0.5;
      G.ball.place(standX, COURT.L + 0.5, SERVE_CONTACT_Z);
      G.state = 'serveAI';
      G.serveDelayTimer = 0.85;
    }
  }

  function doAIServe() {
    const server = 'ai';
    const box = G.serviceBox;
    const diff = G.ai.diff;
    const margin = 0.35;
    let tx = Phys.clamp(
      (box.xMin + box.xMax) / 2 + (Math.random() * 2 - 1) * (box.xMax - box.xMin) * 0.32,
      box.xMin + margin,
      box.xMax - margin
    );
    const nearNetY = box.yMax; // AI's target box sits just past the net on the player's side
    let ty = Phys.clamp(
      nearNetY - (box.yMax - box.yMin) * (0.3 + Math.random() * 0.35),
      box.yMin + margin,
      box.yMax - margin
    );
    const willFault = Math.random() < diff.faultChance * (G.serveAttempt === 1 ? 1 : 0.35);
    if (willFault) {
      tx = Math.random() < 0.5 ? box.xMin - 0.6 : box.xMax + 0.6;
    }
    const T = 0.92 - diff.aimSpread * 0.1 + Math.random() * 0.06;
    G.ball.hit({ x: G.ai.x, y: G.ai.y, z: SERVE_CONTACT_Z }, { x: tx, y: ty, z: 0 }, Math.max(0.68, T), 'ai');
    G.ball.requireBounceFor = 'player';
    G.ai.triggerSwing('normal');
    RetroAudio.sfx.hit();
  }

  function executePlayerServe(power) {
    const box = G.serviceBox;
    const margin = 0.5;
    const tx = Phys.clamp(G.reticle.x, box.xMin - margin, box.xMax + margin);
    const ty = Phys.clamp(G.reticle.y, box.yMin - margin, box.yMax + margin);
    const T = 1.0 - Phys.clamp(power, 0, 1) * 0.28;
    G.ball.hit({ x: G.player.x, y: G.player.y, z: SERVE_CONTACT_Z }, { x: tx, y: ty, z: 0 }, T, 'player');
    G.ball.requireBounceFor = 'ai';
    G.player.triggerSwing(power > 0.7 ? 'power' : 'normal');
    RetroAudio.sfx.hit();
    G.state = 'rally';
    G.servePhase = true; // still "serve in flight" until first legal bounce resolves
  }

  function handleServeFault(reason) {
    if (G.serveAttempt === 1) {
      G.serveAttempt = 2;
      setBanner('FAULT', reason === 'net' ? 'INTO THE NET' : 'OUT', 1.0);
      G.pointEndTimer = 0;
      G.state = 'pointEnd';
      G.pointEndNext = () => beginServeSetup();
    } else {
      setBanner('DOUBLE FAULT', '', 1.1);
      awardPoint(tennisOther(G.match.getServer()));
    }
  }

  function handleRallyOutcome(winnerSide, reason) {
    const label = reason === 'net' ? 'NET' : reason === 'out' ? 'OUT!' : '';
    if (label) setBanner(label, '', 0.85);
    awardPoint(winnerSide);
  }

  function awardPoint(winnerSide) {
    const res = G.match.awardPoint(winnerSide);
    const wonByPlayer = winnerSide === 'player';
    if (res.events.includes('match')) {
      RetroAudio.sfx.matchWin();
    } else if (res.events.includes('game')) {
      RetroAudio.sfx.gameWin();
    } else {
      wonByPlayer ? RetroAudio.sfx.pointWin() : RetroAudio.sfx.pointLose();
    }

    let bannerText = null;
    if (res.events.includes('match')) bannerText = wonByPlayer ? 'YOU WIN THE MATCH!' : 'CPU WINS THE MATCH';
    else if (res.events.includes('set')) bannerText = wonByPlayer ? 'SET WON!' : 'SET LOST';
    else if (res.events.includes('game')) bannerText = wonByPlayer ? 'GAME!' : 'GAME CPU';

    if (bannerText) setBanner(bannerText, '', 1.5);

    G.state = 'pointEnd';
    G.pointEndTimer = 0;
    if (G.match.matchOver) {
      G.pointEndNext = () => { G.state = 'matchEnd'; };
    } else {
      G.pointEndNext = () => startPoint();
    }
  }

  function ballEvent(type, data) {
    if (type === 'bounce') {
      RetroAudio.sfx.bounce();
      if (G.servePhase && data.bounces === 1) {
        const box = G.serviceBox;
        const inBox = data.x >= box.xMin && data.x <= box.xMax && data.y >= box.yMin && data.y <= box.yMax;
        if (inBox) {
          G.servePhase = false; // serve is in play; normal rally rules from here
        } else {
          handleServeFault('long');
        }
      } else if (!G.servePhase && data.inBounds === false) {
        // handled by 'out' event
      }
      return;
    }
    if (type === 'net') {
      RetroAudio.sfx.net();
      if (G.servePhase) handleServeFault('net');
      else handleRallyOutcome(tennisOther(data.lastHitBy), 'net');
      return;
    }
    if (type === 'out') {
      RetroAudio.sfx.out();
      if (G.servePhase) handleServeFault('out');
      else handleRallyOutcome(tennisOther(data.lastHitBy), 'out');
      return;
    }
    if (type === 'doubleBounce') {
      handleRallyOutcome(tennisOther(data.side), 'doubleBounce');
      return;
    }
  }

  function attemptPlayerHit(type) {
    if (!G.ball.isHittableBy('player')) return false;
    if (G.ball.requireBounceFor === 'player' && G.ball.bounces < 1) return false;
    const dist = G.ball.distanceTo(G.player.x, G.player.y);
    if (dist > Phys.HIT_RADIUS) return false;

    const preset = SHOT_PRESETS[type] || SHOT_PRESETS.flat;
    // Placement (left/right) comes from however far the joystick is currently
    // tilted -- moving toward a corner naturally aims the shot that way.
    const aimX = G.joystick.pointerId !== null ? Phys.clamp(G.joystick.nx, -1, 1) : 0;
    const target = Phys.pickShotTarget('player', aimX, preset.aimY, preset.power);
    const contactZ = Phys.contactHeight(G.ball.z);
    G.ball.hit(
      { x: G.player.x, y: G.player.y, z: contactZ },
      { x: target.x, y: target.y, z: 0 },
      target.T,
      'player',
      aimX * 0.5
    );
    G.player.triggerSwing(preset.power > 0.7 ? 'power' : 'normal');
    preset.power > 0.7 ? RetroAudio.sfx.hitPower() : RetroAudio.sfx.hit();
    G.aiReacted = false;
    return true;
  }

  function triggerShotButton(key) {
    if (G.state === 'rally') {
      attemptPlayerHit(key);
    } else if (G.state === 'serveAimPlayer') {
      const preset = SHOT_PRESETS[key] || SHOT_PRESETS.flat;
      executePlayerServe(preset.power);
    }
  }

  function aiSwing(ai) {
    const diff = ai.diff;
    const aimX = (Math.random() * 2 - 1) * diff.aimSpread;
    const aimY = 0.35 + Math.random() * 0.65;
    const power = 0.3 + Math.random() * 0.4 * diff.aimSpread;
    const target = Phys.pickShotTarget('ai', aimX, aimY, power);
    const contactZ = Phys.contactHeight(G.ball.z);
    G.ball.hit(
      { x: ai.x, y: ai.y, z: contactZ },
      { x: target.x, y: target.y, z: 0 },
      target.T,
      'ai',
      aimX * 0.5
    );
    ai.triggerSwing(power > 0.7 ? 'power' : 'normal');
    power > 0.7 ? RetroAudio.sfx.hitPower() : RetroAudio.sfx.hit();
  }

  // ---------- Input wiring ----------
  const PAUSE_BTN = { x: 0, y: 0, w: 44, h: 44 };

  function pointInRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  RetroInput.on({
    onDown(id, x, y) {
      RetroAudio.unlock();
      if (G.state === 'rally' || G.state === 'serveAimPlayer') {
        const j = G.joystick;
        if (j.pointerId === null && Math.hypot(x - j.baseX, y - j.baseY) <= j.radius * 1.7) {
          j.pointerId = id;
          return;
        }
        for (const b of G.shotButtons) {
          if (b.pointerId === null && Math.hypot(x - b.x, y - b.y) <= b.r * 1.15) {
            b.pointerId = id;
            triggerShotButton(b.key);
            return;
          }
        }
      }
    },
    onUp(id, x, y, rec) {
      const j = G.joystick;
      if (j.pointerId === id) {
        j.pointerId = null;
        j.nx = 0;
        j.ny = 0;
        return;
      }
      for (const b of G.shotButtons) {
        if (b.pointerId === id) {
          b.pointerId = null;
          return;
        }
      }
      if (!rec.isTap) return;
      const inMatch = G.state === 'rally' || G.state === 'serveAimPlayer' || G.state === 'pointEnd' || G.state === 'serveAI';
      if (inMatch) {
        if (pointInRect(x, y, PAUSE_BTN)) openPause();
        return;
      }
      handleMenuTap(x, y);
    },
  });

  function openPause() {
    G.prevState = G.state === 'paused' ? G.prevState : G.state;
    G.state = 'paused';
  }

  // ---------- Menu system ----------
  function handleMenuTap(x, y) {
    for (const b of G.buttons) {
      if (pointInRect(x, y, b)) {
        RetroAudio.sfx.uiConfirm();
        b.action();
        return;
      }
    }
  }

  // ---------- Joystick + shot-button layout ----------
  function computeControlLayout() {
    const j = G.joystick;
    j.radius = Phys.clamp(Math.min(logicalW, logicalH) * 0.11, 44, 72);
    j.knobRadius = j.radius * 0.46;
    j.baseX = j.radius + 30;
    j.baseY = logicalH - j.radius - 26;

    const br = Phys.clamp(Math.min(logicalW, logicalH) * 0.075, 28, 44);
    const dr = br * 1.9;
    const cx = logicalW - dr - br - 22;
    const cy = logicalH - dr - br - 22;
    const defs = [
      { key: 'topspin' },
      { key: 'lob' },
      { key: 'flat' },
      { key: 'slice' },
    ];
    const offsets = { topspin: [0, -dr], lob: [dr, 0], flat: [0, dr], slice: [-dr, 0] };
    if (G.shotButtons.length !== defs.length) {
      G.shotButtons = defs.map((d) => ({
        key: d.key,
        label: SHOT_PRESETS[d.key].label,
        color: SHOT_PRESETS[d.key].color,
        r: br,
        x: 0,
        y: 0,
        pointerId: null,
      }));
    }
    G.shotButtons.forEach((b) => {
      b.r = br;
      b.x = cx + offsets[b.key][0];
      b.y = cy + offsets[b.key][1];
    });
  }

  function sampleJoystick(dt) {
    const j = G.joystick;
    if (j.pointerId === null) {
      j.nx = 0;
      j.ny = 0;
      return;
    }
    const p = RetroInput.pointers.get(j.pointerId);
    if (!p) {
      j.pointerId = null;
      j.nx = 0;
      j.ny = 0;
      return;
    }
    const dx = p.x - j.baseX, dy = p.y - j.baseY;
    const mag = Math.hypot(dx, dy);
    if (mag < 1) {
      j.nx = 0;
      j.ny = 0;
    } else {
      const cl = Math.min(mag, j.radius);
      j.nx = (dx / mag) * (cl / j.radius);
      j.ny = (dy / mag) * (cl / j.radius);
    }
    if (Math.hypot(j.nx, j.ny) < 0.08) return;
    if (G.state === 'rally') {
      const MOVE_SPEED = 6.0; // m/s, player top running speed
      G.player.moveBy(j.nx * MOVE_SPEED * dt, -j.ny * MOVE_SPEED * dt);
    } else if (G.state === 'serveAimPlayer') {
      const box = G.serviceBox;
      const RETICLE_SPEED = 4.2; // m/s
      G.reticle.x = Phys.clamp(G.reticle.x + j.nx * RETICLE_SPEED * dt, box.xMin - 0.6, box.xMax + 0.6);
      G.reticle.y = Phys.clamp(G.reticle.y - j.ny * RETICLE_SPEED * dt, box.yMin - 0.6, box.yMax + 0.6);
    }
  }

  function goMenu() {
    G.state = 'menu';
  }

  // ---------- Update ----------
  function update(dt) {
    G.frame++;
    computeControlLayout();
    sampleJoystick(dt);
    if (G.state === 'rally') {
      G.ball.update(dt, ballEvent);
      G.player.update(dt);
      if (G.ball.lastHitBy === 'player' && !G.aiReacted) {
        G.ai.startReaction();
        G.aiReacted = true;
      }
      if (G.ball.lastHitBy === 'ai') G.aiReacted = false;
      G.ai.update(dt, G.ball, aiSwing);
    } else if (G.state === 'serveAI') {
      G.serveDelayTimer -= dt;
      G.ai.updateAnim(dt, false);
      G.player.updateAnim(dt, false);
      if (G.serveDelayTimer <= 0) {
        doAIServe();
        G.state = 'rally';
        G.servePhase = true;
      }
    } else if (G.state === 'serveAimPlayer') {
      G.player.updateAnim(dt, false);
      G.ai.updateAnim(dt, false);
    } else if (G.state === 'pointEnd') {
      G.pointEndTimer += dt;
      G.ball.update(dt, () => {});
      G.player.updateAnim(dt, false);
      G.ai.updateAnim(dt, false);
      if (G.pointEndTimer > 1.15) {
        const next = G.pointEndNext;
        G.pointEndNext = null;
        if (next) next();
      }
    }
    if (G.banner) {
      G.banner.t += dt;
      if (G.banner.t > G.banner.dur) G.banner = null;
    }
  }

  // ---------- Rendering: world ----------
  function drawActor(actor, isPlayer) {
    const p = Court.project(actor.renderX, actor.renderY, 0);
    Court.drawShadow(ctx, actor.renderX, actor.renderY, 0, 0.55);
    const scale = p.scale;
    const h = scale * 1.8; // ~1.8m tall figure
    const w = h * 0.52;
    const bob = actor.anim === 'run' ? Math.sin(actor.animTimer * 14) * h * 0.05 : Math.sin(actor.animTimer * 4) * h * 0.015;
    const baseY = p.y;
    const bodyColor = isPlayer ? '#e3502f' : '#2f6fe3';
    const bodyDark = isPlayer ? '#a3341c' : '#1c479c';
    const skin = '#f2c49b';

    ctx.save();
    ctx.translate(p.x, baseY - bob);

    // legs
    const legSwing = actor.anim === 'run' ? Math.sin(actor.animTimer * 14) * h * 0.16 : 0;
    ctx.fillStyle = bodyDark;
    ctx.fillRect(-w * 0.28, -h * 0.42 + legSwing * 0.3, w * 0.22, h * 0.42);
    ctx.fillRect(w * 0.06, -h * 0.42 - legSwing * 0.3, w * 0.22, h * 0.42);

    // torso
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-w * 0.32, -h * 0.82, w * 0.64, h * 0.42);

    // head
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -h * 0.92, w * 0.26, 0, Math.PI * 2);
    ctx.fill();

    // racket arm — angle animates through swing
    let swingT = 0;
    if (actor.anim === 'swing' || actor.anim === 'swingPower') {
      const total = 0.32;
      const elapsed = total - Math.max(actor.swingTimer, 0);
      swingT = Phys.clamp(elapsed / total, 0, 1);
    }
    const dir = isPlayer ? 1 : -1;
    const baseAngle = -0.6 * dir;
    const swingAngle = baseAngle + swingT * Math.PI * 1.35 * dir * (actor.anim === 'swingPower' ? 1.15 : 1);
    const armLen = h * 0.5;
    const shoulderX = w * 0.28 * dir;
    const shoulderY = -h * 0.72;
    const handX = shoulderX + Math.cos(swingAngle) * armLen * 0.55;
    const handY = shoulderY + Math.sin(swingAngle) * armLen * 0.55;

    ctx.strokeStyle = skin;
    ctx.lineWidth = Math.max(2, w * 0.14);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(handX, handY);
    ctx.stroke();

    // racket
    const racketAngle = swingAngle;
    const rHeadX = handX + Math.cos(racketAngle) * armLen * 0.42;
    const rHeadY = handY + Math.sin(racketAngle) * armLen * 0.42;
    ctx.strokeStyle = '#1c1c1c';
    ctx.lineWidth = Math.max(1.5, w * 0.08);
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(rHeadX, rHeadY);
    ctx.stroke();
    ctx.fillStyle = actor.anim === 'swingPower' ? 'rgba(255,220,120,0.85)' : 'rgba(230,230,230,0.85)';
    ctx.beginPath();
    ctx.ellipse(rHeadX, rHeadY, w * 0.22, w * 0.3, racketAngle, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1c1c1c';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  function drawBall() {
    const b = G.ball;
    for (let i = 0; i < b.trail.length; i++) {
      const t = b.trail[i];
      const tp = Court.project(t.x, t.y, t.z);
      const alpha = (i / b.trail.length) * 0.35;
      ctx.fillStyle = `rgba(216,230,58,${alpha})`;
      const r = Math.max(1, tp.scale * Phys.BALL_RADIUS * 1.6);
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (b.state !== 'idle' || true) {
      Court.drawShadow(ctx, b.x, b.y, b.z, 0.22);
      const p = Court.project(b.x, b.y, b.z);
      const r = Math.max(2.2, p.scale * Phys.BALL_RADIUS * 2.1);
      ctx.fillStyle = '#d8e63a';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,60,20,0.5)';
      ctx.lineWidth = Math.max(0.6, r * 0.18);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.7, 0.4, 2.4);
      ctx.stroke();
    }
  }

  function drawServiceBoxHighlight() {
    if (G.state !== 'serveAimPlayer' || !G.serviceBox) return;
    const b = G.serviceBox;
    const pts = [
      Court.project(b.xMin, b.yMin, 0.01),
      Court.project(b.xMax, b.yMin, 0.01),
      Court.project(b.xMax, b.yMax, 0.01),
      Court.project(b.xMin, b.yMax, 0.01),
    ];
    ctx.fillStyle = 'rgba(255,230,120,0.22)';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill();

    const rp = Court.project(G.reticle.x, G.reticle.y, 0.02);
    const rs = Math.max(6, rp.scale * 0.32);
    ctx.strokeStyle = '#ffe678';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rp.x - rs, rp.y);
    ctx.lineTo(rp.x + rs, rp.y);
    ctx.moveTo(rp.x, rp.y - rs);
    ctx.lineTo(rp.x, rp.y + rs);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rp.x, rp.y, rs * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }

  function renderMatch() {
    Court.render(ctx);
    drawServiceBoxHighlight();

    const drawables = [
      { y: G.player.renderY, draw: () => drawActor(G.player, true) },
      { y: G.ai.renderY, draw: () => drawActor(G.ai, false) },
      { y: G.ball.y, draw: () => drawBall() },
    ];
    drawables.sort((a, b) => b.y - a.y);
    drawables.forEach((d) => d.draw());

    drawHud();
    drawBanner();
  }

  // ---------- HUD ----------
  function drawPill(x, y, w, h, color) {
    ctx.fillStyle = color;
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function drawHud() {
    const m = G.match;
    if (!m) return;
    const scale = Math.max(2, Math.min(3, Math.floor(logicalW / 340)));
    const pad = 10;

    drawPill(pad, pad, Math.min(420, logicalW - pad * 2 - 56), 40, 'rgba(6,17,12,0.72)');
    const pLabel = `P ${m.getPointLabel('player')}`;
    const aLabel = `C ${m.getPointLabel('ai')}`;
    const setsText = m.getSetsSummary().map((s) => `${s.player}-${s.ai}`).join(' ');
    const serverMark = m.getServer() === 'player' ? '>' : '<';

    Font.drawTextShadowed(ctx, `${pLabel}  ${serverMark}  ${aLabel}`, pad + 12, pad + 8, scale, '#f4f1e6');
    Font.drawTextShadowed(ctx, `SETS ${setsText}`, pad + 12, pad + 24, Math.max(1, scale - 1), '#bdeccb');

    // Pause button (top-right)
    PAUSE_BTN.x = logicalW - pad - 44;
    PAUSE_BTN.y = pad;
    PAUSE_BTN.w = 44; PAUSE_BTN.h = 40;
    drawPill(PAUSE_BTN.x, PAUSE_BTN.y, PAUSE_BTN.w, PAUSE_BTN.h, 'rgba(6,17,12,0.72)');
    ctx.fillStyle = '#f4f1e6';
    ctx.fillRect(PAUSE_BTN.x + 15, PAUSE_BTN.y + 11, 5, 18);
    ctx.fillRect(PAUSE_BTN.x + 25, PAUSE_BTN.y + 11, 5, 18);

    if (G.state === 'serveAimPlayer') {
      Font.drawTextCenteredShadowed(ctx, 'JOYSTICK AIMS - BUTTON SERVES', logicalW / 2, logicalH - 20, Math.max(1, scale - 1), '#f4f1e6');
    } else if (G.state === 'rally') {
      const hint = G.ball.isHittableBy('player') && G.ball.distanceTo(G.player.x, G.player.y) <= Phys.HIT_RADIUS;
      if (hint) {
        const p = Court.project(G.player.x, G.player.y, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(18, p.scale * Phys.HIT_RADIUS * 0.5), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (G.state === 'rally' || G.state === 'serveAimPlayer') drawJoystickAndButtons();
  }

  function drawJoystickAndButtons() {
    const j = G.joystick;
    const knobX = j.baseX + j.nx * j.radius;
    const knobY = j.baseY + j.ny * j.radius;

    ctx.fillStyle = 'rgba(6,17,12,0.45)';
    ctx.beginPath();
    ctx.arc(j.baseX, j.baseY, j.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(244,241,230,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = j.pointerId !== null ? 'rgba(244,241,230,0.9)' : 'rgba(244,241,230,0.6)';
    ctx.beginPath();
    ctx.arc(knobX, knobY, j.knobRadius, 0, Math.PI * 2);
    ctx.fill();

    for (const b of G.shotButtons) {
      const pressed = b.pointerId !== null;
      const r = pressed ? b.r * 1.08 : b.r;
      ctx.fillStyle = pressed ? b.color : 'rgba(6,17,12,0.55)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 3;
      ctx.stroke();
      Font.drawTextCentered(ctx, b.label, b.x, b.y, 1, pressed ? '#0a1a12' : '#f4f1e6');
    }
  }

  function drawBanner() {
    if (!G.banner) return;
    const scaleT = Phys.clamp(G.banner.t / 0.18, 0, 1);
    const pop = 1 + (1 - scaleT) * 0.35;
    const alpha = G.banner.t > G.banner.dur - 0.3 ? Phys.clamp((G.banner.dur - G.banner.t) / 0.3, 0, 1) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(logicalW / 2, logicalH * 0.36);
    ctx.scale(pop, pop);
    const scale = Math.max(3, Math.min(5, Math.floor(logicalW / 220)));
    Font.drawTextCenteredShadowed(ctx, G.banner.text, 0, 0, scale, '#ffe678');
    if (G.banner.sub) Font.drawTextCenteredShadowed(ctx, G.banner.sub, 0, scale * 12, Math.max(1, scale - 2), '#f4f1e6');
    ctx.restore();
  }

  // ---------- Menu screens ----------
  function drawTitleCourtBackdrop() {
    Court.render(ctx);
  }

  function screenMenu() {
    drawTitleCourtBackdrop();
    ctx.fillStyle = 'rgba(6,15,11,0.55)';
    ctx.fillRect(0, 0, logicalW, logicalH);

    const titleScale = Math.max(4, Math.min(7, Math.floor(logicalW / 150)));
    Font.drawTextCenteredShadowed(ctx, 'RETRO COURT', logicalW / 2, logicalH * 0.16, titleScale, '#ffe678');
    Font.drawTextCenteredShadowed(ctx, 'TENNIS', logicalW / 2, logicalH * 0.16 + titleScale * 11, titleScale, '#f4f1e6');

    G.buttons = [];
    const bw = Math.min(420, logicalW * 0.82);
    const bx = (logicalW - bw) / 2;
    let by = logicalH * 0.38;
    const bh = 52, gap = 14;

    addMenuButton(bx, by, bw, bh, 'PLAY MATCH', '#2fae5c', () => {
      newMatch();
      startPoint();
    });
    by += bh + gap;
    addMenuButton(bx, by, bw, bh, `DIFFICULTY: ${Settings.difficulty.toUpperCase()}`, '#3a6fb0', () => {
      const order = ['easy', 'medium', 'hard'];
      Settings.difficulty = order[(order.indexOf(Settings.difficulty) + 1) % order.length];
    });
    by += bh + gap;
    addMenuButton(bx, by, bw, bh, matchModeLabel(Settings.matchMode), '#3a6fb0', () => {
      const order = ['quick', 'full', 'best3'];
      Settings.matchMode = order[(order.indexOf(Settings.matchMode) + 1) % order.length];
    });
    by += bh + gap;
    addMenuButton(bx, by, bw, bh, `SOUND: ${Settings.muted ? 'OFF' : 'ON'}`, '#3a6fb0', () => {
      Settings.muted = !Settings.muted;
      RetroAudio.setMuted(Settings.muted);
    });
    by += bh + gap;
    addMenuButton(bx, by, bw, bh, 'HOW TO PLAY', '#7a5a2f', () => { G.state = 'howto'; });

    const fscale = Math.max(1, Math.min(2, Math.floor(logicalW / 480)));
    Font.drawTextCenteredShadowed(ctx, 'OFFLINE • NO ADS • NO IAP', logicalW / 2, logicalH - 22, fscale, '#bdeccb');
  }

  function addMenuButton(x, y, w, h, label, color, action) {
    drawPill(x, y, w, h, color);
    const scale = Math.max(1, Math.min(2, Math.floor(w / 220)));
    Font.drawTextCentered(ctx, label, x + w / 2, y + h / 2, scale, '#f4f1e6');
    G.buttons.push({ x, y, w, h, action });
  }

  function screenHowTo() {
    ctx.fillStyle = '#0e2418';
    ctx.fillRect(0, 0, logicalW, logicalH);

    const bw = Math.min(300, logicalW * 0.7), bh = 48;
    const bx = (logicalW - bw) / 2, by = logicalH - bh - 18;

    const lines = [
      'HOW TO PLAY',
      '',
      'USE THE JOYSTICK (BOTTOM LEFT) TO',
      'MOVE YOUR PLAYER AROUND THE COURT.',
      '',
      'TAP A SHOT BUTTON (BOTTOM RIGHT) TO',
      'SWING WHEN THE BALL IS IN RANGE -',
      'TOPSPIN IS A SAFE DEEP DRIVE, FLAT IS',
      'FAST & AGGRESSIVE, SLICE IS SHORT &',
      'LOW, LOB ARCS DEEP OVER THE CPU.',
      '',
      'TILT THE JOYSTICK LEFT OR RIGHT AS',
      'YOU SWING TO AIM YOUR SHOT.',
      '',
      'TO SERVE: USE THE JOYSTICK TO AIM',
      'THE RETICLE, THEN TAP ANY SHOT',
      'BUTTON TO SERVE.',
      '',
      'WIN POINTS BY MAKING THE CPU MISS,',
      'HIT THE NET, OR HIT THE BALL OUT.',
    ];

    const titleScale = Math.max(2, Math.min(4, Math.floor(logicalW / 260)));
    const bodyScale = Math.max(1, Math.min(2, Math.floor(logicalW / 480)));
    const titleLH = (titleScale + 1) * 11;
    const bodyLH = (bodyScale + 1) * 11;
    const blankLH = bodyLH * 0.65;

    const totalH = titleLH + lines.slice(1).reduce((sum, l) => sum + (l === '' ? blankLH : bodyLH), 0);
    const availableH = by - 20;
    let y = Math.max(28, (availableH - totalH) / 2 + titleLH / 2);

    Font.drawTextCentered(ctx, lines[0], logicalW / 2, y, titleScale, '#ffe678');
    y += titleLH;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '') { y += blankLH; continue; }
      Font.drawTextCentered(ctx, lines[i], logicalW / 2, y, bodyScale, '#f4f1e6');
      y += bodyLH;
    }

    G.buttons = [];
    addMenuButton(bx, by, bw, bh, 'BACK', '#3a6fb0', goMenu);
  }

  function screenPaused() {
    renderUnderlay();
    ctx.fillStyle = 'rgba(6,15,11,0.72)';
    ctx.fillRect(0, 0, logicalW, logicalH);
    const scale = Math.max(3, Math.min(5, Math.floor(logicalW / 200)));
    Font.drawTextCenteredShadowed(ctx, 'PAUSED', logicalW / 2, logicalH * 0.28, scale, '#ffe678');

    G.buttons = [];
    const bw = Math.min(360, logicalW * 0.78), bh = 50, gap = 14;
    const bx = (logicalW - bw) / 2;
    let by = logicalH * 0.42;
    addMenuButton(bx, by, bw, bh, 'RESUME', '#2fae5c', () => { G.state = G.prevState || 'rally'; });
    by += bh + gap;
    addMenuButton(bx, by, bw, bh, `SOUND: ${Settings.muted ? 'OFF' : 'ON'}`, '#3a6fb0', () => {
      Settings.muted = !Settings.muted;
      RetroAudio.setMuted(Settings.muted);
    });
    by += bh + gap;
    addMenuButton(bx, by, bw, bh, 'RESTART MATCH', '#7a5a2f', () => { newMatch(); startPoint(); });
    by += bh + gap;
    addMenuButton(bx, by, bw, bh, 'MAIN MENU', '#a3341c', goMenu);
  }

  function renderUnderlay() {
    if (G.match) renderMatch();
    else drawTitleCourtBackdrop();
  }

  function screenMatchEnd() {
    renderUnderlay();
    ctx.fillStyle = 'rgba(6,15,11,0.72)';
    ctx.fillRect(0, 0, logicalW, logicalH);
    const won = G.match.winner === 'player';
    const scale = Math.max(3, Math.min(6, Math.floor(logicalW / 170)));
    Font.drawTextCenteredShadowed(ctx, won ? 'YOU WIN!' : 'YOU LOSE', logicalW / 2, logicalH * 0.26, scale, won ? '#ffe678' : '#f4a3a3');
    const setsText = G.match.getSetsSummary().filter((s) => !s.current || s.player || s.ai).map((s) => `${s.player}-${s.ai}`).join('  ');
    Font.drawTextCentered(ctx, setsText, logicalW / 2, logicalH * 0.26 + scale * 14, Math.max(2, scale - 2), '#f4f1e6');

    G.buttons = [];
    const bw = Math.min(360, logicalW * 0.78), bh = 50, gap = 14;
    const bx = (logicalW - bw) / 2;
    let by = logicalH * 0.5;
    addMenuButton(bx, by, bw, bh, 'PLAY AGAIN', '#2fae5c', () => { newMatch(); startPoint(); });
    by += bh + gap;
    addMenuButton(bx, by, bw, bh, 'MAIN MENU', '#3a6fb0', goMenu);
  }

  // ---------- Main render dispatch ----------
  function render() {
    ctx.clearRect(0, 0, logicalW, logicalH);
    switch (G.state) {
      case 'menu': screenMenu(); break;
      case 'howto': screenHowTo(); break;
      case 'paused': screenPaused(); break;
      case 'matchEnd': screenMatchEnd(); break;
      default: renderMatch(); break;
    }
  }

  // ---------- Loop ----------
  function loop(ts) {
    if (!G.lastTime) G.lastTime = ts;
    let dt = (ts - G.lastTime) / 1000;
    G.lastTime = ts;
    dt = Math.min(dt, 1 / 20);
    update(dt);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // expose for debugging / smoke tests
  window.__game = G;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
