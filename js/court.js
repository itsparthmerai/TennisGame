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
    playerMinY: 0.9, // how close to the net the human may approach
    playerMaxY: null, // set below
    playerMinX: -1.8,
    playerMaxX: null, // set below
    aiMinY: null,
    aiMaxY: 23.77 - 0.9,
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

  // Simple ambient palette for the retro-arcade look.
  const PALETTE = {
    sky1: '#12233a',
    sky2: '#1c3a52',
    stands: '#0b1a28',
    standsLight: '#16324a',
    courtA: '#1c6b46',
    courtB: '#1a6140',
    courtOut: '#124f34',
    line: '#f4f1e6',
    net: '#e9e6da',
    netPost: '#3a2a1a',
  };

  function drawBackground(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, centerY);
    g.addColorStop(0, PALETTE.sky1);
    g.addColorStop(1, PALETTE.sky2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W_PX, centerY + 2);

    // Retro pixel "stands" band across the horizon.
    const standH = Math.max(18, H_PX * 0.06);
    const standY = centerY - standH * 0.35;
    ctx.fillStyle = PALETTE.stands;
    ctx.fillRect(0, standY, W_PX, standH);
    const blockW = Math.max(10, W_PX / 48);
    for (let i = 0; i * blockW < W_PX; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = PALETTE.standsLight;
        ctx.fillRect(i * blockW, standY, blockW * 0.9, standH * 0.55);
      }
    }
  }

  function polyFromWorld(pts) {
    return pts.map(([x, y, z]) => project(x, y, z || 0));
  }

  function drawCourtSurface(ctx) {
    const { W, L } = COURT;
    const outMargin = 3.0;
    // Outer "out of bounds" run-off area
    const outer = polyFromWorld([
      [-outMargin, -outMargin],
      [W + outMargin, -outMargin],
      [W + outMargin, L + outMargin],
      [-outMargin, L + outMargin],
    ]);
    ctx.fillStyle = PALETTE.courtOut;
    ctx.beginPath();
    ctx.moveTo(outer[0].x, outer[0].y);
    for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i].x, outer[i].y);
    ctx.closePath();
    ctx.fill();

    // In-bounds playing surface, split near/far half for subtle checker shading.
    const half1 = polyFromWorld([[0, 0], [W, 0], [W, COURT.NET_Y], [0, COURT.NET_Y]]);
    const half2 = polyFromWorld([[0, COURT.NET_Y], [W, COURT.NET_Y], [W, L], [0, L]]);
    ctx.fillStyle = PALETTE.courtA;
    ctx.beginPath();
    ctx.moveTo(half1[0].x, half1[0].y);
    for (let i = 1; i < half1.length; i++) ctx.lineTo(half1[i].x, half1[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PALETTE.courtB;
    ctx.beginPath();
    ctx.moveTo(half2[0].x, half2[0].y);
    for (let i = 1; i < half2.length; i++) ctx.lineTo(half2[i].x, half2[i].y);
    ctx.closePath();
    ctx.fill();
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

  function render(ctx) {
    drawBackground(ctx);
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
