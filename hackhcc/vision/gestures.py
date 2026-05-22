"""Map MediaPipe hand landmarks to conduct controls."""

from __future__ import annotations

from dataclasses import dataclass

# Landmark indices (MediaPipe hand)
_WRIST = 0
_THUMB_TIP = 4
_INDEX_TIP = 8
_MIDDLE_TIP = 12
_PINKY_TIP = 20


@dataclass(frozen=True)
class ConductGesture:
    """Normalized gesture features in [0, 1] unless noted."""

    hand_height: float  # 0 = low in frame, 1 = high in frame
    hand_openness: float  # 0 = closed fist, 1 = spread fingers
    detected: bool


def _lm(landmarks, index: int) -> tuple[float, float, float]:
    p = landmarks[index]
    return p.x, p.y, p.z


def gestures_from_landmarks(landmarks) -> ConductGesture:
    """
    Use the primary hand (first in frame) to drive conduct.

    - hand_height: index fingertip Y (inverted so "up" in the air → higher value)
    - hand_openness: thumb–pinky span relative to palm width
    """
    ix, iy, _ = _lm(landmarks, _INDEX_TIP)
    wx, wy, _ = _lm(landmarks, _WRIST)
    tx, ty, _ = _lm(landmarks, _THUMB_TIP)
    px, py, _ = _lm(landmarks, _PINKY_TIP)
    mx, my, _ = _lm(landmarks, _MIDDLE_TIP)

    # Camera coords: y grows downward → invert for "height in the air"
    hand_height = max(0.0, min(1.0, 1.0 - iy))

    palm_width = max(
        ((tx - px) ** 2 + (ty - py) ** 2) ** 0.5,
        ((wx - mx) ** 2 + (wy - my) ** 2) ** 0.5,
        0.05,
    )
    span = ((tx - px) ** 2 + (ty - py) ** 2) ** 0.5
    hand_openness = max(0.0, min(1.0, span / (palm_width * 2.2)))

    # Penalize if index is not clearly above wrist (rough "pointing up")
    if iy > wy - 0.02:
        hand_height *= 0.85

    return ConductGesture(
        hand_height=hand_height,
        hand_openness=hand_openness,
        detected=True,
    )


def gesture_to_conduct(
    gesture: ConductGesture,
    *,
    pitch_range_semitones: float = 12.0,
    tempo_range: tuple[float, float] = (0.75, 1.35),
) -> tuple[float, float, str]:
    """
    Convert gesture → (pitch_shift_semitones, tempo_multiplier, style_preset).

    Raise hand → higher pitch. Open hand → faster tempo + brighter style label.
    """
    # Center pitch around 0 at mid-height
    pitch = (gesture.hand_height - 0.5) * 2.0 * (pitch_range_semitones / 2.0)
    tempo_min, tempo_max = tempo_range
    tempo = tempo_min + gesture.hand_openness * (tempo_max - tempo_min)

    if gesture.hand_openness > 0.65:
        style = "bright"
    elif gesture.hand_openness < 0.35:
        style = "mellow"
    else:
        style = "neutral"

    return round(pitch, 1), round(tempo, 2), style
