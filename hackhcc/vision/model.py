import ssl
import urllib.request
from pathlib import Path

import certifi

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
MODEL_PATH = PROJECT_ROOT / "models" / "hand_landmarker.task"


def ensure_model() -> Path:
    if MODEL_PATH.exists():
        return MODEL_PATH
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading hand landmarker model to {MODEL_PATH}...")
    ssl_context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(MODEL_URL, context=ssl_context) as response:
        MODEL_PATH.write_bytes(response.read())
    return MODEL_PATH
