/**
 * cursor.js — smooth hand-landmark overlay at 60 fps
 *
 * MediaPipe runs at ~15 fps; this file decouples rendering from detection by
 * keeping a smoothed copy of landmarks that lerps toward the latest raw
 * detection every animation frame. Result: fluid motion with no jitter.
 *
 * Dwell-ring progress is calculated from RAW positions so it stays in sync
 * with the actual dwell-select logic in gestures.js.
 */

const DWELL_MS   = 750;   // must match gestures.js DWELL_MS
const DWELL_GRID = 40;    // must match POINT_THR in gestures.js

const LERP       = 0.30;  // landmark smoothing factor per 60fps frame
                           // lower = smoother but laggier; 0.30 is a good balance

const SKELETON = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

const FINGERTIPS = [4, 8, 12, 16, 20];

const GESTURE_LABELS = {
  point:       "POINT",
  fist:        "FIST",
  "open-palm": "PALM",
  "thumbs-up": "THUMBS UP",
};

let _canvas = null;
let _ctx    = null;
let _dw = 0, _dh = 0;

const _standImg = new Image();
let _standReady = false;
_standImg.onload = () => { _standReady = true; };
_standImg.onerror = () => console.error("music stand PNG failed to load:", _standImg.src);
_standImg.src = "/static/music-stand.png";

// Raw data from gestures.js (updated at ~15 fps)
let _rawHands   = [];
let _rawGesture = "none";

// Smoothed state (updated every rAF at ~60 fps)
let _smoothHands = [];

// Dwell tracking — mirrors gestures.js using RAW positions so the ring
// progress always matches when gesture:dwell-select actually fires
let _dwellCell  = null;
let _dwellStart = 0;
let _burstTs    = 0;

export function initCursor() {
  _canvas = document.getElementById("gesture-cursor");
  if (!_canvas) return;
  _ctx = _canvas.getContext("2d");
  _resize();
  window.addEventListener("resize", _resize);
  window.addEventListener("gesture:landmarks", _onLandmarks);
  requestAnimationFrame(_renderLoop);
}

function _resize() {
  _dw = _canvas.width  = window.innerWidth;
  _dh = _canvas.height = window.innerHeight;
}

// Store raw landmarks — do NOT draw here
function _onLandmarks(e) {
  _rawHands   = e.detail.hands ?? [];
  _rawGesture = e.detail.gesture ?? "none";
}

// 60 fps render loop: lerp smooth → raw, then draw
function _renderLoop() {
  requestAnimationFrame(_renderLoop);
  _ctx.clearRect(0, 0, _dw, _dh);

  // Music stand — fixed at bottom center, always visible
  if (_standReady) {
    const sw = 350;
    const sh = 350;
    _ctx.drawImage(_standImg, (_dw - sw) / 2, _dh - sh, sw, sh);
  }

  if (_rawHands.length === 0) {
    _smoothHands = [];
    _dwellCell   = null;
    _dwellStart  = 0;
    return;
  }

  // Sync array length (hand appeared / disappeared)
  if (_smoothHands.length !== _rawHands.length) {
    _smoothHands = _rawHands.map(lm => lm.map(pt => ({ x: pt.x, y: pt.y, z: pt.z ?? 0 })));
  } else {
    for (let h = 0; h < _rawHands.length; h++) {
      for (let i = 0; i < _rawHands[h].length; i++) {
        const r = _rawHands[h][i];
        const s = _smoothHands[h][i];
        s.x += (r.x - s.x) * LERP;
        s.y += (r.y - s.y) * LERP;
        s.z  = (s.z ?? 0) + ((r.z ?? 0) - (s.z ?? 0)) * LERP;
      }
    }
  }

  for (let h = 0; h < _smoothHands.length; h++) {
    _drawHand(_smoothHands[h], _rawHands[h], _rawGesture);
  }
}

// _toScreen — convert MediaPipe [0,1] → pixels (mirror X)
function _toScreen(lm) {
  return { x: (1 - lm.x) * _dw, y: lm.y * _dh };
}

function _drawHand(lm, rawLm, gesture) {
  const pts = lm.map(_toScreen);

  // ── Skeleton ──────────────────────────────────────────────────────────────
  _ctx.strokeStyle = "rgba(255,255,255,0.18)";
  _ctx.lineWidth   = 1.5;
  _ctx.lineCap     = "round";
  for (const [a, b] of SKELETON) {
    _ctx.beginPath();
    _ctx.moveTo(pts[a].x, pts[a].y);
    _ctx.lineTo(pts[b].x, pts[b].y);
    _ctx.stroke();
  }

  // ── Fingertip dots ─────────────────────────────────────────────────────────
  for (const tip of FINGERTIPS) {
    const p = pts[tip];
    const isIndex = tip === 8;
    _ctx.beginPath();
    _ctx.arc(p.x, p.y, isIndex ? 6 : 5, 0, Math.PI * 2);
    _ctx.fillStyle = isIndex ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.45)";
    _ctx.fill();
  }

  // ── Crosshair when pointing ────────────────────────────────────────────────
  if (gesture === "point") {
    const ip = pts[8];
    const R  = 18;
    const G  = 5;
    _ctx.strokeStyle = "rgba(255,210,140,0.55)";
    _ctx.lineWidth   = 1.5;
    _ctx.setLineDash([3, 3]);
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      _ctx.beginPath();
      _ctx.moveTo(ip.x + dx * (R + G), ip.y + dy * (R + G));
      _ctx.lineTo(ip.x + dx * (R + G + 8), ip.y + dy * (R + G + 8));
      _ctx.stroke();
    }
    _ctx.setLineDash([]);
  }

  // ── Open-palm glow ─────────────────────────────────────────────────────────
  if (gesture === "open-palm") {
    const ip = pts[8];
    _ctx.beginPath();
    _ctx.arc(ip.x, ip.y, 44, 0, Math.PI * 2);
    _ctx.fillStyle = "rgba(255,255,255,0.07)";
    _ctx.fill();
  }

  // ── Dwell ring — uses RAW positions so it matches gestures.js exactly ──────
  if (gesture === "point" && rawLm) {
    const ip  = pts[8];
    const ndcX = (1 - rawLm[8].x) * 2 - 1;
    const ndcY = -(rawLm[8].y * 2 - 1);
    const cell = `${Math.round(ndcX * DWELL_GRID)},${Math.round(ndcY * DWELL_GRID)}`;
    const now  = performance.now();

    if (cell !== _dwellCell) {
      _dwellCell  = cell;
      _dwellStart = now;
      _burstTs    = 0;
    }

    const elapsed  = now - _dwellStart;
    const progress = Math.min(elapsed / DWELL_MS, 1);

    if (progress >= 1 && !_burstTs) _burstTs = now;

    if (progress > 0.02) {
      // Color: warm amber → bright gold → white
      let r, g, b;
      if (progress <= 0.5) {
        const t = progress / 0.5;
        r = 255;
        g = Math.round(180 + t * (220 - 180));
        b = Math.round(80  + t * (140 - 80));
      } else {
        const t = (progress - 0.5) / 0.5;
        r = 255;
        g = Math.round(220 + t * (255 - 220));
        b = Math.round(140 + t * (255 - 140));
      }
      const alpha = 0.55 + progress * 0.45;

      _ctx.beginPath();
      _ctx.arc(ip.x, ip.y, 18, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      _ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      _ctx.lineWidth   = 3.5;
      _ctx.lineCap     = "round";
      _ctx.stroke();
    }

    // Burst ring after dwell completes
    if (_burstTs) {
      const age  = now - _burstTs;
      const burstP = age / 350;
      if (burstP < 1) {
        _ctx.beginPath();
        _ctx.arc(ip.x, ip.y, 18 + burstP * 22, 0, Math.PI * 2);
        _ctx.strokeStyle = `rgba(255,255,255,${(1 - burstP) * 0.75})`;
        _ctx.lineWidth   = 2;
        _ctx.stroke();
      }
    }
  } else {
    if (gesture !== "point") {
      _dwellCell  = null;
      _dwellStart = 0;
    }
  }

  // ── Gesture label near wrist ───────────────────────────────────────────────
  const label = GESTURE_LABELS[gesture] ?? "";
  if (label) {
    const w = pts[0];
    _ctx.font          = "bold 11px Inter, sans-serif";
    _ctx.textAlign     = "center";
    _ctx.letterSpacing = "0.1em";
    _ctx.fillStyle     = "rgba(255,255,255,0.65)";
    _ctx.fillText(label, w.x, w.y + 28);
    _ctx.letterSpacing = "0";
  }
}
