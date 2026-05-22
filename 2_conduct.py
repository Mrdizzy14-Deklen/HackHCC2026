#!/usr/bin/env python3
"""
Step 2 — Conduct (edit/perform): camera + hands control pitch/tempo on your stems.

Uses the session from step 1 automatically (.active_session).

Examples:
  python 2_conduct.py
  python 2_conduct.py -s mysong
  python 2_conduct.py --no-audio
"""

from __future__ import annotations

import argparse
import sys

from hackhcc.active_session import get_active, set_active
from hackhcc.env import load_project_env

load_project_env()

from hackhcc.composition import composition_path, load_composition  # noqa: E402
from hackhcc.phases.conduct import run_conduct  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(
        description="HackHCC step 2: conduct your session with hand gestures",
    )
    parser.add_argument(
        "-s",
        "--session",
        default=None,
        help="Session name (default: last setup from 1_setup.py)",
    )
    parser.add_argument(
        "--no-audio",
        action="store_true",
        help="Camera + visuals only, no sound",
    )
    args = parser.parse_args()

    session_id = args.session or get_active()
    set_active(session_id)

    if not composition_path(session_id).exists():
        print(f"No session '{session_id}'. Run step 1 first:")
        print(f"  python 1_setup.py -s {session_id}")
        sys.exit(1)

    comp = load_composition(session_id)
    if not comp.flags.get("allow_conduct"):
        print(f"Session '{session_id}' is not ready for conduct.")
        print("Finish setup first:")
        print(f"  python 1_setup.py -s {session_id}")
        sys.exit(1)

    print(f"=== Step 2: Conduct (session: {session_id}) ===")
    print("  Q = quit   S = save   Raise hand = pitch up   Open hand = tempo up\n")

    try:
        run_conduct(session_id, enable_audio=not args.no_audio)
    except KeyboardInterrupt:
        print("\nConduct cancelled.")
        sys.exit(130)
    except Exception as e:
        print(f"\nConduct failed: {e}")
        sys.exit(1)

    print("\n=== Conduct done ===")
    print(f"  Session: {session_id}")
    print("  Re-run to perform again:  python 2_conduct.py")
    print("  New song:               python 1_setup.py -s newsong")


if __name__ == "__main__":
    main()
