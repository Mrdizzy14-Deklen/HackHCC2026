"""Local audio mastering chain — used as fallback when Replicate is unavailable.

Chain: high-pass(80 Hz) → compress → low-shelf warmth → soft-limit → normalize
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt


def _sos_highpass(cutoff_hz: float, sr: float, order: int = 4):
    return butter(order, cutoff_hz / (sr / 2.0), btype="high", output="sos")


def _sos_lowpass(cutoff_hz: float, sr: float, order: int = 2):
    return butter(order, cutoff_hz / (sr / 2.0), btype="low", output="sos")


def _compress(audio: np.ndarray, threshold: float = 0.40, ratio: float = 3.0) -> np.ndarray:
    """Sample-wise dynamic compression above threshold."""
    abs_a = np.abs(audio)
    gain = np.where(
        abs_a > threshold,
        (threshold + (abs_a - threshold) / ratio) / (abs_a + 1e-9),
        1.0,
    )
    return (audio * gain).astype(np.float32)


def _soft_limit(audio: np.ndarray, threshold: float = 0.88) -> np.ndarray:
    """Smooth soft-knee limiter via tanh."""
    return (np.tanh(audio / threshold) * threshold).astype(np.float32)


def _add_warmth(audio: np.ndarray, sr: float, shelf_hz: float = 200.0, gain: float = 0.12) -> np.ndarray:
    """Boost low-mids slightly for warmth (mix in low-passed copy)."""
    sos = _sos_lowpass(shelf_hz, sr)
    low = sosfilt(sos, audio).astype(np.float32)
    return (audio + low * gain).astype(np.float32)


def master_audio(audio: np.ndarray, sr: int = 44_100) -> np.ndarray:
    """Apply mastering chain and return improved float32 audio in [-1, 1]."""
    # 1. Remove subsonic rumble
    sos_hp = _sos_highpass(80.0, sr)
    audio = sosfilt(sos_hp, audio).astype(np.float32)

    # 2. Dynamic compression
    audio = _compress(audio, threshold=0.42, ratio=3.0)

    # 3. Low-shelf warmth
    audio = _add_warmth(audio, sr, shelf_hz=200.0, gain=0.10)

    # 4. Soft limit
    audio = _soft_limit(audio, threshold=0.88)

    # 5. Loudness normalise to ~-1 dBFS peak
    peak = float(np.max(np.abs(audio))) or 1.0
    audio = np.clip(audio / peak * 0.92, -1.0, 1.0)

    return audio.astype(np.float32)
