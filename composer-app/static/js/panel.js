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
  { id: "drums",   name: "Drums" },
];

// Instruments the 3D scene can render (superset — user can add via voice)
const SCENE_INSTRUMENTS = [
  "piano", "violin", "trumpet", "drums",
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
const trackNotes  = {};

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
  let sessionData = null;
  try {
    const resp = await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: SESSION_ID, mood: "upbeat" }),
    });
    sessionData = await resp.json();
  } catch (err) {
    console.warn("[panel] session/start failed:", err);
  }

  if (sessionData?.tracks?.length) {
    for (const track of sessionData.tracks) {
      registerTrackNotes(track.id, track.notes ?? []);
    }
  }

  // Instruments are added to 3D scene after voice command on curtain-open
  // (see gesture:curtain-open listener below)

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
  registerTrackNotes(trackId, notes);

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

function normalizeTrackNotes(notes) {
  return (notes ?? []).map((n) => ({
    midi: Number(n.midi),
    startMs: Number(n.start_ms ?? n.startMs ?? 0),
    durationMs: Number(n.duration_ms ?? n.durationMs ?? 0),
  })).filter((n) => Number.isFinite(n.midi));
}

function registerTrackNotes(trackId, notes) {
  const normalized = normalizeTrackNotes(notes);
  trackNotes[trackId] = normalized;
  window.dispatchEvent(new CustomEvent("notes:track-ready", {
    detail: { trackId, notes: normalized },
  }));
}

function buildPlaybackNotes() {
  return Object.keys(_conductNodes).flatMap((trackId) =>
    (trackNotes[trackId] ?? []).map((note) => ({
      trackId,
      midi: note.midi,
      startMs: note.startMs,
    })),
  );
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
      registerTrackNotes(trackId, data.notes);
      $note.textContent    = midiToName(data.notes[0].midi);
      $noteSub.textContent = `${data.notes.length} notes detected`;
      $sections.querySelector(`[data-track-id="${trackId}"]`)?.classList.add("done");
    }
  } catch (_) {}
}

function clearCurrentTrack() {
  if (!activeTrackId) return;
  clearNotesList();
  registerTrackNotes(activeTrackId, []);
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
let _inLyricsMode    = false;
let _lyricsText      = "";
let _lyricsRecording = false;
let _lyricsStopFn    = null;   // cleanup fn exposed by _captureLyrics
let _lyricsFinishing = false;  // true while 3-second countdown is running

// AI polish phase (between effects and lyrics)
let _inPolishMode = false;

// Curtain voice trigger
let _instrumentsLaunched  = false;
let _voiceStartListening  = false;

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
  const playbackNotes = buildPlaybackNotes();
  window.dispatchEvent(new CustomEvent("notes:playback-start", {
    detail: { notes: playbackNotes },
  }));
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
    window.dispatchEvent(new CustomEvent("notes:playback-stop"));
    if (btn) btn.textContent = "▶ Resume";
  } else {
    _conductCtx.resume();
    window.dispatchEvent(new CustomEvent("notes:playback-start", {
      detail: { notes: buildPlaybackNotes() },
    }));
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

    $sub.textContent = `Re-rendering ${name}…`;
    await fetch(`/api/render/${trackId}`, { method: "POST" });
    await new Promise((resolve, reject) => {
      const h = setInterval(async () => {
        const d = await fetch("/api/render/status").then(r => r.json());
        if (d.done)  { clearInterval(h); resolve(); }
        if (d.error) { clearInterval(h); reject(new Error(d.error)); }
      }, 1000);
    });

    // Only reload the changed stem, not all of them
    const ab  = await fetch(`/api/stems/${trackId}?t=${Date.now()}`).then(r => r.arrayBuffer());
    const buf = await _conductCtx.decodeAudioData(ab);
    _conductNodes[trackId].buffer = buf;
    _startStemSource(trackId);

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

    $sub.textContent = `Re-rendering ${s.name}…`;
    await fetch(`/api/render/${s.track_id}`, { method: "POST" });
    await new Promise((resolve, reject) => {
      const h = setInterval(async () => {
        const d = await fetch("/api/render/status").then(r => r.json());
        if (d.done)  { clearInterval(h); resolve(); }
        if (d.error) { clearInterval(h); reject(new Error(d.error)); }
      }, 1000);
    });

    // Only reload the re-hummed stem's buffer
    const ab = await fetch(`/api/stems/${s.track_id}?t=${Date.now()}`).then(r => r.arrayBuffer());
    s.buffer = await _reviewCtx.decodeAudioData(ab);

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
  _inPolishMode = true;
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
    _inPolishMode = false;
    _enterLyricsPhase();
  } catch (err) {
    _inPolishMode = false;
    showToast(`Polish failed: ${err.message} — using master as-is`);
    _enterLyricsPhase();
  }
}

// ---------------------------------------------------------------------------
// Lyrics Phase
// ---------------------------------------------------------------------------

async function _enterLyricsPhase() {
  _inEffectsMode   = false;
  _inLyricsMode    = true;
  _lyricsText      = "";
  _lyricsFinishing = false;

  $title.textContent = "Add Lyrics?";
  $sub.textContent   = "🎙 Speak, then ✊ fist to finish";

  $sections.innerHTML = `
    <p class="fx-hint">Click <strong>Speak Lyrics</strong> and say your lyrics.<br>
    Make a <strong>fist ✊</strong> (or click Done) when finished —<br>
    a 3-second pause lets the mic close cleanly before processing.<br><br>
    Skip to just download the instrumental.</p>
  `;

  document.querySelector(".footer").innerHTML = `
    <button class="btn" id="btn-skip-lyrics">Skip</button>
    <button class="btn primary" id="btn-speak-lyrics">🎙 Speak Lyrics</button>
  `;
  document.getElementById("btn-skip-lyrics").addEventListener("click", () => _exportFinal());
  document.getElementById("btn-speak-lyrics").addEventListener("click", _captureLyrics);
}

// Called by fist gesture or Done button — countdown then process
function _finishLyricsCapture() {
  if (_lyricsFinishing || !_lyricsRecording) return;
  _lyricsFinishing = true;

  // Flush textarea if that fallback is active
  const ta = document.getElementById("lyrics-input");
  if (ta) _lyricsText = ta.value;

  const btn = document.getElementById("btn-stop-lyrics");
  let n = 3;
  const update = () => {
    $sub.textContent = `Closing mic in ${n}…`;
    if (btn) btn.textContent = `Done in ${n}…`;
  };
  update();

  const tick = setInterval(() => {
    n--;
    if (n > 0) {
      update();
    } else {
      clearInterval(tick);
      _lyricsRecording = false;
      _lyricsFinishing = false;
      if (_lyricsStopFn) { _lyricsStopFn(); _lyricsStopFn = null; }
      _mixLyricsAndExport();
    }
  }, 1000);
}

function _captureLyrics() {
  if (_lyricsRecording) return;
  _lyricsRecording = true;
  _lyricsFinishing = false;
  $sub.textContent = "🎙 Speak lyrics — ✊ fist when done";
  document.querySelector(".footer").innerHTML = `<button class="btn primary" id="btn-stop-lyrics">✊ Done (3s)</button>`;

  let _wsResources = null;  // { ws, audioCtx, processor, micStream }
  let _activeSR    = null;  // Web Speech rec instance

  function _stopAll() {
    if (_activeSR) { try { _activeSR.stop(); } catch (_) {} _activeSR = null; }
    if (_wsResources) {
      const { ws, audioCtx, processor, micStream } = _wsResources;
      try { if (processor) processor.disconnect(); } catch (_) {}
      try { if (audioCtx)  audioCtx.close();        } catch (_) {}
      if (micStream) micStream.getTracks().forEach(t => t.stop());
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      _wsResources = null;
    }
  }

  // Expose so _finishLyricsCapture (called by fist gesture) can reach it
  _lyricsStopFn = _stopAll;

  document.getElementById("btn-stop-lyrics").addEventListener("click", () => {
    _finishLyricsCapture();
  });

  // Fallback #2: textarea for typed lyrics
  function _fallbackToTextarea() {
    if (!_lyricsRecording) return;
    showToast("No speech API — type your lyrics");
    $sections.innerHTML = `<textarea id="lyrics-input"
      style="width:100%;height:110px;background:rgba(255,255,255,0.05);border:1px solid
      rgba(255,255,255,0.15);border-radius:8px;color:#fff;padding:10px;
      font:400 13px/1.5 'Inter',sans-serif;resize:none"
      placeholder="Type your lyrics here…"></textarea>`;
    document.getElementById("lyrics-input")?.focus();
  }

  // Fallback #1: Web Speech API
  function _fallbackToWebSpeech() {
    if (!_lyricsRecording) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { _fallbackToTextarea(); return; }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
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
    rec.onerror = () => { if (_lyricsRecording) _fallbackToTextarea(); };
    rec.start();
    _activeSR = rec;
  }

  // Primary: ElevenLabs WebSocket STT (same AudioContext fix as curtain trigger)
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const ws = new WebSocket(`ws://${location.host}/ws/stt`);
    _wsResources = { ws, audioCtx: null, processor: null, micStream: stream };

    ws.onopen = () => {
      try {
        const audioCtx  = new AudioContext();
        _wsResources.audioCtx = audioCtx;
        const nativeRate = audioCtx.sampleRate;
        const src = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        _wsResources.processor = processor;
        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const f32 = e.inputBuffer.getChannelData(0);
          const ratio = nativeRate / 16000;
          const targetLen = Math.floor(f32.length / ratio);
          const i16 = new Int16Array(targetLen);
          for (let i = 0; i < targetLen; i++) {
            const s = f32[Math.round(i * ratio)];
            i16[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
          }
          if (i16.length > 0) ws.send(i16.buffer);
        };
        src.connect(processor);
        processor.connect(audioCtx.destination);
      } catch (err) {
        console.warn("[lyrics-stt] AudioContext error:", err);
        _stopAll();
        _fallbackToWebSpeech();
      }
    };

    let accumulated  = "";
    let lastPartial  = "";
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.error === "no_token") { _stopAll(); _fallbackToWebSpeech(); return; }
      if (msg.type === "committed" && msg.text) {
        accumulated += msg.text + " ";
        lastPartial  = "";
      } else if (msg.type === "partial" && msg.text) {
        lastPartial = msg.text;
      }
      // Always mirror what's on screen — so Done captures everything visible
      _lyricsText = (accumulated + lastPartial).trim();
      const display = accumulated
        + (lastPartial ? `<span style="opacity:0.5">${lastPartial}</span>` : "");
      $sections.innerHTML = `<p class="fx-lyrics">${display}</p>`;
    };

    ws.onerror = () => { _stopAll(); _fallbackToWebSpeech(); };
  }).catch(() => _fallbackToWebSpeech());
}

async function _mixLyricsAndExport() {
  if (!_lyricsText.trim()) { _exportFinal(); return; }

  $title.textContent = "Generating Song…";
  $sub.textContent   = "Starting ACE-Step…";
  $sections.innerHTML = `<p class="fx-hint">Composing a warm, cohesive song with your lyrics.<br>Runs on Replicate — takes 60–120 seconds.</p>`;
  document.querySelector(".footer").innerHTML = "";

  // Live elapsed timer so the user knows it's actively processing
  let elapsed = 0;
  const dots = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  const timer = setInterval(() => {
    elapsed++;
    const spin = dots[elapsed % dots.length];
    $sub.textContent = `${spin} Composing… ${elapsed}s`;
  }, 1000);

  try {
    const resp = await fetch("/api/lyrics/mix", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ lyrics: _lyricsText }),
    });
    if (!resp.ok) throw new Error("Lyrics mix request failed");

    await new Promise((resolve, reject) => {
      const h = setInterval(async () => {
        const d = await fetch("/api/lyrics/mix/status").then(r => r.json());
        if (d.done)  { clearInterval(h); resolve(); }
        if (d.error) { clearInterval(h); reject(new Error(d.error)); }
      }, 1000);
    });

    clearInterval(timer);
    $sub.textContent = `Done in ${elapsed}s`;
    showToast("✓ Vocals mixed in!");
    _exportFinal(true);
  } catch (err) {
    clearInterval(timer);
    showToast(`Vocals failed: ${err.message} — exporting without vocals`);
    _exportFinal(false);
  }
}

function _exportFinal(withLyrics = false) {
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
      <p class="fx-hint" style="color:rgba(255,255,255,0.7)">Lyrics ${withLyrics ? "mixed in" : "captured"}:</p>
      <p class="fx-lyrics">${_lyricsText}</p>
    `;
  } else {
    $sections.innerHTML = "";
  }

  // Download final WAV — with-vocals version if lyrics were mixed, AI-polish otherwise
  const apiPath  = withLyrics ? `/api/lyrics/mix/file` : `/api/finalize/file`;
  const filename = withLyrics ? "composition_with_lyrics.wav" : "composition_final.wav";
  const a = document.createElement("a");
  a.href = `${apiPath}?t=${Date.now()}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  document.querySelector(".footer").innerHTML = `
    <button class="btn primary" id="btn-publish-final">Save & publish ↗</button>
    <button class="btn" onclick="location.reload()" style="margin-top:6px">Start Over 🔄</button>
  `;
  document.getElementById("btn-publish-final").addEventListener("click", publishSong);
}

// Upload the exported mix and redirect to the web app's publish page.
async function publishSong() {
  showToast("Saving your performance…");
  try {
    const res = await fetch("/api/publish", { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || "Render your song first");
      return;
    }
    const data = await res.json();
    window.location.href = data.publish_url;   // → log in, name it, publish
  } catch (err) {
    console.warn("[panel] publish failed:", err);
    showToast("Publish failed — is the web app running on :3000?");
  }
}

// ---------------------------------------------------------------------------
// Curtain opening — voice command launches instruments onto stage
// ---------------------------------------------------------------------------

function _playDramaticSpawnSound() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // Timpani-like boom: filtered noise burst at ~80 Hz
    const drumLen = Math.floor(ctx.sampleRate * 0.6);
    const drumBuf = ctx.createBuffer(1, drumLen, ctx.sampleRate);
    const drumData = drumBuf.getChannelData(0);
    for (let i = 0; i < drumLen; i++)
      drumData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (drumLen * 0.1));
    const drumSrc = ctx.createBufferSource();
    drumSrc.buffer = drumBuf;
    const drumBP = ctx.createBiquadFilter();
    drumBP.type = "bandpass"; drumBP.frequency.value = 80; drumBP.Q.value = 2;
    const drumGain = ctx.createGain();
    drumGain.gain.setValueAtTime(1.5, now);
    drumGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    drumSrc.connect(drumBP); drumBP.connect(drumGain); drumGain.connect(ctx.destination);
    drumSrc.start(now);

    // Brass chord stab: C minor (C3 Eb3 G3 C4), staggered attack
    for (const [freq, startT] of [[130.81, 0.03], [155.56, 0.05], [196.00, 0.04], [261.63, 0.06]]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth"; osc.frequency.value = freq;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 1600; lp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.11, now + startT + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + 2.4);
      osc.connect(lp); lp.connect(g); g.connect(ctx.destination);
      osc.start(now + startT); osc.stop(now + 2.5);
    }

    // Cymbal shimmer: high-passed white noise burst
    const shimLen = Math.floor(ctx.sampleRate * 0.25);
    const shimBuf = ctx.createBuffer(1, shimLen, ctx.sampleRate);
    const shimData = shimBuf.getChannelData(0);
    for (let i = 0; i < shimLen; i++)
      shimData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (shimLen * 0.25));
    const shimSrc = ctx.createBufferSource();
    shimSrc.buffer = shimBuf;
    const shimHP = ctx.createBiquadFilter();
    shimHP.type = "highpass"; shimHP.frequency.value = 5000;
    const shimG = ctx.createGain(); shimG.gain.value = 0.35;
    shimSrc.connect(shimHP); shimHP.connect(shimG); shimG.connect(ctx.destination);
    shimSrc.start(now);

    setTimeout(() => ctx.close(), 4000);
  } catch (_) {}
}

function _launchInstruments() {
  if (_instrumentsLaunched) return;
  _instrumentsLaunched = true;
  _playDramaticSpawnSound();
  // Stagger each instrument family 350 ms apart so they don't all crash in at once
  CORE_TRACKS.forEach((t, i) => {
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("instrument:add", { detail: { kind: t.id } }));
    }, i * 350);
  });
  // Open panel after the last family has had time to animate in
  setTimeout(() => $panel.classList.remove("collapsed"), CORE_TRACKS.length * 350 + 500);
}

// Primary: ElevenLabs Scribe v2 Realtime via WebSocket
async function _startElevenLabsSTT() {
  if (_instrumentsLaunched) return;

  let ws       = null;
  let audioCtx = null;
  let micStream = null;
  let processor = null;

  function _cleanup() {
    try { if (processor) processor.disconnect(); } catch (_) {}
    try { if (audioCtx)  audioCtx.close();        } catch (_) {}
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  }

  // Safety timeout — launch instruments even if voice never fires
  const timeout = setTimeout(() => {
    if (!_instrumentsLaunched) { _cleanup(); _launchInstruments(); }
  }, 15000);

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    ws = new WebSocket(`ws://${location.host}/ws/stt`);

    ws.onopen = () => {
      try {
        // Don't force sampleRate — PulseAudio on Linux only supports 44100/48000
        audioCtx = new AudioContext();
        const nativeRate = audioCtx.sampleRate;
        const src = audioCtx.createMediaStreamSource(micStream);
        processor = audioCtx.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const f32 = e.inputBuffer.getChannelData(0);
          // Downsample native rate → 16 kHz before sending to ElevenLabs
          const ratio     = nativeRate / 16000;
          const targetLen = Math.floor(f32.length / ratio);
          const i16       = new Int16Array(targetLen);
          for (let i = 0; i < targetLen; i++) {
            const s = f32[Math.round(i * ratio)];
            i16[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
          }
          if (i16.length > 0) ws.send(i16.buffer);
        };
        src.connect(processor);
        processor.connect(audioCtx.destination);
      } catch (err) {
        console.warn("[stt] AudioContext setup error — falling back to Web Speech:", err);
        _cleanup();
        clearTimeout(timeout);
        _fallbackVoiceCommand();
      }
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.error === "no_token") {
        // No ElevenLabs token — fall back to Web Speech API
        _cleanup();
        clearTimeout(timeout);
        _fallbackVoiceCommand();
        return;
      }
      const heard = (msg.text || "").toLowerCase();
      if (heard) $voicePrompt.textContent = `🎙 "${msg.text}"`;
      const triggered = ["instrument","give","start","orchestra","music","begin","play","bring","my"].some(w => heard.includes(w));
      if (triggered && (msg.type === "committed" || heard.includes("instrument"))) {
        clearTimeout(timeout);
        $voicePrompt.textContent = "✓ Here they come!";
        setTimeout(() => $voicePrompt.classList.add("hidden"), 1800);
        _cleanup();
        _launchInstruments();
      }
    };

    ws.onerror = () => { _cleanup(); clearTimeout(timeout); _fallbackVoiceCommand(); };
    ws.onclose = () => {};

  } catch (err) {
    console.warn("[stt] ElevenLabs init failed:", err);
    _cleanup();
    clearTimeout(timeout);
    _fallbackVoiceCommand();
  }
}

// Fallback: Web Speech API (used if no ElevenLabs token or WebSocket fails)
function _fallbackVoiceCommand() {
  if (_voiceStartListening || _instrumentsLaunched) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { _launchInstruments(); $voicePrompt.classList.add("hidden"); return; }

  _voiceStartListening = true;
  const rec = new SR();
  rec.continuous      = false;
  rec.interimResults  = false;
  rec.lang            = "en-US";
  rec.maxAlternatives = 3;

  rec.onresult = (e) => {
    const heard = Array.from(e.results[0]).map(a => a.transcript.toLowerCase()).join(" ");
    console.log("[voice] curtain heard:", heard);
    const triggered = ["instrument","give","start","orchestra","music","begin","play"].some(w => heard.includes(w));
    if (triggered) {
      $voicePrompt.textContent = "✓ Here they come!";
      setTimeout(() => $voicePrompt.classList.add("hidden"), 1800);
      _launchInstruments();
    } else {
      $voicePrompt.textContent = "🎙 Say \"Give me my instruments\"";
      _voiceStartListening = false;
      setTimeout(_fallbackVoiceCommand, 300);
    }
  };

  rec.onerror = () => { _voiceStartListening = false; setTimeout(_fallbackVoiceCommand, 600); };
  rec.onend   = () => { _voiceStartListening = false; };
  rec.start();
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

// Curtain opens → wait for ElevenLabs voice command "Give me my instruments"
window.addEventListener("gesture:curtain-open", () => {
  setTimeout(() => {
    $voicePrompt.textContent = "🎙 Say \"Give me my instruments\"";
    $voicePrompt.classList.remove("hidden");
    _startElevenLabsSTT();
  }, 1500);
});

// Both hands thumbs-up → approve review / finalize conduct / AI polish / speak lyrics
window.addEventListener("gesture:both-thumbs-up", () => {
  if (_inReviewMode) {
    _reviewApprove();
  } else if (_inEffectsMode) {
    _inEffectsMode = false;
    _finalizeWithAI();
  } else if (_inConductMode) {
    _finalizeConduct();
  } else if (_inLyricsMode && !_lyricsRecording) {
    _captureLyrics();
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

// Fist (one-shot) → switch fx param (effects) / finish lyrics with countdown / skip if not recording
window.addEventListener("gesture:fist", () => {
  if (_inEffectsMode) { _switchFxParam(); return; }
  if (_inLyricsMode && _lyricsRecording) { _finishLyricsCapture(); return; }
  if (_inLyricsMode) { _exportFinal(); return; }
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
// Demo shortcut: press P to advance the current phase instantly
// ---------------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
  if (e.key !== "p" && e.key !== "P") return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  _demoPressP();
});

async function _demoPressP() {
  // Curtain / pre-launch
  if (!_instrumentsLaunched) {
    showToast("Demo: launching instruments");
    _launchInstruments();
    return;
  }
  // Review: approve current stem
  if (_inReviewMode)   { _reviewApprove();   return; }
  // Conduct: finalize
  if (_inConductMode)  { _finalizeConduct(); return; }
  // Effects: proceed to AI polish with current values
  if (_inEffectsMode)  { _inEffectsMode = false; _finalizeWithAI(); return; }
  // Polish: let it finish (no-op)
  if (_inPolishMode)   { showToast("Polishing… please wait"); return; }
  // Lyrics: skip and export
  if (_inLyricsMode)   { _exportFinal(false); return; }

  // Setup: fill missing hums from last recorded hum, then render
  if (!renderStarted) {
    showToast("Demo: filling hums + rendering…");
    try {
      await fetch("/api/demo/fill-and-render", { method: "POST" });
      renderStarted       = true;
      $harmonize.textContent = "Rendering…";
      $harmonize.disabled    = true;
      const poll = setInterval(async () => {
        try {
          const d = await fetch("/api/render/status").then(r => r.json());
          if (d.done)  { clearInterval(poll); onRenderDone(); }
          if (d.error) {
            clearInterval(poll);
            showToast("Render error: " + d.error);
            renderStarted          = false;
            $harmonize.textContent = "Harmonize ✦";
            $harmonize.disabled    = false;
          }
        } catch (_) {}
      }, 2000);
    } catch (err) {
      showToast("Demo error: " + err.message);
    }
    return;
  }

  // Render done — launch conduct if not yet started
  const btn = document.querySelector(".footer button");
  if (btn?.textContent.includes("Conduct")) launchConduct();
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------
boot();
