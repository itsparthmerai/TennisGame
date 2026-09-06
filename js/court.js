// World geometry (meters, real singles tennis dimensions) + a simple but
// legit perspective camera projecting the court onto the 2D canvas.
(function (global) {
  'use strict';

  const COURT = {
    W: 8.23, // singles width
    L: 23.77, // baseline to baseline
    NET_Y: 23.77 / 2,
    NET_H: 0.914,
    NET_H_CENTER: 0.914, // approximated flat (real net dips slightly at center)
    SERVICE_LINE_FROM_NET: 6.4,
    playerMinY: -2.2, // how far behind the baseline the human may retreat
    playerMaxY: null, // set below
    playerMinX: -1.8,
    playerMaxX: null, // set below
    aiMinY: null,
    aiMaxY: 23.77 + 2.2,
  };
  COURT.playerMaxY = COURT.NET_Y - 0.9;
  COURT.aiMinY = COURT.NET_Y + 0.9;
  COURT.playerMaxX = COURT.W + 1.8;

  // --- Camera ---
  const CAM = {
    height: 4.6,
    backY: 7.2, // camera sits this far behind the near baseline (y=0)
    tiltDeg: 21, // downward tilt from horizontal
    vFovDeg: 46,
  };
  CAM.y = -CAM.backY;
  CAM.tilt = (CAM.tiltDeg * Math.PI) / 180;
  CAM.sinT = Math.sin(CAM.tilt);
  CAM.cosT = Math.cos(CAM.tilt);

  let W_PX = 960, H_PX = 540;
  let focal = 0;
  let centerX = 0, centerY = 0;

  function setViewport(w, h) {
    W_PX = w;
    H_PX = h;
    centerX = W_PX / 2;
    centerY = H_PX * 0.46;
    focal = (H_PX / 2) / Math.tan(((CAM.vFovDeg * Math.PI) / 180) / 2);
  }
  setViewport(960, 540);

  // Projects a world point (x,y,z) [meters, z=height off ground] to screen {x,y,scale,depth}.
  function project(x, y, z) {
    const vx = x - COURT.W / 2;
    const vy = y - CAM.y;
    const vz = z - CAM.height;
    const forward = vy * CAM.cosT - vz * CAM.sinT;
    const up = vy * CAM.sinT + vz * CAM.cosT;
    const f = Math.max(forward, 0.05);
    const sx = centerX + (vx / f) * focal;
    const sy = centerY - (up / f) * focal;
    const scale = focal / f;
    return { x: sx, y: sy, scale, depth: f };
  }

  function groundScaleAt(y) {
    return project(COURT.W / 2, y, 0).scale;
  }

  // Wimbledon-inspired palette: dark green + purple stands, natural grass.
  const PALETTE = {
    sky1: '#0a1712',
    sky2: '#132c22',
    stands: '#0c2318',
    standsLight: '#2a1938',
    standRiser: '#0e2c1e',
    standRiserLight: '#3a2352',
    courtA: '#6a9c46',
    courtB: '#5d8d3c',
    courtOut: '#3f6b2c',
    courtWorn: 'rgba(134,107,64,0.5)',
    line: '#f8f8f2',
    net: '#e9e6da',
    netPost: '#173323',
    backWall: '#0c2c1d',
    backWallLine: '#154531',
  };

  function drawBackground(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, centerY);
    g.addColorStop(0, PALETTE.sky1);
    g.addColorStop(1, PALETTE.sky2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W_PX, H_PX);
  }

  // ---------- Stadium: tiered stands + crowd on three sides ----------
  const FAN_COLORS = ['#e8e4d6', '#8a97a8', '#5c4a6e', '#2f4a3a', '#b0463f', '#3f5c8a'];
  const TIERS = 5;

  function buildTierSet(kind) {
    // kind: 'far' | 'left' | 'right' -- each tier rakes upward+outward with a
    // row of "seated" fans along it. Positions are fixed once (crowd doesn't
    // need to be regenerated every frame); a subtle bob is applied at draw time.
    const tiers = [];
    for (let i = 0; i < TIERS; i++) {
      const nearD = 2 + i * 1.7;
      const farD = nearD + 1.7;
      const zNear = 0.8 + i * 1.35;
      const zFar = zNear + 1.35;
      const fans = [];
      const count = kind === 'far' ? 26 : 16;
      const spanMin = kind === 'far' ? -4.2 : -2.5;
      const spanMax = kind === 'far' ? COURT.W + 4.2 : COURT.L + 2.5;
      for (let f = 0; f < count; f++) {
        const t = (f + 0.5) / count;
        const along = spanMin + t * (spanMax - spanMin);
        const seatD = nearD + 0.55 * (farD - nearD);
        const seatZ = zNear + 0.6 * (zFar - zNear);
        let x, y;
        if (kind === 'far') { x = along; y = COURT.L + seatD; }
        else if (kind === 'left') { x = -seatD; y = along; }
        else { x = COURT.W + seatD; y = along; }
        fans.push({
          x, y, z: seatZ,
          color: FAN_COLORS[(f * 7 + i * 3) % FAN_COLORS.length],
          phase: ((f * 37 + i * 91) % 100) / 100 * Math.PI * 2,
          bobSpeed: 1.4 + ((f * 13 + i) % 5) * 0.15,
        });
      }
      tiers.push({ kind, i, nearD, farD, zNear, zFar, fans });
    }
    return tiers;
  }

  const STANDS = {
    far: buildTierSet('far'),
    left: buildTierSet('left'),
    right: buildTierSet('right'),
  };

  function tierQuadWorld(tier) {
    const { kind, nearD, farD, zNear, zFar } = tier;
    if (kind === 'far') {
      const xMin = -4.2, xMax = COURT.W + 4.2;
      return [
        [xMin, COURT.L + nearD, zNear], [xMax, COURT.L + nearD, zNear],
        [xMax, COURT.L + farD, zFar], [xMin, COURT.L + farD, zFar],
      ];
    }
    const yMin = -2.5, yMax = COURT.L + 2.5;
    if (kind === 'left') {
      return [
        [-nearD, yMin, zNear], [-nearD, yMax, zNear],
        [-farD, yMax, zFar], [-farD, yMin, zFar],
      ];
    }
    return [
      [COURT.W + nearD, yMin, zNear], [COURT.W + nearD, yMax, zNear],
      [COURT.W + farD, yMax, zFar], [COURT.W + farD, yMin, zFar],
    ];
  }

  function drawFan(ctx, fan, time, cheer) {
    const c = cheer || 0;
    const bob = Math.sin(time * fan.bobSpeed * (1 + c * 1.6) + fan.phase) * (0.06 + c * 0.16);
    const p = project(fan.x, fan.y, fan.z + bob);
    if (p.depth < 0.1) return;
    const s = p.scale;
    const bodyH = Math.max(1.2, s * 0.55);
    const bodyW = bodyH * 0.62;
    const headR = bodyW * 0.42;
    ctx.fillStyle = fan.color;
    ctx.fillRect(p.x - bodyW / 2, p.y - bodyH, bodyW, bodyH);
    ctx.beginPath();
    ctx.arc(p.x, p.y - bodyH - headR * 0.75, headR, 0, Math.PI * 2);
    ctx.fillStyle = '#e8b98a';
    ctx.fill();

    // Arms shoot up on a crowd-reaction pulse (a sweet-spot hit, big point).
    if (c > 0.12) {
      ctx.strokeStyle = fan.color;
      ctx.lineWidth = Math.max(1, bodyW * 0.22);
      ctx.lineCap = 'round';
      const armLift = bodyH * (0.5 + c * 0.7);
      ctx.beginPath();
      ctx.moveTo(p.x - bodyW * 0.3, p.y - bodyH * 0.7);
      ctx.lineTo(p.x - bodyW * 0.55, p.y - bodyH * 0.7 - armLift);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x + bodyW * 0.3, p.y - bodyH * 0.7);
      ctx.lineTo(p.x + bodyW * 0.55, p.y - bodyH * 0.7 - armLift);
      ctx.stroke();
    }
  }

  function drawStandSet(ctx, tiers, time, cheer) {
    for (const tier of tiers) {
      const quad = polyFromWorld(tierQuadWorld(tier));
      const shade = tier.i % 2 === 0 ? PALETTE.standRiser : PALETTE.standRiserLight;
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      for (let k = 1; k < quad.length; k++) ctx.lineTo(quad[k].x, quad[k].y);
      ctx.closePath();
      ctx.fill();
    }
    // Fans drawn after all risers so nearer tiers' crowd isn't hidden by a farther tier's fill.
    for (const tier of tiers) {
      for (const fan of tier.fans) drawFan(ctx, fan, time, cheer);
    }
  }

  function drawFloodlight(ctx, x, y) {
    const base = project(x, y, 0);
    const top = project(x, y, 13);
    if (top.depth < 0.1) return;
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = Math.max(1, top.scale * 0.06);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();

    const glowR = Math.max(6, top.scale * 1.4);
    const grad = ctx.createRadialGradient(top.x, top.y, 0, top.x, top.y, glowR);
    grad.addColorStop(0, 'rgba(255,250,220,0.9)');
    grad.addColorStop(1, 'rgba(255,250,220,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(top.x, top.y, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f4f1cc';
    const headW = Math.max(3, top.scale * 0.5);
    ctx.fillRect(top.x - headW / 2, top.y - headW * 0.25, headW, headW * 0.5);
  }

  function drawStadium(ctx, time, cheer) {
    drawStandSet(ctx, STANDS.left, time, cheer);
    drawStandSet(ctx, STANDS.right, time, cheer);
    drawStandSet(ctx, STANDS.far, time, cheer);
    drawBackWall(ctx);
    drawFloodlight(ctx, -5.5, -2.5);
    drawFloodlight(ctx, COURT.W + 5.5, -2.5);
    drawFloodlight(ctx, -5.5, COURT.L + 2.5);
    drawFloodlight(ctx, COURT.W + 5.5, COURT.L + 2.5);
  }

  function polyFromWorld(pts) {
    return pts.map(([x, y, z]) => project(x, y, z || 0));
  }

  function fillPoly(ctx, quad, color) {
    if (color) ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    for (let i = 1; i < quad.length; i++) ctx.lineTo(quad[i].x, quad[i].y);
    ctx.closePath();
    ctx.fill();
  }

  function drawWornPatch(ctx, x, y, rxM, ryM) {
    const p = project(x, y, 0.002);
    ctx.fillStyle = PALETTE.courtWorn;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rxM * p.scale, ryM * p.scale * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawCourtSurface(ctx) {
    const { W, L, NET_Y } = COURT;
    const outMargin = 3.0;

    // Surrounding grass run-off, out of bounds.
    fillPoly(ctx, polyFromWorld([
      [-outMargin, -outMargin], [W + outMargin, -outMargin],
      [W + outMargin, L + outMargin], [-outMargin, L + outMargin],
    ]), PALETTE.courtOut);

    // Mowed-stripe grass across the full length, alternating light/dark bands
    // the way a real lawn (Centre Court included) is cut.
    const stripes = 16;
    const stripeH = (L + outMargin * 2) / stripes;
    for (let i = 0; i < stripes; i++) {
      const y0 = Math.max(-outMargin + i * stripeH, 0);
      const y1 = Math.min(-outMargin + (i + 1) * stripeH, L);
      if (y1 <= y0) continue;
      fillPoly(ctx, polyFromWorld([[0, y0], [W, y0], [W, y1], [0, y1]]), i % 2 === 0 ? PALETTE.courtA : PALETTE.courtB);
    }

    // Worn/bare patches where players actually stand -- baseline centers,
    // the forecourt volley spots, and the service-line "T" -- like grass
    // courts look by the second week of a tournament.
    drawWornPatch(ctx, W / 2, 0.55, 1.15, 0.9);
    drawWornPatch(ctx, W / 2, L - 0.55, 1.15, 0.9);
    drawWornPatch(ctx, W * 0.28, NET_Y - 6.4, 0.55, 0.45);
    drawWornPatch(ctx, W * 0.72, NET_Y - 6.4, 0.55, 0.45);
    drawWornPatch(ctx, W * 0.28, NET_Y + 6.4, 0.55, 0.45);
    drawWornPatch(ctx, W * 0.72, NET_Y + 6.4, 0.55, 0.45);
    drawWornPatch(ctx, W / 2, NET_Y - 1.1, 0.85, 0.55);
    drawWornPatch(ctx, W / 2, NET_Y + 1.1, 0.85, 0.55);
  }

  function drawBackWall(ctx) {
    const { W, L } = COURT;
    const xMin = -2.2, xMax = W + 2.2;
    const yNear = L + 0.35, yFar = L + 1.7;
    const zTop = 3.1;
    const wall = polyFromWorld([[xMin, yNear, zTop], [xMax, yNear, zTop], [xMax, yFar, 0], [xMin, yFar, 0]]);
    fillPoly(ctx, wall, PALETTE.backWall);

    // A few vertical panel seams for texture.
    ctx.strokeStyle = PALETTE.backWallLine;
    ctx.lineWidth = 1.5;
    const panels = 10;
    for (let i = 1; i < panels; i++) {
      const t = i / panels;
      const x = xMin + (xMax - xMin) * t;
      const top = project(x, yNear, zTop);
      const bot = project(x, yFar, 0);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bot.x, bot.y);
      ctx.stroke();
    }
  }

  function strokeWorldLine(ctx, a, b, widthM) {
    const p0 = project(a[0], a[1], 0.001);
    const p1 = project(b[0], b[1], 0.001);
    const w = Math.max(1.2, ((p0.scale + p1.scale) / 2) * widthM);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  function drawLines(ctx) {
    const { W, L, NET_Y, SERVICE_LINE_FROM_NET } = COURT;
    ctx.strokeStyle = PALETTE.line;
    ctx.lineCap = 'square';
    const lw = 0.055; // line width in meters
    // Sidelines & baselines
    strokeWorldLine(ctx, [0, 0], [0, L], lw);
    strokeWorldLine(ctx, [W, 0], [W, L], lw);
    strokeWorldLine(ctx, [0, 0], [W, 0], lw);
    strokeWorldLine(ctx, [0, L], [W, L], lw);
    // Service lines
    const nearSvc = NET_Y - SERVICE_LINE_FROM_NET;
    const farSvc = NET_Y + SERVICE_LINE_FROM_NET;
    strokeWorldLine(ctx, [0, nearSvc], [W, nearSvc], lw);
    strokeWorldLine(ctx, [0, farSvc], [W, farSvc], lw);
    // Center service line
    strokeWorldLine(ctx, [W / 2, nearSvc], [W / 2, farSvc], lw);
    // Center marks on baselines
    strokeWorldLine(ctx, [W / 2, 0], [W / 2, 0.25], lw);
    strokeWorldLine(ctx, [W / 2, L], [W / 2, L - 0.25], lw);
  }

  function drawNet(ctx) {
    const { W, NET_Y, NET_H } = COURT;
    const baseL = project(-0.3, NET_Y, 0);
    const baseR = project(W + 0.3, NET_Y, 0);
    const topL = project(-0.3, NET_Y, NET_H);
    const topR = project(W + 0.3, NET_Y, NET_H);

    // Net mesh
    ctx.fillStyle = 'rgba(233,230,218,0.55)';
    ctx.beginPath();
    ctx.moveTo(topL.x, topL.y);
    ctx.lineTo(topR.x, topR.y);
    ctx.lineTo(baseR.x, baseR.y);
    ctx.lineTo(baseL.x, baseL.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(10,20,15,0.35)';
    ctx.lineWidth = 1;
    const cols = 22;
    for (let i = 0; i <= cols; i++) {
      const t = i / cols;
      const x0 = topL.x + (topR.x - topL.x) * t;
      const y0 = topL.y + (topR.y - topL.y) * t;
      const x1 = baseL.x + (baseR.x - baseL.x) * t;
      const y1 = baseL.y + (baseR.y - baseL.y) * t;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    const rows = 6;
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const xL = topL.x + (baseL.x - topL.x) * t;
      const yL = topL.y + (baseL.y - topL.y) * t;
      const xR = topR.x + (baseR.x - topR.x) * t;
      const yR = topR.y + (baseR.y - topR.y) * t;
      ctx.beginPath();
      ctx.moveTo(xL, yL);
      ctx.lineTo(xR, yR);
      ctx.stroke();
    }

    // Top tape
    ctx.strokeStyle = PALETTE.net;
    ctx.lineWidth = Math.max(2, topL.scale * 0.08);
    ctx.beginPath();
    ctx.moveTo(topL.x, topL.y);
    ctx.lineTo(topR.x, topR.y);
    ctx.stroke();

    // Posts
    ctx.fillStyle = PALETTE.netPost;
    const postW = Math.max(2, topL.scale * 0.08);
    ctx.fillRect(topL.x - postW / 2, topL.y - 4, postW, baseL.y - topL.y + 8);
    ctx.fillRect(topR.x - postW / 2, topR.y - 4, postW, baseR.y - topR.y + 8);
  }

  function drawShadow(ctx, x, y, z, radiusM) {
    const p = project(x, y, 0);
    const heightFactor = Math.max(0.25, 1 - Math.min(z, 3) * 0.28);
    const rx = Math.max(1.2, radiusM * p.scale * heightFactor);
    const ry = rx * 0.4;
    ctx.fillStyle = `rgba(0,0,0,${0.35 * heightFactor})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function render(ctx, time, cheer) {
    drawBackground(ctx);
    drawStadium(ctx, time || 0, cheer || 0);
    drawCourtSurface(ctx);
    drawLines(ctx);
    drawNet(ctx);
  }

  global.Court = {
    COURT,
    CAM,
    PALETTE,
    setViewport,
    project,
    groundScaleAt,
    drawShadow,
    render,
    get width() { return W_PX; },
    get height() { return H_PX; },
    get centerX() { return centerX; },
    get centerY() { return centerY; },
  };
})(window);
