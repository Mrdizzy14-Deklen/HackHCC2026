/**
 * cursor.js — draws hand landmarks on a transparent overlay canvas
 *
 * Listens for gesture:landmarks events (dispatched by gestures.js every frame).
 * Shows fingertip dots, hand skeleton, index-finger cursor, dwell progress ring,
 * and a gesture label so the user can see exactly what the system detects.
 */

const DWELL_MS   = 1000;   // must match gestures.js DWELL_MS
const DWELL_GRID = 40;     // grid cells — must match POINT_THR in gestures.js

// Landmark connections for a minimal hand skeleton
const SKELETON = [
  [0,1],[1,2],[2,3],[3,4],        // thumb
  [0,5],[5,6],[6,7],[7,8],        // index
  [5,9],[9,10],[10,11],[11,12],   // middle
  [9,13],[13,14],[14,15],[15,16], // ring
  [13,17],[17,18],[18,19],[19,20],// pinky
  [0,17],                         // palm edge
];

const FINGERTIPS = [4, 8, 12, 16, 20];

const GESTURE_LABELS = {
  point:        "POINT",
  fist:         "FIST",
  "open-palm":  "PALM",
  "thumbs-up":  "THUMBS UP",
  other:        "",
  none:         "",
};

let _canvas  = null;
let _ctx     = null;
let _dw      = 0;
let _dh      = 0;
let _burstTs = 0;

// Dwell tracking (mirrors gestures.js logic)
let _dwellCell  = null;
let _dwellStart = 0;

export function initCursor() {
  _canvas = document.getElementById("gesture-cursor");
  if (!_canvas) return;
  _ctx = _canvas.getContext("2d");
  _resize();
  window.addEventListener("resize", _resize);
  window.addEventListener("gesture:landmarks", _onLandmarks);
}

function _resize() {
  _dw = _canvas.width  = window.innerWidth;
  _dh = _canvas.height = window.innerHeight;
}

// Convert MediaPipe normalized [0,1] to screen pixels (mirror X for selfie)
function _toScreen(lm) {
  return { x: (1 - lm.x) * _dw, y: lm.y * _dh };
}

function _onLandmarks(e) {
  const { hands, gesture } = e.detail;
  _ctx.clearRect(0, 0, _dw, _dh);
  if (!hands.length) {
    _dwellCell = null;
    _dwellStart = 0;
    return;
  }
  for (const lm of hands) _drawHand(lm, gesture);
}

function _drawHand(lm, gesture) {
  const pts = lm.map(_toScreen);

  // ── Skeleton ─────────────────────────────────────────────────────────────
  _ctx.strokeStyle = "rgba(255,255,255,0.18)";
  _ctx.lineWidth   = 1.5;
  _ctx.lineCap     = "round";
  for (const [a, b] of SKELETON) {
    _ctx.beginPath();
    _ctx.moveTo(pts[a].x, pts[a].y);
    _ctx.lineTo(pts[b].x, pts[b].y);
    _ctx.stroke();
  }

  // ── Fingertip dots ────────────────────────────────────────────────────────
  for (const tip of FINGERTIPS) {
    const p = pts[tip];
    const isIndex = tip === 8;
    _ctx.beginPath();
    _ctx.arc(p.x, p.y, isIndex ? 9 : 5, 0, Math.PI * 2);
    _ctx.fillStyle = isIndex ? "rgba(100,255,150,0.9)" : "rgba(255,255,255,0.55)";
    _ctx.fill();

    // Glow on index tip
    if (isIndex) {
      const grd = _ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 22);
      grd.addColorStop(0, "rgba(100,255,150,0.35)");
      grd.addColorStop(1, "rgba(100,255,150,0)");
      _ctx.beginPath();
      _ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
      _ctx.fillStyle = grd;
      _ctx.fill();
    }
  }

  // ── Open-palm glow at index fingertip ────────────────────────────────────
  if (gesture === "open-palm") {
    const ip = pts[8];
    _ctx.beginPath();
    _ctx.arc(ip.x, ip.y, 40, 0, Math.PI * 2);
    _ctx.fillStyle = "rgba(255,255,255,0.08)";
    _ctx.fill();
  }

  // ── Dwell ring at index fingertip ─────────────────────────────────────────
  if (gesture === "point") {
    const ip  = pts[8];
    // NDC cell for stability check (same grid as gestures.js uses)
    const ndcX = (1 - lm[8].x) * 2 - 1;
    const ndcY = -(lm[8].y * 2 - 1);
    const cell = `${Math.round(ndcX * DWELL_GRID)},${Math.round(ndcY * DWELL_GRID)}`;
    const now  = performance.now();

    if (cell !== _dwellCell) {
      _dwellCell  = cell;
      _dwellStart = now;
    }

    const elapsed  = now - _dwellStart;
    const progress = Math.min(elapsed / DWELL_MS, 1);

    if (progress >= 1) {
      _burstTs = performance.now();
    }

    if (progress > 0.02) {
      // Color shifts green → amber → white as ring fills
      let r, g, b;
      if (progress <= 0.4) {
        // green: rgba(100,255,150)
        r = 100; g = 255; b = 150;
      } else if (progress <= 0.8) {
        // lerp green → amber: rgba(255,200,80)
        const t = (progress - 0.4) / 0.4;
        r = Math.round(100 + t * (255 - 100));
        g = Math.round(255 + t * (200 - 255));
        b = Math.round(150 + t * (80  - 150));
      } else {
        // lerp amber → white: rgba(255,255,255)
        const t = (progress - 0.8) / 0.2;
        r = 255;
        g = Math.round(200 + t * (255 - 200));
        b = Math.round(80  + t * (255 - 80));
      }
      const alpha = 0.5 + progress * 0.5;

      _ctx.beginPath();
      _ctx.arc(ip.x, ip.y, 18, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      _ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      _ctx.lineWidth   = 3;
      _ctx.lineCap     = "round";
      _ctx.stroke();
    }

    // Burst ring after dwell completes
    const burstAge = performance.now() - _burstTs;
    if (_burstTs && burstAge < 400) {
      const burstP = burstAge / 400;
      _ctx.beginPath();
      _ctx.arc(ip.x, ip.y, 18 + burstP * 20, 0, Math.PI * 2);
      _ctx.strokeStyle = `rgba(255,255,255,${(1 - burstP) * 0.7})`;
      _ctx.lineWidth = 2;
      _ctx.stroke();
    }
  } else {
    _dwellCell  = null;
    _dwellStart = 0;
  }

  // ── Gesture label near wrist ──────────────────────────────────────────────
  const label = GESTURE_LABELS[gesture] ?? "";
  if (label) {
    const w = pts[0];
    _ctx.font         = "bold 11px Inter, sans-serif";
    _ctx.textAlign    = "center";
    _ctx.letterSpacing = "0.1em";
    _ctx.fillStyle    = "rgba(255,255,255,0.7)";
    _ctx.fillText(label, w.x, w.y + 28);
    _ctx.letterSpacing = "0";
  }
}
