"""Conduct phase — five-stage performance pipeline.

  edit          → 5 gesture zones; make a FIST to save intensities & generate
  mixing        → background stem mix (fast, local)
  refining      → Replicate MusicGen AI refinement of the mix (~30–60 s)
  playback_once → plays refined audio once (press SPACE to skip)
  conduct       → global pitch/tempo; E to export; SPACE back to edit

Fist detection: hold openness < 0.15 for ~20 frames → triggers the chain.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp_lib
import numpy as np
import sounddevice as sd
from scipy.io import wavfile
from scipy.signal import resample

from hackhcc.audio.mixer import mix_stems
from hackhcc.audio.multitrack import MultiTrackAudioEngine
from hackhcc.audio.playback import ConductStemPlayback
from hackhcc.composition import (
    Composition,
    ConductParams,
    Phase,
    load_composition,
    resolve_session_path,
    save_composition,
    session_dir,
)
from hackhcc.vision.gestures import gesture_to_conduct, gestures_from_landmarks
from hackhcc.vision.hands import create_hand_landmarker, draw_hands

WINDOW_NAME = "HackHCC — Conduct"
EXPORT_DIR = Path(__file__).resolve().parent.parent.parent / "exports"

INSTRUMENT_ZONE_ORDER = ["piano", "trumpet", "violin", "flute", "drums"]
_ZONE_COLOR: dict[str, tuple[int, int, int]] = {
    "piano":   (200, 140,  50),
    "trumpet": ( 40, 180, 255),
    "violin":  ( 40, 200,  90),
    "flute":   (210,  70, 220),
    "drums":   ( 60,  80, 255),
}
_DEFAULT_COLOR: tuple[int, int, int] = (140, 140, 140)

ZONE_STRIP_H     = 130
TARGET_SR        = 44_100
FIST_THRESHOLD   = 0.25   # hand_openness < this = fist  (raised for easier detection)
FIST_HOLD_FRAMES = 15     # frames to hold fist (~0.5 s at 30 fps)
GEN_DURATION_SEC = 30


# ─── misc helpers ──────────────────────────────────────────────────────────────

def _zone_color(tid: str) -> tuple[int, int, int]:
    return _ZONE_COLOR.get(tid.lower(), _DEFAULT_COLOR)


def _get_stem_list(comp: Composition) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for t in comp.tracks:
        if t.stem_path:
            p = resolve_session_path(comp.session_id, t.stem_path)
            if p.is_file():
                out.append((t.id, str(p)))
    return out


def _ordered_ids(comp: Composition, stems: list[tuple[str, str]]) -> list[str]:
    present = {tid for tid, _ in stems}
    ordered = [i for i in INSTRUMENT_ZONE_ORDER if i in present]
    for tid in present:
        if tid not in ordered:
            ordered.append(tid)
    return ordered


def _load_wav_mono(path: str) -> np.ndarray:
    sr, data = wavfile.read(path)
    if data.dtype == np.int16:
        audio = data.astype(np.float32) / 32768.0
    else:
        audio = data.astype(np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != TARGET_SR:
        n = max(1, int(len(audio) * TARGET_SR / sr))
        audio = resample(audio, n).astype(np.float32)
    return audio


# ─── AI refinement ─────────────────────────────────────────────────────────────

def _call_refinement_api(mix_path: str, mood: str, out_path: str) -> str:
    """Polish mix.wav: tries Replicate MusicGen, falls back to local mastering."""
    token = (os.getenv("REPLICATE_API_TOKEN") or "").strip()
    if token:
        try:
            import replicate
            print(f"  [refine] Sending to MusicGen (melody-conditioned, {GEN_DURATION_SEC}s)...")
            version = replicate.models.get("meta/musicgen").latest_version
            with open(mix_path, "rb") as f:
                output = replicate.run(
                    f"meta/musicgen:{version.id}",
                    input={
                        "prompt": (
                            f"professional studio mix, {mood}, polished, full arrangement, "
                            "all instruments balanced, high quality, clean mastered sound"
                        ),
                        "melody": f,
                        "model_version": "stereo-melody-large",
                        "duration": GEN_DURATION_SEC,
                        "normalization_strategy": "loudness",
                    },
                )
            out_url = str(output) if not isinstance(output, list) else str(output[0])
            if out_url.startswith("http"):
                urllib.request.urlretrieve(out_url, out_path)
            else:
                import shutil
                shutil.copy(out_url, out_path)
            print(f"  [refine] -> {out_path}")
            return out_path
        except Exception as exc:
            print(f"  [refine] Cloud unavailable ({type(exc).__name__}) — using local mastering")

    # Local mastering fallback (compression + EQ + limiting)
    print("  [refine] Applying local mastering chain...")
    from hackhcc.audio.master import master_audio
    audio = _load_wav_mono(mix_path)
    mastered = master_audio(audio, TARGET_SR)
    peak = float(np.max(np.abs(mastered))) or 1.0
    mastered = np.clip(mastered / peak * 0.92, -1.0, 1.0)
    from scipy.io import wavfile as _wf
    _wf.write(out_path, TARGET_SR, (mastered * 32767).astype(np.int16))
    print(f"  [refine] -> {out_path} (local master)")
    return out_path


# ─── drawing ───────────────────────────────────────────────────────────────────

def _draw_zone_strip(
    frame: np.ndarray,
    track_ids: list[str],
    volumes: dict[str, float],
    muted: dict[str, bool],
    active_zone: int,
) -> None:
    h, w = frame.shape[:2]
    n = len(track_ids)
    if not n:
        return
    zone_w = w // n
    sy = h - ZONE_STRIP_H
    cv2.rectangle(frame, (0, sy), (w, h), (18, 18, 18), -1)
    cv2.line(frame, (0, sy), (w, sy), (70, 70, 70), 1)
    for i, tid in enumerate(track_ids):
        x0, x1 = i * zone_w, (i + 1) * zone_w - 1
        col = _zone_color(tid)
        active = i == active_zone
        is_muted = muted.get(tid, False)
        vol = volumes.get(tid, 1.0)
        cv2.rectangle(frame, (x0+2, sy+3), (x1-2, h-3), col if active else (45,45,45), 2 if active else 1)
        bar_max_h = ZONE_STRIP_H - 42
        bw, bx = 10, x0 + zone_w//2 - 5
        by = sy + 18
        cv2.rectangle(frame, (bx, by), (bx+bw, by+bar_max_h), (45,45,45), -1)
        if not is_muted and vol > 0:
            filled = max(1, int(vol * bar_max_h))
            cv2.rectangle(frame, (bx, by+bar_max_h-filled), (bx+bw, by+bar_max_h), col, -1)
        lc = (80,80,80) if is_muted else (215,215,215)
        label = f"[{tid[:6].upper()}]" if is_muted else tid[:7].upper()
        cv2.putText(frame, label,  (x0+5, h-8),            cv2.FONT_HERSHEY_SIMPLEX, 0.42, lc, 1, cv2.LINE_AA)
        cv2.putText(frame, "MUTE" if is_muted else f"{int(vol*100)}%",
                    (bx-3, by+bar_max_h+13), cv2.FONT_HERSHEY_SIMPLEX, 0.35, lc, 1, cv2.LINE_AA)
        if i < n - 1:
            cv2.line(frame, (x1+1, sy), (x1+1, h), (60,60,60), 1)


def _draw_fist_ring(
    frame: np.ndarray, wx_n: float, wy_n: float, frames: int, hold: int
) -> None:
    h, w = frame.shape[:2]
    cx, cy = int(wx_n * w), int(wy_n * h)
    frac = frames / hold
    cv2.circle(frame, (cx, cy), 34, (50,50,50), 2)
    if frac > 0:
        cv2.ellipse(frame, (cx, cy), (34, 34), -90, 0, int(frac * 360), (0, 255, 180), 3)
    cv2.putText(frame, f"{int(frac*100)}%", (cx-14, cy+5), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0,255,180), 1, cv2.LINE_AA)


def _draw_edit_hud(
    frame: np.ndarray,
    active_zone: int,
    track_ids: list[str],
    fist_frames: int,
    openness: float = -1.0,
) -> None:
    lines = [
        "STAGE 1: EDIT INSTRUMENTS",
        "Wrist X=zone | Hand height=volume | M=mute | Make FIST to save+generate",
    ]
    y = 28
    for i, text in enumerate(lines):
        col = (0, 255, 180) if i == 0 else (190, 190, 190)
        cv2.putText(frame, text, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.65 if i == 0 else 0.51, col, 1+(i==0), cv2.LINE_AA)
        y += 28

    if 0 <= active_zone < len(track_ids):
        tid = track_ids[active_zone]
        cv2.putText(frame, f"Editing: {tid.upper()}", (12, 82), cv2.FONT_HERSHEY_SIMPLEX, 0.6, _zone_color(tid), 2, cv2.LINE_AA)

    # Live openness debug — shows user how closed the hand is
    if openness >= 0:
        status = "FIST!" if openness < FIST_THRESHOLD else f"open ({openness:.2f})"
        col = (0, 255, 180) if openness < FIST_THRESHOLD else (160, 160, 160)
        cv2.putText(frame, f"Hand: {status}  need < {FIST_THRESHOLD:.2f}", (12, 112),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.52, col, 1, cv2.LINE_AA)

    if fist_frames > 0:
        pct = int(fist_frames / FIST_HOLD_FRAMES * 100)
        cv2.putText(frame, f"Hold fist... {pct}%", (12, 138),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.62, (0, 255, 180), 2, cv2.LINE_AA)


def _draw_loading(frame: np.ndarray, message: str, t_start: float, color=(0,220,160)) -> None:
    h, w = frame.shape[:2]
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, h), (8, 8, 8), -1)
    cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)
    elapsed = time.time() - t_start
    cx, cy = w // 2, h // 2 - 30
    angle = int((elapsed * 100) % 360)
    cv2.ellipse(frame, (cx, cy), (46, 46), angle,   0,  80, color, 4)
    cv2.ellipse(frame, (cx, cy), (46, 46), angle+180, 0, 80, color, 4)
    (tw, _), _ = cv2.getTextSize(message, cv2.FONT_HERSHEY_SIMPLEX, 0.72, 2)
    cv2.putText(frame, message, (w//2 - tw//2, cy+90), cv2.FONT_HERSHEY_SIMPLEX, 0.72, color, 2, cv2.LINE_AA)
    cv2.putText(frame, f"{elapsed:.0f}s", (w//2-18, cy+125), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (140,140,140), 1, cv2.LINE_AA)


def _draw_playback_bar(frame: np.ndarray, progress: float) -> None:
    h, w = frame.shape[:2]
    msg = "Listening to your composition..."
    (tw, _), _ = cv2.getTextSize(msg, cv2.FONT_HERSHEY_SIMPLEX, 0.72, 2)
    cv2.putText(frame, msg, (w//2 - tw//2, 46), cv2.FONT_HERSHEY_SIMPLEX, 0.72, (0,220,160), 2, cv2.LINE_AA)
    cv2.putText(frame, "SPACE to skip", (w//2 - 62, 76), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (140,140,140), 1, cv2.LINE_AA)
    bx, by, bar_w = 80, h - 30, w - 160
    cv2.rectangle(frame, (bx, by-8), (bx+bar_w, by+8), (50,50,50), -1)
    filled = int(progress * bar_w)
    if filled > 0:
        cv2.rectangle(frame, (bx, by-8), (bx+filled, by+8), (0,220,160), -1)


def _draw_conduct_hud(
    frame: np.ndarray, params: ConductParams, fps: float, hands: int
) -> None:
    lines = [
        "STAGE 2: GLOBAL CONDUCT",
        f"Pitch: {params.pitch_shift_semitones:+.1f} st   Tempo: {params.tempo_multiplier:.2f}x   Style: {params.style_preset}",
        "Hand height=pitch | Open hand=tempo | E=export | SPACE=back | Q=quit+export",
        f"FPS {int(fps)}   Hands {hands}",
    ]
    y = 28
    for i, text in enumerate(lines):
        col = (255, 165, 0) if i == 0 else (190,190,190)
        cv2.putText(frame, text, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.65 if i == 0 else 0.51, col, 2 if i == 0 else 1, cv2.LINE_AA)
        y += 28
    bx, by, bh = 18, 118, 160
    cv2.rectangle(frame, (bx, by), (bx+14, by+bh), (55,55,55), 1)
    cx = by + bh // 2
    off = int((params.pitch_shift_semitones / 12.0) * (bh//2))
    off = max(-bh//2, min(bh//2, off))
    cv2.line(frame, (bx+7, cx), (bx+7, cx-off), (0,200,255), 3)
    cv2.putText(frame, "pitch", (bx-2, by+bh+16), cv2.FONT_HERSHEY_SIMPLEX, 0.37, (130,130,130), 1)


# ─── volume persistence ────────────────────────────────────────────────────────

def _volumes_path(session_id: str) -> Path:
    return session_dir(session_id) / "volumes.json"


def _save_volumes(session_id: str, volumes: dict[str, float], muted: dict[str, bool]) -> None:
    data = {"volumes": volumes, "muted": muted}
    with _volumes_path(session_id).open("w") as f:
        json.dump(data, f, indent=2)


def _load_volumes(session_id: str, track_ids: list[str]) -> tuple[dict[str, float], dict[str, bool]]:
    vols  = {tid: 1.0  for tid in track_ids}
    muted = {tid: False for tid in track_ids}
    p = _volumes_path(session_id)
    if p.exists():
        try:
            data = json.loads(p.read_text())
            for tid in track_ids:
                if tid in data.get("volumes", {}):
                    vols[tid]  = float(data["volumes"][tid])
                if tid in data.get("muted", {}):
                    muted[tid] = bool(data["muted"][tid])
            print(f"  [conduct] Restored saved volumes from {p.name}")
        except Exception:
            pass
    return vols, muted


# ─── export helper ─────────────────────────────────────────────────────────────

def _export_audio(
    refined_path: str,
    params: ConductParams,
    session_id: str,
) -> str:
    """Export refined audio to exports/<session>.wav.

    Skips librosa pitch/tempo (too memory-heavy for 30 s files; the conduct
    loop already applied those perceptually via rate-based playback).
    Applies the lightweight mastering chain instead.
    """
    print("\n  Exporting... (applying mastering)")
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    out = str(EXPORT_DIR / f"{session_id}.wav")

    audio = _load_wav_mono(refined_path)

    from hackhcc.audio.master import master_audio
    audio = master_audio(audio, TARGET_SR)

    peak = float(np.max(np.abs(audio))) or 1.0
    audio = np.clip(audio / peak * 0.92, -1.0, 1.0)
    wavfile.write(out, TARGET_SR, (audio * 32767).astype(np.int16))
    print(f"  Exported -> {out}")
    return out


# ─── main ──────────────────────────────────────────────────────────────────────

def run_conduct(session_id: str, *, enable_audio: bool = True) -> Composition:
    comp = load_composition(session_id)
    if not comp.flags.get("allow_conduct"):
        raise RuntimeError(f"Session {session_id} not ready — run setup first.")

    comp.phase = Phase.CONDUCT.value
    save_composition(comp)

    stem_list  = _get_stem_list(comp)
    track_ids  = _ordered_ids(comp, stem_list)
    n_zones    = len(track_ids)
    mood       = comp.mood or "upbeat"
    session_bpm = comp.bpm or 0   # used for BPM normalisation at mix time

    volumes, muted = _load_volumes(session_id, track_ids)
    active_zone    = 0
    conduct_params = ConductParams()

    stage        = "edit"
    stage_start  = time.time()
    fist_frames  = 0
    fist_locked  = False

    # Paths (filled in as the pipeline progresses)
    mix_path:     str = ""
    refined_path: str = ""

    # Background thread state
    bg_thread: threading.Thread | None = None
    bg_result: list = [None]   # bg_result[0] = return value
    bg_error:  list = [None]   # bg_error[0]  = error string

    # Playback state
    playback_done   = threading.Event()
    playback_start  = 0.0
    playback_dur    = 0.0
    refined_audio: np.ndarray | None = None

    # Audio engines
    mt_engine:   MultiTrackAudioEngine | None = None
    loop_engine: ConductStemPlayback   | None = None

    # ── audio helpers ──────────────────────────────────────────────────────────

    def start_edit_audio() -> None:
        nonlocal mt_engine
        if not enable_audio or not stem_list:
            return
        try:
            mt_engine = MultiTrackAudioEngine(stem_list)
            mt_engine.start()
            for tid in track_ids:
                v = 0.0 if muted.get(tid) else volumes.get(tid, 1.0)
                mt_engine.set_volume(tid, v)
        except Exception as exc:
            print(f"  [audio] multitrack: {exc}")
            mt_engine = None

    def stop_edit_audio() -> None:
        nonlocal mt_engine
        if mt_engine:
            mt_engine.stop()
            mt_engine = None

    def start_loop_audio(path: str) -> None:
        nonlocal loop_engine
        if not enable_audio or not path:
            return
        try:
            buf = _load_wav_mono(path)
            loop_engine = ConductStemPlayback([buf], track_ids=["refined"], source="refined")
            loop_engine.start()
        except Exception as exc:
            print(f"  [audio] loop: {exc}")
            loop_engine = None

    def stop_loop_audio() -> None:
        nonlocal loop_engine
        if loop_engine:
            loop_engine.stop()
            loop_engine = None

    # ── background task runner ─────────────────────────────────────────────────

    def run_bg(fn, *args, **kwargs) -> threading.Thread:
        bg_result[0] = None
        bg_error[0]  = None
        def _worker():
            try:
                bg_result[0] = fn(*args, **kwargs)
            except Exception as exc:
                bg_error[0] = str(exc)
                print(f"  [bg] {exc}")
        t = threading.Thread(target=_worker, daemon=True)
        t.start()
        return t

    # ── camera setup ───────────────────────────────────────────────────────────

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Cannot open camera (index 0)")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW_NAME, 1280, 720)

    print("Loading MediaPipe hand landmarker...")
    landmarker = create_hand_landmarker()
    print(f"Conduct ready — {n_zones} instrument zones: {track_ids}")
    print("  ✊  Make a FIST (hold ~1 s) to save intensities and send to AI")

    start_time = time.time()
    prev_time  = 0.0
    wx_n = wy_n = 0.5   # wrist position (normalised), updated each frame

    start_edit_audio()

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]

            # ── hand detection ─────────────────────────────────────────────────
            hand_count = 0
            gesture    = None
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_img  = mp_lib.Image(image_format=mp_lib.ImageFormat.SRGB, data=rgb)
            ts_ms   = int((time.time() - start_time) * 1000)
            result  = landmarker.detect_for_video(mp_img, ts_ms)

            if result.hand_landmarks:
                hand_count = len(result.hand_landmarks)
                primary    = result.hand_landmarks[0]
                wrist      = primary[0]
                wx_n, wy_n = wrist.x, wrist.y
                gesture    = gestures_from_landmarks(primary)
                rgb        = draw_hands(rgb, result)

            frame = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

            # ── stage machine ──────────────────────────────────────────────────

            if stage == "edit":
                if gesture and n_zones > 0:
                    # Zone select + volume control
                    active_zone = max(0, min(n_zones - 1, int(wx_n * n_zones)))
                    tid = track_ids[active_zone]
                    vol = max(0.0, min(1.0, 1.0 - wy_n))
                    if not muted[tid]:
                        volumes[tid] = vol
                        if mt_engine:
                            mt_engine.set_volume(tid, vol)

                    # Fist detection
                    if gesture.hand_openness < FIST_THRESHOLD and not fist_locked:
                        fist_frames += 1
                        if fist_frames >= FIST_HOLD_FRAMES:
                            print("\n  Fist! Saving intensities -> mixing stems...")
                            fist_frames = 0
                            fist_locked = True
                            _save_volumes(session_id, volumes, muted)
                            stop_edit_audio()
                            _mix_out = str(session_dir(session_id) / "mix.wav")
                            stage = "mixing"
                            stage_start = time.time()
                            bg_thread = run_bg(
                                mix_stems, stem_list, volumes, _mix_out,
                                target_bpm=session_bpm if session_bpm > 0 else None,
                                target_duration_sec=GEN_DURATION_SEC,
                            )
                    else:
                        if gesture and gesture.hand_openness > 0.28:
                            fist_locked = False
                        fist_frames = max(0, fist_frames - 2)

                cur_openness = gesture.hand_openness if gesture else -1.0
                _draw_edit_hud(frame, active_zone, track_ids, fist_frames, cur_openness)
                _draw_zone_strip(frame, track_ids, volumes, muted, active_zone)
                if fist_frames > 0:
                    _draw_fist_ring(frame, wx_n, wy_n, fist_frames, FIST_HOLD_FRAMES)

            elif stage == "mixing":
                _draw_loading(frame, "Mixing stems...", stage_start, (80, 200, 255))
                if bg_thread and not bg_thread.is_alive():
                    mix_path    = bg_result[0] or str(session_dir(session_id) / "mix.wav")
                    _refine_out = str(session_dir(session_id) / "refined.wav")
                    stage       = "refining"
                    stage_start = time.time()
                    bg_thread   = run_bg(_call_refinement_api, mix_path, mood, _refine_out)
                    print("  Stems mixed — sending to AI refinement...")

            elif stage == "refining":
                _draw_loading(frame, f"AI is generating your music...  {time.time()-stage_start:.0f}s", stage_start)
                if bg_thread and not bg_thread.is_alive():
                    if bg_error[0]:
                        print(f"  [refine] failed: {bg_error[0]} — using mix")
                    refined_path  = bg_result[0] or mix_path
                    refined_audio = _load_wav_mono(refined_path)
                    playback_dur  = len(refined_audio) / TARGET_SR
                    playback_done.clear()
                    playback_start = time.time()

                    _audio_snap = refined_audio  # capture for thread closure
                    def _play_once() -> None:
                        sd.play(_audio_snap, samplerate=TARGET_SR)
                        sd.wait()
                        playback_done.set()

                    threading.Thread(target=_play_once, daemon=True).start()
                    stage = "playback_once"
                    print(f"  Done! Playing refined audio once ({playback_dur:.0f}s)...")

            elif stage == "playback_once":
                progress = min(1.0, (time.time() - playback_start) / max(1.0, playback_dur))
                _draw_playback_bar(frame, progress)
                if playback_done.is_set():
                    start_loop_audio(refined_path)
                    stage = "conduct"
                    print("  Entering conduct mode — hand height = pitch, open = tempo")

            elif stage == "conduct":
                if gesture:
                    pitch, tempo, style = gesture_to_conduct(gesture)
                    conduct_params = ConductParams(
                        pitch_shift_semitones=pitch,
                        tempo_multiplier=tempo,
                        style_preset=style,
                    )
                    if loop_engine:
                        loop_engine.update(pitch, tempo)
                curr = time.time()
                fps  = 1.0 / (curr - prev_time) if prev_time else 0.0
                _draw_conduct_hud(frame, conduct_params, fps, hand_count)

            prev_time = time.time()
            cv2.imshow(WINDOW_NAME, frame)
            key = cv2.waitKey(16) & 0xFF  # ~60 fps cap; longer wait = keys register reliably

            # ── key handling ───────────────────────────────────────────────────

            if key == ord("q"):
                _save_volumes(session_id, volumes, muted)
                if refined_path:
                    stop_loop_audio()
                    _export_audio(refined_path, conduct_params, session_id)
                elif mix_path:
                    _export_audio(mix_path, conduct_params, session_id)
                break

            elif key == ord("m") and stage == "edit" and 0 <= active_zone < n_zones:
                tid = track_ids[active_zone]
                muted[tid] = not muted.get(tid, False)
                if mt_engine:
                    mt_engine.set_volume(tid, 0.0 if muted[tid] else volumes[tid])
                print(f"  {tid}: {'MUTED' if muted[tid] else 'unmuted'}")

            elif key == ord(" "):
                if stage == "playback_once":
                    try:
                        sd.stop()
                    except Exception:
                        pass
                    playback_done.set()

                elif stage == "conduct":
                    stop_loop_audio()
                    _save_volumes(session_id, volumes, muted)
                    stage       = "edit"
                    fist_frames = 0
                    fist_locked = False
                    stage_start = time.time()
                    start_edit_audio()
                    print("  Back to edit -- re-adjust volumes and fist to re-generate")

            elif key == ord("e") and stage == "conduct":
                stop_loop_audio()
                _export_audio(refined_path or mix_path, conduct_params, session_id)
                comp.phase = Phase.DONE.value
                comp.flags["export_complete"] = True
                save_composition(comp)
                break

    finally:
        stop_edit_audio()
        stop_loop_audio()
        landmarker.close()
        cap.release()
        cv2.destroyAllWindows()

    comp.phase = Phase.DONE.value
    comp.flags["allow_export"] = True
    save_composition(comp)
    return comp


def run_conduct_interactive(session_id: str | None = None, **kwargs) -> Composition:
    if not session_id:
        from hackhcc.composition import DEFAULT_SESSION_ID
        session_id = DEFAULT_SESSION_ID
    return run_conduct(session_id, **kwargs)
