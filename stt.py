"""
ElevenLabs realtime speech-to-text.

Usage in another module (e.g. main.py):

    from stt import SpeechListener

    listener = SpeechListener(
        on_partial=lambda t: print("...", t.text),
        on_committed=lambda t: print("Done:", t.text),
    )
    listener.start()
    # ... your loop; read listener.partial_text or listener.full_transcript
    listener.stop()

Or as a context manager:

    with SpeechListener() as listener:
        while running:
            caption = listener.partial_text or listener.full_transcript
"""

from __future__ import annotations

import asyncio
import base64
import os
import ssl
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import certifi
import numpy as np
import sounddevice as sd


def _configure_ssl() -> None:
    """Use certifi CA bundle (fixes CERTIFICATE_VERIFY_FAILED on macOS Python)."""
    ca_bundle = certifi.where()
    os.environ.setdefault("SSL_CERT_FILE", ca_bundle)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", ca_bundle)
    try:
        ssl._create_default_https_context = lambda: ssl.create_default_context(
            cafile=ca_bundle
        )
    except Exception:
        pass


_configure_ssl()

from elevenlabs import (
    AudioFormat,
    CommitStrategy,
    ElevenLabs,
    RealtimeAudioOptions,
    RealtimeEvents,
)

SAMPLE_RATE = 16_000
# ~100 ms of 16-bit mono PCM per chunk
CHUNK_SAMPLES = SAMPLE_RATE // 10


@dataclass(frozen=True)
class TranscriptUpdate:
    """A partial or final transcript segment."""

    text: str
    is_final: bool


TranscriptCallback = Callable[[TranscriptUpdate], None]


def _default_api_key() -> str:
    key = os.getenv("ELEVENLABS_API_KEY")
    if not key:
        raise ValueError(
            "Set ELEVENLABS_API_KEY in your environment (or a .env file)."
        )
    return key


class SpeechListener:
    """
    Streams microphone audio to ElevenLabs Scribe v2 Realtime and transcribes
    continuously in a background thread.

    Thread-safe reads: partial_text, full_transcript, is_listening.
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        on_partial: TranscriptCallback | None = None,
        on_committed: TranscriptCallback | None = None,
        on_error: Callable[[Exception], None] | None = None,
        language_code: str = "en",
        model_id: str = "scribe_v2_realtime",
    ) -> None:
        self._api_key = api_key or _default_api_key()
        self._on_partial = on_partial
        self._on_committed = on_committed
        self._on_error = on_error
        self._language_code = language_code
        self._model_id = model_id

        self._lock = threading.Lock()
        self._partial_text = ""
        self._full_transcript = ""

        self._stop = threading.Event()
        self._ready = threading.Event()
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._audio_queue: asyncio.Queue[bytes] | None = None
        self._stream: sd.InputStream | None = None

    @property
    def partial_text(self) -> str:
        with self._lock:
            return self._partial_text

    @property
    def full_transcript(self) -> str:
        with self._lock:
            return self._full_transcript

    @property
    def is_listening(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self, *, block_until_ready: bool = True, timeout: float = 15.0) -> None:
        """Begin capturing mic audio and transcribing in the background."""
        if self.is_listening:
            return
        self._stop.clear()
        self._ready.clear()
        self._thread = threading.Thread(target=self._run, name="SpeechListener", daemon=True)
        self._thread.start()
        if block_until_ready and not self._ready.wait(timeout=timeout):
            self.stop()
            raise TimeoutError("Speech listener did not become ready in time.")

    def stop(self) -> None:
        """Stop listening and close the ElevenLabs connection."""
        self._stop.set()
        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(lambda: None)
        if self._thread:
            self._thread.join(timeout=5.0)
            self._thread = None

    def __enter__(self) -> SpeechListener:
        self.start()
        return self

    def __exit__(self, *_: Any) -> None:
        self.stop()

    def _set_partial(self, text: str) -> None:
        with self._lock:
            self._partial_text = text
        if self._on_partial and text:
            self._on_partial(TranscriptUpdate(text=text, is_final=False))

    def _append_committed(self, text: str) -> None:
        text = text.strip()
        if not text:
            return
        with self._lock:
            self._partial_text = ""
            if self._full_transcript:
                self._full_transcript = f"{self._full_transcript} {text}".strip()
            else:
                self._full_transcript = text
            committed = self._full_transcript
        if self._on_committed:
            self._on_committed(TranscriptUpdate(text=text, is_final=True))

    def _report_error(self, error: Exception) -> None:
        if self._on_error:
            self._on_error(error)
        else:
            print(f"[stt] {error}")

    def _audio_callback(self, indata: np.ndarray, _frames: int, _time: Any, status: sd.CallbackFlags) -> None:
        if status:
            print(f"[stt] audio status: {status}")
        if self._stop.is_set() or self._loop is None or self._audio_queue is None:
            return
        pcm = (indata[:, 0] * 32767).astype(np.int16).tobytes()
        asyncio.run_coroutine_threadsafe(self._audio_queue.put(pcm), self._loop)

    def _run(self) -> None:
        try:
            asyncio.run(self._async_main())
        except Exception as e:
            self._report_error(e)
        finally:
            self._ready.set()

    async def _async_main(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._audio_queue = asyncio.Queue(maxsize=100)

        client = ElevenLabs(api_key=self._api_key)
        options = RealtimeAudioOptions(
            model_id=self._model_id,
            audio_format=AudioFormat.PCM_16000,
            sample_rate=SAMPLE_RATE,
            commit_strategy=CommitStrategy.VAD,
            language_code=self._language_code,
        )
        connection = await client.speech_to_text.realtime.connect(options)

        def on_partial(data: dict) -> None:
            text = (data.get("text") or "").strip()
            if text:
                self._set_partial(text)

        def on_committed(data: dict) -> None:
            text = (data.get("text") or "").strip()
            if text:
                self._append_committed(text)

        def on_error(error: Any) -> None:
            self._report_error(Exception(str(error)))
            self._stop.set()

        connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, on_partial)
        connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, on_committed)
        connection.on(RealtimeEvents.ERROR, on_error)

        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=CHUNK_SAMPLES,
            callback=self._audio_callback,
        )
        self._stream.start()
        self._ready.set()

        try:
            while not self._stop.is_set():
                try:
                    chunk = await asyncio.wait_for(self._audio_queue.get(), timeout=0.25)
                except asyncio.TimeoutError:
                    continue
                payload = base64.b64encode(chunk).decode("utf-8")
                await connection.send(
                    {"audio_base_64": payload, "sample_rate": SAMPLE_RATE}
                )
        finally:
            if self._stream:
                self._stream.stop()
                self._stream.close()
                self._stream = None
            await connection.close()


def start_listening(**kwargs: Any) -> SpeechListener:
    """Create a SpeechListener, start it, and return it for use elsewhere."""
    listener = SpeechListener(**kwargs)
    listener.start()
    return listener


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass

    print("Listening… (Ctrl+C to stop)")

    def show_partial(update: TranscriptUpdate) -> None:
        print(f"\r… {update.text[:80]:<80}", end="", flush=True)

    def show_committed(update: TranscriptUpdate) -> None:
        print(f"\n✓ {update.text}")

    with SpeechListener(on_partial=show_partial, on_committed=show_committed) as listener:
        try:
            while listener.is_listening:
                threading.Event().wait(0.5)
        except KeyboardInterrupt:
            print("\nStopped.")
        print(f"\nFull transcript:\n{listener.full_transcript or '(none)'}")
