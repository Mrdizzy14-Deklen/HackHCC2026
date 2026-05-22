"""Backward-compatible import — prefer: from hackhcc.stt import SpeechListener"""

from hackhcc.stt import (
    SpeechListener,
    TranscriptUpdate,
    listen_elevenlabs_transcript,
    start_listening,
    voice_input,
)

__all__ = [
    "SpeechListener",
    "TranscriptUpdate",
    "listen_elevenlabs_transcript",
    "start_listening",
    "voice_input",
]
