"""Intent agent — mood + tracks (CLI now; ElevenLabs STT via teammate)."""

from __future__ import annotations

import json
import re
from pathlib import Path

from hackhcc.composition import (
    Composition,
    Intent,
    Track,
    create_default_composition,
    intent_path,
    load_composition,
    save_composition,
)

# Simple instrument keywords for v1 transcript parsing
_INSTRUMENT_KEYWORDS: dict[str, tuple[str, str, str]] = {
    "trumpet": ("trumpet", "Trumpet", "melody"),
    "piano": ("piano", "Piano", "chords"),
    "synth": ("synth", "Synth", "melody"),
    "bass": ("bass", "Bass", "bass"),
    "drums": ("drums", "Drums", "perc"),
    "guitar": ("guitar", "Guitar", "melody"),
    "strings": ("strings", "Strings", "chords"),
    "violin": ("violin", "Violin", "melody"),
}

_MOOD_KEYWORDS = (
    "upbeat",
    "sad",
    "happy",
    "chill",
    "energetic",
    "dark",
    "bright",
    "relaxed",
    "epic",
    "lofi",
    "jazz",
    "rock",
    "pop",
)


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "part"


def tracks_from_instruments(names: list[str]) -> list[Track]:
    tracks: list[Track] = []
    seen: set[str] = set()
    for raw in names:
        key = raw.strip().lower()
        if key in _INSTRUMENT_KEYWORDS:
            tid, display, role = _INSTRUMENT_KEYWORDS[key]
        else:
            tid, display, role = _slug(key), raw.strip().title(), "melody"
        if tid in seen:
            continue
        seen.add(tid)
        tracks.append(
            Track(id=tid, name=display, instrument=tid, role=role),
        )
    return tracks


def default_two_tracks() -> list[Track]:
    return [
        Track(id="melody", name="Melody", instrument="synth", role="melody"),
        Track(id="bass", name="Bass", instrument="bass", role="bass"),
    ]


def parse_transcript(text: str) -> tuple[str, list[str]]:
    """Naive v1: extract mood + instrument mentions from transcript."""
    lower = text.lower()
    mood = ""
    for m in _MOOD_KEYWORDS:
        if m in lower:
            mood = m
            break

    instruments: list[str] = []
    for key in _INSTRUMENT_KEYWORDS:
        if key in lower:
            instruments.append(key)

    if "add " in lower:
        for key in _INSTRUMENT_KEYWORDS:
            if f"add {key}" in lower or f"add a {key}" in lower:
                if key not in instruments:
                    instruments.append(key)

    return mood, instruments


def apply_intent(
    session_id: str,
    *,
    mood: str,
    instruments: list[str] | None = None,
    tracks: list[Track] | None = None,
    raw_transcript: str = "",
    source: str = "cli",
) -> Composition:
    """
    Intent agent entrypoint. Writes mood, tracks[], intent.* only.

    Teammate (ElevenLabs): call with transcript or structured fields.
    """
    try:
        comp = load_composition(session_id)
    except FileNotFoundError:
        create_default_composition(session_id)
        comp = load_composition(session_id)

    comp.mood = mood.strip()
    if tracks is not None:
        comp.tracks = tracks
    elif instruments:
        parsed = tracks_from_instruments(instruments)
        comp.tracks = parsed if parsed else default_two_tracks()
    elif not comp.tracks:
        comp.tracks = default_two_tracks()

    comp.intent = Intent(
        raw_transcript=raw_transcript or comp.intent.raw_transcript,
        source=source,
    )
    comp.phase = "setup"
    save_composition(comp)

    _write_intent_sidecar(comp)
    return load_composition(session_id)


def apply_intent_from_transcript(
    session_id: str,
    transcript: str,
    *,
    source: str = "elevenlabs",
) -> Composition:
    mood, instruments = parse_transcript(transcript)
    if not mood:
        mood = "neutral"
    if not instruments:
        instruments = ["synth", "bass"]
    return apply_intent(
        session_id,
        mood=mood,
        instruments=instruments,
        raw_transcript=transcript,
        source=source,
    )


def _write_intent_sidecar(comp: Composition) -> None:
    sidecar = {
        "mood": comp.mood,
        "tracks": [t.to_dict() for t in comp.tracks],
        "intent": comp.intent.to_dict(),
    }
    path = intent_path(comp.session_id)
    with path.open("w", encoding="utf-8") as f:
        json.dump(sidecar, f, indent=2)


def run_intent_interactive(session_id: str) -> Composition:
    print("\n--- Setup: intent (voice/text) ---")
    print("Enter mood (e.g. upbeat, chill) or press Enter for 'upbeat':")
    mood = input("> ").strip() or "upbeat"

    print("Instruments, comma-separated (e.g. trumpet,bass) or Enter for melody+bass:")
    raw = input("> ").strip()
    if raw:
        instruments = [s.strip() for s in raw.split(",") if s.strip()]
    else:
        instruments = []

    print("Optional: paste voice transcript (Enter to skip):")
    transcript = input("> ").strip()

    if transcript:
        return apply_intent_from_transcript(
            session_id, transcript, source="cli+transcript"
        )
    return apply_intent(session_id, mood=mood, instruments=instruments, source="cli")
