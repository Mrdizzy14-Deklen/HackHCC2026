/**
 * gestures.js — MediaPipe hand tracking → named gesture CustomEvents
 *
 * Dispatches on window:
 *   gesture:curtain-open   — both hands spread apart (scene opening)
 *   gesture:point          — { x, y }  NDC coords of index fingertip
 *   gesture:dwell-select   — { x, y }  point held still for DWELL_MS
 *   gesture:fist           — fist closed (one-shot)
 *   gesture:fist-hold      — fist held for FIST_HOLD_MS (triggers voice)
 *   gesture:open-palm      — all fingers extended (one-shot)
 *   gesture:thumbs-up      — thumb up, fingers curled (one-shot)
 *   gesture:state          — { gesture, confidence } every frame (for UI badge)
 */

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// ── Tuning ──────────────────────────────────────────────────────────────────
const LOOP_MS        = 100;   // 10 fps detection — keeps CPU light
const DWELL_MS       = 1000;  // ms to hold a point before dwell-select fires
const POINT_THR      = 40;    // grid cells for dwell stability
const FIST_HOLD_MS   = 1500;  // ms to hold fist before voice is triggered
const CURTAIN_DELAY  = 2500;  // ms after init before curtain gesture is live
                               // (prevents false-fire from background noise)

let _landmarker    = null;
let _video         = null;
let _lastTs        = -1;
let _loopHandle    = null;
let _readyAt       = 0;       // timestamp when detection became live

// One-shot guards
let _fistLatch       = false;
let _palmLatch       = false;
let _thumbsLatch     = false;
let _curtainFired    = false;
let _fistHoldFired   = false;

// Dwell
let _dwellCell  = null;
let _dwellStart = 0;
let _dwellFired = false;

// Fist hold
let _fistStart  = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function initGestures(videoEl) {
  _video = videoEl;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  );

  _landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });

  _readyAt = performance.now();
  console.log("[gestures] HandLandmarker ready — curtain live in", CURTAIN_DELAY, "ms");
  _startLoop();
}

export function stopGestures() {
  if (_loopHandle) cancelAnimationFrame(_loopHandle);
  _loopHandle = null;
}

// ---------------------------------------------------------------------------
// Detection loop  (throttled to LOOP_MS so Three.js stays at 60fps)
// ---------------------------------------------------------------------------
function _startLoop() {
  let lastRun = 0;

  function tick() {
    _loopHandle = requestAnimationFrame(tick);
    const now = performance.now();
    if (now - lastRun < LOOP_MS) return;
    lastRun = now;
    if (!_video || _video.readyState < 2) return;
    if (_video.currentTime === _lastTs) return;
    _lastTs = _video.currentTime;
    _process(_landmarker.detectForVideo(_video, now), now);
  }

  tick();
}

// ---------------------------------------------------------------------------
// Landmark helpers
// ---------------------------------------------------------------------------

// Compare fingertip to PIP (middle) joint — more robust than MCP for various
// hand orientations. Tip is "extended" when it's clearly above the PIP joint.
function _extended(lm, tip, pip) {
  return lm[tip].y < lm[pip].y - 0.02;
}

// Landmark PIP indices:
//   index=6, middle=10, ring=14, pinky=18
function _classify(lm) {
  const idx = _extended(lm,  8,  6);
  const mid = _extended(lm, 12, 10);
  const rng = _extended(lm, 16, 14);
  const pky = _extended(lm, 20, 18);

  // Thumb-up: thumb tip clearly above wrist, all fingers curled
  const thumbUp = lm[4].y < lm[0].y - 0.12 && !idx && !mid && !rng && !pky;

  if (thumbUp)                      return "thumbs-up";
  if (idx && !mid && !rng && !pky)  return "point";
  if (!idx && !mid && !rng && !pky) return "fist";
  if (idx && mid && rng && pky)     return "open-palm";
  return "other";
}

// Index fingertip → Three.js NDC, accounting for mirrored selfie camera
function _toNDC(lm) {
  return {
    x: (1 - lm[8].x) * 2 - 1,
    y: -(lm[8].y * 2 - 1),
  };
}

// ---------------------------------------------------------------------------
// Main processing
// ---------------------------------------------------------------------------
function _emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent("gesture:" + name, { detail }));
}

function _process(results, now) {
  const hands = results?.landmarks ?? [];

  // Broadcast current state for the UI badge
  const gesture = hands.length ? _classify(hands[0]) : "none";
  _emit("state", { gesture, hands: hands.length });
  _emit("landmarks", { hands, gesture });

  if (hands.length === 0) {
    _fistLatch = _palmLatch = _thumbsLatch = false;
    _fistHoldFired = false;
    _fistStart = 0;
    _dwellCell = null;
    _dwellFired = false;
    return;
  }

  // ── Curtain: both hands spread apart, after cooldown ──────────────────
  const elapsed = now - _readyAt;
  if (!_curtainFired && elapsed > CURTAIN_DELAY && hands.length >= 2) {
    const spread = Math.abs(hands[0][0].x - hands[1][0].x);
    if (spread > 0.42) {
      _curtainFired = true;
      _emit("curtain-open");
    }
  }

  // ── Single-hand gestures ───────────────────────────────────────────────
  const lm = hands[0];
  const g  = _classify(lm);

  // ── Point ──
  if (g === "point") {
    const pos = _toNDC(lm);
    _emit("point", pos);

    const cell = `${Math.round(pos.x * POINT_THR)},${Math.round(pos.y * POINT_THR)}`;
    if (cell !== _dwellCell) {
      _dwellCell = cell; _dwellStart = now; _dwellFired = false;
    } else if (!_dwellFired && now - _dwellStart >= DWELL_MS) {
      _dwellFired = true;
      _emit("dwell-select", pos);
    }

    _fistLatch = _palmLatch = _thumbsLatch = false;
    _fistHoldFired = false; _fistStart = 0;
    return;
  }

  _dwellCell = null; _dwellFired = false;

  // ── Fist (one-shot + hold) ──
  if (g === "fist") {
    if (!_fistLatch) { _fistLatch = true; _emit("fist"); _fistStart = now; }
    if (_fistStart && !_fistHoldFired && now - _fistStart >= FIST_HOLD_MS) {
      _fistHoldFired = true;
      _emit("fist-hold");
    }
    _palmLatch = _thumbsLatch = false;
  } else {
    _fistLatch = false; _fistHoldFired = false; _fistStart = 0;
  }

  // ── Open palm (one-shot) ──
  if (g === "open-palm") {
    if (!_palmLatch) { _palmLatch = true; _emit("open-palm"); }
    _thumbsLatch = false;
  } else {
    _palmLatch = false;
  }

  // ── Thumbs-up (one-shot) ──
  if (g === "thumbs-up") {
    if (!_thumbsLatch) { _thumbsLatch = true; _emit("thumbs-up"); }
  } else {
    _thumbsLatch = false;
  }
}
