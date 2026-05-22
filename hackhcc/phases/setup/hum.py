"""Hum capture agent — records WAV per track into sessions/<id>/hums/."""

from __future__ import annotations

import time

import numpy as np
import sounddevice as sd
from scipy.io import wavfile

from hackhcc.composition import (
    Composition,
    hums_dir,
    load_composition,
    save_composition,
)
from hackhcc.stt.prompts import voice_input

SAMPLE_RATE = 22_050
DEFAULT_SECONDS = 5.0


def record_hum(seconds: float = DEFAULT_SECONDS) -> np.ndarray:
    """Record mono float32 audio from default input device."""
    print(f"  Recording {seconds:.0f}s — hum now...")
    audio = sd.rec(
        int(seconds * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="float32",
    )
    sd.wait()
    return audio[:, 0]


def save_hum_wav(session_id: str, track_id: str, audio: np.ndarray) -> str:
    """Write WAV; return relative hum_path for composition."""
    folder = hums_dir(session_id)
    folder.mkdir(parents=True, exist_ok=True)
    rel = f"hums/{track_id}.wav"
    path = folder / f"{track_id}.wav"
    clipped = np.clip(audio, -1.0, 1.0)
    wavfile.write(path, SAMPLE_RATE, (clipped * 32767).astype(np.int16))
    return rel


def capture_track_hum(
    session_id: str,
    track_id: str,
    *,
    seconds: float = DEFAULT_SECONDS,
) -> str:
    comp = load_composition(session_id)
    track = next((t for t in comp.tracks if t.id == track_id), None)
    if not track:
        raise ValueError(f"Unknown track id: {track_id}")

    print(f"\nTrack: {track.name} ({track.instrument})")
    voice_input(
        "  Hum this part when recording starts.",
        done_phrases=("ready", "start", "go"),
        allow_empty=True,
    )
    audio = record_hum(seconds)
    rel = save_hum_wav(session_id, track_id, audio)
    track.hum_path = rel
    save_composition(comp)
    print(f"  Saved {rel}")
    return rel


def run_hum_capture(
    session_id: str,
    *,
    seconds: float = DEFAULT_SECONDS,
    track_ids: list[str] | None = None,
) -> Composition:
    """
    Hum capture agent: writes hums/*.wav and tracks[].hum_path only.
    """
    comp = load_composition(session_id)
    if not comp.tracks:
        raise RuntimeError("No tracks — run intent setup first.")

    ids = track_ids or [t.id for t in comp.tracks]
    print("\n--- Setup: hum capture ---")
    for tid in ids:
        capture_track_hum(session_id, tid, seconds=seconds)

    return load_composition(session_id)
