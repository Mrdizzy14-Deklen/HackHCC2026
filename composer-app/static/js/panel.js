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

import { initGestures } from "./gestures.js";

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

async function launchConduct() {
  try { await fetch("/api/conduct/start", { method: "POST" }); }
  catch (err) { console.warn("[panel] conduct/start failed:", err); }
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

// Open palm → start humming
window.addEventListener("gesture:open-palm", () => {
  if (activeTrackId && !isRecording) startRecording(activeTrackId);
});

// Fist hold → voice add instrument
window.addEventListener("gesture:fist-hold", () => {
  startVoiceInstrumentAdd();
});

// Thumbs-up → render or conduct
window.addEventListener("gesture:thumbs-up", () => {
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
