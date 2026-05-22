"""
Teammate hook: apply ElevenLabs STT transcript to session intent.

Requires ELEVENLABS_API_KEY and an existing session:

  python run.py new -s mysong
  python examples/elevenlabs_intent_hook.py -s mysong

Or integrate in your STT loop:

  from hackhcc.phases.setup.intent import apply_intent_from_transcript
  apply_intent_from_transcript(session_id, listener.full_transcript, source="elevenlabs")
"""

from __future__ import annotations

import argparse

from hackhcc.phases.setup.intent import apply_intent_from_transcript
from hackhcc.stt import SpeechListener


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("-s", "--session", required=True)
    args = parser.parse_args()

    print("Speak your setup (mood + instruments). Say 'done' when finished.\n")

    final: list[str] = []

    def on_committed(update) -> None:
        final.append(update.text)
        print(f"✓ {update.text}")

    with SpeechListener(on_committed=on_committed) as listener:
        try:
            while listener.is_listening:
                if listener.full_transcript and "done" in listener.full_transcript.lower():
                    break
                import time

                time.sleep(0.2)
        except KeyboardInterrupt:
            pass

    transcript = listener.full_transcript or " ".join(final)
    if not transcript.strip():
        print("No transcript captured.")
        return

    comp = apply_intent_from_transcript(args.session, transcript, source="elevenlabs")
    print(f"\nSession {comp.session_id}: mood={comp.mood} tracks={[t.id for t in comp.tracks]}")
    print("Next: python run.py setup-hum -s", comp.session_id)


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass
    main()
