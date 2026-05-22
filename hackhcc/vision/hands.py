import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

from hackhcc.vision.model import ensure_model


def create_hand_landmarker() -> vision.HandLandmarker:
    options = vision.HandLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(ensure_model())),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return vision.HandLandmarker.create_from_options(options)


def draw_hands(rgb_frame, detection_result):
    mp_hands = mp.tasks.vision.HandLandmarksConnections
    mp_drawing = mp.tasks.vision.drawing_utils
    mp_drawing_styles = mp.tasks.vision.drawing_styles

    annotated = rgb_frame.copy()
    for hand_landmarks in detection_result.hand_landmarks:
        mp_drawing.draw_landmarks(
            annotated,
            hand_landmarks,
            mp_hands.HAND_CONNECTIONS,
            mp_drawing_styles.get_default_hand_landmarks_style(),
            mp_drawing_styles.get_default_hand_connections_style(),
        )
    return annotated
