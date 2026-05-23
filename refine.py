#!/usr/bin/env python3
"""
refine.py — Polish an existing exported WAV.

Tries Replicate MusicGen first; if the model is unavailable (it was deprecated
in 2025) falls back to a local mastering chain that still significantly improves
the output: high-pass filter, dynamic compression, warmth EQ, soft limiting,
and loudness normalisation.

Usage:
    python refine.py mysong
    python refine.py mysong --mood jazz --duration 45
    python refine.py mysong --prompt "orchestral, cinematic, all instruments in harmony"
"""
from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample

EXPORTS_DIR = Path(__file__).resolve().parent / "exports"
TARGET_SR   = 44_100
DEFAULT_PROMPT = (
    "professional studio recording, full band arrangement, "
    "all instruments balanced and in sync, cohesive, polished master, "
    "clean mix, {mood}, no vocals"
)


def _load_wav(path: Path) -> tuple[np.ndarray, int]:
    sr, data = wavfile.read(str(path))
    if data.dtype == np.int16:
        audio = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        audio = data.astype(np.float32) / 2_147_483_648.0
    else:
        audio = data.astype(np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != TARGET_SR and len(audio) > 0:
        n = max(1, int(len(audio) * TARGET_SR / sr))
        audio = resample(audio, n).astype(np.float32)
    return audio, TARGET_SR


def _save_wav(path: Path, audio: np.ndarray) -> None:
    peak = float(np.max(np.abs(audio))) or 1.0
    out  = np.clip(audio / peak * 0.92, -1.0, 1.0)
    wavfile.write(str(path), TARGET_SR, (out * 32767).astype(np.int16))


def _try_musicgen(
    input_path: Path,
    output_path: Path,
    *,
    mood: str,
    duration: int,
    prompt: str | None,
) -> bool:
    """Attempt Replicate MusicGen; return True on success, False otherwise."""
    import os
    token = (os.getenv("REPLICATE_API_TOKEN") or "").strip()
    if not token:
        print("  REPLICATE_API_TOKEN not set — skipping cloud refinement")
        return False
    try:
        import replicate
    except ImportError:
        print("  replicate not installed — skipping cloud refinement")
        return False

    final_prompt = prompt or DEFAULT_PROMPT.format(mood=mood)
    print(f"  Prompt: {final_prompt}")
    print(f"  Calling Replicate MusicGen (stereo-melody-large, {duration}s)...")

    try:
        model   = replicate.models.get("meta/musicgen")
        version = model.latest_version
        print(f"  Using version: {version.id[:16]}...")
        with input_path.open("rb") as f:
            output = replicate.run(
                f"meta/musicgen:{version.id}",
                input={
                    "prompt": final_prompt,
                    "melody": f,
                    "model_version": "stereo-melody-large",
                    "duration": duration,
                    "normalization_strategy": "loudness",
                },
            )
    except Exception as exc:
        print(f"  MusicGen unavailable ({type(exc).__name__}): {exc}")
        print("  Falling back to local mastering.")
        return False

    out_url = str(output) if not isinstance(output, list) else str(output[0])
    if out_url.startswith("http"):
        urllib.request.urlretrieve(out_url, str(output_path))
    else:
        import shutil
        shutil.copy(out_url, str(output_path))

    return True


def refine_wav(
    input_path: Path,
    output_path: Path,
    *,
    mood: str = "upbeat",
    duration: int = 30,
    prompt: str | None = None,
) -> Path:
    print(f"Input : {input_path}")
    print(f"Output: {output_path}")

    if _try_musicgen(input_path, output_path, mood=mood, duration=duration, prompt=prompt):
        print(f"\nDone (cloud)! Refined audio -> {output_path}")
        return output_path

    # Local mastering fallback
    print("  Applying local mastering chain (compression + EQ + limiting)...")
    from hackhcc.audio.master import master_audio
    audio, sr = _load_wav(input_path)
    mastered  = master_audio(audio, sr)
    _save_wav(output_path, mastered)
    print(f"\nDone (local master)! -> {output_path}")
    print(f"  Play: aplay {output_path}  (or open in any audio player)")
    return output_path


def main() -> None:
    from hackhcc.env import load_project_env
    load_project_env()

    parser = argparse.ArgumentParser(description="Refine an exported WAV")
    parser.add_argument("session", help="Session ID (e.g. mysong)")
    parser.add_argument("--mood",     default="upbeat")
    parser.add_argument("--duration", type=int, default=30)
    parser.add_argument("--prompt",   default=None)
    parser.add_argument("--input",    default=None)
    args = parser.parse_args()

    input_path = Path(args.input) if args.input else EXPORTS_DIR / f"{args.session}.wav"
    if not input_path.is_file():
        print(f"ERROR: {input_path} not found")
        print(f"  Available exports: {list(EXPORTS_DIR.glob('*.wav'))}")
        sys.exit(1)

    output_path = input_path.with_stem(input_path.stem + "_refined")
    refine_wav(input_path, output_path, mood=args.mood, duration=args.duration, prompt=args.prompt)


if __name__ == "__main__":
    main()
