"""Stem renderer: hum → instrument audio via Replicate MusicGen (melody-conditioned).

Flow per track:
  1. Call Replicate meta/musicgen with the hum WAV as melody + instrument text prompt.
  2. MusicGen extrapolates 30s of music that matches the hummed melody.
  3. Falls back to local piano synthesis when REPLICATE_API_TOKEN is missing.

Instrument prompts are tuned per instrument; drums use text-only generation
(no melody conditioning, since a hummed melody doesn't map well to percussion).
"""

from __future__ import annotations

import os
import urllib.request
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample

from hackhcc.audio.piano_render import render_piano_from_notes
from hackhcc.composition import (
    Composition,
    Note,
    Track,
    load_composition,
    resolve_session_path,
    save_composition,
    stems_dir,
)

OUTPUT_SR = 44_100
GEN_DURATION_SEC = 30

_INSTRUMENT_PROMPTS: dict[str, str] = {
    "piano":   "solo acoustic grand piano, {mood}, warm, melodic, studio recording, clear melody, no vocals",
    "trumpet": "solo jazz trumpet, {mood}, bright, expressive melody, studio quality, no vocals",
    "violin":  "solo violin, {mood}, expressive, lyrical melody, studio quality, no vocals",
    "flute":   "solo flute, {mood}, airy, delicate melody, studio quality, no vocals",
    "drums":   "{mood} drum kit, rhythmic percussion, live drum beat, studio quality",
}
_DEFAULT_PROMPT = "solo {instrument}, {mood}, melodic, studio quality, no vocals"


def _build_prompt(track: Track, comp: Composition) -> str:
    inst = track.instrument.lower()
    mood = comp.mood or "upbeat"
    template = _INSTRUMENT_PROMPTS.get(inst, _DEFAULT_PROMPT)
    return template.format(mood=mood, instrument=inst)


def _save_stem_wav(session_id: str, track_id: str, audio: np.ndarray) -> str:
    folder = stems_dir(session_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{track_id}.wav"
    clipped = np.clip(audio, -1.0, 1.0)
    wavfile.write(path, OUTPUT_SR, (clipped * 32767).astype(np.int16))
    return f"stems/{track_id}.wav"


def _audio_from_url_or_path(raw: str, tmp_path: Path) -> np.ndarray:
    if raw.startswith("http"):
        urllib.request.urlretrieve(raw, str(tmp_path))
        raw = str(tmp_path)
    sr, data = wavfile.read(raw)
    if data.dtype == np.int16:
        audio = data.astype(np.float32) / 32768.0
    else:
        audio = data.astype(np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != OUTPUT_SR:
        n = int(len(audio) * OUTPUT_SR / sr)
        audio = resample(audio, n).astype(np.float32)
    return audio


def _render_via_musicgen(
    hum_path: Path,
    prompt: str,
    instrument: str,
    *,
    duration: int = GEN_DURATION_SEC,
) -> np.ndarray | None:
    token = (os.getenv("REPLICATE_API_TOKEN") or "").strip()
    if not token:
        return None
    try:
        import replicate
    except ImportError:
        print("  [render] pip install replicate  to enable MusicGen")
        return None

    is_drums = "drum" in instrument.lower()
    tmp = hum_path.parent / f"_mg_{hum_path.stem}.wav"

    try:
        print(f"  [render] MusicGen ({instrument}, ~{duration}s)...")
        if is_drums:
            # Drums: text-only, no melody conditioning
            output = replicate.run(
                "meta/musicgen",
                input={
                    "prompt": prompt,
                    "model_version": "stereo-large",
                    "duration": duration,
                    "normalization_strategy": "loudness",
                },
            )
        else:
            with hum_path.open("rb") as f:
                output = replicate.run(
                    "meta/musicgen",
                    input={
                        "prompt": prompt,
                        "melody": f,
                        "model_version": "stereo-melody-large",
                        "duration": duration,
                        "normalization_strategy": "loudness",
                    },
                )
    except Exception as exc:
        print(f"  [render] MusicGen API error: {exc}")
        return None

    out_url = str(output) if not isinstance(output, list) else str(output[0])
    try:
        return _audio_from_url_or_path(out_url, tmp)
    except Exception as exc:
        print(f"  [render] Failed to load MusicGen output: {exc}")
        return None


def _render_local_fallback(track: Track, comp: Composition) -> np.ndarray:
    inst = track.instrument.lower()
    if inst in ("piano", "synth"):
        audio, engine = render_piano_from_notes(
            track.notes,
            duration_sec=float(GEN_DURATION_SEC),
            bpm=comp.bpm,
        )
        print(f"  [render] Local piano ({engine}, {len(track.notes)} notes)")
    else:
        from hackhcc.phases.setup.render_local import render_notes_to_audio
        audio = render_notes_to_audio(
            track.notes, instrument=inst, duration_sec=float(GEN_DURATION_SEC)
        )
        print(f"  [render] Local {inst} ({len(track.notes)} notes)")
    return audio


def render_track_stem(
    session_id: str,
    track: Track,
    comp: Composition,
) -> str:
    """Render one stem. MusicGen is primary; local synthesis is fallback."""
    hum_audio: np.ndarray | None = None

    if track.hum_path:
        hum_file = resolve_session_path(session_id, track.hum_path)
        if hum_file.is_file():
            prompt = _build_prompt(track, comp)
            hum_audio = _render_via_musicgen(
                hum_file, prompt, track.instrument
            )

    if hum_audio is None:
        if not track.notes:
            raise ValueError(
                f"Track '{track.id}' has no hum and no notes — cannot render."
            )
        hum_audio = _render_local_fallback(track, comp)

    return _save_stem_wav(session_id, track.id, hum_audio)


def run_render_stems(
    session_id: str,
    *,
    use_musicgen: bool = True,  # kept for backward compat, always True now
) -> Composition:
    comp = load_composition(session_id)
    if not comp.tracks:
        raise RuntimeError("No tracks to render.")

    print(f"\n--- Stem render ({GEN_DURATION_SEC}s per track via MusicGen) ---")
    for track in comp.tracks:
        print(f"  Track {track.id} ({track.instrument})...")
        track.stem_path = render_track_stem(session_id, track, comp)
        print(f"    → {track.stem_path}")

    save_composition(comp)
    return load_composition(session_id)
