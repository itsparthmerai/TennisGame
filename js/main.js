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
    court: 'grass', // 'clay' | 'hard' | 'grass' -- picked via the pop-up shown before each new match
    muted: false,
    slowMo: true,
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
  const SERVE_START_Z = 1.0; // toss begins near hand height
  const SERVE_TOSS_DURATION = 0.85; // seconds, up and back down
  const IDEAL_CONTACT_Z = 1.0; // sweet-spot contact height for a rally shot
  const TIMING_TOLERANCE_Z = 1.4; // how forgiving the timing window is
  const SWEET_SPOT_THRESHOLD = 0.82; // timing quality needed for a glowing power shot

  // Bullet-time: as the ball closes in on whichever player is about to hit
  // it, the whole sim eases into slow motion so the swing (and the timing
  // window) is easy to actually see, then eases back out right after contact.
  // Driven purely by ball-to-receiver distance, so it needs no explicit
  // start/stop triggers -- it naturally ramps down and back up every shot.
  const SLOWMO_MIN_SCALE = 0.32;
  const SLOWMO_START_DIST = 3.6; // meters -- still full speed at/beyond this
  const SLOWMO_FULL_DIST = 1.7; // meters -- fully slowed at/within this
  const SLOWMO_EASE_RATE = 10; // how fast the scale itself eases toward its target

  // Each shot button has a power/depth RANGE, not a fixed value -- tapping the
  // button fires immediately, and how well-timed the tap is (the ball's
  // height relative to the ideal contact height) determines how far up each
  // range the shot lands: a perfectly timed tap is a glowing sweet-spot power
  // shot, a mistimed one is a weaker, shorter shot. Left/right placement
  // comes from wherever the joystick is tilted at the moment of the tap.
  const SHOT_PRESETS = {
    topspin: { aimYMin: 0.50, aimYMax: 0.95, powerMin: 0.30, powerMax: 0.65, label: 'TOPSPIN', color: '#2fae5c' },
    lob: { aimYMin: 0.50, aimYMax: 0.95, powerMin: 0.00, powerMax: 0.25, label: 'LOB', color: '#3a6fb0' },
    flat: { aimYMin: 0.45, aimYMax: 0.85, powerMin: 0.50, powerMax: 0.95, label: 'FLAT', color: '#a3341c' },
    slice: { aimYMin: 0.05, aimYMax: 0.40, powerMin: 0.15, powerMax: 0.45, label: 'SLICE', color: '#c98a2c' },
  };
  // The serve has its own dedicated button/power range -- no shot-type choice,
  // just how well-timed the swing tap is against the toss. Placement comes
  // from the reticle, not aim.
  const SERVE_PRESET = { powerMin: 0.30, powerMax: 0.92, label: 'SERVE', color: '#d9a441' };

  function computeTimingQuality(ballZ) {
    const diff = Math.abs(ballZ - IDEAL_CONTACT_Z);
    return Phys.clamp(1 - diff / TIMING_TOLERANCE_Z, 0, 1);
  }

  function computeServeTimingQuality(tossT, duration) {
    const phase = Phys.clamp(tossT / duration, 0, 1);
    return Phys.clamp(1 - Math.abs(phase - 0.5) * 2.2, 0, 1);
  }

  // Wimbledon's famous all-whites, with a colored trim so the two players
  // still read clearly apart at a glance during a fast rally.
  const KITS = {
    player: { shirt: '#f6f3e7', shirtShade: '#dcd8c8', trim: '#c23b2b', shorts: '#eeebdd', hair: '#3b2a1a', shoe: '#2a2a2a' },
    ai: { shirt: '#f2efe3', shirtShade: '#d8d5c5', trim: '#2b5fc2', shorts: '#e9e6d8', hair: '#241a12', shoe: '#232323' },
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
    serveButton: null,
    elapsed: 0,
    serveToss: null, // { t, duration } while the player's toss is in the air
    shake: null, // { t, dur, mag } camera punch on a sweet-spot hit
    crowdCheer: 0, // 0..1, decays -- drives a crowd reaction pulse
    shotCallout: null, // { text, t, dur, x, y } "POWER SHOT!"-style callout
    sweetTrailUntil: 0,
    slowMoScale: 1, // 1 = full speed, eases toward SLOWMO_MIN_SCALE as the ball nears its receiver
  };

  function setBanner(text, sub, dur) {
    G.banner = { text, sub: sub || '', t: 0, dur: dur || 1.2 };
  }

  function newMatch() {
    Court.setSurface(Settings.court);
    Phys.setSurface(Settings.court);
    G.match = new TennisMatch(Object.assign({ firstServer: 'player' }, matchConfigFor(Settings.matchMode)));
    G.player = new Phys.Player();
    G.ai = new Phys.AIPlayer(Settings.difficulty);
    G.ball = new Phys.Ball();
    G.aiReacted = false;
  }

  function resetReadyPositions() {
    // Default to a return-of-serve stance right at (a touch behind) each
    // baseline; beginServeSetup() then repositions whichever side is serving.
    G.player.teleportTo(COURT.W / 2, -0.4);
    G.ai.teleportTo(COURT.W / 2, COURT.L + 0.4);
    G.ai.targetX = G.ai.x;
    G.ai.targetY = G.ai.y;
  }

  function startPoint() {
    resetReadyPositions();
    G.serveToss = null;
    G.shake = null;
    G.shotCallout = null;
    G.slowMoScale = 1;
    G.serveAttempt = 1;
    G.servePhase = true;
    G.aiReacted = false;
    G.playerReacted = false;
    G.ai.approaching = false;
    beginServeSetup();
  }

  function beginServeSetup() {
    const server = G.match.getServer();
    const court = G.match.getServeCourt();
    const box = getServiceBoxTarget(server, court);
    G.serviceBox = box;
    const standX = serverStanceX(server, court);
    // The receiver lines up behind their own baseline, on the same side as
    // the service box the serve is coming into -- not dead center.
    const receiveX = Phys.clamp((box.xMin + box.xMax) / 2, COURT.playerMinX + 0.6, COURT.playerMaxX - 0.6);
    if (server === 'player') {
      G.player.teleportTo(standX, -0.5);
      G.ball.place(standX, -0.5, SERVE_START_Z);
      G.reticle.x = (box.xMin + box.xMax) / 2;
      G.reticle.y = box.yMin + (box.yMax - box.yMin) * 0.35;
      G.state = 'serveAimPlayer';
      G.ai.teleportTo(receiveX, COURT.L + 0.4);
    } else {
      G.ai.teleportTo(standX, COURT.L + 0.5);
      G.ball.place(standX, COURT.L + 0.5, SERVE_CONTACT_Z);
      G.state = 'serveAI';
      G.serveDelayTimer = 0.85;
      G.player.teleportTo(receiveX, -0.4);
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
    G.ai.triggerServe();
    RetroAudio.sfx.hit();
  }

  // First tap of SERVE: toss the ball up. A second tap (attemptServeSwing)
  // times the swing against the toss's arc.
  function beginServeToss() {
    G.ball.z = SERVE_START_Z;
    G.serveToss = { t: 0, duration: SERVE_TOSS_DURATION };
    G.state = 'serveToss';
  }

  function attemptServeSwing() {
    if (!G.serveToss) return;
    const quality = computeServeTimingQuality(G.serveToss.t, G.serveToss.duration);
    executePlayerServe(quality);
  }

  function executePlayerServe(timingQuality) {
    const t = Phys.clamp(timingQuality, 0, 1);
    const power = SERVE_PRESET.powerMin + t * (SERVE_PRESET.powerMax - SERVE_PRESET.powerMin);
    const box = G.serviceBox;
    const margin = 0.5;
    // A mistimed toss-swing loses placement accuracy, not just power.
    const wobble = (1 - t) * 0.9;
    const tx = Phys.clamp(G.reticle.x + (Math.random() * 2 - 1) * wobble, box.xMin - margin, box.xMax + margin);
    const ty = Phys.clamp(G.reticle.y + (Math.random() * 2 - 1) * wobble, box.yMin - margin, box.yMax + margin);
    const T = 1.0 - power * 0.28;
    G.ball.hit({ x: G.player.x, y: G.player.y, z: SERVE_CONTACT_Z }, { x: tx, y: ty, z: 0 }, T, 'player');
    G.ball.requireBounceFor = 'ai';
    G.player.triggerServe();
    power > 0.7 ? RetroAudio.sfx.hitPower() : RetroAudio.sfx.hit();
    if (t >= SWEET_SPOT_THRESHOLD) triggerSweetSpotFX('POWER SERVE!', G.player.x, G.player.y);
    G.serveToss = null;
    G.state = 'rally';
    G.servePhase = true; // still "serve in flight" until first legal bounce resolves
  }

  function handleServeFault(reason) {
    G.serveToss = null;
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
    G.serveToss = null;
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
    // Timing quality comes from how close the ball's height is to the ideal
    // contact height at the instant of the tap -- swing at the right moment
    // for a glowing sweet-spot shot, mistime it for something weaker.
    const t = computeTimingQuality(G.ball.z);
    const power = preset.powerMin + t * (preset.powerMax - preset.powerMin);
    const aimY = preset.aimYMin + t * (preset.aimYMax - preset.aimYMin);
    // Placement (left/right) comes from wherever the joystick is tilted at
    // the moment of the tap.
    const aimX = G.joystick.pointerId !== null ? Phys.clamp(G.joystick.nx, -1, 1) : 0;
    const target = Phys.pickShotTarget('player', aimX, aimY, power);
    const contactZ = Phys.contactHeight(G.ball.z);
    G.ball.hit(
      { x: G.player.x, y: G.player.y, z: contactZ },
      { x: target.x, y: target.y, z: 0 },
      target.T,
      'player',
      aimX * 0.5
    );
    const isForehand = (G.player.x - (G.player.preShotX ?? G.player.x)) * G.player.facing >= 0;
    // Contact made this close to the net is a volley -- a short compact
    // punch, not a full groundstroke swing -- regardless of which shot
    // button was tapped (that still decides aim/power above).
    const visualType = Phys.isVolleyRange('player', G.player.y) ? 'volley' : type;
    G.player.triggerSwing(visualType, isForehand);
    power > 0.7 ? RetroAudio.sfx.hitPower() : RetroAudio.sfx.hit();
    G.aiReacted = false;
    const sweet = t >= SWEET_SPOT_THRESHOLD;
    flashShotButton(type, sweet);
    if (sweet) triggerSweetSpotFX('POWER SHOT!', G.player.x, G.player.y);
    return true;
  }

  function triggerShotButton(key) {
    if (G.state === 'rally') {
      attemptPlayerHit(key);
    }
  }

  function flashShotButton(key, sweet) {
    const b = G.shotButtons.find((sb) => sb.key === key);
    if (b) {
      b.flashUntil = G.elapsed + (sweet ? 0.32 : 0.16);
      b.flashSweet = sweet;
    }
  }

  // Bright-arcade payoff for a well-timed hit: a quick camera punch, a crowd
  // reaction pulse, a floating callout, and a hot ball trail.
  function triggerSweetSpotFX(label, worldX, worldY) {
    G.shake = { t: 0, dur: 0.28, mag: 10 };
    G.crowdCheer = 1;
    G.shotCallout = { text: label, t: 0, dur: 0.9, x: worldX, y: worldY };
    G.sweetTrailUntil = G.elapsed + 0.6;
  }

  function aiSwing(ai) {
    const diff = ai.diff;
    const aimX = (Math.random() * 2 - 1) * diff.aimSpread;
    // Full range so every shot type below is actually reachable -- these
    // used to be offset so tightly (aimY never below 0.35, power never
    // below 0.3) that slice and lob could never trigger, and flat only
    // barely could at the hardest difficulty.
    const aimY = Math.random();
    const power = Math.random() * (0.4 + 0.5 * diff.aimSpread);
    const target = Phys.pickShotTarget('ai', aimX, aimY, power);
    const contactZ = Phys.contactHeight(G.ball.z);
    G.ball.hit(
      { x: ai.x, y: ai.y, z: contactZ },
      { x: target.x, y: target.y, z: 0 },
      target.T,
      'ai',
      aimX * 0.5
    );
    let shotType = 'topspin';
    if (power > 0.65) shotType = 'flat';
    else if (aimY < 0.3) shotType = 'slice';
    else if (power < 0.22) shotType = 'lob';
    if (Phys.isVolleyRange('ai', ai.y)) shotType = 'volley';
    // Sometimes commit to following an aggressive shot into the net for the
    // rest of the point -- real approach shots are flat/sliced drives deep
    // into the court, almost never a defensive lob. Harder AI does this more.
    if (!ai.approaching && shotType !== 'volley') {
      const approachChance = { flat: 0.35, slice: 0.3, topspin: 0.22, lob: 0.03 }[shotType] || 0.15;
      if (Math.random() < approachChance * diff.aimSpread) ai.approaching = true;
    }
    const isForehand = (ai.x - (ai.preShotX ?? ai.x)) * ai.facing >= 0;
    ai.triggerSwing(shotType, isForehand);
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
      if (G.state === 'rally' || G.state === 'serveAimPlayer' || G.state === 'serveToss') {
        const j = G.joystick;
        if (j.pointerId === null && Math.hypot(x - j.baseX, y - j.baseY) <= j.radius * 1.7) {
          j.pointerId = id;
          return;
        }
        // Only the button set for the current phase is live: the serve
        // button while serving (toss, then a timed swing), the four shot
        // buttons once the ball is in play. Shots fire immediately on tap --
        // there's no hold/charge, timing quality is read at the instant of
        // the tap.
        if (G.state === 'serveAimPlayer') {
          const b = G.serveButton;
          if (b && Math.hypot(x - b.x, y - b.y) <= b.r * 1.1) beginServeToss();
        } else if (G.state === 'serveToss') {
          const b = G.serveButton;
          if (b && Math.hypot(x - b.x, y - b.y) <= b.r * 1.1) attemptServeSwing();
        } else {
          for (const b of G.shotButtons) {
            if (Math.hypot(x - b.x, y - b.y) <= b.r * 1.15) {
              triggerShotButton(b.key);
              return;
            }
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
      if (!rec.isTap) return;
      const inMatch = G.state === 'rally' || G.state === 'serveAimPlayer' || G.state === 'serveToss' || G.state === 'pointEnd' || G.state === 'serveAI';
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
        flashUntil: 0,
        flashSweet: false,
      }));
    }
    G.shotButtons.forEach((b) => {
      b.r = br;
      b.x = cx + offsets[b.key][0];
      b.y = cy + offsets[b.key][1];
    });

    // Serve button sits centered where the shot-button diamond is, but
    // bigger and alone -- the four shot buttons don't appear until the
    // serve is actually in play.
    if (!G.serveButton) {
      G.serveButton = {
        key: 'serve', label: SERVE_PRESET.label, color: SERVE_PRESET.color,
        r: 0, x: 0, y: 0, flashUntil: 0, flashSweet: false,
      };
    }
    G.serveButton.r = br * 1.55;
    G.serveButton.x = cx;
    G.serveButton.y = cy;
  }

  function sampleJoystick(dt) {
    const j = G.joystick;
    if (j.pointerId === null) {
      j.nx = 0;
      j.ny = 0;
    } else {
      const p = RetroInput.pointers.get(j.pointerId);
      if (!p) {
        j.pointerId = null;
        j.nx = 0;
        j.ny = 0;
      } else {
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
      }
    }
    const active = Math.hypot(j.nx, j.ny) >= 0.08;
    // Movement is never locked, even mid-swing -- shots fire instantly on tap
    // now, so there's no more "charging" period to worry about, but you must
    // still be free to chase/track the ball right up to contact. Whatever the
    // stick is tilted at the instant of the tap is read as the shot's aim
    // direction (see attemptPlayerHit).
    if (G.state === 'rally' && G.player) {
      G.player.setMoveInput(active ? j.nx : 0, active ? -j.ny : 0);
    } else if ((G.state === 'serveAimPlayer' || G.state === 'serveToss') && active) {
      const box = G.serviceBox;
      const RETICLE_SPEED = 4.2; // m/s
      G.reticle.x = Phys.clamp(G.reticle.x + j.nx * RETICLE_SPEED * dt, box.xMin - 0.6, box.xMax + 0.6);
      G.reticle.y = Phys.clamp(G.reticle.y - j.ny * RETICLE_SPEED * dt, box.yMin - 0.6, box.yMax + 0.6);
    }
  }

  function goMenu() {
    G.state = 'menu';
  }

  // How far the ball still has to go before it reaches whichever player is
  // about to receive it -- the only input the bullet-time effect needs.
  function slowMoTargetScale() {
    if (!Settings.slowMo) return 1;
    const ball = G.ball;
    if (!ball || ball.state !== 'inFlight' || !ball.lastHitBy) return 1;
    const receiver = ball.lastHitBy === 'player' ? G.ai : G.player;
    const dist = ball.distanceTo(receiver.x, receiver.y);
    if (dist >= SLOWMO_START_DIST) return 1;
    if (dist <= SLOWMO_FULL_DIST) return SLOWMO_MIN_SCALE;
    const t = (dist - SLOWMO_FULL_DIST) / (SLOWMO_START_DIST - SLOWMO_FULL_DIST);
    return SLOWMO_MIN_SCALE + t * (1 - SLOWMO_MIN_SCALE);
  }

  // ---------- Update ----------
  function update(dt) {
    G.frame++;
    G.elapsed += dt;
    computeControlLayout();
    sampleJoystick(dt);
    if (G.state === 'rally') {
      // Bullet-time: ease the whole sim's timestep toward the target scale
      // as the ball closes in on its receiver, and back out once it's hit
      // away again -- this naturally slows down for (and shows off) every
      // swing without any explicit start/stop bookkeeping.
      const target = slowMoTargetScale();
      const ease = 1 - Math.exp(-SLOWMO_EASE_RATE * dt);
      G.slowMoScale += (target - G.slowMoScale) * ease;
      const simDt = dt * G.slowMoScale;

      G.ball.update(simDt, ballEvent);
      G.player.update(simDt);
      if (G.ball.lastHitBy === 'player' && !G.aiReacted) {
        G.ai.startReaction();
        G.ai.triggerSplitStep();
        G.aiReacted = true;
      }
      if (G.ball.lastHitBy === 'ai') G.aiReacted = false;
      if (G.ball.lastHitBy === 'ai' && !G.playerReacted) {
        G.player.preShotX = G.player.x;
        G.player.triggerSplitStep();
        G.playerReacted = true;
      }
      if (G.ball.lastHitBy === 'player') G.playerReacted = false;
      G.ai.update(simDt, G.ball, aiSwing);
    } else {
      G.slowMoScale = 1;
      if (G.state === 'serveAI') {
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
      } else if (G.state === 'serveToss') {
        G.player.updateAnim(dt, false);
        G.ai.updateAnim(dt, false);
        const st = G.serveToss;
        if (st) {
          st.t += dt;
          const phase = Phys.clamp(st.t / st.duration, 0, 1);
          G.ball.x = G.player.x;
          G.ball.y = G.player.y - 0.15;
          G.ball.z = SERVE_START_Z + (SERVE_CONTACT_Z - SERVE_START_Z) * Math.sin(phase * Math.PI);
          // The toss must always resolve -- if the player never taps, swing
          // anyway (with whatever timing quality that leaves) rather than
          // hanging the point.
          if (st.t >= st.duration) attemptServeSwing();
        }
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
    }
    if (G.banner) {
      G.banner.t += dt;
      if (G.banner.t > G.banner.dur) G.banner = null;
    }
    if (G.shake) {
      G.shake.t += dt;
      if (G.shake.t >= G.shake.dur) G.shake = null;
    }
    if (G.crowdCheer > 0) {
      G.crowdCheer = Math.max(0, G.crowdCheer - dt * 1.5);
    }
    if (G.shotCallout) {
      G.shotCallout.t += dt;
      if (G.shotCallout.t > G.shotCallout.dur) G.shotCallout = null;
    }
  }

  // ---------- Rendering: world ----------
  function mirrorDeg(a) { return ((180 - a) + 360) % 360; }
  function lerpAngleDeg(a, b, t) {
    const diff = (((b - a + 540) % 360) - 180);
    return a + diff * t;
  }
  function easeIn(t) { return t * t; }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function lerpNum(a, b, t) { return a + (b - a) * t; }

  // Two-bone IK: given a shoulder and a desired hand position, solves for an
  // elbow that keeps the upper-arm/forearm lengths fixed -- so the joint
  // always bends a believable amount for how far the hand actually reaches
  // (barely bent near full extension, sharply bent up close), instead of an
  // arbitrary fixed offset that looked like a "kink" at short reaches.
  // bendSign picks which side the elbow points to (+1/-1).
  function solveArmIK(sx, sy, hx, hy, upperLen, foreLen, bendSign) {
    const dx = hx - sx, dy = hy - sy;
    const d = Math.hypot(dx, dy) || 0.0001;
    const maxReach = upperLen + foreLen - 0.001;
    const minReach = Math.abs(upperLen - foreLen) + 0.001;
    const dC = Phys.clamp(d, minReach, maxReach);
    const ux = dx / d, uy = dy / d;
    const baseAngle = Math.atan2(uy, ux);
    const cosA = Phys.clamp((upperLen * upperLen + dC * dC - foreLen * foreLen) / (2 * upperLen * dC), -1, 1);
    const a1 = Math.acos(cosA);
    const elbowAngle = baseAngle + bendSign * a1;
    return {
      elbowX: sx + Math.cos(elbowAngle) * upperLen,
      elbowY: sy + Math.sin(elbowAngle) * upperLen,
      handX: sx + ux * dC,
      handY: sy + uy * dC,
    };
  }

  function limbCapsule(x1, y1, x2, y2, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function jointDot(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawActor(actor, isPlayer) {
    const p = Court.project(actor.renderX, actor.renderY, 0);
    Court.drawShadow(ctx, actor.renderX, actor.renderY, 0, 0.55);
    const scale = p.scale;
    const h = scale * 1.8; // ~1.8m tall figure
    const w = h * 0.52;
    const vx = actor.vx || 0, vy = actor.vy || 0;
    const speed = Math.hypot(vx, vy);
    const speedT = Phys.clamp(speed / 6.5, 0, 1);
    const running = actor.anim === 'run';
    // A pure lateral shuffle (tracking sideways) takes shorter, quicker steps
    // than a full sprint chasing a ball down the line -- blend continuously
    // by how sideways-dominant the current movement is, rather than a hard
    // run/shuffle mode switch that would visibly pop.
    const lateralRatio = speed > 0.3 ? Phys.clamp(Math.abs(vx) / speed, 0, 1) : 0;
    const strideFreq = 9 + speedT * 8 + lateralRatio * 3;
    const strideAmp = h * (0.11 + speedT * 0.11) * (1 - lateralRatio * 0.22);
    const kit = isPlayer ? KITS.player : KITS.ai;
    const skin = '#e8b98c';
    const dir = actor.facing; // dominant (racket) shoulder side -- fixed per character

    // ---- swing state (computed early -- both legs and arms key off it) ----
    const isSwinging = actor.anim === 'swing';
    let swingT = 0;
    if (isSwinging) {
      const total = actor.swingDuration || 0.5;
      swingT = Phys.clamp((total - Math.max(actor.swingTimer, 0)) / total, 0, 1);
    }
    const swingEase = isSwinging ? Math.sin(swingT * Math.PI) : 0; // 0 at start/end, peaks mid-swing
    const shape = Phys.SWING_SHAPES[actor.swingType] || Phys.SWING_SHAPES.flat;
    const isServe = actor.swingType === 'serve';
    const isVolley = actor.swingType === 'volley';
    const tossingServe = isPlayer && G.state === 'serveToss';
    // A forehand is played on the dominant (racket) shoulder's own side, so
    // it uses the swing shapes exactly as authored; a backhand reaches
    // across the body to the opposite side, so it mirrors them. This was
    // previously inverted -- forehands were mirroring across the body and
    // backhands weren't, which is why contact looked cramped up near the
    // face instead of extended out to the correct side.
    const sweepSign = dir * (actor.isForehand ? 1 : -1);
    const mirror = sweepSign < 0;
    const back = mirror ? mirrorDeg(shape.back) : shape.back;
    const contact = mirror ? mirrorDeg(shape.contact) : shape.contact;
    const follow = mirror ? mirrorDeg(shape.follow) : shape.follow;

    // Split-step: a quick reactive hop the instant the opponent makes
    // contact, feet landing slightly wider -- real players are never flat
    // footed waiting for the ball.
    const splitDur = Phys.SPLIT_STEP_DURATION || 0.22;
    const splitFrac = actor.splitStepTimer > 0 ? actor.splitStepTimer / splitDur : 0;
    const splitHop = splitFrac > 0 ? Math.sin((1 - splitFrac) * Math.PI) : 0;

    // A groundstroke steps into the ball (front foot plants toward contact);
    // a serve gets an explosive little leg-drive lift instead; a volley's
    // feet barely move at all -- it's a block, not a swing.
    const strideStep = (isSwinging && !isServe && !isVolley) ? swingEase * h * 0.05 * sweepSign : 0;
    const serveLift = (isServe && isSwinging) ? swingEase * h * 0.035 : 0;

    const runBob = running ? Math.abs(Math.sin(actor.animTimer * strideFreq)) * h * 0.05 : Math.sin(actor.animTimer * 3.4) * h * 0.012;
    const bob = runBob + splitHop * h * 0.045 + serveLift;
    const baseY = p.y;

    ctx.save();
    ctx.translate(p.x, baseY - bob);

    // ---- legs: hip -> knee -> ankle capsules with a bending knee, not flat blocks ----
    const legSwing = running ? Math.sin(actor.animTimer * strideFreq) * strideAmp : strideStep;
    const stanceWiden = splitHop * w * 0.10;
    const legTop = -h * 0.42, legH = h * 0.42, legW = w * 0.145;
    const thighLen = legH * 0.53, shinLen = legH * 0.47;

    const drawLeg = (hipX, off) => {
      const kneeX = hipX + off * 0.3;
      const kneeY = legTop + thighLen;
      const ankleX = hipX + off * 0.16;
      const lift = Math.max(0, -off) * 0.18;
      const ankleY = -legH * 0.09 - lift;

      limbCapsule(hipX, legTop, kneeX, kneeY, legW, skin);
      limbCapsule(kneeX, kneeY, ankleX, ankleY, legW * 0.82, skin);
      jointDot(kneeX, kneeY, legW * 0.44, skin);

      // shorts overlay the top of the thigh only
      const sf = 0.45;
      limbCapsule(hipX, legTop, hipX + (kneeX - hipX) * sf, legTop + (kneeY - legTop) * sf, legW * 1.2, kit.shorts);

      // shoe
      ctx.fillStyle = kit.shoe;
      ctx.beginPath();
      ctx.ellipse(ankleX + dir * legW * 0.35, ankleY + legW * 0.15, legW * 0.95, legW * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    drawLeg(-w * 0.17 - stanceWiden, legSwing);
    drawLeg(w * 0.17 + stanceWiden, -legSwing);

    // hip: rounds off the join between legs and torso
    ctx.fillStyle = kit.shorts;
    ctx.beginPath();
    ctx.ellipse(0, legTop, w * 0.26, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    // body lean into the direction of travel (subtle, sells the running feel)
    const lean = running ? Phys.clamp(vx * 0.035, -0.16, 0.16) * w : 0;
    ctx.save();
    ctx.translate(lean, 0);

    // ---- torso: tapered shoulders-to-hips shape, not a flat rectangle ----
    const shoulderHalfW = w * 0.33, hipHalfW = w * 0.20;
    const torsoTopY = -h * 0.75, torsoBotY = legTop;
    ctx.beginPath();
    ctx.moveTo(-shoulderHalfW, torsoTopY);
    ctx.lineTo(shoulderHalfW, torsoTopY);
    ctx.lineTo(hipHalfW, torsoBotY);
    ctx.lineTo(-hipHalfW, torsoBotY);
    ctx.closePath();
    const torsoGrad = ctx.createLinearGradient(-shoulderHalfW, 0, shoulderHalfW, 0);
    torsoGrad.addColorStop(0, kit.shirtShade);
    torsoGrad.addColorStop(0.5, kit.shirt);
    torsoGrad.addColorStop(1, kit.shirtShade);
    ctx.fillStyle = torsoGrad;
    ctx.fill();
    // trim stripe down one side + collar
    ctx.fillStyle = kit.trim;
    ctx.fillRect(w * 0.14, torsoTopY, w * 0.06, torsoBotY - torsoTopY);
    ctx.fillRect(-w * 0.1, torsoTopY, w * 0.2, h * 0.05);

    // neck
    limbCapsule(0, torsoTopY + h * 0.015, 0, -h * 0.865, w * 0.13, skin);

    // head + hair + headband
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -h * 0.92, w * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = kit.hair;
    ctx.beginPath();
    ctx.arc(0, -h * 0.975, w * 0.216, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = kit.trim;
    ctx.fillRect(-w * 0.2, -h * 0.94, w * 0.4, h * 0.03);

    let angleDeg;
    if (isSwinging) {
      angleDeg = swingT < 0.35
        ? lerpAngleDeg(back, contact, easeIn(swingT / 0.35))
        : lerpAngleDeg(contact, follow, easeOut((swingT - 0.35) / 0.65));
    } else {
      // Racket angle only matters for which way the head/strings face --
      // hand placement (neutral grip vs. running carry) is set separately
      // below, so this just needs to look like a natural wrist angle.
      angleDeg = dir > 0 ? 100 : 80;
    }
    const toXY = (deg) => {
      const r = (deg * Math.PI) / 180;
      return [Math.cos(r), -Math.sin(r)];
    };
    const [adx, ady] = toXY(angleDeg);

    // Hips/shoulders "fire" into a groundstroke rather than just the arm --
    // a cheap approximation of the coil-and-release weight transfer, done by
    // shifting both shoulder anchors together (clamped so they never pop
    // outside the torso outline) rather than literally rotating the torso
    // polygon, which would tear away from the arms on this flat capsule rig.
    const rotPunch = (isSwinging && !isServe && !isVolley) ? swingEase * 0.07 * sweepSign : 0;
    const shoulderSpan = shoulderHalfW * 0.92;

    const armLen = h * (isServe && isSwinging ? 0.62 : 0.5);
    const shoulderX = Phys.clamp(w * 0.30 * dir + rotPunch * w, -shoulderSpan, shoulderSpan);
    const shoulderY = isServe && isSwinging ? -h * 0.9 : -h * 0.72;
    const offShoulderX = Phys.clamp(-w * 0.28 * dir + rotPunch * w, -shoulderSpan, shoulderSpan);
    const offShoulderY = -h * 0.7;

    // Real upper-arm/forearm bone lengths -- fixed regardless of pose, so
    // the two-bone IK below always bends the elbow a believable amount for
    // how far the hand is actually reaching (see solveArmIK).
    const upperLen = h * 0.2, foreLen = h * 0.18;
    // Both elbows point outward, away from the torso centerline -- the
    // natural direction for a relaxed or reaching human arm.
    const bendSign = -dir;
    const offBendSign = dir;

    // ---- where each hand is trying to go ----
    // A full swing reaches the racket way out along the swing arc. At rest,
    // both hands hold the racket together at the grip, in front of the
    // stomach -- a real, neutral tennis-ready position -- and only drift
    // apart while sprinting, where the racket is carried in the dominant
    // hand and the other arm swings free for balance.
    const neutralGripX = dir * w * 0.05;
    const neutralGripY = -h * 0.56;
    const twoHandedBackhandSwing = isSwinging && !actor.isForehand && !isServe;

    let handTargetX, handTargetY, headExt;
    if (isSwinging) {
      const reach = 0.55;
      handTargetX = shoulderX + adx * armLen * reach;
      handTargetY = shoulderY + ady * armLen * reach;
      headExt = 0.42;
    } else if (running) {
      // carried low and in close, at hip height, on the dominant side
      const carryAngle = 260 + Math.sin(actor.animTimer * strideFreq) * 10 * dir;
      const [cdx, cdy] = toXY(carryAngle);
      handTargetX = shoulderX + cdx * armLen * 0.34;
      handTargetY = shoulderY + cdy * armLen * 0.34;
      headExt = 0.34;
    } else {
      handTargetX = neutralGripX;
      handTargetY = neutralGripY;
      headExt = 0.34;
    }

    let offTargetX, offTargetY;
    if (isServe && isSwinging) {
      const [odx2, ody2] = toXY(lerpNum(90, 55, swingT));
      offTargetX = offShoulderX + odx2 * offArmLenFor(0.5);
      offTargetY = offShoulderY - h * 0.18 + ody2 * offArmLenFor(0.5);
    } else if (tossingServe) {
      offTargetX = offShoulderX;
      offTargetY = offShoulderY - h * 0.5;
    } else if (twoHandedBackhandSwing) {
      offTargetX = handTargetX;
      offTargetY = handTargetY;
    } else if (running) {
      // free arm pumps opposite the legs, low, for balance
      const pumpAngle = 250 + Math.sin(actor.animTimer * strideFreq) * 35 * dir;
      const [odx3, ody3] = toXY(pumpAngle);
      offTargetX = offShoulderX + odx3 * (upperLen + foreLen) * 0.72;
      offTargetY = offShoulderY + ody3 * (upperLen + foreLen) * 0.72;
    } else {
      // resting on the racket throat -- the classic two-handed ready grip
      offTargetX = neutralGripX;
      offTargetY = neutralGripY;
    }
    function offArmLenFor(scale) { return h * scale * 0.55; }

    // sleeve caps smooth the join where each arm meets the torso
    jointDot(shoulderX, shoulderY, w * 0.13, kit.shirtShade);
    jointDot(offShoulderX, offShoulderY, w * 0.11, kit.shirtShade);

    const racketArm = solveArmIK(shoulderX, shoulderY, handTargetX, handTargetY, upperLen, foreLen, bendSign);
    const offArm = solveArmIK(offShoulderX, offShoulderY, offTargetX, offTargetY, upperLen, foreLen, offBendSign);
    const handX = racketArm.handX, handY = racketArm.handY;
    const offHandX = offArm.handX, offHandY = offArm.handY;

    // off (non-racket) arm: upper arm + forearm with an elbow joint --
    // always drawn, not just for a two-handed backhand.
    limbCapsule(offShoulderX, offShoulderY, offArm.elbowX, offArm.elbowY, w * 0.135, skin);
    limbCapsule(offArm.elbowX, offArm.elbowY, offHandX, offHandY, w * 0.115, skin);
    jointDot(offArm.elbowX, offArm.elbowY, w * 0.075, skin);
    jointDot(offHandX, offHandY, w * 0.08, skin);

    // racket arm: upper arm + forearm with an elbow joint
    limbCapsule(shoulderX, shoulderY, racketArm.elbowX, racketArm.elbowY, w * 0.15, skin);
    limbCapsule(racketArm.elbowX, racketArm.elbowY, handX, handY, w * 0.125, skin);
    jointDot(racketArm.elbowX, racketArm.elbowY, w * 0.08, skin);
    jointDot(handX, handY, w * 0.09, skin);

    // racket -- extends as a natural continuation of the forearm (wrist to
    // string bed), not a separately tracked angle, so it never looks like
    // it's floating off at an angle unrelated to where the arm actually is.
    const fdx = handX - racketArm.elbowX, fdy = handY - racketArm.elbowY;
    const fdist = Math.hypot(fdx, fdy) || 1;
    const fux = fdx / fdist, fuy = fdy / fdist;
    const angle = Math.atan2(fuy, fux);
    const rHeadX = handX + fux * armLen * headExt;
    const rHeadY = handY + fuy * armLen * headExt;
    ctx.strokeStyle = '#1c1c1c';
    ctx.lineWidth = Math.max(1.5, w * 0.08);
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(rHeadX, rHeadY);
    ctx.stroke();
    const shotColor = (SHOT_PRESETS[actor.swingType] && SHOT_PRESETS[actor.swingType].color) || '#e6e6e6';
    const impactT = isSwinging ? Phys.clamp(1 - Math.abs(swingT - 0.38) / 0.22, 0, 1) : 0;
    ctx.fillStyle = impactT > 0 ? shotColor : 'rgba(232,230,222,0.92)';
    ctx.beginPath();
    ctx.ellipse(rHeadX, rHeadY, w * 0.22, w * 0.3, angle, 0, Math.PI * 2);
    ctx.fill();

    // strings: a light crosshatch inside the racket head, in its local frame
    ctx.save();
    ctx.translate(rHeadX, rHeadY);
    ctx.rotate(angle);
    ctx.strokeStyle = 'rgba(70,65,55,0.55)';
    ctx.lineWidth = Math.max(0.5, w * 0.016);
    for (let k = -2; k <= 2; k++) {
      const t = (k / 3) * w * 0.28;
      ctx.beginPath(); ctx.moveTo(-w * 0.19, t); ctx.lineTo(w * 0.19, t); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(t * 0.75, -w * 0.28); ctx.lineTo(t * 0.75, w * 0.28); ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = '#1c1c1c';
    ctx.lineWidth = Math.max(1.2, w * 0.045);
    ctx.beginPath();
    ctx.ellipse(rHeadX, rHeadY, w * 0.22, w * 0.3, angle, 0, Math.PI * 2);
    ctx.stroke();

    // brief colored impact flash at contact, tinted per shot type -- kept
    // tight to the racket head so it never washes over the face on a
    // backhand or volley, where contact naturally happens closer to the body.
    if (impactT > 0.05) {
      ctx.globalAlpha = impactT * 0.7;
      ctx.fillStyle = shotColor;
      ctx.beginPath();
      ctx.arc(rHeadX, rHeadY, w * (0.24 + impactT * 0.2), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore(); // lean
    ctx.restore(); // translate
  }

  function drawBall() {
    const b = G.ball;
    const hotTrail = G.elapsed < G.sweetTrailUntil;
    for (let i = 0; i < b.trail.length; i++) {
      const t = b.trail[i];
      const tp = Court.project(t.x, t.y, t.z);
      const alpha = (i / b.trail.length) * (hotTrail ? 0.55 : 0.35);
      ctx.fillStyle = hotTrail ? `rgba(255,140,40,${alpha})` : `rgba(216,230,58,${alpha})`;
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

  function drawShotCallout() {
    const c = G.shotCallout;
    if (!c) return;
    const life = Phys.clamp(c.t / c.dur, 0, 1);
    const alpha = life > 0.6 ? Phys.clamp((1 - life) / 0.4, 0, 1) : 1;
    const p = Court.project(c.x, c.y, 2.2 + life * 1.4);
    ctx.save();
    ctx.globalAlpha = alpha;
    const scale = Math.max(2, Math.min(4, Math.floor(logicalW / 260)));
    Font.drawTextCenteredShadowed(ctx, c.text, p.x, p.y, scale, '#ff9c3c');
    ctx.restore();
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
    // Camera shake/zoom-punch on a sweet-spot hit -- applied only to the
    // world-space scene, never to the HUD/banner, which stay screen-fixed.
    ctx.save();
    if (G.shake) {
      const decay = 1 - G.shake.t / G.shake.dur;
      const mag = G.shake.mag * decay * decay;
      const ang = G.elapsed * 90;
      const ox = Math.sin(ang) * mag;
      const oy = Math.cos(ang * 1.3) * mag * 0.6;
      const zoom = 1 + 0.025 * decay;
      ctx.translate(logicalW / 2, logicalH / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-logicalW / 2 + ox, -logicalH / 2 + oy);
    }

    Court.render(ctx, G.elapsed, G.crowdCheer);
    drawServiceBoxHighlight();

    const drawables = [
      { y: G.player.renderY, draw: () => drawActor(G.player, true) },
      { y: G.ai.renderY, draw: () => drawActor(G.ai, false) },
      { y: G.ball.y, draw: () => drawBall() },
    ];
    drawables.sort((a, b) => b.y - a.y);
    drawables.forEach((d) => d.draw());
    drawShotCallout();
    ctx.restore();

    drawSlowMoVignette();
    drawHud();
    drawBanner();
  }

  // A faint cool-toned edge vignette that reads as "time is dilating" without
  // ever obscuring the ball or the swing it's there to show off.
  function drawSlowMoVignette() {
    const intensity = Phys.clamp((1 - G.slowMoScale - 0.05) / 0.6, 0, 1);
    if (intensity <= 0) return;
    const cx = logicalW / 2, cy = logicalH / 2;
    const outerR = Math.hypot(cx, cy);
    const grad = ctx.createRadialGradient(cx, cy, outerR * 0.55, cx, cy, outerR);
    grad.addColorStop(0, 'rgba(60,110,200,0)');
    grad.addColorStop(1, `rgba(30,60,140,${0.28 * intensity})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, logicalW, logicalH);
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

  // A fixed small corner radius, unlike drawPill's h/2 -- for panels/windows
  // that are taller than a button, where a pill radius would round them into
  // a blob instead of a rectangular frame.
  function drawWindow(x, y, w, h, r, fillColor, strokeColor) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fill();
    }
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
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
      Font.drawTextCenteredShadowed(ctx, 'JOYSTICK AIMS - TAP SERVE TO TOSS', logicalW / 2, logicalH - 20, Math.max(1, scale - 1), '#f4f1e6');
    } else if (G.state === 'serveToss') {
      Font.drawTextCenteredShadowed(ctx, 'TAP SERVE AGAIN AT THE PEAK!', logicalW / 2, logicalH - 20, Math.max(1, scale - 1), '#ffe678');
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

    if (G.state === 'rally' || G.state === 'serveAimPlayer' || G.state === 'serveToss') drawJoystickAndButtons();
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

    if (G.state === 'serveAimPlayer') {
      if (G.serveButton) drawShotButton(G.serveButton, 2);
    } else if (G.state === 'serveToss') {
      if (G.serveButton) {
        drawServeTossGauge(G.serveButton);
        drawShotButton(G.serveButton, 2);
      }
    } else {
      for (const b of G.shotButtons) drawShotButton(b, 1);
    }
  }

  // Buttons fire immediately on tap now -- this just flashes briefly to
  // confirm the tap landed, glowing gold for a sweet-spot hit.
  function drawShotButton(b, labelScale) {
    const flashing = G.elapsed < (b.flashUntil || 0);
    const r = flashing ? b.r * (b.flashSweet ? 1.28 : 1.14) : b.r;
    ctx.fillStyle = flashing ? (b.flashSweet ? '#ffe678' : b.color) : 'rgba(6,17,12,0.55)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 3;
    ctx.stroke();
    Font.drawTextCentered(ctx, b.label, b.x, b.y, labelScale, flashing ? '#0a1a12' : '#f4f1e6');

    if (flashing && b.flashSweet) {
      ctx.strokeStyle = 'rgba(255,230,120,0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // While the serve toss is in the air, a ring around the SERVE button shows
  // the toss's arc progress and highlights the sweet-spot timing zone near
  // its peak -- tap again when the marker crosses the gold band.
  function drawServeTossGauge(b) {
    const st = G.serveToss;
    if (!st) return;
    const phase = Phys.clamp(st.t / st.duration, 0, 1);
    const ringR = b.r + 10;

    ctx.strokeStyle = 'rgba(10,26,18,0.6)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(b.x, b.y, ringR, 0, Math.PI * 2);
    ctx.stroke();

    const zoneCenter = -Math.PI / 2 + Math.PI; // matches phase = 0.5
    ctx.strokeStyle = 'rgba(255,230,120,0.85)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(b.x, b.y, ringR, zoneCenter - 0.35, zoneCenter + 0.35);
    ctx.stroke();

    const markerAngle = -Math.PI / 2 + phase * Math.PI * 2;
    const mx = b.x + Math.cos(markerAngle) * ringR;
    const my = b.y + Math.sin(markerAngle) * ringR;
    ctx.fillStyle = '#f4f1e6';
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, Math.PI * 2);
    ctx.fill();
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
    Court.render(ctx, G.elapsed);
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
      G.state = 'courtSelect';
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
    addMenuButton(bx, by, bw, bh, `SLOW-MO SWINGS: ${Settings.slowMo ? 'ON' : 'OFF'}`, '#3a6fb0', () => {
      Settings.slowMo = !Settings.slowMo;
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

  function chooseCourtAndStart(court) {
    Settings.court = court;
    newMatch();
    startPoint();
  }

  // A modal pop-up (not a full screen swap) shown over the main menu before
  // every new match, so the court surface is a deliberate choice each time
  // rather than a buried settings toggle -- surface changes bounce/pace, so
  // it deserves the same visibility as picking difficulty.
  function screenCourtSelect() {
    drawTitleCourtBackdrop();
    ctx.fillStyle = 'rgba(6,15,11,0.62)';
    ctx.fillRect(0, 0, logicalW, logicalH);

    const panelW = Math.min(400, logicalW * 0.86);
    const panelH = Math.min(400, logicalH * 0.86);
    const panelX = (logicalW - panelW) / 2;
    const panelY = (logicalH - panelH) / 2;
    drawWindow(panelX, panelY, panelW, panelH, 16, 'rgba(10,26,18,0.95)', 'rgba(244,241,230,0.4)');

    const titleScale = Math.max(2, Math.min(3, Math.floor(logicalW / 280)));
    Font.drawTextCenteredShadowed(ctx, 'CHOOSE COURT', logicalW / 2, panelY + 34, titleScale, '#ffe678');

    G.buttons = [];
    const bw = panelW - 56;
    const bx = panelX + 28;
    let by = panelY + 68;
    const bh = 52, gap = 14;

    addMenuButton(bx, by, bw, bh, 'CLAY', '#c06a3c', () => chooseCourtAndStart('clay'));
    by += bh + gap;
    addMenuButton(bx, by, bw, bh, 'HARD COURT', '#2b6ca3', () => chooseCourtAndStart('hard'));
    by += bh + gap;
    addMenuButton(bx, by, bw, bh, 'GRASS', '#3f8a4a', () => chooseCourtAndStart('grass'));
    by += bh + gap;
    addMenuButton(bx, by, bw, bh, 'BACK', '#5a5a52', goMenu);

    const fscale = Math.max(1, Math.min(2, Math.floor(logicalW / 480)));
    Font.drawTextCentered(ctx, 'SURFACE CHANGES BOUNCE & PACE', logicalW / 2, panelY + panelH - 16, fscale, '#bdeccb');
  }

  function screenHowTo() {
    ctx.fillStyle = '#0e2418';
    ctx.fillRect(0, 0, logicalW, logicalH);

    const bw = Math.min(300, logicalW * 0.7), bh = 48;
    const bx = (logicalW - bw) / 2, by = logicalH - bh - 18;

    const lines = [
      'HOW TO PLAY',
      '',
      'JOYSTICK (LEFT) MOVES YOU.',
      '',
      'TAP A SHOT BUTTON (RIGHT) TO SWING -',
      'TIME IT RIGHT AS THE BALL ARRIVES FOR',
      'A GLOWING POWER SHOT. MISTIME IT AND',
      'IT COMES OUT WEAKER & SHORTER.',
      '',
      'THE ACTION SLOWS DOWN AS THE BALL',
      'CLOSES IN SO YOU CAN SEE THE SWING -',
      'TURN THIS OFF ANYTIME FROM THE MENU.',
      '',
      'TOPSPIN IS SAFE, FLAT IS FAST, SLICE',
      'IS SHORT, LOB IS HIGH & DEEP.',
      '',
      'KEEP MOVING RIGHT UP TO CONTACT - WHERE',
      'THE STICK POINTS WHEN YOU SWING IS',
      'WHERE THE SHOT GOES.',
      '',
      'TO SERVE: AIM WITH THE JOYSTICK, TAP',
      'SERVE TO TOSS THE BALL, THEN TAP IT',
      'AGAIN AT THE PEAK FOR A POWER SERVE.',
      '',
      'WIN BY MAKING THE CPU MISS, NET IT,',
      'OR HIT IT OUT.',
    ];

    const titleScale = Math.max(2, Math.min(4, Math.floor(logicalW / 260)));
    const availableH = by - 20;
    function measure(scale) {
      const titleLH = (titleScale + 1) * 11;
      const bodyLH = (scale + 1) * 10;
      const blankLH = bodyLH * 0.55;
      const totalH = titleLH + lines.slice(1).reduce((sum, l) => sum + (l === '' ? blankLH : bodyLH), 0);
      return { titleLH, bodyLH, blankLH, totalH };
    }
    let bodyScale = Math.max(1, Math.min(2, Math.floor(logicalW / 480)));
    let m = measure(bodyScale);
    if (m.totalH > availableH && bodyScale > 1) {
      bodyScale = 1;
      m = measure(bodyScale);
    }
    const { titleLH, bodyLH, blankLH, totalH } = m;
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
      case 'courtSelect': screenCourtSelect(); break;
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
