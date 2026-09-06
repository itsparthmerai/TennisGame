// Minimal 8-bit style sound effects synthesized with WebAudio.
// No audio files -> zero network dependency, tiny footprint.
(function (global) {
  'use strict';

  let ctx = null;
  let muted = false;
  let masterGain = null;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.5;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone({ freq = 440, dur = 0.1, type = 'square', gain = 0.2, glideTo = null, delay = 0 }) {
    if (muted) return;
    const c = ensureCtx();
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.linearRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst({ dur = 0.08, gain = 0.18, delay = 0, filterFreq = 1200 }) {
    if (muted) return;
    const c = ensureCtx();
    const t0 = c.currentTime + delay;
    const bufferSize = Math.max(1, Math.floor(c.sampleRate * dur));
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const SFX = {
    hit() {
      tone({ freq: 260, glideTo: 140, dur: 0.09, type: 'square', gain: 0.22 });
      noiseBurst({ dur: 0.05, gain: 0.12, filterFreq: 2200 });
    },
    hitPower() {
      tone({ freq: 180, glideTo: 90, dur: 0.14, type: 'sawtooth', gain: 0.25 });
      noiseBurst({ dur: 0.08, gain: 0.16, filterFreq: 3000 });
    },
    bounce() {
      tone({ freq: 520, glideTo: 300, dur: 0.06, type: 'triangle', gain: 0.14 });
    },
    net() {
      noiseBurst({ dur: 0.12, gain: 0.2, filterFreq: 900 });
      tone({ freq: 120, dur: 0.1, type: 'square', gain: 0.12 });
    },
    out() {
      tone({ freq: 200, dur: 0.18, type: 'sawtooth', gain: 0.15, glideTo: 80 });
    },
    pointWin() {
      tone({ freq: 523, dur: 0.09, type: 'square', gain: 0.2, delay: 0 });
      tone({ freq: 659, dur: 0.09, type: 'square', gain: 0.2, delay: 0.09 });
      tone({ freq: 784, dur: 0.16, type: 'square', gain: 0.2, delay: 0.18 });
    },
    pointLose() {
      tone({ freq: 300, dur: 0.1, type: 'square', gain: 0.16, delay: 0 });
      tone({ freq: 220, dur: 0.16, type: 'square', gain: 0.16, delay: 0.1 });
    },
    gameWin() {
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'square', gain: 0.2, delay: i * 0.11 }));
    },
    matchWin() {
      [523, 587, 659, 784, 880, 1047].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'square', gain: 0.22, delay: i * 0.13 }));
    },
    ui() {
      tone({ freq: 440, dur: 0.05, type: 'square', gain: 0.15 });
    },
    uiConfirm() {
      tone({ freq: 440, dur: 0.05, type: 'square', gain: 0.16, delay: 0 });
      tone({ freq: 660, dur: 0.08, type: 'square', gain: 0.16, delay: 0.05 });
    },
    swish() {
      noiseBurst({ dur: 0.07, gain: 0.08, filterFreq: 4000 });
    },
    serveBounce() {
      tone({ freq: 440, glideTo: 240, dur: 0.05, type: 'triangle', gain: 0.12 });
    },
  };

  function setMuted(m) {
    muted = m;
  }
  function isMuted() {
    return muted;
  }
  function unlock() {
    ensureCtx();
  }

  global.RetroAudio = { sfx: SFX, setMuted, isMuted, unlock };
})(window);
