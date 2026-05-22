"""ElevenLabs STT example (requires ELEVENLABS_API_KEY)."""

from hackhcc.stt import SpeechListener

with SpeechListener(
    on_partial=lambda t: print("...", t.text),
    on_committed=lambda t: print("Done:", t.text),
) as listener:
    try:
        while listener.is_listening:
            caption = listener.partial_text
            if caption and "stop" in caption.lower():
                break
    except KeyboardInterrupt:
        pass

print(listener.full_transcript or "(none)")
