"""Canonical session document (composition.json) and manifest."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SESSIONS_DIR = PROJECT_ROOT / "sessions"
DEFAULT_SESSION_ID = "demo"
SCHEMA_VERSION = 1


class Phase(str, Enum):
    SETUP = "setup"
    CONDUCT = "conduct"
    REVIEW = "review"
    EXPORT = "export"
    DONE = "done"


class GenerationMode(str, Enum):
    REALIZE_ONLY = "realize_only"


class Writer(str, Enum):
    """Logical owners for contract documentation."""

    ORCHESTRATOR = "orchestrator"
    INTENT = "intent"
    HUM_CAPTURE = "hum_capture"
    PITCH = "pitch"
    CONDUCT = "conduct"
    REVIEW = "review"
    EXPORT = "export"


@dataclass
class ConductParams:
    """Live performance controls (updated during conduct)."""

    pitch_shift_semitones: float = 0.0
    tempo_multiplier: float = 1.0
    style_preset: str = "neutral"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Note:
    start_ms: int
    duration_ms: int
    midi: int
    confidence: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Note:
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class Track:
    id: str
    name: str
    instrument: str = "synth"
    role: str = "melody"
    hum_path: str = ""
    stem_path: str = ""
    notes: list[Note] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["notes"] = [n.to_dict() if isinstance(n, Note) else n for n in self.notes]
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Track:
        notes_raw = data.pop("notes", [])
        notes = [
            Note.from_dict(n) if isinstance(n, dict) else n for n in notes_raw
        ]
        known = {f.name for f in cls.__dataclass_fields__.values()}
        return cls(
            **{k: v for k, v in data.items() if k in known},
            notes=notes,
        )


@dataclass
class Intent:
    raw_transcript: str = ""
    source: str = "cli"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Intent:
        if not data:
            return cls()
        known = {f.name for f in cls.__dataclass_fields__.values()}
        return cls(**{k: v for k, v in data.items() if k in known})


def default_flags() -> dict[str, bool]:
    return {
        "intent_complete": False,
        "hums_complete": False,
        "pitch_complete": False,
        "stems_complete": False,
        "setup_complete": False,
        "allow_conduct": False,
        "allow_export": False,
    }


@dataclass
class Composition:
    version: int = SCHEMA_VERSION
    session_id: str = ""
    phase: str = Phase.SETUP.value
    generation_mode: str = GenerationMode.REALIZE_ONLY.value
    bpm: int = 120
    key: str = "C"
    mood: str = ""
    tracks: list[Track] = field(default_factory=list)
    intent: Intent = field(default_factory=Intent)
    conduct: ConductParams = field(default_factory=ConductParams)
    flags: dict[str, bool] = field(default_factory=default_flags)
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "session_id": self.session_id,
            "phase": self.phase,
            "generation_mode": self.generation_mode,
            "bpm": self.bpm,
            "key": self.key,
            "mood": self.mood,
            "tracks": [t.to_dict() for t in self.tracks],
            "intent": self.intent.to_dict(),
            "conduct": self.conduct.to_dict(),
            "flags": dict(self.flags),
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Composition:
        data = dict(data)
        conduct_raw = data.pop("conduct", {})
        intent_raw = data.pop("intent", {})
        tracks_raw = data.pop("tracks", [])
        flags_raw = data.pop("flags", {})

        tracks = [Track.from_dict(t) if isinstance(t, dict) else t for t in tracks_raw]
        conduct = ConductParams(**conduct_raw) if conduct_raw else ConductParams()
        intent = Intent.from_dict(intent_raw) if intent_raw else Intent()

        flags = default_flags()
        flags.update({k: bool(v) for k, v in flags_raw.items()})

        known = {f.name for f in cls.__dataclass_fields__.values()}
        return cls(
            **{k: v for k, v in data.items() if k in known},
            tracks=tracks,
            intent=intent,
            conduct=conduct,
            flags=flags,
        )


def new_session_id() -> str:
    return uuid.uuid4().hex[:8]


def session_dir(session_id: str) -> Path:
    return SESSIONS_DIR / session_id


def hums_dir(session_id: str) -> Path:
    return session_dir(session_id) / "hums"


def stems_dir(session_id: str) -> Path:
    return session_dir(session_id) / "stems"


def composition_path(session_id: str) -> Path:
    return session_dir(session_id) / "composition.json"


def manifest_path(session_id: str) -> Path:
    return session_dir(session_id) / "manifest.json"


def intent_path(session_id: str) -> Path:
    return session_dir(session_id) / "intent.json"


def resolve_session_path(session_id: str, relative: str) -> Path:
    return session_dir(session_id) / relative


def load_composition(session_id: str) -> Composition:
    path = composition_path(session_id)
    if not path.exists():
        raise FileNotFoundError(f"No session at {path}")
    with path.open(encoding="utf-8") as f:
        return Composition.from_dict(json.load(f))


def save_composition(composition: Composition) -> Path:
    root = session_dir(composition.session_id)
    root.mkdir(parents=True, exist_ok=True)
    hums_dir(composition.session_id).mkdir(parents=True, exist_ok=True)
    stems_dir(composition.session_id).mkdir(parents=True, exist_ok=True)

    refresh_setup_flags(composition)

    path = composition_path(composition.session_id)
    with path.open("w", encoding="utf-8") as f:
        json.dump(composition.to_dict(), f, indent=2)
    _update_manifest(composition)
    return path


def refresh_setup_flags(comp: Composition) -> None:
    """Recompute intent/hums/pitch gates from on-disk state (orchestrator only)."""
    comp.flags["intent_complete"] = bool(
        comp.mood.strip() and len(comp.tracks) >= 1
    )

    hums_ok = True
    if not comp.tracks:
        hums_ok = False
    for track in comp.tracks:
        if not track.hum_path:
            hums_ok = False
            break
        if not resolve_session_path(comp.session_id, track.hum_path).is_file():
            hums_ok = False
            break
    comp.flags["hums_complete"] = hums_ok

    pitch_ok = hums_ok and all(len(t.notes) >= 1 for t in comp.tracks)
    comp.flags["pitch_complete"] = pitch_ok

    stems_ok = True
    if not comp.tracks:
        stems_ok = False
    for track in comp.tracks:
        if not track.stem_path:
            stems_ok = False
            break
        if not resolve_session_path(comp.session_id, track.stem_path).is_file():
            stems_ok = False
            break
    comp.flags["stems_complete"] = stems_ok


def evaluate_setup_gates(comp: Composition) -> tuple[bool, list[str]]:
    """Return (ready_for_conduct, list of human-readable blockers)."""
    refresh_setup_flags(comp)
    errors: list[str] = []

    if not comp.flags["intent_complete"]:
        if not comp.mood.strip():
            errors.append("mood is empty (intent agent)")
        if not comp.tracks:
            errors.append("no tracks defined (intent agent)")

    if not comp.flags["hums_complete"]:
        for track in comp.tracks:
            path = (
                resolve_session_path(comp.session_id, track.hum_path)
                if track.hum_path
                else None
            )
            if not path or not path.is_file():
                errors.append(f"hum missing for track '{track.id}' (hum_capture)")

    if comp.flags["hums_complete"] and not comp.flags["pitch_complete"]:
        for track in comp.tracks:
            if not track.notes:
                errors.append(f"pitch not detected for track '{track.id}' (pitch agent)")

    ready = (
        comp.flags["intent_complete"]
        and comp.flags["hums_complete"]
        and comp.flags["pitch_complete"]
    )
    return ready, errors


def try_mark_setup_complete(session_id: str) -> Composition:
    """Set setup_complete only when all setup gates pass."""
    comp = load_composition(session_id)
    ready, errors = evaluate_setup_gates(comp)
    if not ready:
        raise RuntimeError(
            "Setup incomplete:\n  - " + "\n  - ".join(errors)
        )
    comp.flags["setup_complete"] = True
    comp.flags["allow_conduct"] = True
    comp.phase = Phase.CONDUCT.value
    save_composition(comp)
    return load_composition(session_id)


def force_setup_stub(session_id: str, *, mood: str = "upbeat") -> Composition:
    """Dev-only: unlock conduct without hums/pitch (demo --stub)."""
    comp = load_composition(session_id)
    comp.mood = mood
    if not comp.tracks:
        comp.tracks = [
            Track(id="melody", name="Melody", instrument="synth", role="melody"),
        ]
    comp.flags["intent_complete"] = True
    comp.flags["hums_complete"] = True
    comp.flags["pitch_complete"] = True
    comp.flags["setup_complete"] = True
    comp.flags["allow_conduct"] = True
    comp.phase = Phase.CONDUCT.value
    save_composition(comp)
    return load_composition(session_id)


def create_default_composition(session_id: str | None = None) -> Composition:
    sid = session_id or new_session_id()
    comp = Composition(
        session_id=sid,
        phase=Phase.SETUP.value,
        mood="",
        tracks=[],
        intent=Intent(source="cli"),
    )
    save_composition(comp)
    return comp


def _update_manifest(composition: Composition) -> None:
    manifest = {
        "session_id": composition.session_id,
        "phase": composition.phase,
        "flags": composition.flags,
        "track_ids": [t.id for t in composition.tracks],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    with manifest_path(composition.session_id).open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)


# Backward compatibility
def mark_setup_complete(session_id: str) -> Composition:
    return try_mark_setup_complete(session_id)
