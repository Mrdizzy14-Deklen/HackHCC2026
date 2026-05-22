"""Setup phase: intent → hum → pitch → gated complete."""

from hackhcc.phases.setup.hum import run_hum_capture
from hackhcc.phases.setup.intent import (
    apply_intent,
    apply_intent_from_transcript,
    run_intent_interactive,
)
from hackhcc.phases.setup.pitch import run_pitch_detection
from hackhcc.phases.setup.runner import run_setup, run_setup_stub

__all__ = [
    "apply_intent",
    "apply_intent_from_transcript",
    "run_hum_capture",
    "run_intent_interactive",
    "run_pitch_detection",
    "run_setup",
    "run_setup_stub",
]
