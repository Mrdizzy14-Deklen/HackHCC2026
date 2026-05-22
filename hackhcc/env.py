"""Load project-root .env for CLI and library use."""

from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = PROJECT_ROOT / ".env"


def load_project_env() -> bool:
    """Load ``.env`` from repo root. Safe to call multiple times."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return False
    if ENV_FILE.is_file():
        return load_dotenv(ENV_FILE, override=False)
    return load_dotenv(override=False)
