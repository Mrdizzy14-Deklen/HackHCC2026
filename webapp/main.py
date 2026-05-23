import ssl
import time
import urllib.request
from pathlib import Path

import certifi

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
MODEL_PATH = Path(__file__).parent / "models" / "hand_landmarker.task"


def ensure_model() -> Path:
    if MODEL_PATH.exists():
        return MODEL_PATH
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading hand landmarker model to {MODEL_PATH}...")
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(MODEL_URL, context=ssl_context) as response:
        MODEL_PATH.write_bytes(response.read())
    return MODEL_PATH


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


def main():
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Error: cannot open camera")
        return

    cv2.namedWindow("MediaPipe Bones", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("MediaPipe Bones", 1280, 720)
    try:
        cv2.moveWindow("MediaPipe Bones", 100, 100)
    except Exception:
        pass

    print("Loading MediaPipe hand landmarker...")
    try:
        landmarker = create_hand_landmarker()
        print("Hand landmarker ready.")
    except Exception as e:
        print(f"Could not load MediaPipe: {e}")
        landmarker = None

    start_time = time.time()
    prev_time = 0
    frame_count = 0

    print("Starting live video. Press Q to quit.")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("Failed to grab frame")
                break

            frame_count += 1
            frame = cv2.flip(frame, 1)

            if landmarker:
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(
                    image_format=mp.ImageFormat.SRGB, data=rgb_frame
                )
                timestamp_ms = int((time.time() - start_time) * 1000)
                result = landmarker.detect_for_video(mp_image, timestamp_ms)
                if result.hand_landmarks:
                    rgb_frame = draw_hands(rgb_frame, result)
                    frame = cv2.cvtColor(rgb_frame, cv2.COLOR_RGB2BGR)

            curr_time = time.time()
            fps = 1 / (curr_time - prev_time) if prev_time else 0
            prev_time = curr_time
            cv2.putText(
                frame,
                f"FPS: {int(fps)}",
                (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                1,
                (0, 255, 0),
                2,
            )

            cv2.imshow("MediaPipe Bones", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        if landmarker:
            landmarker.close()
        cap.release()
        cv2.destroyAllWindows()
        print("Done.")


if __name__ == "__main__":
    main()
