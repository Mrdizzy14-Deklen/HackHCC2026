/**
 * panel.js — UI controller
 *
 * Gesture flow:
 *   1. Spread both hands → curtains open  (handled in scene.js)
 *   2. Point + dwell 1 s on instrument → select it
 *   3. Open palm → start 5-second hum recording
 *   4. Notes appear automatically when done
 *   5. Hold fist 1.5 s → say instrument name to add it to scene (Web Speech)
 *   6. Thumbs-up → render stems
 *   7. Thumbs-up again (or click) → launch conduct
 */

import { initGestures, stopGestures } from "./gestures.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SESSION_ID  = "session1";
const HUM_SECONDS = 5;

// All instruments the backend supports
const CORE_TRACKS = [
  { id: "piano",   name: "Piano" },
  { id: "violin",  name: "Violin" },
  { id: "trumpet", name: "Trumpet" },
  { id: "flute",   name: "Flute" },
  { id: "drums",   name: "Drums" },
];

// Instruments the 3D scene can render (superset — user can add via voice)
const SCENE_INSTRUMENTS = [
  "piano", "violin", "trumpet", "flute", "drums",
  "oboe", "trombone", "french horn",
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let tracks        = [...CORE_TRACKS];   // may grow if user adds via voice
let activeTrackId = null;
let isRecording   = false;
let pollHandle    = null;
let renderStarted = false;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $title      = document.getElementById("panel-title");
const $sub        = document.getElementById("panel-sub");
const $note       = document.getElementById("note");
const $noteSub    = document.getElementById("sub");
const $sections   = document.getElementById("sections");
const $notesList  = document.getElementById("notes");
const $notesLabel = document.getElementById("notes-label");
const $rec        = document.getElementById("rec");
const $clear      = document.getElementById("btn-clear");
const $harmonize  = document.getElementById("btn-harmonize");
const $panel      = document.getElementById("panel");
const $badge      = document.getElementById("gesture-badge");
const $voicePrompt = document.getElementById("voice-prompt");

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  // ── Camera + MediaPipe ────────────────────────────────────────────────
  const camSrc     = document.getElementById("gesture-cam");
  const camPreview = document.getElementById("gesture-cam-preview");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
    });
    camSrc.srcObject     = stream;
    camPreview.srcObject = stream;          // same stream → second video el
    await camSrc.play();
    await camPreview.play();
    await initGestures(camSrc);
    console.log("[panel] Gesture system online");
  } catch (err) {
    console.warn("[panel] Camera/gesture unavailable:", err.message);
    document.getElementById("cam-preview").style.display = "none";
  }

  // ── Backend session ───────────────────────────────────────────────────
  try {
    await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: SESSION_ID, mood: "upbeat" }),
    });
  } catch (err) {
    console.warn("[panel] session/start failed:", err);
  }

  // ── Populate 3D scene with default instruments ────────────────────────
  // Small delay lets the GLTF loader cache up before we fire add events
  setTimeout(() => {
    for (const t of CORE_TRACKS) {
      window.dispatchEvent(new CustomEvent("instrument:add", { detail: { kind: t.id } }));
    }
  }, 800);

  // ── Toast container ──────────────────────────────────────────────────
  const $toast = document.createElement("div");
  $toast.id = "track-toast";
  document.body.appendChild($toast);

  // ── Panel UI ──────────────────────────────────────────────────────────
  buildTabs();
  $rec.addEventListener("click", toggleRecording);
  $clear.addEventListener("click", clearCurrentTrack);
  $harmonize.addEventListener("click", startRender);
  document.getElementById("panel-toggle").addEventListener("click", () =>
    $panel.classList.toggle("collapsed"),
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function buildTabs() {
  $sections.innerHTML = "";
  for (const t of tracks) {
    const btn = document.createElement("button");
    btn.className       = "tab";
    btn.textContent     = t.name;
    btn.dataset.trackId = t.id;
    btn.addEventListener("click", () => selectTrack(t.id));
    $sections.appendChild(btn);
  }
}

function addTrackTab(id, name) {
  if (tracks.find((t) => t.id === id)) return; // already exists
  tracks.push({ id, name });
  const btn = document.createElement("button");
  btn.className       = "tab";
  btn.textContent     = name;
  btn.dataset.trackId = id;
  btn.addEventListener("click", () => selectTrack(id));
  $sections.appendChild(btn);
}

function selectTrack(trackId) {
  if (activeTrackId === trackId) return;
  activeTrackId = trackId;

  for (const btn of $sections.querySelectorAll(".tab")) {
    btn.classList.toggle("active", btn.dataset.trackId === trackId);
  }

  const t = tracks.find((x) => x.id === trackId);
  $title.textContent   = t?.name ?? trackId;
  $sub.textContent     = "Show open palm ✋ to start humming";
  $note.textContent    = "—";
  $noteSub.textContent = "Ready to record";
  clearNotesList();
  refreshTrackStatus(trackId);
  $panel.classList.remove("collapsed");
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
function toggleRecording() {
  if (!activeTrackId) {
    $noteSub.textContent = "Point at an instrument first";
    return;
  }
  if (!isRecording) startRecording(activeTrackId);
}

async function startRecording(trackId) {
  if (isRecording) return;
  isRecording = true;

  $rec.classList.add("on");
  $note.textContent    = "●";
  $noteSub.textContent = `Recording… ${HUM_SECONDS}s`;

  let remaining = HUM_SECONDS;
  const countdown = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    $noteSub.textContent = remaining > 0 ? `Recording… ${remaining}s` : "Processing…";
  }, 1000);

  try {
    await fetch(`/api/tracks/${trackId}/hum?seconds=${HUM_SECONDS}`, { method: "POST" });
  } catch {
    clearInterval(countdown);
    isRecording = false;
    $rec.classList.remove("on");
    $noteSub.textContent = "Failed to start recording";
    return;
  }

  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(async () => {
    try {
      const data = await fetch(`/api/tracks/${trackId}/hum/status`).then((r) => r.json());
      if (!data.recording && (data.done || data.error)) {
        clearInterval(pollHandle);
        clearInterval(countdown);
        finishRecording(trackId, data.notes ?? [], data.error ?? null);
      }
    } catch (_) {}
  }, 500);
}

function showToast(msg) {
  const el = document.getElementById("track-toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2000);
}

function finishRecording(trackId, notes, error) {
  isRecording = false;
  $rec.classList.remove("on");

  if (error) {
    $noteSub.textContent = `Error: ${error}`;
    $note.textContent    = "—";
    return;
  }

  $noteSub.textContent = `${notes.length} note${notes.length !== 1 ? "s" : ""} detected`;
  $note.textContent    = notes.length ? midiToName(notes[0].midi) : "—";
  renderNotes(notes);

  const t = tracks.find(x => x.id === trackId);
  showToast(`${t?.name ?? trackId} recorded — ${notes.length} notes`);

  $sections.querySelector(`[data-track-id="${trackId}"]`)?.classList.add("done");

  const done = $sections.querySelectorAll(".tab.done").length;
  $sub.textContent =
    done === CORE_TRACKS.length
      ? "All recorded! 👍 Thumbs-up to render."
      : `${done}/${CORE_TRACKS.length} done — point at next instrument`;
}

// ---------------------------------------------------------------------------
// Notes list
// ---------------------------------------------------------------------------
function renderNotes(notes) {
  clearNotesList();
  if (!notes.length) { $notesLabel.textContent = "No notes detected"; return; }
  $notesLabel.textContent = `${notes.length} notes detected`;
  notes.forEach((n, i) => {
    const el  = document.createElement("div");
    el.className = "note" + (i === 0 ? " active" : "");
    const dur = n.duration_ms ? `${(n.duration_ms / 1000).toFixed(1)}s` : "";
    el.innerHTML = `<div class="note-left"><span class="note-pitch">${midiToName(n.midi)}</span><span class="note-dur">${dur}</span></div>`;
    el.addEventListener("click", () => {
      $notesList.querySelectorAll(".note").forEach((x) => x.classList.remove("active"));
      el.classList.add("active");
    });
    $notesList.appendChild(el);
  });
}

function clearNotesList() {
  $notesList.innerHTML    = "";
  $notesLabel.textContent = "No notes yet";
}

function midiToName(midi) {
  const N = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  return midi != null ? N[midi % 12] + Math.floor(midi / 12 - 1) : "—";
}

// ---------------------------------------------------------------------------
// Refresh existing session track state (for page reloads)
// ---------------------------------------------------------------------------
async function refreshTrackStatus(trackId) {
  try {
    const data = await fetch(`/api/tracks/${trackId}/hum/status`).then((r) => r.json());
    if (data.done && data.notes?.length) {
      renderNotes(data.notes);
      $note.textContent    = midiToName(data.notes[0].midi);
      $noteSub.textContent = `${data.notes.length} notes detected`;
      $sections.querySelector(`[data-track-id="${trackId}"]`)?.classList.add("done");
    }
  } catch (_) {}
}

function clearCurrentTrack() {
  if (!activeTrackId) return;
  clearNotesList();
  $note.textContent    = "—";
  $noteSub.textContent = "Ready to record";
  $sections.querySelector(`[data-track-id="${activeTrackId}"]`)?.classList.remove("done");
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
async function startRender() {
  if (renderStarted) return;
  renderStarted          = true;
  $harmonize.textContent = "Rendering…";
  $harmonize.disabled    = true;

  try {
    await fetch("/api/render", { method: "POST" });
  } catch {
    $harmonize.textContent = "Error — retry";
    $harmonize.disabled    = false;
    renderStarted          = false;
    return;
  }

  const poll = setInterval(async () => {
    try {
      const data = await fetch("/api/render/status").then((r) => r.json());
      if (data.done)  { clearInterval(poll); onRenderDone(); }
      if (data.error) {
        clearInterval(poll);
        $harmonize.textContent = "Render error";
        $harmonize.disabled    = false;
        renderStarted          = false;
      }
    } catch (_) {}
  }, 2000);
}

function onRenderDone() {
  $harmonize.textContent = "✓ Rendered!";
  $sub.textContent       = "👍 Thumbs-up or click Conduct";
  const btn = document.createElement("button");
  btn.className   = "btn primary";
  btn.textContent = "Conduct ↗";
  btn.style.marginTop = "6px";
  btn.addEventListener("click", launchConduct);
  document.querySelector(".footer").appendChild(btn);
}

// ---------------------------------------------------------------------------
// Conduct Mode  (browser-side Web Audio API)
// ---------------------------------------------------------------------------

// Review mode (one stem at a time before full conduct)
let _reviewStems       = [];     // [{...stem, buffer}]
let _reviewIdx         = 0;
let _reviewCtx         = null;
let _reviewSource      = null;
let _inReviewMode      = false;
let _reviewRerecording = false;

let _conductCtx          = null;
let _conductNodes        = {};    // track_id → { buffer, gainNode, sourceNode, volume }
let _inConductMode       = false;
let _conductHoveredKind  = null;  // instrument currently under finger
let _conductRerecording  = false; // re-hum in progress

// Effects phase
let _inEffectsMode  = false;
let _effectsParam   = "pitch";   // "pitch" | "tempo"
let _effectsPitch   = 0;         // semitones
let _effectsTempo   = 1.0;       // multiplier
let _effectsCtx     = null;
let _effectsSource  = null;
let _effectsMixing  = false;

// Lyrics phase
let _inLyricsMode   = false;
let _lyricsText     = "";

async function launchConduct() {
  let data;
  try {
    const resp = await fetch("/api/conduct/start", { method: "POST" });
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      showToast(e.detail ?? "Not ready — render first");
      return;
    }
    data = await resp.json();
  } catch (err) {
    showToast("Conduct unavailable");
    return;
  }
  const stems = data.stems ?? [];
  if (!stems.length) { showToast("No stems found — render first"); return; }
  await _enterReviewMode(stems);
}

async function _enterConductMode(stems) {
  _inConductMode = true;
  $panel.classList.remove("collapsed");
  $title.textContent = "Conducting";
  $sub.textContent   = "Loading stems…";

  document.querySelector(".record").style.display     = "none";
  document.querySelector(".notes-wrap").style.display = "none";

  // Volume-meter rows
  $sections.innerHTML = "";
  for (const s of stems) {
    const row = document.createElement("div");
    row.className       = "conduct-row";
    row.dataset.trackId = s.track_id;
    row.innerHTML = `
      <span class="conduct-name">${s.name}</span>
      <div class="conduct-bar"><div class="conduct-fill" style="width:100%"></div></div>
      <button class="conduct-solo" data-tid="${s.track_id}" title="Solo 3 s">▶</button>
    `;
    $sections.appendChild(row);
  }

  document.querySelector(".footer").innerHTML = `
    <button class="btn" id="btn-c-pause">⏸ Pause</button>
    <button class="btn primary" id="btn-c-play">▶ Play All</button>
  `;

  // Web Audio
  _conductCtx   = new AudioContext();
  _conductNodes = {};
  await Promise.all(stems.map(async (s) => {
    try {
      const ab  = await fetch(s.url).then(r => r.arrayBuffer());
      const buf = await _conductCtx.decodeAudioData(ab);
      _conductNodes[s.track_id] = { buffer: buf, gainNode: null, sourceNode: null, volume: 1.0 };
    } catch (e) { console.warn("[conduct] load failed:", s.track_id, e); }
  }));

  $sub.textContent = "Point at an instrument — raise hand to raise volume";

  document.querySelectorAll(".conduct-solo").forEach(btn =>
    btn.addEventListener("click", () => _soloStem(btn.dataset.tid)));
  document.getElementById("btn-c-play").addEventListener("click",  _playAllStems);
  document.getElementById("btn-c-pause").addEventListener("click", _toggleConductPause);

  setTimeout(_playAllStems, 300);
}

function _startStemSource(trackId) {
  const node = _conductNodes[trackId];
  if (!node?.buffer) return;
  if (node.sourceNode) { try { node.sourceNode.stop(); } catch (_) {} }
  const gain = _conductCtx.createGain();
  gain.gain.value = node.volume;
  gain.connect(_conductCtx.destination);
  const src = _conductCtx.createBufferSource();
  src.buffer = node.buffer;
  src.loop   = true;
  src.connect(gain);
  src.start(0);
  node.gainNode   = gain;
  node.sourceNode = src;
}

function _playAllStems() {
  if (_conductCtx.state === "suspended") _conductCtx.resume();
  Object.keys(_conductNodes).forEach(_startStemSource);
  Object.keys(_conductNodes).forEach(tid =>
    window.dispatchEvent(new CustomEvent("conduct:volume", { detail: { kind: tid, volume: _conductNodes[tid].volume } }))
  );
  const btn = document.getElementById("btn-c-pause");
  if (btn) btn.textContent = "⏸ Pause";
}

function _soloStem(trackId) {
  Object.keys(_conductNodes).forEach(tid => {
    const n = _conductNodes[tid];
    if (n.gainNode) n.gainNode.gain.setTargetAtTime(tid === trackId ? 1 : 0.04, _conductCtx.currentTime, 0.1);
  });
  document.querySelectorAll(".conduct-row").forEach(r =>
    r.classList.toggle("soloing", r.dataset.trackId === trackId));
  setTimeout(() => {
    Object.keys(_conductNodes).forEach(tid => {
      const n = _conductNodes[tid];
      if (n.gainNode) n.gainNode.gain.setTargetAtTime(n.volume, _conductCtx.currentTime, 0.15);
    });
    document.querySelectorAll(".conduct-row").forEach(r => r.classList.remove("soloing"));
  }, 3000);
}

function _toggleConductPause() {
  if (!_conductCtx) return;
  const btn = document.getElementById("btn-c-pause");
  if (_conductCtx.state === "running") {
    _conductCtx.suspend();
    if (btn) btn.textContent = "▶ Resume";
  } else {
    _conductCtx.resume();
    if (btn) btn.textContent = "⏸ Pause";
  }
}

function _setConductVolume(trackId, vol) {
  const node = _conductNodes[trackId];
  if (!node) return;
  node.volume = Math.max(0, Math.min(1, vol));
  if (node.gainNode)
    node.gainNode.gain.setTargetAtTime(node.volume, _conductCtx.currentTime, 0.08);
  const fill = document.querySelector(`.conduct-row[data-track-id="${trackId}"] .conduct-fill`);
  if (fill) fill.style.width = `${node.volume * 100}%`;
  window.dispatchEvent(new CustomEvent("conduct:volume", { detail: { kind: trackId, volume: node.volume } }));
}

// Re-hum a single instrument while all stems keep playing, then re-render all
async function _rerecordInConduct(trackId) {
  if (_conductRerecording) return;
  _conductRerecording = true;
  const name = tracks.find(t => t.id === trackId)?.name ?? trackId;
  $sub.textContent = `🎙 Humming ${name}… ${HUM_SECONDS}s`;
  document.querySelector(`.conduct-row[data-track-id="${trackId}"]`)?.classList.add("soloing");

  try {
    await fetch(`/api/tracks/${trackId}/hum?seconds=${HUM_SECONDS}`, { method: "POST" });
    await new Promise((resolve, reject) => {
      const h = setInterval(async () => {
        const d = await fetch(`/api/tracks/${trackId}/hum/status`).then(r => r.json());
        if (!d.recording && (d.done || d.error)) {
          clearInterval(h);
          d.error ? reject(new Error(d.error)) : resolve(d);
        }
      }, 500);
    });

    $sub.textContent = "Re-rendering all stems…";
    renderStarted = false;
    await fetch("/api/render", { method: "POST" });
    await new Promise((resolve, reject) => {
      const h = setInterval(async () => {
        const d = await fetch("/api/render/status").then(r => r.json());
        if (d.done)  { clearInterval(h); resolve(); }
        if (d.error) { clearInterval(h); reject(new Error(d.error)); }
      }, 2000);
    });

    await _reloadAllStems();
    showToast(`✓ ${name} updated!`);
    $sub.textContent = "Point at instrument + raise/lower hand for volume";
  } catch (err) {
    showToast(`Error: ${err.message}`);
    $sub.textContent = "Error — try again";
  } finally {
    _conductRerecording = false;
    document.querySelector(`.conduct-row[data-track-id="${trackId}"]`)?.classList.remove("soloing");
  }
}

// Reload all audio buffers after a re-render (stems swap in seamlessly)
async function _reloadAllStems() {
  for (const trackId of Object.keys(_conductNodes)) {
    try {
      const ab  = await fetch(`/api/stems/${trackId}?t=${Date.now()}`).then(r => r.arrayBuffer());
      const buf = await _conductCtx.decodeAudioData(ab);
      _conductNodes[trackId].buffer = buf;
      _startStemSource(trackId);
    } catch (e) { console.warn("[conduct] reload failed:", trackId, e); }
  }
}

// ---------------------------------------------------------------------------
// Review Mode  (one stem at a time, thumbs-up advances, open-palm re-hums)
// ---------------------------------------------------------------------------

async function _enterReviewMode(stems) {
  _inReviewMode  = true;
  _inConductMode = false;
  _reviewStems   = stems;
  _reviewIdx     = 0;

  $panel.classList.remove("collapsed");
  $title.textContent = "Review Instruments";
  $sub.textContent   = "Loading stems…";

  document.querySelector(".record").style.display     = "none";
  document.querySelector(".notes-wrap").style.display = "none";

  $sections.innerHTML = "";
  for (const s of stems) {
    const row = document.createElement("div");
    row.className       = "conduct-row";
    row.dataset.trackId = s.track_id;
    row.innerHTML = `<span class="conduct-name">${s.name}</span>
      <div class="conduct-bar"><div class="conduct-fill" style="width:100%"></div></div>`;
    $sections.appendChild(row);
  }

  document.querySelector(".footer").innerHTML = `
    <button class="btn" id="btn-r-rehum">🎙 Re-hum</button>
    <button class="btn primary" id="btn-r-approve">👍👍 Approve</button>
  `;

  _reviewCtx = new AudioContext();

  await Promise.all(stems.map(async (s) => {
    try {
      const ab = await fetch(s.url).then(r => r.arrayBuffer());
      s.buffer = await _reviewCtx.decodeAudioData(ab);
    } catch (e) { console.warn("[review] load failed:", s.track_id, e); }
  }));

  document.getElementById("btn-r-approve").addEventListener("click", _reviewApprove);
  document.getElementById("btn-r-rehum").addEventListener("click", () => _rerecordInReview());

  _playCurrentReviewStem();
}

function _playCurrentReviewStem() {
  if (_reviewSource) { try { _reviewSource.stop(); } catch (_) {} }
  _reviewSource = null;

  const s = _reviewStems[_reviewIdx];
  if (!s?.buffer) { $sub.textContent = "Stem not loaded — try re-humming"; return; }

  if (_reviewCtx.state === "suspended") _reviewCtx.resume();

  const gain = _reviewCtx.createGain();
  gain.gain.value = 1.0;
  gain.connect(_reviewCtx.destination);

  _reviewSource        = _reviewCtx.createBufferSource();
  _reviewSource.buffer = s.buffer;
  _reviewSource.loop   = true;
  _reviewSource.connect(gain);
  _reviewSource.start(0);

  document.querySelectorAll(".conduct-row").forEach((r, i) =>
    r.classList.toggle("pointed", i === _reviewIdx));

  $title.textContent = `Review: ${s.name}`;
  $sub.textContent   = `${_reviewIdx + 1} of ${_reviewStems.length} — 👍👍 both thumbs to approve · ✋ re-hum`;
}

function _reviewApprove() {
  if (_reviewRerecording) return;
  if (_reviewSource) { try { _reviewSource.stop(); } catch (_) {} }
  _reviewSource = null;

  const rows = document.querySelectorAll(".conduct-row");
  if (rows[_reviewIdx]) rows[_reviewIdx].classList.add("reviewed");
  _reviewIdx++;

  if (_reviewIdx >= _reviewStems.length) {
    _transitionReviewToConduct();
  } else {
    _playCurrentReviewStem();
  }
}

async function _rerecordInReview() {
  if (_reviewRerecording) return;
  _reviewRerecording = true;

  if (_reviewSource) { try { _reviewSource.stop(); } catch (_) {} }
  _reviewSource = null;

  const s = _reviewStems[_reviewIdx];
  $sub.textContent = `🎙 Humming ${s.name}… ${HUM_SECONDS}s`;

  try {
    await fetch(`/api/tracks/${s.track_id}/hum?seconds=${HUM_SECONDS}`, { method: "POST" });
    await new Promise((resolve, reject) => {
      const h = setInterval(async () => {
        const d = await fetch(`/api/tracks/${s.track_id}/hum/status`).then(r => r.json());
        if (!d.recording && (d.done || d.error)) {
          clearInterval(h);
          d.error ? reject(new Error(d.error)) : resolve(d);
        }
      }, 500);
    });

    $sub.textContent = "Re-rendering…";
    renderStarted = false;
    await fetch("/api/render", { method: "POST" });
    await new Promise((resolve, reject) => {
      const h = setInterval(async () => {
        const d = await fetch("/api/render/status").then(r => r.json());
        if (d.done)  { clearInterval(h); resolve(); }
        if (d.error) { clearInterval(h); reject(new Error(d.error)); }
      }, 2000);
    });

    for (const stem of _reviewStems) {
      const ab = await fetch(`/api/stems/${stem.track_id}?t=${Date.now()}`).then(r => r.arrayBuffer());
      stem.buffer = await _reviewCtx.decodeAudioData(ab);
    }

    showToast(`✓ ${s.name} updated!`);
    _playCurrentReviewStem();
  } catch (err) {
    showToast(`Error: ${err.message}`);
    _playCurrentReviewStem();
  } finally {
    _reviewRerecording = false;
  }
}

async function _transitionReviewToConduct() {
  _conductCtx   = _reviewCtx;
  _conductNodes = {};
  for (const s of _reviewStems) {
    _conductNodes[s.track_id] = { buffer: s.buffer, gainNode: null, sourceNode: null, volume: 1.0 };
  }

  _inReviewMode  = false;
  _inConductMode = true;

  $title.textContent = "Conducting";
  $sub.textContent   = "Point at instrument — raise hand for volume";

  $sections.innerHTML = "";
  for (const s of _reviewStems) {
    const row = document.createElement("div");
    row.className       = "conduct-row";
    row.dataset.trackId = s.track_id;
    row.innerHTML = `<span class="conduct-name">${s.name}</span>
      <div class="conduct-bar"><div class="conduct-fill" style="width:100%"></div></div>
      <button class="conduct-solo" data-tid="${s.track_id}" title="Solo 3 s">▶</button>`;
    $sections.appendChild(row);
  }

  document.querySelector(".footer").innerHTML = `
    <button class="btn" id="btn-c-pause">⏸ Pause</button>
    <button class="btn primary" id="btn-c-play">▶ Play All</button>
  `;

  document.querySelectorAll(".conduct-solo").forEach(btn =>
    btn.addEventListener("click", () => _soloStem(btn.dataset.tid)));
  document.getElementById("btn-c-play").addEventListener("click",  _playAllStems);
  document.getElementById("btn-c-pause").addEventListener("click", _toggleConductPause);

  showToast("✓ All approved — now conducting!");
  setTimeout(_playAllStems, 300);
}

// Both hands thumbs-up: lock conduct, keep camera/gestures alive for effects phase
function _finalizeConduct() {
  _inConductMode = false;

  // Stop all conduct sources (effects phase will play master.wav instead)
  Object.values(_conductNodes).forEach(n => {
    if (n.sourceNode) { try { n.sourceNode.stop(); } catch (_) {} }
  });

  showToast("👍👍 Locked — entering effects room!");
  _enterEffectsPhase();
}

// ---------------------------------------------------------------------------
// Effects Phase  (pitch / tempo control via palm rotation)
// ---------------------------------------------------------------------------

async function _enterEffectsPhase() {
  _inEffectsMode = true;
  _effectsPitch  = 0;
  _effectsTempo  = 1.0;
  _effectsParam  = "pitch";

  $panel.classList.remove("collapsed");
  $title.textContent = "Fine-tune";
  $sub.textContent   = "Mixing master…";

  $sections.innerHTML = `
    <div class="fx-row" id="fx-pitch">
      <span class="fx-label">Pitch</span>
      <span class="fx-value" id="fx-pitch-val">±0 st</span>
    </div>
    <div class="fx-row" id="fx-tempo">
      <span class="fx-label">Tempo</span>
      <span class="fx-value" id="fx-tempo-val">100%</span>
    </div>
    <p class="fx-hint">Rotate open palm · Fist = switch param · ✋ = preview · 👍👍 = next</p>
  `;
  _updateFxUI();

  document.querySelector(".footer").innerHTML = `
    <button class="btn" id="btn-fx-switch">⇄ Switch</button>
    <button class="btn primary" id="btn-fx-preview">✋ Preview</button>
  `;
  document.getElementById("btn-fx-switch").addEventListener("click", _switchFxParam);
  document.getElementById("btn-fx-preview").addEventListener("click", _previewMaster);

  try {
    _effectsCtx = new AudioContext();
    await _previewMaster();
  } catch (err) {
    showToast(`Effects init error: ${err.message}`);
    $sub.textContent = "Error — try ✋ again";
  }
}

function _updateFxUI() {
  document.getElementById("fx-pitch")?.classList.toggle("fx-active", _effectsParam === "pitch");
  document.getElementById("fx-tempo")?.classList.toggle("fx-active", _effectsParam === "tempo");
  const pv = document.getElementById("fx-pitch-val");
  const tv = document.getElementById("fx-tempo-val");
  if (pv) pv.textContent = `${_effectsPitch >= 0 ? "+" : ""}${_effectsPitch.toFixed(1)} st`;
  if (tv) tv.textContent = `${Math.round(_effectsTempo * 100)}%`;
}

function _switchFxParam() {
  _effectsParam = _effectsParam === "pitch" ? "tempo" : "pitch";
  _updateFxUI();
  showToast(_effectsParam === "pitch" ? "Adjusting Pitch" : "Adjusting Tempo");
}

async function _previewMaster() {
  if (_effectsMixing) return;
  _effectsMixing = true;
  $sub.textContent = "Mixing…";

  if (_effectsSource) { try { _effectsSource.stop(); } catch (_) {} }
  _effectsSource = null;

  try {
    const resp = await fetch(`/api/master?pitch=${_effectsPitch.toFixed(2)}&tempo=${_effectsTempo.toFixed(3)}`, { method: "POST" });
    if (!resp.ok) throw new Error("Mix request failed");

    await new Promise((resolve, reject) => {
      const h = setInterval(async () => {
        const d = await fetch("/api/master/status").then(r => r.json());
        if (d.done)  { clearInterval(h); resolve(); }
        if (d.error) { clearInterval(h); reject(new Error(d.error)); }
      }, 600);
    });

    const ab  = await fetch(`/api/master/file?t=${Date.now()}`).then(r => r.arrayBuffer());
    const buf = await _effectsCtx.decodeAudioData(ab);

    if (_effectsCtx.state === "suspended") _effectsCtx.resume();
    const src = _effectsCtx.createBufferSource();
    src.buffer = buf;
    src.loop   = true;
    src.connect(_effectsCtx.destination);
    src.start(0);
    _effectsSource = src;

    $sub.textContent = "Rotate palm to adjust · ✋ re-preview · 👍👍 lyrics";
  } catch (err) {
    showToast(`Mix error: ${err.message}`);
    $sub.textContent = "Error — try ✋ again";
  } finally {
    _effectsMixing = false;
  }
}

// ---------------------------------------------------------------------------
// AI Finalize  (master.wav → MusicGen melody conditioning → final.wav)
// ---------------------------------------------------------------------------

async function _finalizeWithAI() {
  if (_effectsSource) { try { _effectsSource.stop(); } catch (_) {} }
  _effectsSource = null;

  $title.textContent = "Polishing…";
  $sub.textContent   = "Sending to AI — making a real song…";
  $sections.innerHTML = `<p class="fx-hint">MusicGen is creating a cohesive full-band arrangement from your melody.<br><br>This takes about 30 seconds…</p>`;
  document.querySelector(".footer").innerHTML = "";

  try {
    const resp = await fetch("/api/finalize", { method: "POST" });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail ?? "Finalize failed");

    await new Promise((resolve, reject) => {
      const h = setInterval(async () => {
        const d = await fetch("/api/finalize/status").then(r => r.json());
        if (d.done)  { clearInterval(h); resolve(); }
        if (d.error) { clearInterval(h); reject(new Error(d.error)); }
      }, 2000);
    });

    // Play the finalized result
    const ab  = await fetch(`/api/finalize/file?t=${Date.now()}`).then(r => r.arrayBuffer());
    const buf = await _effectsCtx.decodeAudioData(ab);
    if (_effectsCtx.state === "suspended") _effectsCtx.resume();
    const src = _effectsCtx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(_effectsCtx.destination);
    src.start(0);
    _effectsSource = src;

    showToast("✓ Song polished!");
    _enterLyricsPhase();
  } catch (err) {
    showToast(`Polish failed: ${err.message} — using master as-is`);
    _enterLyricsPhase();
  }
}

// ---------------------------------------------------------------------------
// Lyrics Phase
// ---------------------------------------------------------------------------

async function _enterLyricsPhase() {
  _inEffectsMode = false;
  _inLyricsMode  = true;
  _lyricsText    = "";

  $title.textContent = "Add Lyrics?";
  $sub.textContent   = "👍👍 speak lyrics · ✊ skip & export";

  $sections.innerHTML = `
    <p class="fx-hint">Hold both thumbs up and speak your lyrics.<br>
    The music will keep playing while you talk.<br><br>
    Make a fist to skip and just download the track.</p>
  `;

  document.querySelector(".footer").innerHTML = `
    <button class="btn" id="btn-skip-lyrics">✊ Skip</button>
    <button class="btn primary" id="btn-speak-lyrics">🎙 Speak Lyrics</button>
  `;
  document.getElementById("btn-skip-lyrics").addEventListener("click", () => _exportFinal());
  document.getElementById("btn-speak-lyrics").addEventListener("click", _captureLyrics);
}

function _captureLyrics() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showToast("Speech not supported — exporting as-is"); _exportFinal(); return; }

  $sub.textContent = "🎙 Listening… speak your lyrics";
  document.querySelector(".footer").innerHTML = `<button class="btn primary" id="btn-stop-lyrics">Done ✓</button>`;

  const rec = new SR();
  rec.continuous     = true;
  rec.interimResults = true;
  rec.lang           = "en-US";

  let final = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript + " ";
      else interim = e.results[i][0].transcript;
    }
    _lyricsText = final;
    $sections.innerHTML = `<p class="fx-lyrics">${final}<span style="opacity:0.5">${interim}</span></p>`;
  };

  rec.onerror = () => { _exportFinal(); };
  rec.start();

  document.getElementById("btn-stop-lyrics").addEventListener("click", () => {
    rec.stop();
    _exportFinal();
  });
}

function _exportFinal() {
  if (_effectsSource) { try { _effectsSource.stop(); } catch (_) {} }
  _inLyricsMode = false;

  // Now that all gesture interaction is done, free the camera
  stopGestures();
  const camSrc = document.getElementById("gesture-cam");
  if (camSrc?.srcObject) {
    camSrc.srcObject.getTracks().forEach(t => t.stop());
    camSrc.srcObject = null;
  }
  document.getElementById("cam-preview").style.display = "none";

  $title.textContent = "All Done! 🎉";
  $sub.textContent   = "Your composition is downloading…";

  if (_lyricsText.trim()) {
    $sections.innerHTML = `
      <p class="fx-hint" style="color:rgba(255,255,255,0.7)">Lyrics captured:</p>
      <p class="fx-lyrics">${_lyricsText}</p>
    `;
    // Download lyrics as text file
    const lyricBlob = new Blob([_lyricsText], { type: "text/plain" });
    const lyricUrl  = URL.createObjectURL(lyricBlob);
    const la = document.createElement("a");
    la.href = lyricUrl; la.download = "lyrics.txt"; la.click();
    URL.revokeObjectURL(lyricUrl);
  } else {
    $sections.innerHTML = "";
  }

  // Download final WAV (AI-polished, or master if finalize wasn't run)
  const a = document.createElement("a");
  a.href = `/api/finalize/file?t=${Date.now()}`;
  a.download = "composition_final.wav";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  document.querySelector(".footer").innerHTML = `
    <button class="btn primary" onclick="location.reload()">Start Over 🔄</button>
  `;
}

// ---------------------------------------------------------------------------
// Voice instrument addition  (Web Speech API, triggered by fist-hold)
// ---------------------------------------------------------------------------
let _speechBusy = false;

function startVoiceInstrumentAdd() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $voicePrompt.textContent = "Speech not supported in this browser";
    $voicePrompt.classList.remove("hidden");
    setTimeout(() => $voicePrompt.classList.add("hidden"), 2500);
    return;
  }
  if (_speechBusy) return;
  _speechBusy = true;

  $voicePrompt.textContent = "🎙 Say instrument name…";
  $voicePrompt.classList.remove("hidden");

  const rec = new SR();
  rec.continuous      = false;
  rec.interimResults  = false;
  rec.lang            = "en-US";
  rec.maxAlternatives = 3;

  rec.onresult = (e) => {
    const said = Array.from(e.results[0])
      .map((a) => a.transcript.toLowerCase())
      .join(" ");
    console.log("[voice] heard:", said);

    const matched = SCENE_INSTRUMENTS.find((inst) => said.includes(inst));
    if (matched) {
      $voicePrompt.textContent = `✓ Adding ${matched}`;
      // Add to 3D scene
      window.dispatchEvent(new CustomEvent("instrument:add", { detail: { kind: matched } }));
      // Add to panel tabs (for humming later)
      const name = matched.charAt(0).toUpperCase() + matched.slice(1);
      addTrackTab(matched, name);
    } else {
      $voicePrompt.textContent = `Didn't catch that. Try: piano, violin…`;
    }
    setTimeout(() => $voicePrompt.classList.add("hidden"), 2000);
  };

  rec.onerror = () => {
    $voicePrompt.textContent = "Couldn't hear you — try again";
    setTimeout(() => $voicePrompt.classList.add("hidden"), 2000);
  };

  rec.onend = () => { _speechBusy = false; };
  rec.start();
}

// ---------------------------------------------------------------------------
// Gesture event listeners
// ---------------------------------------------------------------------------

// Badge: show current gesture state in camera preview
window.addEventListener("gesture:state", (e) => {
  if (!$badge) return;
  const g = e.detail.gesture;
  const LABELS = {
    point: "👆 Point",
    fist:  "✊ Fist",
    "open-palm": "✋ Palm",
    "thumbs-up": "👍 Thumbs",
    none:  "—",
    other: "…",
  };
  $badge.textContent = LABELS[g] ?? g;
  $badge.className   = (g !== "none" && g !== "other") ? "active" : "";
});

// Instrument selected by dwell-pointing at 3D model
window.addEventListener("instrument:gesture-selected", (e) => {
  selectTrack(e.detail.kind);
});

// Open palm → re-hum current (review) / preview master (effects) / conduct pause / record (setup)
window.addEventListener("gesture:open-palm", () => {
  if (_inReviewMode)  { if (!_reviewRerecording) _rerecordInReview(); return; }
  if (_inEffectsMode) { _previewMaster(); return; }
  if (_inConductMode) {
    if (_conductHoveredKind && !_conductRerecording) {
      _rerecordInConduct(_conductHoveredKind);
    } else if (!_conductRerecording) {
      _toggleConductPause();
    }
  } else if (activeTrackId && !isRecording) {
    startRecording(activeTrackId);
  }
});

// Instrument hovered while pointing → track which instrument + adjust volume
window.addEventListener("instrument:hover", (e) => {
  if (!e.detail.kind) return;
  if (_inConductMode) {
    _conductHoveredKind = e.detail.kind;
    // raise hand (y→1) = loud, lower hand (y→-1) = quiet
    const vol = Math.max(0, Math.min(1, (e.detail.y + 0.7) / 1.4));
    _setConductVolume(e.detail.kind, vol);
  }
  document.querySelectorAll(".conduct-row").forEach(r =>
    r.classList.toggle("pointed", r.dataset.trackId === e.detail.kind));
});

// Both hands thumbs-up → approve review / finalize conduct / AI polish / done
window.addEventListener("gesture:both-thumbs-up", () => {
  if (_inReviewMode) {
    _reviewApprove();
  } else if (_inEffectsMode) {
    _inEffectsMode = false;
    _finalizeWithAI();
  } else if (_inConductMode) {
    _finalizeConduct();
  }
});

// Palm rotate → adjust active effects parameter
window.addEventListener("gesture:palm-rotate", (e) => {
  if (!_inEffectsMode) return;
  const step = e.detail.delta;
  if (_effectsParam === "pitch") {
    _effectsPitch = Math.max(-6, Math.min(6, _effectsPitch + step * 8));
  } else {
    _effectsTempo = Math.max(0.5, Math.min(2.0, _effectsTempo + step * 0.5));
  }
  _updateFxUI();
});

// Fist (one-shot) → switch fx param (effects mode) or skip lyrics (lyrics mode)
window.addEventListener("gesture:fist", () => {
  if (_inEffectsMode) { _switchFxParam(); return; }
  if (_inLyricsMode)  { _exportFinal();   return; }
});

// Fist hold → voice add instrument (only in setup mode)
window.addEventListener("gesture:fist-hold", () => {
  if (_inEffectsMode || _inLyricsMode || _inReviewMode || _inConductMode) return;
  startVoiceInstrumentAdd();
});

// Thumbs-up → launch conduct / start render  (NOT used during review — use both-thumbs)
window.addEventListener("gesture:thumbs-up", () => {
  if (_inReviewMode) return;
  const conductBtn = document.querySelector(".footer button:last-child");
  if (conductBtn?.textContent.includes("Conduct")) {
    launchConduct();
  } else if (!renderStarted) {
    const done = $sections.querySelectorAll(".tab.done").length;
    if (done > 0) startRender();
  }
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------
boot();
