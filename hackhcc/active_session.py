"""Remember which session you last set up (for 1_setup.py → 2_conduct.py)."""

from __future__ import annotations

from pathlib import Path

from hackhcc.composition import DEFAULT_SESSION_ID, PROJECT_ROOT

ACTIVE_FILE = PROJECT_ROOT / ".active_session"


def set_active(session_id: str) -> None:
    ACTIVE_FILE.write_text(session_id.strip(), encoding="utf-8")


def get_active() -> str:
    if ACTIVE_FILE.is_file():
        sid = ACTIVE_FILE.read_text(encoding="utf-8").strip()
        if sid:
            return sid
    return DEFAULT_SESSION_ID


def clear_active() -> None:
    if ACTIVE_FILE.is_file():
        ACTIVE_FILE.unlink()
