"""
POC stem renderer: hum + notes → playable instrument WAV (30s).

Default: local piano-style synthesis from detected notes (no extra API).
Optional: Replicate MusicGen melody if REPLICATE_API_TOKEN is set.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
from scipy.io import wavfile

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
POC_DURATION_SEC = 30.0

# POC timbre profiles (extend later per instrument)
_TIMBRE = {
    "piano": {"harmonics": (1.0, 0.45, 0.2, 0.08), "attack": 0.008, "decay": 0.15},
    "synth": {"harmonics": (1.0, 0.45, 0.2, 0.08), "attack": 0.008, "decay": 0.15},
    "trumpet": {"harmonics": (1.0, 0.6, 0.3), "attack": 0.02, "decay": 0.12},
    "bass": {"harmonics": (1.0, 0.25), "attack": 0.02, "decay": 0.2},
    "default": {"harmonics": (1.0, 0.4, 0.15), "attack": 0.01, "decay": 0.18},
}


def _midi_to_hz(midi: int) -> float:
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def _prompt_for_track(track: Track, comp: Composition) -> str:
    inst = track.instrument.lower()
    mood = comp.mood or "neutral"
    if inst in ("piano", "synth"):
        return (
            f"solo acoustic grand piano, {mood}, warm, dynamic, "
            f"studio recording, {comp.bpm} bpm, key of {comp.key}, "
            "clear melody, no vocals"
        )
    return (
        f"solo {inst}, {mood}, {comp.bpm} bpm, key of {comp.key}, "
        "studio mix, no vocals"
    )


def _extend_notes_loop(notes: list[Note], target_ms: int) -> list[Note]:
    if not notes:
        return notes
    span = max(n.start_ms + n.duration_ms for n in notes)
    if span <= 0:
        return notes
    if span >= target_ms:
        return notes

    out: list[Note] = []
    offset = 0
    gap_ms = 400
    while offset < target_ms:
        for n in notes:
            start = n.start_ms + offset
            if start >= target_ms:
                break
            dur = min(n.duration_ms, target_ms - start)
            out.append(
                Note(
                    start_ms=start,
                    duration_ms=dur,
                    midi=n.midi,
                    confidence=n.confidence,
                )
            )
        offset += span + gap_ms
    return out


def _adsr_envelope(n_samples: int, sr: int, *, attack: float, decay: float) -> np.ndarray:
    attack_n = max(1, int(attack * sr))
    decay_n = max(1, int(decay * sr))
    sustain_level = 0.55
    release_n = max(1, n_samples - attack_n - decay_n)
    env = np.ones(n_samples, dtype=np.float32)
    env[:attack_n] = np.linspace(0.0, 1.0, attack_n, dtype=np.float32)
    if attack_n + decay_n < n_samples:
        env[attack_n : attack_n + decay_n] = np.linspace(
            1.0, sustain_level, decay_n, dtype=np.float32
        )
    tail_start = attack_n + decay_n
    if tail_start < n_samples:
        env[tail_start:] = np.linspace(
            sustain_level, 0.0, n_samples - tail_start, dtype=np.float32
        )
    return env


def _synth_note(
    midi: int,
    duration_sec: float,
    *,
    instrument: str,
    sr: int = OUTPUT_SR,
) -> np.ndarray:
    profile = _TIMBRE.get(instrument.lower(), _TIMBRE["default"])
    n = max(1, int(duration_sec * sr))
    t = np.arange(n, dtype=np.float64) / sr
    freq = _midi_to_hz(midi)
    wave = np.zeros(n, dtype=np.float64)
    for i, amp in enumerate(profile["harmonics"], start=1):
        wave += amp * np.sin(2.0 * np.pi * freq * i * t)
    env = _adsr_envelope(n, sr, attack=profile["attack"], decay=profile["decay"])
    out = (wave * env).astype(np.float32)
    peak = np.max(np.abs(out)) or 1.0
    return (out / peak) * 0.35


def render_notes_to_audio(
    notes: list[Note],
    *,
    instrument: str,
    duration_sec: float = POC_DURATION_SEC,
    sr: int = OUTPUT_SR,
) -> np.ndarray:
    """Build a timeline from detected notes (POC piano / instrument)."""
    target_ms = int(duration_sec * 1000)
    notes = _extend_notes_loop(notes, target_ms)
    total = int(duration_sec * sr)
    mix = np.zeros(total, dtype=np.float32)

    for note in notes:
        start = int(note.start_ms / 1000.0 * sr)
        dur = max(0.05, note.duration_ms / 1000.0)
        chunk = _synth_note(note.midi, dur, instrument=instrument, sr=sr)
        end = min(total, start + len(chunk))
        if start >= total:
            continue
        mix[start:end] += chunk[: end - start]

    peak = np.max(np.abs(mix)) or 1.0
    mix = (mix / peak) * 0.85
    # Fade edges
    fade = min(int(0.5 * sr), total // 10)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        mix[:fade] *= ramp
        mix[-fade:] *= ramp[::-1]
    return mix


def _save_stem_wav(session_id: str, track_id: str, audio: np.ndarray) -> str:
    folder = stems_dir(session_id)
    folder.mkdir(parents=True, exist_ok=True)
    rel = f"stems/{track_id}.wav"
    path = folder / f"{track_id}.wav"
    clipped = np.clip(audio, -1.0, 1.0)
    wavfile.write(path, OUTPUT_SR, (clipped * 32767).astype(np.int16))
    return rel


def _render_via_musicgen(
    hum_path: Path,
    prompt: str,
    *,
    duration_sec: int = 30,
) -> np.ndarray | None:
    token = (os.getenv("REPLICATE_API_TOKEN") or "").strip()
    if not token:
        return None
    try:
        import replicate
    except ImportError:
        print("  [render] install replicate for cloud stems: pip install replicate")
        return None

    print(f"  [render] MusicGen (~{duration_sec}s, may take a minute)...")
    duration = min(30, max(8, duration_sec))
    with hum_path.open("rb") as f:
        output = replicate.run(
            "meta/musicgen:stereo-melody-large",
            input={
                "prompt": prompt,
                "input_audio": f,
                "duration": duration,
                "continuation": False,
                "model_version": "stereo-melody-large",
            },
        )
    # output is URI or file path depending on version
    out_path = str(output) if not isinstance(output, list) else str(output[0])
    if out_path.startswith("http"):
        import urllib.request

        tmp = hum_path.parent / f"_mg_{hum_path.stem}.wav"
        urllib.request.urlretrieve(out_path, tmp)
        out_path = str(tmp)
    sr, data = wavfile.read(out_path)
    if data.dtype == np.int16:
        audio = data.astype(np.float32) / 32768.0
    else:
        audio = data.astype(np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != OUTPUT_SR:
        from scipy.signal import resample

        n = int(len(audio) * OUTPUT_SR / sr)
        audio = resample(audio, n).astype(np.float32)
    return audio


def render_track_stem(
    session_id: str,
    track: Track,
    comp: Composition,
    *,
    use_musicgen: bool = False,
) -> str:
    """Render one stem; returns relative stem_path."""
    if not track.notes:
        raise ValueError(f"Track {track.id} has no notes — run pitch detection first.")

    inst = track.instrument.lower()
    if inst == "synth":
        inst = "piano"  # POC: synth melody → piano timbre

    prompt = _prompt_for_track(track, comp)
    audio: np.ndarray | None = None

    if use_musicgen and track.hum_path:
        hum_file = resolve_session_path(session_id, track.hum_path)
        if hum_file.is_file():
            audio = _render_via_musicgen(hum_file, prompt)

    if audio is None:
        if inst in ("piano", "synth"):
            audio, engine = render_piano_from_notes(
                track.notes,
                duration_sec=POC_DURATION_SEC,
                bpm=comp.bpm,
            )
            print(f"  [render] Piano engine: {engine} ({len(track.notes)} notes)")
        else:
            print(f"  [render] Local {inst} from {len(track.notes)} notes")
            audio = render_notes_to_audio(
                track.notes,
                instrument=inst,
                duration_sec=POC_DURATION_SEC,
            )

    return _save_stem_wav(session_id, track.id, audio)


def run_render_stems(
    session_id: str,
    *,
    use_musicgen: bool = False,
) -> Composition:
    """
    final_generator POC: write stems/{track_id}.wav for each track.
    """
    comp = load_composition(session_id)
    if not comp.tracks:
        raise RuntimeError("No tracks to render.")

    print(f"\n--- Stem render (POC, {int(POC_DURATION_SEC)}s per track) ---")
    for track in comp.tracks:
        print(f"  Track {track.id} ({track.instrument})...")
        track.stem_path = render_track_stem(
            session_id, track, comp, use_musicgen=use_musicgen
        )
        print(f"    → {track.stem_path}")

    save_composition(comp)
    return load_composition(session_id)
