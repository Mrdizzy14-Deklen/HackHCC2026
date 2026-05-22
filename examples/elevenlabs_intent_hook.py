"""
ElevenLabs → intent → optional hum → pitch.

  python run.py new -s mysong
  python examples/elevenlabs_intent_hook.py -s mysong
  python examples/elevenlabs_intent_hook.py -s mysong --continue
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from hackhcc.phases.setup.intent import apply_intent_from_elevenlabs
from hackhcc.phases.setup.runner import run_hum_and_pitch


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("-s", "--session", required=True)
    parser.add_argument(
        "--continue",
        dest="continue_setup",
        action="store_true",
        help="Run setup-hum and setup-pitch after intent",
    )
    parser.add_argument("--hum-seconds", type=float, default=5.0)
    args = parser.parse_args()

    comp = apply_intent_from_elevenlabs(args.session)
    print(f"\nSession {comp.session_id}: mood={comp.mood} tracks={[t.id for t in comp.tracks]}")

    if args.continue_setup:
        run_hum_and_pitch(args.session, hum_seconds=args.hum_seconds)
    else:
        print("Next:")
        print(f"  python run.py setup-hum -s {args.session}")
        print(f"  python run.py setup-pitch -s {args.session}")


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass
    main()
