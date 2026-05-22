#!/usr/bin/env python3
"""
Step 1 — Setup (inputs): voice/text intent → hum → pitch → instrument stems.

Examples:
  python 1_setup.py
  python 1_setup.py -s mysong
  python 1_setup.py -s mysong --text --mood upbeat --instruments piano
"""

from __future__ import annotations

import argparse
import sys

from hackhcc.active_session import set_active
from hackhcc.env import load_project_env

load_project_env()

from hackhcc.phases.setup.runner import run_setup  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(
        description="HackHCC step 1: capture intent, hums, pitch, render stems",
    )
    parser.add_argument(
        "-s",
        "--session",
        default="mysong",
        help="Session name (default: mysong)",
    )
    parser.add_argument(
        "--text",
        action="store_true",
        help="Typed mood/instruments (no ElevenLabs for intent)",
    )
    parser.add_argument("--mood", default=None, help="e.g. upbeat")
    parser.add_argument(
        "--instruments",
        default=None,
        help="Comma-separated, e.g. piano or trumpet,bass",
    )
    parser.add_argument("--hum-seconds", type=float, default=5.0)
    parser.add_argument(
        "--musicgen",
        action="store_true",
        help="Use Replicate MusicGen for stems (needs REPLICATE_API_TOKEN)",
    )
    parser.add_argument(
        "--no-render",
        action="store_true",
        help="Skip stem render (conduct uses raw hums)",
    )
    args = parser.parse_args()

    instruments = None
    if args.instruments:
        instruments = [x.strip() for x in args.instruments.split(",") if x.strip()]

    skip_intent = bool(args.mood or args.instruments)
    interactive = not skip_intent and not args.text

    print(f"=== Step 1: Setup (session: {args.session}) ===\n")

    try:
        comp = run_setup(
            args.session,
            mood=args.mood,
            instruments=instruments,
            hum_seconds=args.hum_seconds,
            skip_intent=skip_intent,
            interactive_intent=interactive,
            text_intent=args.text,
            render_stems=not args.no_render,
            use_musicgen=args.musicgen,
        )
    except KeyboardInterrupt:
        print("\nSetup cancelled.")
        sys.exit(130)
    except Exception as e:
        print(f"\nSetup failed: {e}")
        sys.exit(1)

    set_active(comp.session_id)
    print(f"\n=== Setup done ===")
    print(f"  Session saved: {comp.session_id}")
    print(f"  Next step:     python 2_conduct.py")
    print(f"  Or:            python 2_conduct.py -s {comp.session_id}")


if __name__ == "__main__":
    main()
