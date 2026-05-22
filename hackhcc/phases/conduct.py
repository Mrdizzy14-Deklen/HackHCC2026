"""Conduct phase: MediaPipe hands control pitch and tempo in real time."""

from __future__ import annotations

import json
import time
from pathlib import Path

import cv2
import mediapipe as mp

from hackhcc.audio.engine import ConductToneEngine
from hackhcc.composition import (
    Composition,
    ConductParams,
    Phase,
    load_composition,
    save_composition,
    session_dir,
)
from hackhcc.vision.gestures import gesture_to_conduct, gestures_from_landmarks
from hackhcc.vision.hands import create_hand_landmarker, draw_hands

WINDOW_NAME = "HackHCC — Conduct"
AUTOMATION_FILENAME = "conduct_automation.jsonl"


def _automation_path(session_id: str) -> Path:
    return session_dir(session_id) / AUTOMATION_FILENAME


def _append_automation(session_id: str, params: ConductParams) -> None:
    line = {
        "t": time.time(),
        "pitch_shift_semitones": params.pitch_shift_semitones,
        "tempo_multiplier": params.tempo_multiplier,
        "style_preset": params.style_preset,
    }
    path = _automation_path(session_id)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(line) + "\n")


def _draw_hud(
    frame,
    *,
    params: ConductParams,
    fps: float,
    hands: int,
) -> None:
    lines = [
        "CONDUCT  |  Q = quit  |  S = save session",
        f"Pitch: {params.pitch_shift_semitones:+.1f} st   "
        f"Tempo: {params.tempo_multiplier:.2f}x   "
        f"Style: {params.style_preset}",
        "Raise index finger -> higher pitch | Open hand -> faster tempo",
        f"FPS: {int(fps)}   Hands: {hands}",
    ]
    y = 28
    for i, text in enumerate(lines):
        color = (0, 255, 180) if i == 0 else (220, 220, 220)
        scale = 0.65 if i > 0 else 0.75
        thick = 2 if i == 0 else 1
        cv2.putText(
            frame,
            text,
            (12, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            scale,
            color,
            thick,
            cv2.LINE_AA,
        )
        y += 28 if i == 0 else 26

    # Pitch bar
    bar_x, bar_y, bar_h = 20, 120, 200
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + 16, bar_y + bar_h), (60, 60, 60), 1)
    center = bar_y + bar_h // 2
    offset = int((params.pitch_shift_semitones / 12.0) * (bar_h // 2))
    offset = max(-bar_h // 2, min(bar_h // 2, offset))
    cv2.line(
        frame,
        (bar_x + 8, center),
        (bar_x + 8, center - offset),
        (0, 200, 255),
        4,
    )
    cv2.putText(
        frame,
        "pitch",
        (bar_x - 2, bar_y + bar_h + 18),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.4,
        (160, 160, 160),
        1,
    )


def run_conduct(session_id: str, *, enable_audio: bool = True) -> Composition:
    comp = load_composition(session_id)
    if not comp.flags.get("allow_conduct"):
        raise RuntimeError(
            f"Session {session_id} is not ready for conduct. Run: python run.py setup"
        )

    comp.phase = Phase.CONDUCT.value
    save_composition(comp)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Cannot open camera (index 0)")

    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW_NAME, 1280, 720)

    print("Loading MediaPipe hand landmarker...")
    landmarker = create_hand_landmarker()
    print("Conduct ready. Raise hand = pitch up, open hand = tempo up.")

    engine: ConductToneEngine | None = None
    if enable_audio:
        try:
            engine = ConductToneEngine()
            engine.start()
            print("Audio engine started (continuous tone follows your hand).")
        except Exception as e:
            print(f"Audio disabled: {e}")
            engine = None

    start_time = time.time()
    prev_time = 0.0
    last_log_time = 0.0
    log_interval = 0.15

    # Clear previous automation for this run
    auto_path = _automation_path(session_id)
    if auto_path.exists():
        auto_path.unlink()

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("Failed to grab frame")
                break

            frame = cv2.flip(frame, 1)
            hand_count = 0
            params = comp.conduct

            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            timestamp_ms = int((time.time() - start_time) * 1000)
            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            if result.hand_landmarks:
                hand_count = len(result.hand_landmarks)
                primary = result.hand_landmarks[0]
                gesture = gestures_from_landmarks(primary)
                pitch, tempo, style = gesture_to_conduct(gesture)
                params = ConductParams(
                    pitch_shift_semitones=pitch,
                    tempo_multiplier=tempo,
                    style_preset=style,
                )
                comp.conduct = params
                if engine:
                    engine.update(pitch, tempo)

                now = time.time()
                if now - last_log_time >= log_interval:
                    _append_automation(session_id, params)
                    last_log_time = now

                rgb_frame = draw_hands(rgb_frame, result)

            frame = cv2.cvtColor(rgb_frame, cv2.COLOR_RGB2BGR)
            curr = time.time()
            fps = 1.0 / (curr - prev_time) if prev_time else 0.0
            prev_time = curr

            _draw_hud(frame, params=params, fps=fps, hands=hand_count)
            cv2.imshow(WINDOW_NAME, frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("s"):
                comp.flags["allow_export"] = True
                save_composition(comp)
                print(f"Saved conduct state -> {session_dir(session_id) / 'composition.json'}")

    finally:
        landmarker.close()
        if engine:
            engine.stop()
        cap.release()
        cv2.destroyAllWindows()

    comp.phase = Phase.REVIEW.value
    comp.flags["allow_export"] = True
    save_composition(comp)
    print(f"Conduct finished. Automation log: {auto_path}")
    return comp


def run_conduct_interactive(session_id: str | None = None, **kwargs) -> Composition:
    if not session_id:
        from hackhcc.composition import DEFAULT_SESSION_ID

        session_id = DEFAULT_SESSION_ID
    return run_conduct(session_id, **kwargs)
