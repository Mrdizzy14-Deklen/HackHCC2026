"""Conduct audio: hum playback (preferred) or fallback tone."""

from __future__ import annotations

from typing import Protocol

from hackhcc.composition import Composition

from hackhcc.audio.playback import ConductHumPlayback, ConductStemPlayback
from hackhcc.audio.tone import ConductToneEngine

__all__ = ["ConductAudioEngine", "create_conduct_audio"]


class ConductAudioDriver(Protocol):
    def update(self, pitch_shift_semitones: float, tempo_multiplier: float) -> None: ...
    def start(self) -> None: ...
    def stop(self) -> None: ...


class ConductAudioEngine:
    """Wraps hum playback or sine tone with the same update/start/stop API."""

    def __init__(self, inner: ConductAudioDriver, *, mode: str, detail: str = "") -> None:
        self._inner = inner
        self.mode = mode
        self.detail = detail

    def update(self, pitch_shift_semitones: float, tempo_multiplier: float) -> None:
        self._inner.update(pitch_shift_semitones, tempo_multiplier)

    def start(self) -> None:
        self._inner.start()

    def stop(self) -> None:
        self._inner.stop()


def create_conduct_audio(comp: Composition) -> ConductAudioEngine:
    """
    Build audio for conduct: rendered stems → raw hums → test tone.
    """
    stems = ConductStemPlayback.from_composition(comp)
    if stems is not None:
        ids = ", ".join(stems.track_ids)
        return ConductAudioEngine(
            stems,
            mode="stems",
            detail=f"instrument mix ({ids})",
        )
    hum = ConductHumPlayback.from_composition(comp)
    if hum is not None:
        ids = ", ".join(hum.track_ids)
        return ConductAudioEngine(
            hum,
            mode="hums",
            detail=f"raw hum loop ({ids})",
        )
    tone = ConductToneEngine()
    return ConductAudioEngine(tone, mode="tone", detail="sine preview (no audio)")
