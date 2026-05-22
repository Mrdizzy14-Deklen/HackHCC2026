"""Conduct phase — two-stage performance interface.

Stage 1 — EDIT  (per-instrument gesture zones)
  • Screen divided into 5 horizontal zones (one per instrument).
  • Move your wrist into a zone to select that instrument.
  • Hand height (Y) → volume for the selected track (0–100 %).
  • Press M to mute / unmute the selected track.
  • Press SPACE to mix all stems and advance to Stage 2.

Stage 2 — CONDUCT  (global pitch + tempo)
  • All stems are mixed into one WAV with your volume settings applied.
  • Hand height     → global pitch shift (±12 semitones).
  • Hand openness   → tempo multiplier (0.75 – 1.35 ×).
  • Press E to export the final file (pitch + tempo baked in).
  • Press SPACE to go back to Stage 1 for more editing.
  • Press Q to export and quit.
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import mediapipe as mp_lib
import numpy as np
from scipy.io import wavfile
from scipy.signal import resample

from hackhcc.audio.mixer import mix_stems
from hackhcc.audio.multitrack import MultiTrackAudioEngine
from hackhcc.audio.playback import ConductStemPlayback
from hackhcc.composition import (
    Composition,
    ConductParams,
    Phase,
    load_composition,
    resolve_session_path,
    save_composition,
    session_dir,
)
from hackhcc.vision.gestures import gesture_to_conduct, gestures_from_landmarks
from hackhcc.vision.hands import create_hand_landmarker, draw_hands

WINDOW_NAME = "HackHCC — Conduct"
EXPORT_DIR = Path(__file__).resolve().parent.parent.parent / "exports"

# Fixed instrument order for the 5 zones
INSTRUMENT_ZONE_ORDER = ["piano", "trumpet", "violin", "flute", "drums"]

# BGR colours per instrument
_ZONE_COLOR: dict[str, tuple[int, int, int]] = {
    "piano":   (200, 140,  50),
    "trumpet": ( 40, 180, 255),
    "violin":  ( 40, 200,  90),
    "flute":   (210,  70, 220),
    "drums":   ( 60,  80, 255),
}
_DEFAULT_COLOR: tuple[int, int, int] = (140, 140, 140)

ZONE_STRIP_H = 130   # pixels reserved at the bottom for the instrument strip
TARGET_SR = 44_100


# ─── helpers ──────────────────────────────────────────────────────────────────

def _zone_color(tid: str) -> tuple[int, int, int]:
    return _ZONE_COLOR.get(tid.lower(), _DEFAULT_COLOR)


def _get_stem_list(comp: Composition) -> list[tuple[str, str]]:
    """Return [(track_id, abs_wav_path)] for every track with a valid stem."""
    out: list[tuple[str, str]] = []
    for t in comp.tracks:
        if t.stem_path:
            p = resolve_session_path(comp.session_id, t.stem_path)
            if p.is_file():
                out.append((t.id, str(p)))
    return out


def _ordered_track_ids(comp: Composition, stem_list: list[tuple[str, str]]) -> list[str]:
    """Return track IDs in INSTRUMENT_ZONE_ORDER where possible."""
    present = {tid for tid, _ in stem_list}
    ordered = [i for i in INSTRUMENT_ZONE_ORDER if i in present]
    # append any tracks not in the fixed list
    for tid in present:
        if tid not in ordered:
            ordered.append(tid)
    return ordered


def _load_mix_wav(path: str) -> np.ndarray:
    sr, data = wavfile.read(path)
    if data.dtype == np.int16:
        audio = data.astype(np.float32) / 32768.0
    else:
        audio = data.astype(np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != TARGET_SR:
        n = max(1, int(len(audio) * TARGET_SR / sr))
        audio = resample(audio, n).astype(np.float32)
    return audio


# ─── drawing helpers ───────────────────────────────────────────────────────────

def _draw_zone_strip(
    frame: np.ndarray,
    track_ids: list[str],
    volumes: dict[str, float],
    muted: dict[str, bool],
    active_zone: int,
) -> None:
    h, w = frame.shape[:2]
    n = len(track_ids)
    if n == 0:
        return
    zone_w = w // n
    strip_y = h - ZONE_STRIP_H

    # Dark background
    cv2.rectangle(frame, (0, strip_y), (w, h), (18, 18, 18), -1)
    cv2.line(frame, (0, strip_y), (w, strip_y), (70, 70, 70), 1)

    for i, tid in enumerate(track_ids):
        x0, x1 = i * zone_w, (i + 1) * zone_w - 1
        color = _zone_color(tid)
        is_active = i == active_zone
        is_muted = muted.get(tid, False)
        vol = volumes.get(tid, 1.0)

        # Zone border
        cv2.rectangle(
            frame,
            (x0 + 2, strip_y + 3),
            (x1 - 2, h - 3),
            color if is_active else (45, 45, 45),
            2 if is_active else 1,
        )

        # Volume bar background
        bar_max_h = ZONE_STRIP_H - 42
        bar_w = 10
        bx = x0 + zone_w // 2 - bar_w // 2
        by = strip_y + 18
        cv2.rectangle(frame, (bx, by), (bx + bar_w, by + bar_max_h), (45, 45, 45), -1)

        # Volume fill
        if not is_muted and vol > 0:
            filled = max(1, int(vol * bar_max_h))
            cv2.rectangle(
                frame,
                (bx, by + bar_max_h - filled),
                (bx + bar_w, by + bar_max_h),
                color,
                -1,
            )

        # Label
        label = (f"[{tid[:6].upper()}]" if is_muted else tid[:7].upper())
        lc = (80, 80, 80) if is_muted else (215, 215, 215)
        cv2.putText(frame, label, (x0 + 5, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.42, lc, 1, cv2.LINE_AA)

        # Volume %
        pct = "MUTE" if is_muted else f"{int(vol * 100)}%"
        cv2.putText(frame, pct, (bx - 3, by + bar_max_h + 13), cv2.FONT_HERSHEY_SIMPLEX, 0.35, lc, 1, cv2.LINE_AA)

        # Divider
        if i < n - 1:
            cv2.line(frame, (x1 + 1, strip_y), (x1 + 1, h), (60, 60, 60), 1)


def _draw_stage1_hud(frame: np.ndarray, active_zone: int, track_ids: list[str]) -> None:
    lines = [
        "STAGE 1: EDIT INSTRUMENTS",
        "Wrist X → select zone   |   Hand height → volume   |   M = mute   |   SPACE = mix & conduct",
    ]
    y = 28
    for i, text in enumerate(lines):
        color = (0, 255, 180) if i == 0 else (190, 190, 190)
        cv2.putText(frame, text, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.65 if i == 0 else 0.52, color, 1 + i, cv2.LINE_AA)
        y += 28

    if 0 <= active_zone < len(track_ids):
        tid = track_ids[active_zone]
        cv2.putText(frame, f"Editing: {tid.upper()}", (12, 82), cv2.FONT_HERSHEY_SIMPLEX, 0.6, _zone_color(tid), 2, cv2.LINE_AA)


def _draw_stage2_hud(
    frame: np.ndarray,
    params: ConductParams,
    fps: float,
    hands: int,
) -> None:
    lines = [
        "STAGE 2: GLOBAL CONDUCT",
        f"Pitch: {params.pitch_shift_semitones:+.1f} st   Tempo: {params.tempo_multiplier:.2f}×   Style: {params.style_preset}",
        "Hand height → pitch   |   Open hand → tempo   |   E = export   |   SPACE = back to edit   |   Q = quit",
        f"FPS {int(fps)}   Hands {hands}",
    ]
    y = 28
    for i, text in enumerate(lines):
        color = (255, 165, 0) if i == 0 else (190, 190, 190)
        thick = 2 if i == 0 else 1
        cv2.putText(frame, text, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.65 if i == 0 else 0.52, color, thick, cv2.LINE_AA)
        y += 28

    # Pitch bar (left side)
    bx, by, bh = 18, 120, 160
    cv2.rectangle(frame, (bx, by), (bx + 14, by + bh), (55, 55, 55), 1)
    center = by + bh // 2
    offset = int((params.pitch_shift_semitones / 12.0) * (bh // 2))
    offset = max(-bh // 2, min(bh // 2, offset))
    cv2.line(frame, (bx + 7, center), (bx + 7, center - offset), (0, 200, 255), 3)
    cv2.putText(frame, "pitch", (bx - 2, by + bh + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.37, (140, 140, 140), 1)


# ─── main ─────────────────────────────────────────────────────────────────────

def run_conduct(session_id: str, *, enable_audio: bool = True) -> Composition:
    comp = load_composition(session_id)
    if not comp.flags.get("allow_conduct"):
        raise RuntimeError(f"Session {session_id} not ready — run setup first.")

    comp.phase = Phase.CONDUCT.value
    save_composition(comp)

    stem_list = _get_stem_list(comp)
    track_ids = _ordered_track_ids(comp, stem_list)
    n_zones = len(track_ids)

    volumes: dict[str, float] = {tid: 1.0 for tid in track_ids}
    muted: dict[str, bool]   = {tid: False for tid in track_ids}
    active_zone = 0
    conduct_params = ConductParams()

    # Stage state: "edit" | "conduct"
    stage = "edit"

    # Audio handles
    mt_engine: MultiTrackAudioEngine | None = None
    loop_engine: ConductStemPlayback | None = None

    # ── audio helpers ──────────────────────────────────────────────────────────

    def start_edit_audio() -> None:
        nonlocal mt_engine
        if not enable_audio or not stem_list:
            return
        try:
            mt_engine = MultiTrackAudioEngine(stem_list)
            mt_engine.start()
            print(f"  [audio] playing {len(stem_list)} stems")
        except Exception as exc:
            print(f"  [audio] multitrack failed: {exc}")
            mt_engine = None

    def stop_edit_audio() -> None:
        nonlocal mt_engine
        if mt_engine:
            mt_engine.stop()
            mt_engine = None

    def start_loop_audio(mix_path: str) -> None:
        nonlocal loop_engine
        if not enable_audio:
            return
        try:
            buf = _load_mix_wav(mix_path)
            loop_engine = ConductStemPlayback([buf], track_ids=["mix"], source="mix")
            loop_engine.start()
        except Exception as exc:
            print(f"  [audio] loop failed: {exc}")
            loop_engine = None

    def stop_loop_audio() -> None:
        nonlocal loop_engine
        if loop_engine:
            loop_engine.stop()
            loop_engine = None

    # ── mix / export helpers ───────────────────────────────────────────────────

    def do_mix(p: ConductParams) -> str:
        """Mix with current volumes (no pitch/tempo transforms — applied at export)."""
        out = str(session_dir(session_id) / "mix.wav")
        mix_stems(stem_list, volumes, out)
        return out

    def do_export(p: ConductParams) -> str:
        EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        out = str(EXPORT_DIR / f"{session_id}.wav")
        mix_stems(
            stem_list,
            volumes,
            out,
            pitch_shift_semitones=p.pitch_shift_semitones,
            tempo_multiplier=p.tempo_multiplier,
        )
        return out

    # ── camera / mediapipe setup ───────────────────────────────────────────────

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Cannot open camera (index 0)")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW_NAME, 1280, 720)

    print("Loading MediaPipe hand landmarker...")
    landmarker = create_hand_landmarker()
    print("Conduct ready.")
    if n_zones:
        print(f"  {n_zones} instrument zones: {track_ids}")
    else:
        print("  No stems found — running in silent mode.")
    print("  Stage 1: wrist X = select zone, hand height = volume, M = mute, SPACE = mix")

    start_time = time.time()
    prev_time = 0.0
    mix_path = ""

    start_edit_audio()

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]

            hand_count = 0
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_img = mp_lib.Image(image_format=mp_lib.ImageFormat.SRGB, data=rgb)
            ts_ms = int((time.time() - start_time) * 1000)
            result = landmarker.detect_for_video(mp_img, ts_ms)

            if result.hand_landmarks:
                hand_count = len(result.hand_landmarks)
                primary = result.hand_landmarks[0]
                wrist = primary[0]
                x_norm, y_norm = wrist.x, wrist.y

                rgb = draw_hands(rgb, result)

                if stage == "edit" and n_zones > 0:
                    # Zone selection from wrist X; volume from wrist Y
                    active_zone = max(0, min(n_zones - 1, int(x_norm * n_zones)))
                    tid = track_ids[active_zone]
                    vol = max(0.0, min(1.0, 1.0 - y_norm))
                    if not muted[tid]:
                        volumes[tid] = vol
                        if mt_engine:
                            mt_engine.set_volume(tid, vol)

                elif stage == "conduct":
                    gesture = gestures_from_landmarks(primary)
                    pitch, tempo, style = gesture_to_conduct(gesture)
                    conduct_params = ConductParams(
                        pitch_shift_semitones=pitch,
                        tempo_multiplier=tempo,
                        style_preset=style,
                    )
                    if loop_engine:
                        loop_engine.update(pitch, tempo)

            frame = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

            curr = time.time()
            fps = 1.0 / (curr - prev_time) if prev_time else 0.0
            prev_time = curr

            if stage == "edit":
                _draw_stage1_hud(frame, active_zone, track_ids)
                _draw_zone_strip(frame, track_ids, volumes, muted, active_zone)
            else:
                _draw_stage2_hud(frame, conduct_params, fps, hand_count)

            cv2.imshow(WINDOW_NAME, frame)
            key = cv2.waitKey(1) & 0xFF

            if key == ord("q"):
                if stage == "conduct" and stem_list:
                    stop_loop_audio()
                    export_path = do_export(conduct_params)
                    print(f"\nExported → {export_path}")
                break

            elif key == ord("m") and stage == "edit" and 0 <= active_zone < n_zones:
                tid = track_ids[active_zone]
                muted[tid] = not muted.get(tid, False)
                if mt_engine:
                    mt_engine.set_volume(tid, 0.0 if muted[tid] else volumes[tid])
                print(f"  {tid}: {'MUTED' if muted[tid] else 'unmuted'}")

            elif key == ord(" "):
                if stage == "edit":
                    if not stem_list:
                        print("  No stems to mix — skipping to Stage 2 (silent)")
                    else:
                        print("  Mixing stems...")
                        stop_edit_audio()
                        mix_path = do_mix(conduct_params)
                    stage = "conduct"
                    start_loop_audio(mix_path if stem_list else "")
                    print("  Stage 2: hand height = pitch | open hand = tempo | E = export | SPACE = back")
                else:
                    stop_loop_audio()
                    stage = "edit"
                    start_edit_audio()
                    print("  Back to Stage 1 (instrument editor)")

            elif key == ord("e") and stage == "conduct":
                stop_loop_audio()
                export_path = do_export(conduct_params)
                print(f"\nExported → {export_path}")
                comp.phase = Phase.DONE.value
                comp.flags["export_complete"] = True
                save_composition(comp)
                break

    finally:
        stop_edit_audio()
        stop_loop_audio()
        landmarker.close()
        cap.release()
        cv2.destroyAllWindows()

    comp.phase = Phase.DONE.value
    comp.flags["allow_export"] = True
    save_composition(comp)
    return comp


def run_conduct_interactive(session_id: str | None = None, **kwargs) -> Composition:
    if not session_id:
        from hackhcc.composition import DEFAULT_SESSION_ID
        session_id = DEFAULT_SESSION_ID
    return run_conduct(session_id, **kwargs)
