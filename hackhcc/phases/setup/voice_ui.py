"""
Voice-driven setup UI: say "instruments" to reveal parts; name them to add cards.

Integrates ElevenLabs STT with OpenCV overlay and intent agent (mood + tracks[]).
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

import cv2
import numpy as np

from hackhcc.composition import Composition, load_composition
from hackhcc.phases.setup.intent import (
    apply_intent_from_transcript,
    parse_transcript,
    tracks_from_instruments,
)
from hackhcc.stt import SpeechListener, TranscriptUpdate

WINDOW_NAME = "HackHCC — Setup"
FRAME_W, FRAME_H = 1280, 720

# Visual palette per instrument id
_INSTRUMENT_COLORS: dict[str, tuple[int, int, int]] = {
    "trumpet": (60, 180, 255),
    "piano": (200, 200, 255),
    "synth": (255, 120, 220),
    "bass": (120, 255, 160),
    "drums": (255, 200, 80),
    "guitar": (255, 160, 100),
    "strings": (180, 220, 255),
    "violin": (255, 180, 200),
}


def should_reveal_instruments(text: str) -> bool:
    """True when the user asks for / mentions the instruments step."""
    lower = text.lower()
    return "instrument" in lower or "instruments" in lower


@dataclass
class InstrumentCard:
    instrument_id: str
    display_name: str
    pop_t: float = 0.0  # 0..1 animation
    added_at: float = field(default_factory=time.time)


class SetupVoiceUI:
    """OpenCV + STT state for setup intent."""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.cards: list[InstrumentCard] = []
        self.panel_visible = False
        self.mood = ""
        self.caption = ""
        self.status = "Say your mood, or say \"instruments\" to choose parts"
        self._last_applied_transcript = ""
        self._listener: SpeechListener | None = None

    def _on_partial(self, update: TranscriptUpdate) -> None:
        self._handle_transcript(update.text, final=False)

    def _on_committed(self, update: TranscriptUpdate) -> None:
        self._handle_transcript(update.text, final=True)

    def _handle_transcript(self, text: str, *, final: bool) -> None:
        if not text.strip():
            return
        self.caption = text.strip()
        if self._listener:
            full = self._listener.full_transcript
            if self._listener.partial_text:
                self.caption = f"{full} {self._listener.partial_text}".strip()

        combined = (self._listener.full_transcript if self._listener else "") + " " + text
        combined = combined.strip()

        if should_reveal_instruments(combined):
            self.panel_visible = True
            self.status = "Name instruments (trumpet, bass, piano…) — they appear below"

        mood, instruments = parse_transcript(combined)
        if mood:
            self.mood = mood

        for inst in instruments:
            self._add_card(inst)

        if final and combined != self._last_applied_transcript:
            self._last_applied_transcript = combined
            apply_intent_from_transcript(
                self.session_id,
                combined,
                source="elevenlabs",
            )
            try:
                comp = load_composition(self.session_id)
                self.mood = comp.mood
                self._sync_cards_from_comp(comp)
            except Exception:
                pass
            self.status = "Listening… (Q = continue to hum recording)"

    def _sync_cards_from_comp(self, comp: Composition) -> None:
        existing = {c.instrument_id for c in self.cards}
        for track in comp.tracks:
            if track.instrument not in existing:
                self._add_card(track.instrument)

    def _add_card(self, instrument_id: str) -> None:
        key = instrument_id.strip().lower()
        if any(c.instrument_id == key for c in self.cards):
            return
        name = key.replace("_", " ").title()
        self.cards.append(InstrumentCard(instrument_id=key, display_name=name, pop_t=0.0))
        self.panel_visible = True

    def tick_animations(self) -> None:
        for card in self.cards:
            if card.pop_t < 1.0:
                card.pop_t = min(1.0, card.pop_t + 0.12)

    def draw(self, frame: np.ndarray) -> np.ndarray:
        self.tick_animations()
        out = frame.copy()
        overlay = out.copy()
        cv2.rectangle(overlay, (0, 0), (FRAME_W, FRAME_H), (18, 14, 28), -1)
        cv2.addWeighted(overlay, 0.55, out, 0.45, 0, out)

        cv2.putText(
            out,
            "SETUP — Voice",
            (24, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (0, 255, 200),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            out,
            self.status,
            (24, 78),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (200, 200, 220),
            1,
            cv2.LINE_AA,
        )
        if self.mood:
            cv2.putText(
                out,
                f"Mood: {self.mood}",
                (24, 108),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 220, 120),
                2,
                cv2.LINE_AA,
            )

        if self.caption:
            cv2.rectangle(out, (20, 130), (FRAME_W - 20, 190), (40, 35, 55), -1)
            cv2.putText(
                out,
                self.caption[:90],
                (32, 168),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (240, 240, 255),
                1,
                cv2.LINE_AA,
            )

        if self.panel_visible:
            cv2.putText(
                out,
                "Instruments",
                (24, 240),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )
            self._draw_instrument_cards(out)
        else:
            cv2.putText(
                out,
                'Tip: say "instruments" to show parts',
                (24, 260),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (140, 140, 160),
                1,
                cv2.LINE_AA,
            )

        cv2.putText(
            out,
            "Q = next step (hum)   |   keep speaking to add instruments",
            (24, FRAME_H - 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (160, 160, 180),
            1,
            cv2.LINE_AA,
        )
        return out

    def _draw_instrument_cards(self, frame: np.ndarray) -> None:
        if not self.cards:
            cv2.putText(
                frame,
                "(none yet — try: trumpet, bass, piano)",
                (40, 320),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (150, 150, 170),
                1,
                cv2.LINE_AA,
            )
            return

        n = len(self.cards)
        card_w, card_h = 200, 220
        gap = 24
        total_w = n * card_w + (n - 1) * gap
        start_x = max(24, (FRAME_W - total_w) // 2)
        base_y = 280

        for i, card in enumerate(self.cards):
            ease = math.sin(card.pop_t * math.pi / 2)  # pop-in ease
            scale = 0.3 + 0.7 * ease
            w = int(card_w * scale)
            h = int(card_h * scale)
            x = start_x + i * (card_w + gap) + (card_w - w) // 2
            y = base_y + int((card_h - h) * (1 - ease))

            color = _INSTRUMENT_COLORS.get(card.instrument_id, (180, 180, 255))
            shadow = (x + 6, y + 8)
            cv2.rectangle(
                frame,
                (shadow[0], shadow[1]),
                (shadow[0] + w, shadow[1] + h),
                (10, 8, 20),
                -1,
            )
            cv2.rectangle(frame, (x, y), (x + w, y + h), color, -1)
            cv2.rectangle(frame, (x, y), (x + w, y + h), (255, 255, 255), 2)

            label = card.display_name
            font_scale = 0.65 * scale + 0.2
            (tw, th), _ = cv2.getTextSize(
                label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 2
            )
            tx = x + (w - tw) // 2
            ty = y + h // 2 + th // 2
            cv2.putText(
                frame,
                label,
                (tx, ty),
                cv2.FONT_HERSHEY_SIMPLEX,
                font_scale,
                (20, 20, 30),
                2,
                cv2.LINE_AA,
            )
            icon_y = y + int(h * 0.28)
            cv2.circle(frame, (x + w // 2, icon_y), int(22 * scale), (255, 255, 255), 2)


def run_voice_setup_intent(session_id: str, *, use_camera: bool = True) -> Composition:
    """
    Listen via ElevenLabs STT; show instruments on screen when user says
    \"instruments\" or names parts. Persists mood + tracks[] via intent agent.
    """
    ui = SetupVoiceUI(session_id)
    listener = SpeechListener(
        on_partial=ui._on_partial,
        on_committed=ui._on_committed,
    )
    ui._listener = listener
    listener.start()

    cap = cv2.VideoCapture(0) if use_camera else None
    if cap is not None and not cap.isOpened():
        cap = None

    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW_NAME, FRAME_W, FRAME_H)

    blank = np.zeros((FRAME_H, FRAME_W, 3), dtype=np.uint8)
    blank[:] = (22, 18, 32)

    try:
        while True:
            if cap is not None:
                ret, frame = cap.read()
                if ret:
                    frame = cv2.flip(cv2.resize(frame, (FRAME_W, FRAME_H)), 1)
                else:
                    frame = blank.copy()
            else:
                frame = blank.copy()

            display = ui.draw(frame)
            cv2.imshow(WINDOW_NAME, display)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        listener.stop()
        if cap is not None:
            cap.release()
        cv2.destroyAllWindows()

    transcript = listener.full_transcript.strip()
    if transcript:
        return apply_intent_from_transcript(
            session_id, transcript, source="elevenlabs"
        )
    comp = load_composition(session_id)
    if comp.tracks:
        return comp
    return apply_intent_from_transcript(
        session_id, "upbeat synth bass", source="hardcoded"
    )
