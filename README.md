# Retro Court Tennis

A fully offline, retro-arcade tennis game for phone and iPad, playable straight
from a browser (or installed as an app via "Add to Home Screen"). No accounts,
no ads, no in-app purchases, no gear/customization to grind for — just tennis.

## Play it

Open `index.html` on a static web server (any host works — GitHub Pages, or
locally with `python3 -m http.server`), then load it on your phone/iPad in
Safari or Chrome. Add it to your home screen for a fullscreen, app-like,
offline experience — a service worker caches everything on first load.

## Controls

- **Drag** anywhere to move your player around your side of the court.
- **Swipe** as the ball arrives to swing: swipe direction aims the shot
  (up = deep, down = short), and swipe speed controls power/flatness.
- **Tap** for a safe, reliable shot down the middle.
- **Serve**: drag the reticle inside the highlighted service box, then tap.

## Features

- Real tennis rules: deuce/advantage scoring, tiebreaks at 6-6, first/second
  serves with proper service boxes, and a choice of Quick Set (first to 4,
  no-ad), Full Set (first to 6), or Best of 3 Sets.
- Three CPU difficulty levels (Easy/Medium/Hard) with a reaction-time and
  aiming-error model, not just a speed multiplier.
- Retro pixel-art HUD (custom bitmap font, no web fonts), a pseudo-3D
  behind-the-baseline camera, chiptune-style WebAudio sound effects, and a
  CRT scanline overlay — all rendered with plain Canvas 2D, no image assets
  or external libraries.
- 100% offline after first load; no network calls, no analytics, no ads.

## Project structure

```
index.html          Markup + canvas
style.css            Layout, CRT overlay, safe-area handling
manifest.webmanifest PWA manifest (installable, fullscreen, landscape)
sw.js                Offline-first service worker
js/font.js           5x7 bitmap font renderer
js/audio.js          WebAudio retro sound effects
js/court.js          World geometry + perspective camera + court rendering
js/scoring.js        Tennis scoring state machine (points/games/sets/match)
js/entities.js       Ball physics, player/AI characters, shot-aiming math
js/input.js          Pointer/touch gesture tracking (tap vs swipe)
js/main.js           Game states, menus, HUD, serve/rally logic, game loop
scripts/gen-icons.js Generates icons/*.png (retro pixel-art app icons)
```

## Regenerating icons

```
node scripts/gen-icons.js
```
