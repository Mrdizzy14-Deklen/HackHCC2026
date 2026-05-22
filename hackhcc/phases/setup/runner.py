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
from hackhcc.phases.setup.intent import (
    apply_intent,
    apply_intent_from_elevenlabs,
    run_intent_cli,
)
from hackhcc.phases.setup.pitch import run_pitch_detection
from hackhcc.phases.setup.render import run_render_stems
from hackhcc.phases.setup.voice_ui import run_voice_setup_intent


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


def run_hum_and_pitch(
    session_id: str,
    *,
    hum_seconds: float = 5.0,
    render_stems: bool = True,
    use_musicgen: bool = True,
) -> Composition:
    """Setup: hums → pitch → render stems → gate."""
    print("\n--- Hum capture ---")
    run_hum_capture(session_id, seconds=hum_seconds)
    print("\n--- Pitch detection ---")
    run_pitch_detection(session_id)

    ready, errors = evaluate_setup_gates(load_composition(session_id))
    if not ready:
        raise RuntimeError(
            "Setup gates failed after hum/pitch:\n  - " + "\n  - ".join(errors)
        )

    if render_stems:
        run_render_stems(session_id, use_musicgen=use_musicgen)

    comp = try_mark_setup_complete(session_id)
    print("\nSetup complete — conduct unlocked.")
    print(f"  Key: {comp.key}  BPM: {comp.bpm}  Mood: {comp.mood}")
    for t in comp.tracks:
        stem = t.stem_path or "(none)"
        print(
            f"  {t.id}: {len(t.notes)} notes, hum={t.hum_path}, stem={stem}"
        )
    return comp


def run_setup_elevenlabs(
    session_id: str | None = None,
    *,
    hum_seconds: float = 5.0,
    use_voice_ui: bool = True,
    render_stems: bool = True,
    use_musicgen: bool = True,
) -> Composition:
    """
    Full ElevenLabs setup: intent (voice UI or headless STT) → hum → pitch.
    """
    sid = _ensure_session(session_id)
    print(f"Session: {sid}")

    print("\n--- 1/3 Intent (ElevenLabs) ---")
    if use_voice_ui:
        run_voice_setup_intent(sid)
    else:
        apply_intent_from_elevenlabs(sid)

    return run_hum_and_pitch(
        sid,
        hum_seconds=hum_seconds,
        render_stems=render_stems,
        use_musicgen=use_musicgen,
    )


def run_setup(
    session_id: str | None = None,
    *,
    mood: str | None = None,
    instruments: list[str] | None = None,
    hum_seconds: float = 5.0,
    skip_intent: bool = False,
    interactive_intent: bool = True,
    voice_intent: bool = False,
    text_intent: bool = False,
    render_stems: bool = True,
    use_musicgen: bool = True,
) -> Composition:
    """
    Full setup pipeline:
      1. intent (mood only — instruments are fixed 5)
      2. hum capture (WAV per track)
      3. pitch detection (notes per track)
      4. stem render via MusicGen
      5. gate → setup_complete / allow_conduct
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
    elif voice_intent:
        run_voice_setup_intent(sid)
    elif text_intent:
        run_intent_cli(sid)
    elif interactive_intent:
        apply_intent_from_elevenlabs(sid)
    else:
        comp = load_composition(sid)
        if not comp.tracks:
            apply_intent(
                sid,
                mood=mood or "upbeat",
                instruments=instruments or ["synth", "bass"],
            )

    return run_hum_and_pitch(
        sid,
        hum_seconds=hum_seconds,
        render_stems=render_stems,
        use_musicgen=use_musicgen,
    )


def run_setup_stub(session_id: str | None = None, *, mood: str = "upbeat") -> Composition:
    """Dev-only: skip hum/pitch and unlock conduct (--stub)."""
    sid = _ensure_session(session_id)
    comp = load_composition(sid)
    if not comp.tracks:
        apply_intent(sid, mood=mood, instruments=["synth"], source="hardcoded")
    print(f"Session: {sid}")
    print("  [stub] Skipping hum / pitch — forcing allow_conduct.")
    return force_setup_stub(sid, mood=mood)
