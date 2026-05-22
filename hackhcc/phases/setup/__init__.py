"""Setup phase: intent → hum → pitch → gated complete."""

from hackhcc.phases.setup.hum import run_hum_capture
from hackhcc.phases.setup.intent import (
    apply_intent,
    apply_intent_from_elevenlabs,
    apply_intent_from_transcript,
    listen_elevenlabs_transcript,
    run_intent_interactive,
)
from hackhcc.stt.prompts import voice_input
from hackhcc.phases.setup.pitch import run_pitch_detection
from hackhcc.phases.setup.runner import (
    run_hum_and_pitch,
    run_setup,
    run_setup_elevenlabs,
    run_setup_stub,
)
from hackhcc.phases.setup.voice_ui import run_voice_setup_intent

__all__ = [
    "apply_intent",
    "apply_intent_from_elevenlabs",
    "apply_intent_from_transcript",
    "listen_elevenlabs_transcript",
    "run_hum_capture",
    "run_intent_interactive",
    "run_pitch_detection",
    "run_setup",
    "run_hum_and_pitch",
    "run_setup_elevenlabs",
    "run_setup_stub",
    "run_voice_setup_intent",
    "voice_input",
]
