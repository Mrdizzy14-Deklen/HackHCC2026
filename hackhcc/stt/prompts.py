"""Voice prompts — replaces keyboard input() with ElevenLabs STT."""

from __future__ import annotations

import time
from collections.abc import Callable

from hackhcc.stt.listener import SpeechListener, TranscriptUpdate

DEFAULT_DONE_PHRASES = ("done", "next", "finished")


def listen_elevenlabs_transcript(
    *,
    done_phrases: tuple[str, ...] = DEFAULT_DONE_PHRASES,
    on_partial: Callable[[str], None] | None = None,
    on_committed: Callable[[str], None] | None = None,
    poll_interval: float = 0.2,
) -> str:
    """
    Block on ElevenLabs realtime STT until a done phrase or Ctrl+C.

    Returns the full transcript.
    """
    phrases = tuple(p.lower() for p in done_phrases if p)

    def _partial(update: TranscriptUpdate) -> None:
        if on_partial and update.text.strip():
            on_partial(update.text.strip())

    def _committed(update: TranscriptUpdate) -> None:
        if on_committed and update.text.strip():
            on_committed(update.text.strip())

    with SpeechListener(on_partial=_partial, on_committed=_committed) as listener:
        try:
            while listener.is_listening:
                full = listener.full_transcript.lower()
                if phrases and any(p in full for p in phrases):
                    break
                time.sleep(poll_interval)
        except KeyboardInterrupt:
            pass
        return (listener.full_transcript or "").strip()


def voice_input(
    prompt: str,
    *,
    done_phrases: tuple[str, ...] = DEFAULT_DONE_PHRASES,
    default: str = "",
    allow_empty: bool = False,
) -> str:
    """
    Print a prompt and capture the answer via microphone (ElevenLabs STT).

    Replaces input() everywhere in the pipeline.
    """
    phrase_hint = ", ".join(f'"{p}"' for p in done_phrases[:3])
    print(prompt)
    print(f"  Listening… say {phrase_hint} when finished.\n")

    def _partial(text: str) -> None:
        print(f"  … {text[:72]}", end="\r", flush=True)

    def _committed(text: str) -> None:
        print(f"  ✓ {text}")

    transcript = listen_elevenlabs_transcript(
        done_phrases=done_phrases,
        on_partial=_partial,
        on_committed=_committed,
    ).strip()

    # Strip trailing done phrase from transcript
    lower = transcript.lower()
    for phrase in sorted(done_phrases, key=len, reverse=True):
        if phrase and phrase in lower:
            idx = lower.rfind(phrase)
            transcript = transcript[:idx].strip()
            lower = transcript.lower()
            break

    if not transcript and default:
        print(f"  (using default: {default})")
        return default
    if not transcript and not allow_empty:
        raise ValueError(
            "No speech captured. Check mic permissions and ELEVENLABS_API_KEY."
        )
    return transcript
