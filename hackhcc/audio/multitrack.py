"""Multi-track audio engine: plays N stems simultaneously with per-track volume.

Used in Stage 1 of the conduct phase so the user can hear all instruments
at once and adjust per-track volume via hand gestures.
"""

from __future__ import annotations

import threading
from pathlib import Path

import numpy as np
import sounddevice as sd
from scipy.io import wavfile
from scipy.signal import resample

TARGET_SR = 44_100
BLOCK = 2048


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
    # Soft fade to reduce loop clicks
    fade = min(800, len(audio) // 10)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        audio[:fade] *= ramp
        audio[-fade:] *= ramp[::-1]
    return audio


class MultiTrackAudioEngine:
    """Loop N stems simultaneously; adjust per-track volume in real time."""

    def __init__(self, tracks: list[tuple[str, str]]) -> None:
        # tracks: [(track_id, wav_path), ...]
        self._ids: list[str] = []
        self._bufs: dict[str, np.ndarray] = {}
        self._pos: dict[str, int] = {}
        self._vol: dict[str, float] = {}
        self._lock = threading.Lock()
        self._stream: sd.OutputStream | None = None

        for tid, path in tracks:
            if not Path(path).is_file():
                print(f"  [multitrack] skip {tid}: {path} not found")
                continue
            buf = _load_mono(path)
            if len(buf) < 100:
                continue
            self._ids.append(tid)
            self._bufs[tid] = buf
            self._pos[tid] = 0
            self._vol[tid] = 1.0

    @property
    def track_ids(self) -> list[str]:
        return list(self._ids)

    def set_volume(self, track_id: str, volume: float) -> None:
        with self._lock:
            if track_id in self._vol:
                self._vol[track_id] = max(0.0, min(1.0, volume))

    def get_volume(self, track_id: str) -> float:
        return self._vol.get(track_id, 1.0)

    def get_volumes(self) -> dict[str, float]:
        with self._lock:
            return dict(self._vol)

    def _callback(
        self,
        outdata: np.ndarray,
        frames: int,
        _time,
        _status,
    ) -> None:
        mix = np.zeros(frames, dtype=np.float32)
        n_active = 0
        with self._lock:
            vols = dict(self._vol)
            pos = dict(self._pos)

        for tid in self._ids:
            v = vols.get(tid, 0.0)
            if v <= 0.0:
                continue
            buf = self._bufs[tid]
            blen = len(buf)
            p = pos[tid]
            chunk = np.empty(frames, dtype=np.float32)
            written = 0
            while written < frames:
                need = frames - written
                avail = blen - p
                take = min(need, avail)
                chunk[written : written + take] = buf[p : p + take]
                p = (p + take) % blen
                written += take
            pos[tid] = p
            mix += chunk * v
            n_active += 1

        if n_active > 0:
            mix /= n_active

        with self._lock:
            self._pos.update(pos)

        outdata[:, 0] = np.clip(mix, -1.0, 1.0)

    def start(self) -> None:
        if not self._ids:
            return
        self._stream = sd.OutputStream(
            samplerate=TARGET_SR,
            blocksize=BLOCK,
            channels=1,
            dtype="float32",
            callback=self._callback,
        )
        self._stream.start()

    def stop(self) -> None:
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None
