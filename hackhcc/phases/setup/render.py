"""Stem renderer: hum → instrument audio via Replicate MusicGen.

Coherence strategy
------------------
All melodic instruments (piano, trumpet, violin, flute) are conditioned on the
SAME melody hum — the piano hum is used as a shared reference so every stem
follows the same key and melodic contour. This prevents each instrument from
going off in its own random direction.

Drums are generated text-only (no melody conditioning) with an explicit BPM
reference so they land on the same tempo.

Flow per track:
  1. Pick the shared melody hum (piano > first melodic hum).
  2. Call Replicate meta/musicgen with that hum + instrument-specific prompt.
  3. Falls back to local synthesis when REPLICATE_API_TOKEN is missing.
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
# Each instrument is "converted" from its ~5 s hum into a short instrument stem.
# Rendering at hum length (instead of 30 s) makes MusicGen ~6x faster/cheaper per
# track; the full-length song is built later by tiling these stems in the mixer.
HUM_DURATION_SEC = 5
GEN_DURATION_SEC = HUM_DURATION_SEC   # stem render length (matches the hum)
MIX_DURATION_SEC = 30                 # final song length, built by looping stems

_MELODIC_INSTRUMENTS = {"piano", "trumpet", "violin", "flute"}

# Prompts reference "full band" so MusicGen generates each part
# as if it exists alongside the others — improves harmonic coherence.
_INSTRUMENT_PROMPTS: dict[str, str] = {
    "piano":   "acoustic grand piano, {mood}, full band arrangement, plays melody, warm tone, no vocals, studio quality",
    "trumpet": "jazz trumpet, {mood}, full band arrangement, plays lead melody, bright tone, no vocals, studio quality",
    "violin":  "violin, {mood}, full band arrangement, plays melody, expressive, no vocals, studio quality",
    "flute":   "flute, {mood}, full band arrangement, plays melody, airy tone, no vocals, studio quality",
    "drums":   "{mood} drum kit, {bpm} bpm, rhythmic, full band, live feel, studio quality",
}
_DEFAULT_PROMPT = "{instrument}, {mood}, full band arrangement, melodic, studio quality, no vocals"


def _build_prompt(track: Track, comp: Composition) -> str:
    inst = track.instrument.lower()
    mood = comp.mood or "upbeat"
    bpm  = comp.bpm or 120
    template = _INSTRUMENT_PROMPTS.get(inst, _DEFAULT_PROMPT)
    return template.format(mood=mood, instrument=inst, bpm=bpm)


def _find_primary_melody_hum(comp: Composition, session_id: str) -> Path | None:
    """Return piano hum path (or first melodic hum) to use as shared melody reference."""
    preferred_order = ["piano", "violin", "trumpet", "flute"]
    all_melodic = {t.instrument.lower(): t for t in comp.tracks if t.instrument.lower() in _MELODIC_INSTRUMENTS}
    for inst in preferred_order:
        track = all_melodic.get(inst)
        if track and track.hum_path:
            p = resolve_session_path(session_id, track.hum_path)
            if p.is_file():
                return p
    # fallback to any track with a hum
    for t in comp.tracks:
        if t.hum_path:
            p = resolve_session_path(session_id, t.hum_path)
            if p.is_file():
                return p
    return None


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
    elif data.dtype == np.int32:
        audio = data.astype(np.float32) / 2_147_483_648.0
    else:
        audio = data.astype(np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != OUTPUT_SR:
        n = int(len(audio) * OUTPUT_SR / sr)
        audio = resample(audio, n).astype(np.float32)
    return audio


_MUSICGEN_VERSION: str | None = None  # cached after first lookup


def _get_musicgen_ref() -> str:
    global _MUSICGEN_VERSION
    if _MUSICGEN_VERSION:
        return f"meta/musicgen:{_MUSICGEN_VERSION}"
    try:
        import replicate
        _MUSICGEN_VERSION = replicate.models.get("meta/musicgen").latest_version.id
        print(f"  [render] MusicGen version: {_MUSICGEN_VERSION[:16]}...")
        return f"meta/musicgen:{_MUSICGEN_VERSION}"
    except Exception as exc:
        print(f"  [render] Could not resolve MusicGen version: {exc}")
        return "meta/musicgen"


def _render_via_musicgen(
    melody_hum: Path,
    prompt: str,
    instrument: str,
    *,
    duration: int = GEN_DURATION_SEC,
) -> np.ndarray | None:
    import time

    token = (os.getenv("REPLICATE_API_TOKEN") or "").strip()
    if not token:
        return None
    try:
        import replicate
    except ImportError:
        print("  [render] pip install replicate  to enable MusicGen")
        return None

    is_drums = "drum" in instrument.lower()
    tmp = melody_hum.parent / f"_mg_{instrument}.wav"
    ref = _get_musicgen_ref()

    for attempt in range(3):
        try:
            print(f"  [render] MusicGen ({instrument}, ~{duration}s)...")
            if is_drums:
                output = replicate.run(
                    ref,
                    input={
                        "prompt": prompt,
                        "model_version": "stereo-large",
                        "duration": duration,
                        "normalization_strategy": "loudness",
                    },
                )
            else:
                with melody_hum.open("rb") as f:
                    output = replicate.run(
                        ref,
                        input={
                            "prompt": prompt,
                            "melody": f,
                            "model_version": "stereo-melody-large",
                            "duration": duration,
                            "normalization_strategy": "loudness",
                        },
                    )
            break  # success
        except Exception as exc:
            msg = str(exc)
            if "429" in msg or "throttled" in msg or "rate" in msg.lower():
                wait = 12 * (attempt + 1)
                print(f"  [render] Rate limited — waiting {wait}s before retry {attempt+1}/3...")
                time.sleep(wait)
                continue
            print(f"  [render] MusicGen API error: {exc}")
            return None
    else:
        print(f"  [render] MusicGen failed after 3 attempts — using local fallback")
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
    *,
    shared_melody_hum: Path | None = None,
) -> str:
    """Render one stem.

    Melodic instruments use `shared_melody_hum` (the piano hum) so all stems
    follow the same key and melodic contour. Drums use text-only generation.
    Falls back to local synthesis when no Replicate token.
    """
    audio: np.ndarray | None = None
    melody_hum = shared_melody_hum or (
        resolve_session_path(session_id, track.hum_path) if track.hum_path else None
    )

    if melody_hum and melody_hum.is_file():
        prompt = _build_prompt(track, comp)
        audio = _render_via_musicgen(melody_hum, prompt, track.instrument)

    if audio is None:
        if not track.notes:
            raise ValueError(f"Track '{track.id}' has no hum and no notes — cannot render.")
        audio = _render_local_fallback(track, comp)

    return _save_stem_wav(session_id, track.id, audio)


def run_render_stems(
    session_id: str,
    *,
    use_musicgen: bool = True,  # kept for backward compat
) -> Composition:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    comp = load_composition(session_id)
    if not comp.tracks:
        raise RuntimeError("No tracks to render.")

    # Determine shared melody hum ONCE — all melodic stems use the same reference
    shared_hum = _find_primary_melody_hum(comp, session_id)
    if shared_hum:
        print(f"\n  Shared melody reference: {shared_hum.name}")
        print(f"  All melodic instruments will follow this melody for coherence.")
    else:
        print("\n  Warning: no melody hum found — each instrument uses its own hum")

    # Pre-warm MusicGen version cache so all threads reuse the same ref
    _get_musicgen_ref()

    n = len(comp.tracks)
    print(f"\n--- Stem render ({GEN_DURATION_SEC}s per track, {n} tracks in parallel via MusicGen) ---")

    def _render_one(track: Track) -> tuple[str, str]:
        inst = track.instrument.lower()
        is_melodic = inst in _MELODIC_INSTRUMENTS
        hum_to_use = shared_hum if is_melodic else None
        label = "shared melody" if is_melodic and shared_hum else "text-only"
        print(f"  [{track.id}] {inst} ({label}) starting…")
        stem_path = render_track_stem(session_id, track, comp, shared_melody_hum=hum_to_use)
        print(f"  [{track.id}] {inst} -> {stem_path}")
        return track.id, stem_path

    stem_results: dict[str, str] = {}
    errors: list[str] = []

    with ThreadPoolExecutor(max_workers=n) as executor:
        futures = {executor.submit(_render_one, t): t for t in comp.tracks}
        for future in as_completed(futures):
            track = futures[future]
            try:
                tid, path = future.result()
                stem_results[tid] = path
            except Exception as exc:
                errors.append(f"{track.id}: {exc}")
                print(f"  [{track.id}] render failed: {exc}")

    if errors:
        raise RuntimeError("Some stems failed to render:\n" + "\n".join(errors))

    for track in comp.tracks:
        if track.id in stem_results:
            track.stem_path = stem_results[track.id]

    save_composition(comp)
    return load_composition(session_id)
