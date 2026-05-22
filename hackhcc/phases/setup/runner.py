"""Setup phase runner — orchestrates intent, hum, pitch with gates."""

from __future__ import annotations

from hackhcc.composition import (
    Composition,
    create_default_composition,
    evaluate_setup_gates,
    force_setup_stub,
    load_composition,
    try_mark_setup_complete,
)
from hackhcc.phases.setup.hum import run_hum_capture
from hackhcc.phases.setup.intent import apply_intent, run_intent_interactive
from hackhcc.phases.setup.pitch import run_pitch_detection


def _ensure_session(session_id: str | None) -> str:
    if session_id:
        try:
            load_composition(session_id)
            return session_id
        except FileNotFoundError:
            create_default_composition(session_id)
            return session_id
    comp = create_default_composition()
    return comp.session_id


def run_setup(
    session_id: str | None = None,
    *,
    mood: str | None = None,
    instruments: list[str] | None = None,
    hum_seconds: float = 5.0,
    skip_intent: bool = False,
    interactive_intent: bool = True,
) -> Composition:
    """
    Full setup pipeline:
      1. intent (mood + tracks)
      2. hum capture (WAV per track)
      3. pitch detection (notes per track)
      4. gate → setup_complete / allow_conduct
    """
    sid = _ensure_session(session_id)
    print(f"Session: {sid}")

    if skip_intent and mood:
        apply_intent(
            sid,
            mood=mood,
            instruments=instruments or ["synth", "bass"],
            source="cli",
        )
    elif interactive_intent:
        run_intent_interactive(sid)
    else:
        comp = load_composition(sid)
        if not comp.tracks:
            apply_intent(
                sid,
                mood=mood or "upbeat",
                instruments=instruments or ["synth", "bass"],
            )

    run_hum_capture(sid, seconds=hum_seconds)
    run_pitch_detection(sid)

    ready, errors = evaluate_setup_gates(load_composition(sid))
    if not ready:
        raise RuntimeError(
            "Setup gates failed after pipeline:\n  - " + "\n  - ".join(errors)
        )

    comp = try_mark_setup_complete(sid)
    print("\nSetup complete — conduct unlocked.")
    print(f"  Tracks: {[t.id for t in comp.tracks]}")
    print(f"  Key: {comp.key}  BPM: {comp.bpm}  Mood: {comp.mood}")
    for t in comp.tracks:
        print(f"  {t.id}: {len(t.notes)} notes, hum={t.hum_path}")
    return comp


def run_setup_stub(session_id: str | None = None, *, mood: str = "upbeat") -> Composition:
    """Dev-only: skip hum/pitch and unlock conduct (--stub)."""
    sid = _ensure_session(session_id)
    comp = load_composition(sid)
    if not comp.tracks:
        apply_intent(sid, mood=mood, instruments=["synth"], source="hardcoded")
    print(f"Session: {sid}")
    print("  [stub] Skipping hum / pitch — forcing allow_conduct.")
    return force_setup_stub(sid, mood=mood)
