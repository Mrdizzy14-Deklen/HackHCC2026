"""Offline stem mixer: BPM-normalise N stems, sum with volume weights → single WAV.

BPM normalisation
-----------------
Each stem is time-stretched to the session's target BPM before mixing.
This is the primary fix for the "off-beat" problem — MusicGen calls are
independent so each stem may land on a slightly different tempo.

Optionally applies global pitch shift and tempo stretch for the final export.
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


def _detect_bpm(audio: np.ndarray) -> float:
    """Estimate BPM of an audio array. Returns 0.0 on failure."""
    try:
        import librosa
        tempo, _ = librosa.beat.beat_track(y=audio, sr=TARGET_SR)
        # librosa >= 0.10 returns ndarray
        bpm = float(np.asarray(tempo).flat[0])
        return bpm if 40 < bpm < 240 else 0.0
    except Exception:
        return 0.0


def _tile_to_length(audio: np.ndarray, target_len: int, crossfade: int = 2048) -> np.ndarray:
    """Loop a short stem to `target_len` samples with equal-power crossfades.

    Used to build the full-length song from the short (~5 s) instrument stems.
    Linear fades on each seam sum to unity in the overlap, avoiding loop clicks.
    """
    if len(audio) == 0:
        return np.zeros(target_len, dtype=np.float32)
    if len(audio) >= target_len:
        return audio[:target_len].astype(np.float32, copy=True)

    xf = int(min(crossfade, len(audio) // 4))
    step = len(audio) - xf if xf else len(audio)
    win_in  = np.linspace(0.0, 1.0, xf, dtype=np.float32) if xf else None
    win_out = win_in[::-1] if xf else None

    out = np.zeros(target_len, dtype=np.float32)
    pos, first = 0, True
    while pos < target_len:
        seg = audio.astype(np.float32, copy=True)
        if xf:
            if not first:
                seg[:xf] *= win_in     # fades up against previous tail
            seg[-xf:] *= win_out       # fades down into next head
        end = min(pos + len(seg), target_len)
        out[pos:end] += seg[: end - pos]
        first = False
        pos += step
    return out


def _bpm_stretch(audio: np.ndarray, src_bpm: float, tgt_bpm: float) -> np.ndarray:
    """Time-stretch audio from src_bpm to tgt_bpm. No-op if BPMs are close."""
    if src_bpm <= 0 or tgt_bpm <= 0 or abs(src_bpm - tgt_bpm) < 2.0:
        return audio
    rate = tgt_bpm / src_bpm
    # Cap stretch to ±40 % to avoid artefacts on wildly wrong detections
    rate = max(0.6, min(1.4, rate))
    try:
        import librosa
        return librosa.effects.time_stretch(audio, rate=rate).astype(np.float32)
    except Exception:
        return audio


def mix_stems(
    stem_paths: list[tuple[str, str]],
    volumes: dict[str, float],
    output_path: str,
    *,
    pitch_shift_semitones: float = 0.0,
    tempo_multiplier: float = 1.0,
    target_bpm: int | None = None,
    target_duration_sec: float | None = None,
) -> str:
    """
    Mix stems into one WAV, then apply pitch shift and tempo stretch.

    stem_paths          : [(track_id, abs_wav_path), ...]
    volumes             : {track_id: 0.0–1.0}
    output_path         : where to write the final WAV
    target_bpm          : if set, each stem is time-stretched to this BPM first
    target_duration_sec : if set, each stem is looped/trimmed to this length so a
                          short (~5 s) stem fills the full song before summing
    """
    arrays: list[np.ndarray] = []
    target_len = int(target_duration_sec * TARGET_SR) if target_duration_sec else 0
    max_len = target_len

    for tid, path in stem_paths:
        if not Path(path).is_file():
            print(f"  [mixer] skip {tid}: {path} not found")
            continue
        audio = _load_mono(path)
        vol = max(0.0, min(1.0, volumes.get(tid, 1.0)))

        # BPM normalisation — align each stem to the session tempo
        if target_bpm and target_bpm > 0:
            src_bpm = _detect_bpm(audio)
            if src_bpm > 0:
                audio = _bpm_stretch(audio, src_bpm, float(target_bpm))
                print(f"  [mixer] {tid}: {src_bpm:.0f} bpm -> {target_bpm} bpm (rate {target_bpm/src_bpm:.2f}x)")
            else:
                print(f"  [mixer] {tid}: BPM detect failed, skipping normalisation")

        # Loop the short stem up to the full song length
        if target_len:
            audio = _tile_to_length(audio, target_len)

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
