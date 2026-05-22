"""Play recorded hums during conduct (soft mix, pitch/tempo from hands)."""

from __future__ import annotations

import threading
from pathlib import Path

import numpy as np
import sounddevice as sd
from scipy.io import wavfile
from scipy.signal import resample

from hackhcc.composition import Composition, resolve_session_path

OUTPUT_SAMPLE_RATE = 44_100
# Soft combined level (per track scales down further when many tracks)
MIX_GAIN = 0.42


def _load_mono_wav(path: Path, target_sr: int = OUTPUT_SAMPLE_RATE) -> np.ndarray:
    sr, data = wavfile.read(path)
    if data.dtype == np.int16:
        audio = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        audio = data.astype(np.float32) / 2147483648.0
    else:
        audio = data.astype(np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != target_sr and len(audio) > 0:
        n = max(1, int(len(audio) * target_sr / sr))
        audio = resample(audio, n).astype(np.float32)
    return audio


class ConductStemPlayback:
    """
    Looping mix of rendered stems (preferred for conduct POC).
    Same pitch/tempo control as hum playback.
    """

    def __init__(self, buffers: list[np.ndarray], *, track_ids: list[str], source: str) -> None:
        if not buffers:
            raise ValueError("No stem audio to play")
        self._buffers = buffers
        self._track_ids = track_ids
        self._source = source
        self._positions = [0.0] * len(buffers)
        self._pitch_semitones = 0.0
        self._tempo = 1.0
        self._lock = threading.Lock()
        self._stream: sd.OutputStream | None = None
        self._running = False
        n = len(buffers)
        self._track_gain = MIX_GAIN / n

    @classmethod
    def from_composition(cls, comp: Composition) -> ConductStemPlayback | None:
        buffers: list[np.ndarray] = []
        ids: list[str] = []
        source = "stems"

        for track in comp.tracks:
            rel = track.stem_path or ""
            if not rel:
                continue
            path = resolve_session_path(comp.session_id, rel)
            if not path.is_file():
                continue
            audio = _load_mono_wav(path)
            if len(audio) < 100:
                continue
            fade = min(800, len(audio) // 10)
            if fade > 0:
                ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
                audio[:fade] *= ramp
                audio[-fade:] *= ramp[::-1]
            buffers.append(audio)
            ids.append(track.id)

        if not buffers:
            return None
        return cls(buffers, track_ids=ids, source=source)

    def update(self, pitch_shift_semitones: float, tempo_multiplier: float) -> None:
        with self._lock:
            self._pitch_semitones = pitch_shift_semitones
            self._tempo = max(0.5, min(2.0, tempo_multiplier))

    def _rate(self) -> float:
        return self._tempo * (2.0 ** (self._pitch_semitones / 12.0))

    def _callback(self, outdata, frames, _time, _status) -> None:
        with self._lock:
            rate = self._rate()
            gain = self._track_gain
            positions = list(self._positions)

        mix = np.zeros(frames, dtype=np.float32)
        for i, buf in enumerate(self._buffers):
            pos = positions[i]
            length = len(buf)
            idx = np.arange(frames, dtype=np.float64) * rate + pos
            indices = (idx % length).astype(np.int64)
            mix += buf[indices] * gain
            positions[i] = (pos + frames * rate) % length

        np.clip(mix, -1.0, 1.0, out=mix)
        outdata[:, 0] = mix

        with self._lock:
            self._positions = positions

    def start(self) -> None:
        if self._running:
            return
        self._stream = sd.OutputStream(
            samplerate=OUTPUT_SAMPLE_RATE,
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

    @property
    def track_ids(self) -> list[str]:
        return list(self._track_ids)

    @property
    def source(self) -> str:
        return self._source


class ConductHumPlayback:
    """
    Looping mix of session hum WAVs; conduct params change playback rate
    (pitch + tempo together, like the previous tone engine).
    """

    def __init__(self, buffers: list[np.ndarray], *, track_ids: list[str]) -> None:
        if not buffers:
            raise ValueError("No hum audio to play")
        self._buffers = buffers
        self._track_ids = track_ids
        self._positions = [0.0] * len(buffers)
        self._pitch_semitones = 0.0
        self._tempo = 1.0
        self._lock = threading.Lock()
        self._stream: sd.OutputStream | None = None
        self._running = False
        n = len(buffers)
        self._track_gain = MIX_GAIN / n

    @classmethod
    def from_composition(cls, comp: Composition) -> ConductHumPlayback | None:
        buffers: list[np.ndarray] = []
        ids: list[str] = []
        for track in comp.tracks:
            if not track.hum_path:
                continue
            path = resolve_session_path(comp.session_id, track.hum_path)
            if not path.is_file():
                continue
            audio = _load_mono_wav(path)
            if len(audio) < 100:
                continue
            # Short fade in/out to reduce loop clicks
            fade = min(400, len(audio) // 8)
            if fade > 0:
                ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
                audio[:fade] *= ramp
                audio[-fade:] *= ramp[::-1]
            buffers.append(audio)
            ids.append(track.id)
        if not buffers:
            return None
        return cls(buffers, track_ids=ids)

    def update(self, pitch_shift_semitones: float, tempo_multiplier: float) -> None:
        with self._lock:
            self._pitch_semitones = pitch_shift_semitones
            self._tempo = max(0.5, min(2.0, tempo_multiplier))

    def _rate(self) -> float:
        return self._tempo * (2.0 ** (self._pitch_semitones / 12.0))

    def _callback(self, outdata, frames, _time, _status) -> None:
        with self._lock:
            rate = self._rate()
            gain = self._track_gain
            positions = list(self._positions)

        mix = np.zeros(frames, dtype=np.float32)
        for i, buf in enumerate(self._buffers):
            pos = positions[i]
            length = len(buf)
            idx = np.arange(frames, dtype=np.float64) * rate + pos
            indices = (idx % length).astype(np.int64)
            mix += buf[indices] * gain
            positions[i] = (pos + frames * rate) % length

        np.clip(mix, -1.0, 1.0, out=mix)
        outdata[:, 0] = mix

        with self._lock:
            self._positions = positions

    def start(self) -> None:
        if self._running:
            return
        self._stream = sd.OutputStream(
            samplerate=OUTPUT_SAMPLE_RATE,
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

    @property
    def track_ids(self) -> list[str]:
        return list(self._track_ids)
