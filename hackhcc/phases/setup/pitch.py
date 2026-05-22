"""Pitch agent — hum WAV → tracks[].notes.

Primary: Basic Pitch (Spotify) — polyphonic, ONNX-based, much more accurate.
Fallback: librosa YIN — if basic-pitch not installed.
"""

from __future__ import annotations

import numpy as np

from hackhcc.composition import (
    Composition,
    Note,
    load_composition,
    resolve_session_path,
    save_composition,
)

_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _estimate_key(midis: list[int]) -> str:
    if not midis:
        return "C"
    counts = [0] * 12
    for m in midis:
        counts[m % 12] += 1
    return _NOTE_NAMES[counts.index(max(counts))]


def _bpm_from_notes(notes: list[Note]) -> int:
    if len(notes) < 2:
        return 120
    gaps = [notes[i + 1].start_ms - notes[i].start_ms for i in range(len(notes) - 1)]
    gaps = [g for g in gaps if 200 < g < 2000]
    if not gaps:
        return 120
    return int(max(60, min(180, 60_000 / float(np.median(gaps)))))


def _detect_basic_pitch(wav_path: str) -> list[Note]:
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH

    _, midi_data, _ = predict(wav_path, ICASSP_2022_MODEL_PATH)
    notes: list[Note] = []
    if not midi_data.instruments:
        return notes
    for n in midi_data.instruments[0].notes:
        dur_ms = max(50, int((n.end - n.start) * 1000))
        notes.append(
            Note(
                start_ms=int(n.start * 1000),
                duration_ms=dur_ms,
                midi=n.pitch,
                confidence=n.velocity / 127.0,
            )
        )
    notes.sort(key=lambda n: n.start_ms)
    return notes


def _detect_librosa_yin(wav_path: str) -> list[Note]:
    import librosa
    from scipy.io import wavfile

    sr, data = wavfile.read(wav_path)
    if data.dtype == np.int16:
        audio = data.astype(np.float32) / 32768.0
    else:
        audio = data.astype(np.float32)
    if audio.ndim > 1:
        audio = audio[:, 0]

    frame_length, hop_length = 2048, 512
    frames: list[tuple[float, float]] = []
    n = len(audio)
    i = 0
    while i + frame_length < n:
        frame = audio[i : i + frame_length] * np.hanning(frame_length)
        f0 = librosa.yin(frame, fmin=80.0, fmax=500.0, sr=sr)
        hz = float(np.nanmedian(f0)) if len(f0) else 0.0
        if hz > 80.0:
            frames.append((i / sr, hz))
        i += hop_length

    notes: list[Note] = []
    if not frames:
        return notes

    def _hz_to_midi(hz: float) -> int:
        return int(round(69 + 12 * np.log2(hz / 440.0)))

    seg_start, seg_hz, last_t = frames[0][0], frames[0][1], frames[0][0]

    def flush(end_t: float) -> None:
        dur_ms = int((end_t - seg_start) * 1000)
        if dur_ms >= 120:
            notes.append(
                Note(
                    start_ms=int(seg_start * 1000),
                    duration_ms=dur_ms,
                    midi=_hz_to_midi(seg_hz),
                    confidence=0.75,
                )
            )

    for t, hz in frames[1:]:
        if abs(_hz_to_midi(hz) - _hz_to_midi(seg_hz)) <= 1 and (t - last_t) * 1000 < 150:
            last_t = t
            seg_hz = (seg_hz + hz) / 2
        else:
            flush(last_t)
            seg_start, seg_hz, last_t = t, hz, t
    flush(last_t)
    return notes


def detect_notes_from_wav(wav_path: str) -> tuple[list[Note], int]:
    """Return (notes, bpm). Tries Basic Pitch first, falls back to librosa YIN."""
    notes: list[Note] = []
    engine = "?"
    try:
        notes = _detect_basic_pitch(wav_path)
        engine = "basic-pitch"
    except ImportError:
        notes = _detect_librosa_yin(wav_path)
        engine = "librosa-yin"
    except Exception as exc:
        print(f"  [pitch] basic-pitch failed ({exc}), falling back to librosa")
        notes = _detect_librosa_yin(wav_path)
        engine = "librosa-yin(fallback)"

    if not notes:
        notes = [Note(start_ms=0, duration_ms=500, midi=60, confidence=0.5)]

    bpm = _bpm_from_notes(notes)
    print(f"    engine={engine}  notes={len(notes)}  bpm≈{bpm}")
    return notes, bpm


def run_pitch_detection(
    session_id: str,
    *,
    track_ids: list[str] | None = None,
) -> Composition:
    """Pitch agent: reads hums/*, writes tracks[].notes, updates bpm/key."""
    comp = load_composition(session_id)
    if not comp.tracks:
        raise RuntimeError("No tracks — run intent first.")

    ids = set(track_ids or [t.id for t in comp.tracks])
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

    if bpm_candidates:
        comp.bpm = int(np.median(bpm_candidates))
    if all_midis:
        comp.key = _estimate_key(all_midis)

    save_composition(comp)
    return load_composition(session_id)
