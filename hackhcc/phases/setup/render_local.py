"""Local fallback synthesis for non-piano instruments (additive synth + ADSR).

Used only when Replicate token is absent or MusicGen call fails.
"""

from __future__ import annotations

import numpy as np

from hackhcc.composition import Note

OUTPUT_SR = 44_100
POC_DURATION_SEC = 30.0

_TIMBRE: dict[str, dict] = {
    "trumpet": {"harmonics": (1.0, 0.6, 0.3, 0.1), "attack": 0.025, "decay": 0.12},
    "violin":  {"harmonics": (1.0, 0.5, 0.25, 0.1, 0.05), "attack": 0.04, "decay": 0.2},
    "flute":   {"harmonics": (1.0, 0.15, 0.05), "attack": 0.03, "decay": 0.18},
    "drums":   {"harmonics": (1.0,), "attack": 0.002, "decay": 0.05},
    "default": {"harmonics": (1.0, 0.4, 0.15), "attack": 0.01, "decay": 0.18},
}


def _midi_to_hz(midi: int) -> float:
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def _adsr(n: int, sr: int, *, attack: float, decay: float) -> np.ndarray:
    a = max(1, int(attack * sr))
    d = max(1, int(decay * sr))
    sustain = 0.55
    env = np.ones(n, dtype=np.float32)
    env[:a] = np.linspace(0.0, 1.0, a)
    if a + d < n:
        env[a : a + d] = np.linspace(1.0, sustain, d)
    tail = a + d
    if tail < n:
        env[tail:] = np.linspace(sustain, 0.0, n - tail)
    return env


def _synth_note(midi: int, dur: float, *, instrument: str, sr: int = OUTPUT_SR) -> np.ndarray:
    p = _TIMBRE.get(instrument.lower(), _TIMBRE["default"])
    n = max(1, int(dur * sr))
    t = np.arange(n, dtype=np.float64) / sr
    freq = _midi_to_hz(midi)
    wave = sum(amp * np.sin(2.0 * np.pi * freq * (i + 1) * t) for i, amp in enumerate(p["harmonics"]))
    env = _adsr(n, sr, attack=p["attack"], decay=p["decay"])
    out = (wave * env).astype(np.float32)
    peak = np.max(np.abs(out)) or 1.0
    return out / peak * 0.35


def _extend_loop(notes: list[Note], target_ms: int) -> list[Note]:
    if not notes:
        return notes
    span = max(n.start_ms + n.duration_ms for n in notes)
    if span <= 0 or span >= target_ms:
        return notes
    out: list[Note] = []
    offset, gap = 0, 400
    while offset < target_ms:
        for n in notes:
            s = n.start_ms + offset
            if s >= target_ms:
                break
            d = min(n.duration_ms, target_ms - s)
            out.append(Note(start_ms=s, duration_ms=d, midi=n.midi, confidence=n.confidence))
        offset += span + gap
    return out


def render_notes_to_audio(
    notes: list[Note],
    *,
    instrument: str,
    duration_sec: float = POC_DURATION_SEC,
    sr: int = OUTPUT_SR,
) -> np.ndarray:
    target_ms = int(duration_sec * 1000)
    notes = _extend_loop(notes, target_ms)
    total = int(duration_sec * sr)
    mix = np.zeros(total, dtype=np.float32)

    for note in notes:
        start = int(note.start_ms / 1000.0 * sr)
        dur = max(0.05, note.duration_ms / 1000.0)
        chunk = _synth_note(note.midi, dur, instrument=instrument, sr=sr)
        end = min(total, start + len(chunk))
        if start < total:
            mix[start:end] += chunk[: end - start]

    peak = np.max(np.abs(mix)) or 1.0
    mix = mix / peak * 0.85
    fade = min(int(0.5 * sr), total // 10)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        mix[:fade] *= ramp
        mix[-fade:] *= ramp[::-1]
    return mix
