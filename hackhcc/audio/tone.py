"""Simple real-time tone driven by conduct parameters (fallback when no hums)."""

from __future__ import annotations

import threading

import numpy as np
import sounddevice as sd

SAMPLE_RATE = 44_100
BASE_FREQ = 261.63  # C4


class ConductToneEngine:
    """Plays a continuous tone; pitch/tempo follow conduct params."""

    def __init__(self, base_freq: float = BASE_FREQ) -> None:
        self._base_freq = base_freq
        self._pitch_semitones = 0.0
        self._tempo = 1.0
        self._phase = 0.0
        self._lock = threading.Lock()
        self._stream: sd.OutputStream | None = None
        self._running = False

    def update(self, pitch_shift_semitones: float, tempo_multiplier: float) -> None:
        with self._lock:
            self._pitch_semitones = pitch_shift_semitones
            self._tempo = max(0.5, min(2.0, tempo_multiplier))

    def _callback(self, outdata, frames, _time, _status) -> None:
        with self._lock:
            freq = self._base_freq * (2.0 ** (self._pitch_semitones / 12.0))
            tempo = self._tempo
            phase = self._phase

        t = (np.arange(frames, dtype=np.float64) + phase) / SAMPLE_RATE
        wave = 0.25 * np.sin(2.0 * np.pi * freq * tempo * t)
        outdata[:, 0] = wave.astype(np.float32)

        with self._lock:
            self._phase = phase + frames

    def start(self) -> None:
        if self._running:
            return
        self._stream = sd.OutputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=1024,
            callback=self._callback,
        )
        self._stream.start()
        self._running = True

    def stop(self) -> None:
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        self._running = False
