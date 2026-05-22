"""v1 phase orchestrator — structural merge, no LLM."""

from __future__ import annotations

import argparse

from hackhcc.composition import (
    DEFAULT_SESSION_ID,
    composition_path,
    create_default_composition,
    evaluate_setup_gates,
    load_composition,
    session_dir,
    try_mark_setup_complete,
)
from hackhcc.phases.conduct import run_conduct
from hackhcc.phases.setup import run_setup, run_setup_stub
from hackhcc.phases.setup.hum import run_hum_capture
from hackhcc.phases.setup.intent import apply_intent, apply_intent_from_transcript
from hackhcc.phases.setup.pitch import run_pitch_detection


def cmd_new(args: argparse.Namespace) -> None:
    comp = create_default_composition(args.session)
    print(f"Created session: {comp.session_id}")
    print(f"  Folder: {session_dir(comp.session_id)}")


def cmd_setup(args: argparse.Namespace) -> None:
    sid = args.session if args.session else _session_id(args)
    if args.stub:
        comp = run_setup_stub(sid, mood=args.mood or "upbeat")
    else:
        instruments = None
        if args.instruments:
            instruments = [s.strip() for s in args.instruments.split(",") if s.strip()]
        comp = run_setup(
            sid,
            mood=args.mood,
            instruments=instruments,
            hum_seconds=args.hum_seconds,
            skip_intent=bool(args.mood or args.instruments),
            interactive_intent=not (args.mood or args.instruments),
        )
    print(f"allow_conduct={comp.flags.get('allow_conduct')}")


def cmd_setup_intent(args: argparse.Namespace) -> None:
    sid = _session_id(args)
    if args.transcript:
        comp = apply_intent_from_transcript(sid, args.transcript, source="cli")
    else:
        instruments = [s.strip() for s in args.instruments.split(",")] if args.instruments else []
        comp = apply_intent(
            sid,
            mood=args.mood or "upbeat",
            instruments=instruments or None,
            source="cli",
        )
    ready, errors = evaluate_setup_gates(comp)
    print(f"intent_complete={comp.flags.get('intent_complete')}")
    if errors:
        print("  blockers:", "; ".join(errors) if not ready else "none for intent")


def cmd_setup_hum(args: argparse.Namespace) -> None:
    sid = _session_id(args)
    run_hum_capture(sid, seconds=args.hum_seconds)


def cmd_setup_pitch(args: argparse.Namespace) -> None:
    sid = _session_id(args)
    run_pitch_detection(sid)
    comp = load_composition(sid)
    ready, errors = evaluate_setup_gates(comp)
    print(f"pitch_complete={comp.flags.get('pitch_complete')}")
    if ready:
        try_mark_setup_complete(sid)
        print("Setup complete — conduct unlocked.")
    elif errors:
        print("  blockers:", "; ".join(errors))


def cmd_conduct(args: argparse.Namespace) -> None:
    sid = _session_id(args)
    path = composition_path(sid)
    if not path.exists():
        raise SystemExit(f"No session '{sid}'. Run: python run.py new -s {sid}")
    comp = load_composition(sid)
    if not comp.flags.get("allow_conduct"):
        ready, errors = evaluate_setup_gates(comp)
        if ready:
            try_mark_setup_complete(sid)
        else:
            raise SystemExit(
                "Setup incomplete. Run: python run.py setup -s "
                f"{sid}\n  - " + "\n  - ".join(errors)
            )
    run_conduct(sid, enable_audio=not args.no_audio)


def cmd_status(args: argparse.Namespace) -> None:
    sid = _session_id(args)
    comp = load_composition(sid)
    root = session_dir(sid)
    print(f"Session: {sid}")
    print(f"  Phase: {comp.phase}")
    print(f"  Mood: {comp.mood}  Key: {comp.key}  BPM: {comp.bpm}")
    print(f"  Flags: {comp.flags}")
    print(f"  Intent source: {comp.intent.source}")
    for t in comp.tracks:
        print(
            f"  Track {t.id}: hum={t.hum_path or '(none)'} "
            f"notes={len(t.notes)}"
        )
    print(f"  Path: {root}")
    for p in sorted(root.rglob("*")):
        if p.is_file():
            print(f"    - {p.relative_to(root)}")


def cmd_demo(args: argparse.Namespace) -> None:
    sid = args.session if args.session else None
    if args.stub:
        comp = run_setup_stub(sid, mood="demo")
    else:
        comp = run_setup(
            sid,
            mood=args.mood or "upbeat",
            instruments=["synth", "bass"],
            hum_seconds=args.hum_seconds,
            skip_intent=True,
        )
    print("\n--- Starting conduct (Q to quit, S to save) ---\n")
    run_conduct(comp.session_id, enable_audio=not args.no_audio)


def _session_id(args: argparse.Namespace) -> str:
    return getattr(args, "session", None) or DEFAULT_SESSION_ID


def _add_session_arg(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--session",
        "-s",
        default=None,
        help=f"Session id (default: {DEFAULT_SESSION_ID}, or new uuid for `new`)",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="HackHCC2026 v1 — multimodal music pipeline",
    )
    _add_session_arg(parser)
    sub = parser.add_subparsers(dest="command", required=True)

    p_new = sub.add_parser("new", help="Create a new session folder")
    _add_session_arg(p_new)
    p_new.set_defaults(func=cmd_new)

    p_setup = sub.add_parser("setup", help="Full setup: intent → hum → pitch")
    _add_session_arg(p_setup)
    p_setup.add_argument("--mood", default=None, help="Skip prompts; set mood")
    p_setup.add_argument(
        "--instruments",
        default=None,
        help="Comma-separated, e.g. trumpet,bass (with --mood)",
    )
    p_setup.add_argument("--hum-seconds", type=float, default=5.0)
    p_setup.add_argument(
        "--stub",
        action="store_true",
        help="Dev: skip hum/pitch, force allow_conduct",
    )
    p_setup.set_defaults(func=cmd_setup)

    p_si = sub.add_parser("setup-intent", help="Intent step only")
    _add_session_arg(p_si)
    p_si.add_argument("--mood", default="upbeat")
    p_si.add_argument("--instruments", default="synth,bass")
    p_si.add_argument("--transcript", default=None, help="Voice transcript text")
    p_si.set_defaults(func=cmd_setup_intent)

    p_sh = sub.add_parser("setup-hum", help="Hum capture step only")
    _add_session_arg(p_sh)
    p_sh.add_argument("--hum-seconds", type=float, default=5.0)
    p_sh.set_defaults(func=cmd_setup_hum)

    p_sp = sub.add_parser("setup-pitch", help="Pitch detection step only")
    _add_session_arg(p_sp)
    p_sp.set_defaults(func=cmd_setup_pitch)

    p_conduct = sub.add_parser("conduct", help="Run MediaPipe conduct phase")
    _add_session_arg(p_conduct)
    p_conduct.add_argument("--no-audio", action="store_true")
    p_conduct.set_defaults(func=cmd_conduct)

    p_status = sub.add_parser("status", help="Show session state")
    _add_session_arg(p_status)
    p_status.set_defaults(func=cmd_status)

    p_demo = sub.add_parser("demo", help="Setup + conduct")
    _add_session_arg(p_demo)
    p_demo.add_argument("--mood", default=None)
    p_demo.add_argument("--instruments", default=None)
    p_demo.add_argument("--hum-seconds", type=float, default=5.0)
    p_demo.add_argument("--stub", action="store_true")
    p_demo.add_argument("--no-audio", action="store_true")
    p_demo.set_defaults(func=cmd_demo)

    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
