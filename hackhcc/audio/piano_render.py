"""
Higher-quality piano stems: SoundFont (FluidSynth) when available,
else Karplus-Strong plucked synthesis + light reverb.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve, resample

from hackhcc.composition import Note

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SF2_PATH = PROJECT_ROOT / "assets" / "soundfonts" / "TimGM6mb.sf2"
SF2_URL = (
    "https://raw.githubusercontent.com/deepin-community/"
    "timgm6mb-soundfont/master/TimGM6mb.sf2"
)
OUTPUT_SR = 44_100


def _extend_notes_loop(notes: list[Note], target_ms: int) -> list[Note]:
    if not notes:
        return notes
    span = max(n.start_ms + n.duration_ms for n in notes)
    if span <= 0 or span >= target_ms:
        return notes
    out: list[Note] = []
    offset = 0
    gap_ms = 500
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


def _notes_to_midi_path(notes: list[Note], midi_path: Path, *, bpm: int = 120) -> None:
    import pretty_midi

    pm = pretty_midi.PrettyMIDI(initial_tempo=float(bpm))
    piano = pretty_midi.Instrument(program=0, name="Acoustic Grand Piano")
    for n in notes:
        vel = int(55 + 40 * min(1.0, max(0.0, n.confidence)))
        start = n.start_ms / 1000.0
        end = start + max(0.08, n.duration_ms / 1000.0)
        piano.notes.append(
            pretty_midi.Note(velocity=vel, pitch=n.midi, start=start, end=end)
        )
    pm.instruments.append(piano)
    pm.write(str(midi_path))


def ensure_soundfont() -> Path | None:
    if SF2_PATH.is_file() and SF2_PATH.stat().st_size > 100_000:
        return SF2_PATH
    SF2_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"  [piano] Downloading SoundFont (~6 MB) to {SF2_PATH.name}...")
    try:
        urllib.request.urlretrieve(SF2_URL, SF2_PATH)
        return SF2_PATH if SF2_PATH.is_file() else None
    except Exception as e:
        print(f"  [piano] SoundFont download failed: {e}")
        return None


def _render_midi_fluidsynth_cli(midi_path: Path, wav_path: Path, sf2: Path) -> bool:
    if not shutil.which("fluidsynth"):
        return False
    cmd = [
        "fluidsynth",
        "-ni",
        str(sf2),
        str(midi_path),
        "-F",
        str(wav_path),
        "-r",
        str(OUTPUT_SR),
        "-g",
        "0.9",
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=120)
        return wav_path.is_file()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return False


def _render_midi_midi2audio(midi_path: Path, wav_path: Path, sf2: Path) -> bool:
    try:
        from midi2audio import FluidSynth
    except ImportError:
        return False
    try:
        fs = FluidSynth(str(sf2), sample_rate=OUTPUT_SR)
        fs.midi_to_audio(str(midi_path), str(wav_path))
        return wav_path.is_file()
    except Exception:
        return False


def _load_wav_float(path: Path) -> np.ndarray:
    sr, data = wavfile.read(path)
    if data.dtype == np.int16:
        audio = data.astype(np.float32) / 32768.0
    else:
        audio = data.astype(np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != OUTPUT_SR:
        n = int(len(audio) * OUTPUT_SR / sr)
        audio = resample(audio, n).astype(np.float32)
    return audio


def _fit_duration(audio: np.ndarray, duration_sec: float, sr: int = OUTPUT_SR) -> np.ndarray:
    target = int(duration_sec * sr)
    if len(audio) == 0:
        return np.zeros(target, dtype=np.float32)
    if len(audio) >= target:
        out = audio[:target].copy()
    else:
        reps = int(np.ceil(target / len(audio)))
        out = np.tile(audio, reps)[:target]
    fade = min(int(0.4 * sr), len(out) // 8)
    if fade > 0:
        r = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        out[:fade] *= r
        out[-fade:] *= r[::-1]
    peak = np.max(np.abs(out)) or 1.0
    return (out / peak * 0.92).astype(np.float32)


def _karplus_strong(
    freq: float,
    duration_sec: float,
    *,
    sr: int = OUTPUT_SR,
    damping: float = 0.996,
) -> np.ndarray:
    n_out = max(1, int(duration_sec * sr))
    N = max(2, int(sr / max(freq, 50.0)))
    buffer = (np.random.randn(N).astype(np.float64) * 0.5)
    out = np.zeros(n_out, dtype=np.float64)
    for i in range(n_out):
        out[i] = buffer[0]
        avg = 0.5 * (buffer[0] + buffer[1])
        buffer[:-1] = buffer[1:]
        buffer[-1] = damping * avg
    attack = min(int(0.004 * sr), n_out // 4)
    if attack > 0:
        out[:attack] *= np.linspace(0, 1, attack)
    release = min(int(0.08 * sr), n_out // 3)
    if release > 0:
        out[-release:] *= np.linspace(1, 0, release)
    return out.astype(np.float32)


def _simple_reverb(audio: np.ndarray, sr: int = OUTPUT_SR) -> np.ndarray:
    """Short room reverb for depth."""
    ir_len = int(0.12 * sr)
    t = np.arange(ir_len, dtype=np.float64) / sr
    ir = np.exp(-t * 18.0) * np.sin(2.0 * np.pi * 180.0 * t)
    ir /= np.max(np.abs(ir)) or 1.0
    wet = fftconvolve(audio, ir.astype(np.float32), mode="full")[: len(audio)]
    return (0.78 * audio + 0.35 * wet).astype(np.float32)


def render_piano_fallback(
    notes: list[Note],
    *,
    duration_sec: float = 30.0,
    bpm: int = 120,
) -> np.ndarray:
    """Plucked-string piano-ish fallback (no FluidSynth)."""
    target_ms = int(duration_sec * 1000)
    notes = _extend_notes_loop(notes, target_ms)
    total = int(duration_sec * OUTPUT_SR)
    mix = np.zeros(total, dtype=np.float32)

    for n in notes:
        start = int(n.start_ms / 1000.0 * OUTPUT_SR)
        dur = max(0.1, n.duration_ms / 1000.0)
        freq = 440.0 * (2.0 ** ((n.midi - 69) / 12.0))
        chunk = _karplus_strong(freq, dur)
        end = min(total, start + len(chunk))
        if start >= total:
            continue
        mix[start:end] += chunk[: end - start]

    mix = _simple_reverb(mix)
    return _fit_duration(mix, duration_sec)


def render_piano_from_notes(
    notes: list[Note],
    *,
    duration_sec: float = 30.0,
    bpm: int = 120,
    prefer_fluidsynth: bool = True,
) -> tuple[np.ndarray, str]:
    """
    Render piano audio. Returns (waveform, engine_label).
    """
    if not notes:
        return np.zeros(int(duration_sec * OUTPUT_SR), dtype=np.float32), "silent"

    target_ms = int(duration_sec * 1000)
    looped = _extend_notes_loop(notes, target_ms)

    if prefer_fluidsynth:
        sf2 = ensure_soundfont()
        if sf2 and (shutil.which("fluidsynth") or _midi2audio_available()):
            with tempfile.TemporaryDirectory() as tmp:
                midi = Path(tmp) / "score.mid"
                wav = Path(tmp) / "render.wav"
                _notes_to_midi_path(looped, midi, bpm=bpm)
                ok = False
                if shutil.which("fluidsynth"):
                    print("  [piano] Rendering with FluidSynth + SoundFont")
                    ok = _render_midi_fluidsynth_cli(midi, wav, sf2)
                if not ok:
                    ok = _render_midi_midi2audio(midi, wav, sf2)
                if ok:
                    audio = _fit_duration(_load_wav_float(wav), duration_sec)
                    return audio, "fluidsynth"

    print("  [piano] FluidSynth unavailable — using enhanced pluck synth")
    print("          Install for real piano: sudo dnf install fluidsynth")
    audio = render_piano_fallback(looped, duration_sec=duration_sec, bpm=bpm)
    return audio, "pluck+reverb"


def _midi2audio_available() -> bool:
    try:
        import midi2audio  # noqa: F401

        return True
    except ImportError:
        return False
