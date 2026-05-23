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

from fastapi import FastAPI, HTTPException, WebSocket
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
        self.mix_busy      = False
        self.mix_done      = False
        self.mix_error: str | None = None
        self.finalize_busy  = False
        self.finalize_done  = False
        self.finalize_error: str | None = None
        self.lyrics_busy  = False
        self.lyrics_done  = False
        self.lyrics_error: str | None = None


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
# Mix helper
# ---------------------------------------------------------------------------

def _do_mix_stems(sid: str, pitch: float = 0.0, tempo: float = 1.0) -> Path:
    import numpy as np
    import librosa
    from hackhcc.composition import session_dir

    s_dir = session_dir(sid) / "stems"
    comp  = load_composition(sid)

    arrays, sr_out = [], None
    for t in comp.tracks:
        p = s_dir / f"{t.id}.wav"
        if not p.is_file():
            continue
        y, sr = librosa.load(str(p), sr=None, mono=True)
        if sr_out is None:
            sr_out = sr
        elif sr != sr_out:
            y = librosa.resample(y, orig_sr=sr, target_sr=sr_out)
        arrays.append(y)

    if not arrays:
        raise RuntimeError("No stems found — render first")

    max_len = max(len(a) for a in arrays)
    mixed   = np.mean([np.pad(a, (0, max_len - len(a))) for a in arrays], axis=0)

    if pitch != 0:
        mixed = librosa.effects.pitch_shift(mixed, sr=sr_out, n_steps=float(pitch))
    if tempo != 1.0:
        mixed = librosa.effects.time_stretch(mixed, rate=float(tempo))

    peak = np.max(np.abs(mixed))
    if peak > 0:
        mixed = mixed / peak * 0.9

    out = session_dir(sid) / "master.wav"
    try:
        import soundfile as sf
        sf.write(str(out), mixed, sr_out)
    except ImportError:
        from scipy.io import wavfile
        wavfile.write(str(out), sr_out, mixed.astype("float32"))
    return out


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


@app.post("/api/render/{track_id}")
async def start_single_render(track_id: str):
    """Re-render just one stem — used during conduct/review re-hum (much faster)."""
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")
    ctx: _Ctx = app.state.ctx
    if ctx.render_busy:
        raise HTTPException(409, "Render already running")

    ctx.render_busy  = True
    ctx.render_done  = False
    ctx.render_error = None

    def _render():
        try:
            from hackhcc.phases.setup.render import (
                render_track_stem,
                _find_primary_melody_hum,
                _MELODIC_INSTRUMENTS,
            )
            comp  = load_composition(sid)
            track = next((t for t in comp.tracks if t.id == track_id), None)
            if not track:
                raise ValueError(f"Track '{track_id}' not found")
            shared_hum = _find_primary_melody_hum(comp, sid)
            is_melodic = track.instrument.lower() in _MELODIC_INSTRUMENTS
            track.stem_path = render_track_stem(
                sid, track, comp,
                shared_melody_hum=(shared_hum if is_melodic else None),
            )
            save_composition(comp)
            ctx.render_done = True
        except Exception as exc:
            ctx.render_error = str(exc)
        finally:
            ctx.render_busy = False

    threading.Thread(target=_render, daemon=True).start()
    return {"status": "rendering", "track_id": track_id}


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


# --- Master mix -------------------------------------------------------------

@app.post("/api/master")
async def create_master(pitch: float = 0.0, tempo: float = 1.0):
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")
    ctx: _Ctx = app.state.ctx
    if ctx.mix_busy:
        raise HTTPException(409, "Mix already running")
    ctx.mix_busy  = True
    ctx.mix_done  = False
    ctx.mix_error = None
    def _mix():
        try:
            _do_mix_stems(sid, pitch, tempo)
            ctx.mix_done = True
        except Exception as exc:
            ctx.mix_error = str(exc)
        finally:
            ctx.mix_busy = False
    threading.Thread(target=_mix, daemon=True).start()
    return {"status": "mixing", "pitch": pitch, "tempo": tempo}


@app.get("/api/master/status")
async def master_status():
    ctx: _Ctx = app.state.ctx
    return {"busy": ctx.mix_busy, "done": ctx.mix_done, "error": ctx.mix_error}


@app.get("/api/master/file")
async def serve_master():
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")
    from hackhcc.composition import session_dir
    path = session_dir(sid) / "master.wav"
    if not path.is_file():
        raise HTTPException(404, "No master yet — call POST /api/master first")
    return FileResponse(str(path), media_type="audio/wav", filename="master.wav")


# --- Lyrics vocal mix  (primary: ACE-Step / fallback: ElevenLabs TTS) ---

ACE_STEP_VERSION = "280fc4f9ee507577f880a167f639c02622421d8fecf492454320311217b688f1"


def _do_mix_lyrics_ace_step(sid: str, lyrics: str, final_path: Path, out: Path) -> None:
    """
    Generate a full song with real vocals using ACE-Step (lucataco/ace-step).

    ACE-Step is text-to-music: it takes tags (style/mood/instruments) + lyrics
    and generates a cohesive song with actual singing.  It does NOT condition on
    existing audio, so the output is a fresh generation — but the mood, BPM, and
    instrument palette from the user's composition are encoded in the tags so the
    style is consistent.
    """
    import replicate
    import numpy as np
    from scipy.io import wavfile
    from hackhcc.composition import load_composition, session_dir
    from hackhcc.phases.setup.render import _audio_from_url_or_path, OUTPUT_SR

    comp        = load_composition(sid)
    mood        = comp.mood or "upbeat"
    bpm         = comp.bpm or 120
    instruments = [t.instrument for t in comp.tracks]

    # ACE-Step tags: comma-separated descriptors (no full sentences)
    tags = ", ".join(filter(None, [
        mood,
        "vocal",
        "singer",
        "singing",
        "lead vocals",
        "lyrics",
        *instruments,
        f"{bpm} bpm",
        "orchestral",
        "studio quality",
        "warm",
        "cohesive",
    ]))

    # Wrap plain text in structural tags so the model knows verse/chorus layout
    fmt_lyrics = lyrics.strip()
    if fmt_lyrics and not fmt_lyrics.startswith("["):
        lines = fmt_lyrics.splitlines()
        mid   = max(1, len(lines) // 2)
        fmt_lyrics = (
            "[verse]\n" + "\n".join(lines[:mid])
            + "\n\n[chorus]\n" + "\n".join(lines[mid:])
        )

    ace_ref = f"lucataco/ace-step:{ACE_STEP_VERSION}"
    print(f"  [lyrics-ace] Generating song with vocals — tags: {tags[:60]}…")
    print(f"  [lyrics-ace] Lyrics preview: {fmt_lyrics[:80]}…")

    output = replicate.run(
        ace_ref,
        input={
            "tags":                 tags,
            "lyrics":               fmt_lyrics,
            "duration":             30,
            "guidance_scale":       7.0,
            "lyric_guidance_scale": 7.0,   # 5–10 needed for actual vocal presence
            "number_of_steps":      100,
            "seed":                 -1,
        },
    )

    # Replicate may return a FileOutput object or a plain URL string
    item = output[0] if isinstance(output, list) else output
    url  = item.url if hasattr(item, "url") else str(item)

    # Download to a temp file, then load with librosa (handles WAV + MP3)
    import urllib.request, librosa
    from scipy.signal import butter, sosfiltfilt
    tmp = session_dir(sid) / "_ace_step_tmp.bin"
    try:
        urllib.request.urlretrieve(url, str(tmp))
        audio, sr = librosa.load(str(tmp), sr=44_100, mono=True)

        # Warmth pass: gentle high-shelf rolloff above 10 kHz reduces harshness,
        # then blend 65% filtered + 35% original to keep transient clarity
        sos    = butter(2, 10_000, fs=44_100, btype="low", output="sos")
        warm   = sosfiltfilt(sos, audio)
        audio  = warm * 0.65 + audio * 0.35

        # Normalize to -1 dBFS so it's loud but never clips
        peak  = np.max(np.abs(audio)) or 1.0
        audio = audio / peak * 0.891   # 0.891 ≈ -1 dBFS

        wavfile.write(str(out), 44_100, (audio * 32767).astype(np.int16))
        print(f"  [lyrics-ace] Done → {out.name}")
    finally:
        if tmp.is_file():
            tmp.unlink()


def _do_mix_lyrics_tts(sid: str, lyrics: str, final_path: Path, out: Path) -> None:
    """Fallback: ElevenLabs TTS speech overlaid on final.wav."""
    import shutil, tempfile, os as _os
    import numpy as np
    from hackhcc.composition import session_dir

    token = (os.getenv("ELEVENLABS_API_KEY") or "").strip()
    if not token:
        print("  [lyrics] No ElevenLabs key — copying final.wav as-is")
        shutil.copy(str(final_path), str(out))
        return

    try:
        import librosa
        from elevenlabs.client import ElevenLabs

        client = ElevenLabs(api_key=token)
        print("  [lyrics] ElevenLabs TTS fallback…")
        mp3_bytes = b"".join(
            client.text_to_speech.convert(
                voice_id="21m00Tcm4TlvDq8ikWAM",
                text=lyrics.strip(),
                model_id="eleven_multilingual_v2",
            )
        )
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tf:
            tf.write(mp3_bytes)
            tmp_mp3 = tf.name
        try:
            vocals, sr_v = librosa.load(tmp_mp3, sr=None, mono=True)
        finally:
            _os.unlink(tmp_mp3)

        music, sr_m = librosa.load(str(final_path), sr=None, mono=True)
        if sr_v != sr_m:
            vocals = librosa.resample(vocals, orig_sr=sr_v, target_sr=sr_m)
        max_len  = max(len(music), len(vocals))
        mixed    = (
            np.pad(music,  (0, max_len - len(music)))  * 0.55
            + np.pad(vocals, (0, max_len - len(vocals))) * 0.80
        )
        peak = float(np.max(np.abs(mixed)))
        if peak > 0:
            mixed = mixed / peak * 0.9
        try:
            import soundfile as sf
            sf.write(str(out), mixed, sr_m)
        except ImportError:
            from scipy.io import wavfile
            wavfile.write(str(out), sr_m, mixed.astype("float32"))
        print("  [lyrics] TTS vocals mixed → final_with_lyrics.wav")
    except Exception as exc:
        print(f"  [lyrics] TTS failed ({exc}) — copying final.wav")
        shutil.copy(str(final_path), str(out))


def _do_mix_lyrics(sid: str, lyrics: str) -> Path:
    import shutil
    from hackhcc.composition import session_dir

    final_path = session_dir(sid) / "final.wav"
    if not final_path.is_file():
        raise RuntimeError("No final.wav — run finalize first")

    out = session_dir(sid) / "final_with_lyrics.wav"

    if not lyrics.strip():
        shutil.copy(str(final_path), str(out))
        return out

    # Primary: ACE-Step (Replicate) — generates cohesive song from music + lyrics
    replicate_token = (os.getenv("REPLICATE_API_TOKEN") or "").strip()
    if replicate_token:
        try:
            import replicate as _r  # confirm importable before spawning thread work
            _do_mix_lyrics_ace_step(sid, lyrics, final_path, out)
            return out
        except Exception as exc:
            print(f"  [lyrics] ACE-Step failed ({exc}) — falling back to ElevenLabs TTS")

    # Fallback: ElevenLabs TTS speech overlaid on final.wav
    _do_mix_lyrics_tts(sid, lyrics, final_path, out)
    return out


# --- AI Finalize  (master.wav → MusicGen melody conditioning → final.wav) ----

def _do_finalize_master(sid: str) -> Path:
    import shutil
    from hackhcc.composition import session_dir, load_composition

    master_path = session_dir(sid) / "master.wav"
    if not master_path.is_file():
        raise RuntimeError("No master.wav — run /api/master first")

    comp  = load_composition(sid)
    mood  = comp.mood or "upbeat"
    out   = session_dir(sid) / "final.wav"

    token = (os.getenv("REPLICATE_API_TOKEN") or "").strip()
    if not token:
        print("  [finalize] No REPLICATE_API_TOKEN — copying master as final")
        shutil.copy(str(master_path), str(out))
        return out

    try:
        import replicate
        from hackhcc.phases.setup.render import _get_musicgen_ref

        prompt = (
            f"{mood} orchestral arrangement, full band, professional studio quality, "
            f"cohesive polished song, radio ready, rich harmonics, no vocals"
        )
        ref = _get_musicgen_ref()
        print(f"  [finalize] MusicGen conditioning on master.wav ({mood}, 30s)...")
        with master_path.open("rb") as f:
            output = replicate.run(
                ref,
                input={
                    "prompt": prompt,
                    "melody": f,
                    "model_version": "stereo-melody-large",
                    "duration": 30,
                    "normalization_strategy": "loudness",
                },
            )
        url = str(output) if not isinstance(output, list) else str(output[0])
        tmp = session_dir(sid) / "_final_tmp.wav"
        urllib.request.urlretrieve(url, str(tmp))
        tmp.rename(out)
        print(f"  [finalize] Done → final.wav")
    except Exception as exc:
        print(f"  [finalize] MusicGen failed ({exc}) — falling back to master.wav")
        shutil.copy(str(master_path), str(out))

    return out


@app.post("/api/finalize")
async def finalize_composition():
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")
    ctx: _Ctx = app.state.ctx
    if ctx.finalize_busy:
        raise HTTPException(409, "Finalize already running")
    ctx.finalize_busy  = True
    ctx.finalize_done  = False
    ctx.finalize_error = None
    def _fin():
        try:
            _do_finalize_master(sid)
            ctx.finalize_done = True
        except Exception as exc:
            ctx.finalize_error = str(exc)
        finally:
            ctx.finalize_busy = False
    threading.Thread(target=_fin, daemon=True).start()
    return {"status": "finalizing"}


@app.get("/api/finalize/status")
async def finalize_status():
    ctx: _Ctx = app.state.ctx
    return {"busy": ctx.finalize_busy, "done": ctx.finalize_done, "error": ctx.finalize_error}


@app.get("/api/finalize/file")
async def serve_final():
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")
    from hackhcc.composition import session_dir
    path = session_dir(sid) / "final.wav"
    if not path.is_file():
        raise HTTPException(404, "No final.wav yet — call POST /api/finalize first")
    return FileResponse(str(path), media_type="audio/wav", filename="composition_final.wav")


# --- Lyrics vocal mix ---

class _LyricsMixBody(BaseModel):
    lyrics: str


@app.post("/api/lyrics/mix")
async def mix_lyrics(body: _LyricsMixBody):
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")
    ctx: _Ctx = app.state.ctx
    if ctx.lyrics_busy:
        raise HTTPException(409, "Lyrics mix already running")
    ctx.lyrics_busy  = True
    ctx.lyrics_done  = False
    ctx.lyrics_error = None

    def _mix():
        try:
            _do_mix_lyrics(sid, body.lyrics)
            ctx.lyrics_done = True
        except Exception as exc:
            ctx.lyrics_error = str(exc)
        finally:
            ctx.lyrics_busy = False

    threading.Thread(target=_mix, daemon=True).start()
    return {"status": "mixing_lyrics"}


@app.get("/api/lyrics/mix/status")
async def lyrics_mix_status():
    ctx: _Ctx = app.state.ctx
    return {"busy": ctx.lyrics_busy, "done": ctx.lyrics_done, "error": ctx.lyrics_error}


@app.get("/api/lyrics/mix/file")
async def serve_lyrics_mix():
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")
    from hackhcc.composition import session_dir
    path = session_dir(sid) / "final_with_lyrics.wav"
    if not path.is_file():
        raise HTTPException(404, "No lyrics mix yet — call POST /api/lyrics/mix first")
    return FileResponse(str(path), media_type="audio/wav", filename="composition_with_lyrics.wav")


# --- ElevenLabs realtime STT  (browser PCM → Scribe v2 → transcript JSON) --------

async def _drain_stt_queue(q: asyncio.Queue, ws: WebSocket) -> None:
    try:
        while True:
            msg = await q.get()
            try:
                await ws.send_json(msg)
            except Exception:
                return
    except asyncio.CancelledError:
        pass


@app.websocket("/ws/stt")
async def stt_ws(websocket: WebSocket):
    """Bridge browser Int16 PCM → ElevenLabs Scribe v2 Realtime → transcript JSON."""
    import base64
    await websocket.accept()

    token = (os.getenv("ELEVENLABS_API_KEY") or "").strip()
    if not token:
        await websocket.send_json({"error": "no_token"})
        await websocket.close()
        return

    from elevenlabs import ElevenLabs, AudioFormat, RealtimeAudioOptions, CommitStrategy, RealtimeEvents

    client = ElevenLabs(api_key=token)
    options = RealtimeAudioOptions(
        model_id="scribe_v2_realtime",
        audio_format=AudioFormat.PCM_16000,
        sample_rate=16_000,
        commit_strategy=CommitStrategy.VAD,
        language_code="en",
    )

    q: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def _on_partial(data: dict) -> None:
        text = (data.get("text") or "").strip()
        if text:
            loop.call_soon_threadsafe(q.put_nowait, {"type": "partial", "text": text})

    def _on_committed(data: dict) -> None:
        text = (data.get("text") or "").strip()
        if text:
            loop.call_soon_threadsafe(q.put_nowait, {"type": "committed", "text": text})

    try:
        connection = await client.speech_to_text.realtime.connect(options)
    except Exception as exc:
        await websocket.send_json({"error": str(exc)})
        await websocket.close()
        return

    connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT,   _on_partial)
    connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, _on_committed)

    drain_task = asyncio.create_task(_drain_stt_queue(q, websocket))
    try:
        while True:
            try:
                pcm = await asyncio.wait_for(websocket.receive_bytes(), timeout=20.0)
                payload = base64.b64encode(pcm).decode()
                await connection.send({"audio_base_64": payload, "sample_rate": 16_000})
            except (asyncio.TimeoutError, Exception):
                break
    finally:
        drain_task.cancel()
        await connection.close()
        try:
            await websocket.close()
        except Exception:
            pass


# --- Demo shortcut  (fill missing hums from last recording + render) ----------

@app.post("/api/demo/fill-and-render")
async def demo_fill_and_render():
    """Demo shortcut: copy last valid hum to any unrecorded tracks, then render all."""
    import shutil
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")
    ctx: _Ctx = app.state.ctx
    if ctx.render_busy:
        return {"status": "already_rendering"}

    ctx.render_busy  = True
    ctx.render_done  = False
    ctx.render_error = None

    def _do():
        try:
            comp = load_composition(sid)
            h_dir = hums_dir(sid)
            h_dir.mkdir(parents=True, exist_ok=True)

            # Find the most recently recorded hum to use as template
            last_hum: Path | None = None
            for t in comp.tracks:
                p = h_dir / f"{t.id}.wav"
                if p.is_file():
                    last_hum = p

            if last_hum:
                changed = False
                for t in comp.tracks:
                    p = h_dir / f"{t.id}.wav"
                    if not p.is_file():
                        shutil.copy(str(last_hum), str(p))
                        t.hum_path = f"hums/{t.id}.wav"
                        changed = True
                if changed:
                    save_composition(comp)
                    run_pitch_detection(sid)

            run_render_stems(sid)
            try:
                comp2 = load_composition(sid)
                comp2.flags["stems_complete"] = True
                comp2.flags["setup_complete"] = True
                comp2.flags["allow_conduct"]  = True
                from hackhcc.composition import Phase
                comp2.phase = Phase.CONDUCT.value
                save_composition(comp2)
            except Exception:
                pass
            ctx.render_done = True
        except Exception as exc:
            ctx.render_error = str(exc)
        finally:
            ctx.render_busy = False

    threading.Thread(target=_do, daemon=True).start()
    return {"status": "demo_rendering"}


# --- Publish (Treble Trouble) — prefers your final.wav, then export, then stems ---

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


def _mixdown_stems_to_export(sid: str) -> Path | None:
    """Sum the rendered stems into exports/<sid>.wav."""
    import numpy as np
    from scipy.io import wavfile

    from hackhcc.composition import session_dir

    stems_path = session_dir(sid) / "stems"
    stem_files = sorted(stems_path.glob("*.wav")) if stems_path.is_dir() else []
    if not stem_files:
        return None

    sr = 44_100
    tracks: list = []
    for f in stem_files:
        sr, raw = wavfile.read(f)
        a = raw.astype(np.float32)
        if raw.dtype.kind in "iu":
            a /= float(np.iinfo(raw.dtype).max)
        if a.ndim > 1:
            a = a.mean(axis=1)
        tracks.append(a)

    length = max(len(a) for a in tracks)
    mix = np.zeros(length, dtype=np.float32)
    for a in tracks:
        mix[: len(a)] += a
    peak = float(np.max(np.abs(mix))) or 1.0
    mix = np.clip(mix / peak * 0.92, -1.0, 1.0)

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    out = EXPORTS_DIR / f"{sid}.wav"
    wavfile.write(out, sr, (mix * 32767).astype(np.int16))
    return out


def _publish_wav_path(sid: str) -> Path | None:
    """Pick the best mix to publish: final.wav > exports/<sid>.wav > stem mixdown."""
    from hackhcc.composition import session_dir

    final = session_dir(sid) / "final.wav"
    if final.is_file():
        return final
    export = EXPORTS_DIR / f"{sid}.wav"
    if export.is_file():
        return export
    return _mixdown_stems_to_export(sid)


@app.post("/api/publish")
async def publish():
    """Hand the finished song off to Treble Trouble to be named + published."""
    sid = _read_active_session()
    if not sid:
        raise HTTPException(400, "No active session")

    wav = await asyncio.to_thread(_publish_wav_path, sid)
    if not wav or not wav.is_file():
        raise HTTPException(
            400, "Nothing to publish yet — record your parts and render first"
        )

    try:
        audio_id = await asyncio.to_thread(_upload_mix_to_treble_trouble, wav, sid)
    except Exception as exc:
        raise HTTPException(
            502, f"Couldn't reach Treble Trouble at {TREBLE_TROUBLE_URL} ({exc})"
        )

    if not audio_id:
        raise HTTPException(502, "Upload succeeded but no audioId was returned")

    publish_url = f"{TREBLE_TROUBLE_URL}/publish?audioId={audio_id}&session={sid}"
    return {"publish_url": publish_url, "audio_id": audio_id}
