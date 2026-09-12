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

  // A sunny day at a grand-slam-style venue: warm alternating stand colors,
  // trees and a glass building beyond the stands, clay/hard/grass swapped in
  // by setSurface() below. courtA/B/Out/Worn are the only fields it touches;
  // everything else (stands, sky, trees, building) stays the same across all
  // three surfaces.
  const PALETTE = {
    sky1: '#4f96cf',
    sky2: '#cfe7ee',
    standRiser: '#c97a3d',
    standRiserLight: '#4f7a52',
    courtA: '#6a9c46',
    courtB: '#5d8d3c',
    courtOut: '#3f6b2c',
    courtWorn: 'rgba(134,107,64,0.5)',
    line: '#f8f8f2',
    net: '#e9e6da',
    netPost: '#173323',
    backWall: '#1d4a35',
    backWallLine: '#2f6b4c',
    cloud: 'rgba(255,255,255,0.88)',
    treeCanopy: '#3f6b3a',
    treeCanopyLight: '#5c8a4f',
    treeTrunk: '#5b4630',
    buildingGlass: '#9fb7bf',
    buildingFrame: '#5f7078',
  };

  // Real courts differ in look as much as they do in bounce: grass is a
  // mowed lawn with alternating stripe bands, hard court and clay are a
  // flat, single-tone surface (mowed:false skips the stripe loop below).
  const SURFACE_PALETTES = {
    grass: { courtA: '#6a9c46', courtB: '#5d8d3c', courtOut: '#3f6b2c', courtWorn: 'rgba(134,107,64,0.5)', mowed: true },
    hard: { courtA: '#2b6ca3', courtB: '#2b6ca3', courtOut: '#1c5c3a', courtWorn: 'rgba(210,220,230,0.4)', mowed: false },
    clay: { courtA: '#c06a3c', courtB: '#c06a3c', courtOut: '#7a3f22', courtWorn: 'rgba(235,208,175,0.55)', mowed: false },
  };
  let currentSurface = 'grass';
  function setSurface(name) {
    const key = SURFACE_PALETTES[name] ? name : 'grass';
    currentSurface = key;
    const s = SURFACE_PALETTES[key];
    PALETTE.courtA = s.courtA;
    PALETTE.courtB = s.courtB;
    PALETTE.courtOut = s.courtOut;
    PALETTE.courtWorn = s.courtWorn;
  }

  function drawBackground(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, centerY);
    g.addColorStop(0, PALETTE.sky1);
    g.addColorStop(1, PALETTE.sky2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W_PX, H_PX);
  }

  // A handful of soft, overlapping-circle clouds drifting very slowly across
  // the upper sky. Screen-space (clouds are effectively at infinity, so a
  // world-space projection would buy nothing) with positions fixed once and
  // a slow time-based horizontal drift, wrapping around the width.
  const CLOUDS = [0.1, 0.32, 0.55, 0.78, 0.93].map((t, i) => ({
    xFrac: t,
    yFrac: 0.01 + ((i * 37) % 100) / 100 * 0.07,
    scale: 0.55 + ((i * 53) % 100) / 100 * 0.5,
    speed: 2.2 + (i % 3) * 1.1,
  }));

  function drawCloud(ctx, x, y, scale) {
    const r = 16 * scale;
    ctx.fillStyle = PALETTE.cloud;
    const puffs = [[-1.6, 0.1, 0.8], [-0.7, -0.35, 1], [0.3, -0.3, 1.05], [1.2, 0, 0.85], [0.1, 0.35, 0.9]];
    for (const [ox, oy, s] of puffs) {
      ctx.beginPath();
      ctx.arc(x + ox * r, y + oy * r, r * s * 0.62, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawClouds(ctx, time) {
    for (const c of CLOUDS) {
      const driftFrac = (c.xFrac + (time * c.speed) / 3600) % 1.15 - 0.075;
      const x = driftFrac * W_PX;
      const y = c.yFrac * H_PX;
      drawCloud(ctx, x, y, c.scale * Math.min(W_PX, H_PX) * 0.012);
    }
  }

  // ---------- Stadium: tiered stands, trees, and a distant building ----------
  // This camera tilts down 21 degrees to get a good low, court-level view for
  // gameplay -- a side effect is that anything both tall and far behind the
  // baseline projects above the top of the canvas (there is no vertical room
  // left for it), which is why the original tiers (topping out over 7m high)
  // never actually showed any sky above them. These sizes are tuned so the
  // stand top lands a bit below the canvas edge, leaving a real (if thin)
  // sky band for the tree line, building, and clouds to sit in.
  const TIERS = 3;

  function buildTierSet(kind) {
    // kind: 'far' | 'left' | 'right' -- each tier rakes upward+outward. Pure
    // geometry (no crowd figures) so the stands read as clean color bands.
    const tiers = [];
    for (let i = 0; i < TIERS; i++) {
      const nearD = 1.0 + i * 0.7;
      const farD = nearD + 0.7;
      const zNear = 0.45 + i * 0.42;
      const zFar = zNear + 0.42;
      tiers.push({ kind, i, nearD, farD, zNear, zFar });
    }
    return tiers;
  }

  const STANDS = {
    far: buildTierSet('far'),
    left: buildTierSet('left'),
    right: buildTierSet('right'),
  };

  // A tree line along the horizon behind the far baseline, so the venue reads
  // as a real place rather than an empty color gradient. Deliberately NOT
  // placed along the near sidelines: at this camera's steep angle, anything
  // this size gets close enough to the camera there to loom giant-sized over
  // the players, so the only place a tree can sit at a believable scale is
  // far behind the far end, all at roughly the same distance from camera.
  function buildTrees() {
    const trees = [];
    const spots = [-5, -2.5, -0.5, 1.5, 3.5, COURT.W / 2, COURT.W - 3.5, COURT.W - 1.5, COURT.W + 0.5, COURT.W + 2.5, COURT.W + 5];
    spots.forEach((x, i) => {
      trees.push({
        x,
        y: COURT.L + 4.3 + ((i * 31) % 100) / 100 * 1.2,
        h: 2.6 + ((i * 29) % 100) / 100 * 1.0,
        r: 1.1 + ((i * 41) % 100) / 100 * 0.5,
        lean: (((i * 17) % 100) / 100 - 0.5) * 0.4,
      });
    });
    return trees;
  }
  const TREES = buildTrees();

  function drawTree(ctx, tree) {
    const base = project(tree.x, tree.y, 0);
    if (base.depth < 0.1) return;
    const top = project(tree.x + tree.lean, tree.y, tree.h);
    const canopyR = tree.r * top.scale;
    ctx.strokeStyle = PALETTE.treeTrunk;
    ctx.lineWidth = Math.max(1.5, canopyR * 0.22);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y + canopyR * 0.3);
    ctx.stroke();
    ctx.fillStyle = PALETTE.treeCanopy;
    ctx.beginPath();
    ctx.arc(top.x, top.y, canopyR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.treeCanopyLight;
    ctx.beginPath();
    ctx.arc(top.x - canopyR * 0.32, top.y - canopyR * 0.28, canopyR * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTrees(ctx) {
    for (const t of TREES) drawTree(ctx, t);
  }

  function drawBuilding(ctx) {
    const { W, L } = COURT;
    const y = L + 7;
    const xMin = -7, xMax = W + 7;
    const zTop = 3.2, zRoof = 3.7;
    const wall = polyFromWorld([[xMin, y, zTop], [xMax, y, zTop], [xMax, y, 0], [xMin, y, 0]]);
    fillPoly(ctx, wall, PALETTE.buildingGlass);
    // Flat roof cap, slightly forward of the glass face for a bit of depth.
    const roof = polyFromWorld([[xMin, y - 0.6, zRoof], [xMax, y - 0.6, zRoof], [xMax, y, zTop], [xMin, y, zTop]]);
    fillPoly(ctx, roof, PALETTE.buildingFrame);
    // Glass panel grid.
    ctx.strokeStyle = PALETTE.buildingFrame;
    ctx.lineWidth = 1.5;
    const cols = 14;
    for (let i = 1; i < cols; i++) {
      const t = i / cols;
      const x = xMin + (xMax - xMin) * t;
      const top = project(x, y, zTop);
      const bot = project(x, y, 0);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bot.x, bot.y);
      ctx.stroke();
    }
    const rows = 4;
    for (let j = 1; j < rows; j++) {
      const t = j / rows;
      const z = zTop * t;
      const left = project(xMin, y, z);
      const right = project(xMax, y, z);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();
    }
  }

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

  function mixColor(hex, amt) {
    const c = hex.replace('#', '');
    const num = parseInt(c.length === 3 ? c.split('').map((ch) => ch + ch).join('') : c, 16);
    const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + amt));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amt));
    const b = Math.max(0, Math.min(255, (num & 0xff) + amt));
    return `rgb(${r},${g},${b})`;
  }

  // Empty color-banded stands, like a poster illustration of a grand-slam
  // venue rather than a crowd sim -- a sweet-spot hit briefly brightens the
  // bands instead of animating individual fans.
  function drawStandSet(ctx, tiers, cheer) {
    const boost = (cheer || 0) * 40;
    for (const tier of tiers) {
      const quad = polyFromWorld(tierQuadWorld(tier));
      const base = tier.i % 2 === 0 ? PALETTE.standRiser : PALETTE.standRiserLight;
      ctx.fillStyle = boost > 1 ? mixColor(base, boost) : base;
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      for (let k = 1; k < quad.length; k++) ctx.lineTo(quad[k].x, quad[k].y);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawStadium(ctx, cheer) {
    drawBuilding(ctx);
    drawTrees(ctx);
    drawStandSet(ctx, STANDS.left, cheer);
    drawStandSet(ctx, STANDS.right, cheer);
    drawStandSet(ctx, STANDS.far, cheer);
    drawBackWall(ctx);
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

    if (SURFACE_PALETTES[currentSurface].mowed) {
      // Mowed-stripe grass across the full length, alternating light/dark
      // bands the way a real lawn (Centre Court included) is cut.
      const stripes = 16;
      const stripeH = (L + outMargin * 2) / stripes;
      for (let i = 0; i < stripes; i++) {
        const y0 = Math.max(-outMargin + i * stripeH, 0);
        const y1 = Math.min(-outMargin + (i + 1) * stripeH, L);
        if (y1 <= y0) continue;
        fillPoly(ctx, polyFromWorld([[0, y0], [W, y0], [W, y1], [0, y1]]), i % 2 === 0 ? PALETTE.courtA : PALETTE.courtB);
      }
    } else {
      // Hard court and clay are a flat, single-tone playing surface.
      fillPoly(ctx, polyFromWorld([[0, 0], [W, 0], [W, L], [0, L]]), PALETTE.courtA);
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
    drawClouds(ctx, time || 0);
    drawStadium(ctx, cheer || 0);
    drawCourtSurface(ctx);
    drawLines(ctx);
    drawNet(ctx);
  }

  global.Court = {
    COURT,
    CAM,
    PALETTE,
    setSurface,
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
