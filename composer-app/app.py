from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import threading
import urllib.request
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Make hackhcc importable from parent dir
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hackhcc.env import load_project_env
load_project_env()

from hackhcc.composition import (
    Composition,
    create_default_composition,
    hums_dir,
    load_composition,
    save_composition,
)
from hackhcc.phases.setup.intent import apply_intent, default_five_tracks
from hackhcc.phases.setup.pitch import run_pitch_detection
from hackhcc.phases.setup.render import run_render_stems

STATIC_DIR = Path(__file__).parent / "static"
RIGGED_HAND_DIR = Path(__file__).parent / "rigged_hand"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ACTIVE_SESSION_FILE = PROJECT_ROOT / ".active_session"
EXPORTS_DIR = PROJECT_ROOT / "exports"

# Treble Trouble web app (login / name / publish + MongoDB). Override with the
# TREBLE_TROUBLE_URL env var when it runs somewhere other than localhost:3000.
TREBLE_TROUBLE_URL = os.environ.get("TREBLE_TROUBLE_URL", "http://localhost:3000").rstrip("/")


# ---------------------------------------------------------------------------
# Shared mutable state (lives in app.state.ctx)
# ---------------------------------------------------------------------------
class _Ctx:
    subprocesses: list[Any]
    hum_busy: dict[str, bool]      # track_id -> currently recording
    hum_done: dict[str, bool]      # track_id -> finished + pitch run
    hum_error: dict[str, str | None]
    render_busy: bool
    render_done: bool
    render_error: str | None

    def __init__(self) -> None:
        self.subprocesses = []
        self.hum_busy = {}
        self.hum_done = {}
        self.hum_error = {}
        self.render_busy = False
        self.render_done = False
        self.render_error = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.ctx = _Ctx()
    yield
    for proc in app.state.ctx.subprocesses:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/rigged_hand", StaticFiles(directory=RIGGED_HAND_DIR), name="rigged_hand")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _read_active_session() -> str | None:
    return ACTIVE_SESSION_FILE.read_text().strip() if ACTIVE_SESSION_FILE.is_file() else None


def _write_active_session(sid: str) -> None:
    ACTIVE_SESSION_FILE.write_text(sid)


def _comp_json(comp: Composition) -> dict:
    return {
        "session_id": comp.session_id,
        "mood": comp.mood,
        "bpm": comp.bpm,
        "key": comp.key,
        "phase": comp.phase,
        "allow_conduct": comp.flags.get("allow_conduct", False),
        "tracks": [
            {
                "id": t.id,
                "name": t.name,
                "instrument": t.instrument,
                "hum_done": bool(t.hum_path),
                "stem_done": bool(t.stem_path),
                "notes_count": len(t.notes),
                "notes": [n.to_dict() for n in t.notes],
            }
            for t in comp.tracks
        ],
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/ping")
async def ping():
    return {"status": "ok"}


# --- Session ----------------------------------------------------------------

class SessionStartBody(BaseModel):
    session_id: str = "session1"
    mood: str = "upbeat"


@app.post("/api/session/start")
async def session_start(body: SessionStartBody):
    def _init():
        try:
            comp = load_composition(body.session_id)
        except FileNotFoundError:
            comp = create_default_composition(body.session_id)
        if not comp.tracks:
            apply_intent(
                body.session_id,
                mood=body.mood,
                tracks=default_five_tracks(),
                source="web",
            )
        _write_active_session(body.session_id)
        return load_composition(body.session_id)

    comp = await asyncio.to_thread(_init)
    return _comp_json(comp)


@app.get("/api/session/state")
async def session_state():
    sid = _read_active_session()
    if not sid:
        return {"session_id": None, "tracks": [], "phase": "idle"}
    try:
        comp = await asyncio.to_thread(load_composition, sid)
        return _comp_json(comp)
    except FileNotFoundError:
        return {"session_id": sid, "tracks": [], "phase": "idle"}


# --- Hum recording ----------------------------------------------------------

@app.post("/api/tracks/{track_id}/hum")
async def start_hum(track_id: str, seconds: float = 5.0):
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session — call /api/session/start first")

    ctx: _Ctx = app.state.ctx
    if ctx.hum_busy.get(track_id):
        raise HTTPException(409, f"Already recording {track_id}")

    ctx.hum_busy[track_id] = True
    ctx.hum_done[track_id] = False
    ctx.hum_error[track_id] = None

    def _record():
        try:
            import numpy as np
            import sounddevice as sd
            from scipy.io import wavfile

            audio = sd.rec(
                int(seconds * 22_050),
                samplerate=22_050,
                channels=1,
                dtype="float32",
            )
            sd.wait()
            audio = audio[:, 0]

            folder = hums_dir(sid)
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / f"{track_id}.wav"
            wavfile.write(path, 22_050, (np.clip(audio, -1.0, 1.0) * 32767).astype("int16"))

            comp = load_composition(sid)
            for t in comp.tracks:
                if t.id == track_id:
                    t.hum_path = f"hums/{track_id}.wav"
                    break
            save_composition(comp)

            run_pitch_detection(sid)
            ctx.hum_done[track_id] = True
        except Exception as exc:
            ctx.hum_error[track_id] = str(exc)
        finally:
            ctx.hum_busy[track_id] = False

    threading.Thread(target=_record, daemon=True).start()
    return {"status": "recording", "track_id": track_id, "seconds": seconds}


@app.get("/api/tracks/{track_id}/hum/status")
async def hum_status(track_id: str):
    ctx: _Ctx = app.state.ctx
    sid = _read_active_session()
    notes: list = []
    if sid and ctx.hum_done.get(track_id):
        try:
            comp = await asyncio.to_thread(load_composition, sid)
            for t in comp.tracks:
                if t.id == track_id:
                    notes = [n.to_dict() for n in t.notes]
                    break
        except Exception:
            pass
    return {
        "track_id": track_id,
        "recording": ctx.hum_busy.get(track_id, False),
        "done": ctx.hum_done.get(track_id, False),
        "error": ctx.hum_error.get(track_id),
        "notes": notes,
    }


# --- Stem render ------------------------------------------------------------

@app.post("/api/render")
async def start_render():
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")

    ctx: _Ctx = app.state.ctx
    if ctx.render_busy:
        raise HTTPException(409, "Render already running")

    ctx.render_busy = True
    ctx.render_done = False
    ctx.render_error = None

    def _render():
        try:
            run_render_stems(sid)
            # Unlock conduct — stems exist, session is ready to play
            try:
                comp = load_composition(sid)
                comp.flags["stems_complete"] = True
                comp.flags["setup_complete"] = True
                comp.flags["allow_conduct"] = True
                from hackhcc.composition import Phase
                comp.phase = Phase.CONDUCT.value
                save_composition(comp)
            except Exception:
                pass
            ctx.render_done = True
        except Exception as exc:
            ctx.render_error = str(exc)
        finally:
            ctx.render_busy = False

    threading.Thread(target=_render, daemon=True).start()
    return {"status": "rendering", "session_id": sid}


@app.get("/api/render/status")
async def render_status():
    ctx: _Ctx = app.state.ctx
    return {
        "running": ctx.render_busy,
        "done": ctx.render_done,
        "error": ctx.render_error,
    }


# --- Conduct ----------------------------------------------------------------

@app.get("/api/stems/{track_id}")
async def serve_stem(track_id: str):
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")
    from hackhcc.composition import session_dir
    stem_path = session_dir(sid) / "stems" / f"{track_id}.wav"
    if not stem_path.is_file():
        raise HTTPException(404, f"Stem '{track_id}' not found — render first")
    return FileResponse(str(stem_path), media_type="audio/wav")


@app.post("/api/conduct/start")
async def conduct_start():
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")
    comp = await asyncio.to_thread(load_composition, sid)
    if not comp.flags.get("allow_conduct"):
        raise HTTPException(400, f"Session '{sid}' is not ready — render first.")
    from hackhcc.composition import session_dir
    stems = []
    for t in comp.tracks:
        stem_path = session_dir(sid) / "stems" / f"{t.id}.wav"
        if stem_path.is_file():
            stems.append({"track_id": t.id, "name": t.name or t.id, "url": f"/api/stems/{t.id}"})
    return {"status": "ready", "stems": stems, "session_id": sid}


# --- Publish ----------------------------------------------------------------

def _upload_mix_to_treble_trouble(wav_path: Path, session_id: str) -> str:
    """POST the exported mix to Treble Trouble's GridFS upload; return audioId."""
    data = wav_path.read_bytes()
    boundary = uuid.uuid4().hex
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{session_id}.wav"\r\n'.encode(),
        b"Content-Type: audio/wav\r\n\r\n",
        data,
        f"\r\n--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(
        f"{TREBLE_TROUBLE_URL}/api/audio/upload",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp).get("audioId")


@app.post("/api/publish")
async def publish():
    """Hand the finished song off to Treble Trouble to be named + published.

    Uploads the exported mix (exports/<session>.wav) into the web app's GridFS,
    then returns a /publish URL the browser should redirect to so the conductor
    can log in, name the piece, and publish it to the leaderboard.
    """
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")

    wav = EXPORTS_DIR / f"{sid}.wav"
    if not wav.is_file():
        raise HTTPException(
            400, "No exported song yet — finish conducting and press E to export first"
        )

    try:
        audio_id = await asyncio.to_thread(_upload_mix_to_treble_trouble, wav, sid)
    except Exception as exc:  # noqa: BLE001 — surface any transport/HTTP error to the UI
        raise HTTPException(
            502, f"Couldn't reach Treble Trouble at {TREBLE_TROUBLE_URL} ({exc})"
        )

    if not audio_id:
        raise HTTPException(502, "Upload succeeded but no audioId was returned")

    publish_url = f"{TREBLE_TROUBLE_URL}/publish?audioId={audio_id}&session={sid}"
    return {"publish_url": publish_url, "audio_id": audio_id}
