"""Offline stem mixer: sum N stems with volume weights → single WAV.

Optionally applies pitch shift and tempo stretch (via librosa) for the
final export step.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample

TARGET_SR = 44_100


def _load_mono(path: str) -> np.ndarray:
    sr, data = wavfile.read(path)
    if data.dtype == np.int16:
        audio = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        audio = data.astype(np.float32) / 2_147_483_648.0
    else:
        audio = data.astype(np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != TARGET_SR and len(audio) > 0:
        n = max(1, int(len(audio) * TARGET_SR / sr))
        audio = resample(audio, n).astype(np.float32)
    return audio


def mix_stems(
    stem_paths: list[tuple[str, str]],
    volumes: dict[str, float],
    output_path: str,
    *,
    pitch_shift_semitones: float = 0.0,
    tempo_multiplier: float = 1.0,
) -> str:
    """
    Mix stems into one WAV, then apply pitch shift and tempo stretch.

    stem_paths : [(track_id, abs_wav_path), ...]
    volumes    : {track_id: 0.0–1.0}
    output_path: where to write the final WAV
    """
    arrays: list[np.ndarray] = []
    max_len = 0

    for tid, path in stem_paths:
        if not Path(path).is_file():
            print(f"  [mixer] skip {tid}: {path} not found")
            continue
        audio = _load_mono(path)
        vol = max(0.0, min(1.0, volumes.get(tid, 1.0)))
        arrays.append(audio * vol)
        max_len = max(max_len, len(audio))

    if not arrays:
        raise RuntimeError("No valid stems to mix.")

    # Sum and normalise by track count
    mix = np.zeros(max_len, dtype=np.float32)
    for arr in arrays:
        padded = np.zeros(max_len, dtype=np.float32)
        padded[: len(arr)] = arr
        mix += padded
    mix /= max(1, len(arrays))

    # Tempo stretch (must come before pitch shift — librosa works on full array)
    if abs(tempo_multiplier - 1.0) > 0.02:
        try:
            import librosa
            mix = librosa.effects.time_stretch(mix, rate=tempo_multiplier)
        except Exception as exc:
            print(f"  [mixer] tempo stretch skipped: {exc}")

    # Pitch shift
    if abs(pitch_shift_semitones) > 0.1:
        try:
            import librosa
            mix = librosa.effects.pitch_shift(
                mix, sr=TARGET_SR, n_steps=pitch_shift_semitones
            )
        except Exception as exc:
            print(f"  [mixer] pitch shift skipped: {exc}")

    # Final normalise + write
    peak = float(np.max(np.abs(mix))) or 1.0
    mix = np.clip(mix / peak * 0.9, -1.0, 1.0)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(output_path, TARGET_SR, (mix * 32767).astype(np.int16))
    print(f"  [mixer] wrote {output_path}  ({len(mix)/TARGET_SR:.1f}s)")
    return output_path
