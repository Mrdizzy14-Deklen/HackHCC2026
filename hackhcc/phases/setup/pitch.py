"""Pitch agent — monophonic pitch from hum WAV → tracks[].notes."""

from __future__ import annotations

import numpy as np
from scipy.io import wavfile

from hackhcc.composition import Note, load_composition, resolve_session_path, save_composition

# MIDI note names for key estimation
_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _hz_to_midi(hz: float) -> int:
    if hz <= 0:
        return 0
    return int(round(69 + 12 * np.log2(hz / 440.0)))


def _midi_to_name(midi: int) -> str:
    return _NOTE_NAMES[midi % 12]


def _estimate_key_from_midis(midis: list[int]) -> str:
    if not midis:
        return "C"
    counts = [0] * 12
    for m in midis:
        counts[m % 12] += 1
    root = counts.index(max(counts))
    return _NOTE_NAMES[root]


def _detect_pitch_frames(
    audio: np.ndarray,
    sr: int,
    *,
    frame_length: int = 2048,
    hop_length: int = 512,
    fmin: float = 80.0,
    fmax: float = 500.0,
) -> list[tuple[float, float]]:
    """Autocorrelation pitch per frame → (time_sec, hz)."""
    import librosa

    frames: list[tuple[float, float]] = []
    n = len(audio)
    i = 0
    while i + frame_length < n:
        frame = audio[i : i + frame_length]
        frame = frame * np.hanning(len(frame))
        f0 = librosa.yin(
            frame,
            fmin=fmin,
            fmax=fmax,
            sr=sr,
        )
        hz = float(np.nanmedian(f0)) if len(f0) else 0.0
        t = i / sr
        if hz > fmin:
            frames.append((t, hz))
        i += hop_length
    return frames


def _frames_to_notes(
    frames: list[tuple[float, float]],
    *,
    min_duration_ms: int = 120,
    gap_ms: int = 150,
) -> list[Note]:
    """Merge contiguous similar pitch frames into Note events."""
    if not frames:
        return []

    notes: list[Note] = []
    seg_start = frames[0][0]
    seg_hz = frames[0][1]
    last_t = seg_start

    def flush(end_t: float) -> None:
        dur_ms = int((end_t - seg_start) * 1000)
        if dur_ms >= min_duration_ms:
            midi = _hz_to_midi(seg_hz)
            notes.append(
                Note(
                    start_ms=int(seg_start * 1000),
                    duration_ms=dur_ms,
                    midi=midi,
                    confidence=0.85,
                )
            )

    for t, hz in frames[1:]:
        midi = _hz_to_midi(hz)
        seg_midi = _hz_to_midi(seg_hz)
        gap = (t - last_t) * 1000
        if abs(midi - seg_midi) <= 1 and gap < gap_ms:
            last_t = t
            seg_hz = (seg_hz + hz) / 2
        else:
            flush(last_t)
            seg_start = t
            seg_hz = hz
            last_t = t
    flush(last_t)
    return notes


def detect_notes_from_wav(wav_path: str) -> tuple[list[Note], int]:
    """Load WAV and return notes + estimated bpm."""
    sr, data = wavfile.read(wav_path)
    if data.dtype != np.float32:
        if data.dtype == np.int16:
            audio = data.astype(np.float32) / 32768.0
        else:
            audio = data.astype(np.float32)
    else:
        audio = data
    if audio.ndim > 1:
        audio = audio[:, 0]

    frames = _detect_pitch_frames(audio, sr)
    notes = _frames_to_notes(frames)
    if not notes and frames:
        t, hz = frames[len(frames) // 2]
        notes = [
            Note(
                start_ms=int(t * 1000),
                duration_ms=500,
                midi=_hz_to_midi(hz),
                confidence=0.7,
            )
        ]

    # Rough BPM from note onsets
    bpm = 120
    if len(notes) >= 2:
        gaps = [
            notes[i + 1].start_ms - notes[i].start_ms
            for i in range(len(notes) - 1)
        ]
        gaps = [g for g in gaps if 200 < g < 2000]
        if gaps:
            median_ms = float(np.median(gaps))
            bpm = int(max(60, min(180, 60000 / median_ms)))

    return notes, bpm


def run_pitch_detection(
    session_id: str,
    *,
    track_ids: list[str] | None = None,
) -> Composition:
    """
    Pitch agent: reads hums/*, writes tracks[].notes, may update bpm/key.
    """
    comp = load_composition(session_id)
    if not comp.tracks:
        raise RuntimeError("No tracks — run intent first.")

    ids = track_ids or [t.id for t in comp.tracks]
    all_midis: list[int] = []
    bpm_candidates: list[int] = []

    print("\n--- Setup: pitch detection ---")
    for track in comp.tracks:
        if track.id not in ids:
            continue
        if not track.hum_path:
            print(f"  Skip {track.id}: no hum_path")
            continue
        wav = resolve_session_path(session_id, track.hum_path)
        if not wav.is_file():
            print(f"  Skip {track.id}: file missing {wav}")
            continue

        print(f"  Analyzing {track.id} ({wav.name})...")
        notes, bpm = detect_notes_from_wav(str(wav))
        track.notes = notes
        all_midis.extend(n.midi for n in notes)
        bpm_candidates.append(bpm)
        print(f"    → {len(notes)} notes, bpm≈{bpm}")

    if bpm_candidates:
        comp.bpm = int(np.median(bpm_candidates))
    if all_midis:
        comp.key = _estimate_key_from_midis(all_midis)

    save_composition(comp)
    return load_composition(session_id)

