# HackHCC2026

Hum a melody for each instrument → get AI/local stems → **conduct** the mix with your hands → export and publish.

Two ways to use the project:

| Path | Best for |
|------|----------|
| **CLI** (`1_setup.py` + `2_conduct.py`) | Full desktop conduct studio (camera, fist trigger, AI polish) |
| **Web** (`composer-app/`) | 3D composer UI, in-browser hum/render/conduct, publish to Treble Trouble |

## Setup

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
sudo dnf install fluidsynth   # optional: better local piano stems (Fedora)
```

### Environment (`.env`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `ELEVENLABS_API_KEY` | For voice intent | Spoken mood/setup (step 1) |
| `REPLICATE_API_TOKEN` | Optional | MusicGen stems, conduct refinement, web finalize |
| `TREBLE_TROUBLE_URL` | Optional | Publish target (default `http://localhost:3000`) |

## CLI workflow

### Step 1 — Setup

Records mood, five instrument hums (~5 s each), pitch detection, and stem render. Stems match hum length; the conduct mixer loops them into a ~30 s song.

```bash
# Typed mood (instruments are always piano, trumpet, violin, flute, drums)
python 1_setup.py -s mysong --text --mood upbeat

# Voice mood via ElevenLabs
python 1_setup.py -s mysong

# Cloud stems (needs REPLICATE_API_TOKEN)
python 1_setup.py -s mysong --text --mood chill --musicgen
```

| Flag | Effect |
|------|--------|
| `--text` | Type mood instead of voice |
| `--musicgen` | Replicate MusicGen for stems (default is local piano/synth fallback) |
| `--no-render` | Skip stems; conduct falls back to raw hums |
| `--hum-seconds N` | Hum length per track (default 5) |

Step 1 writes `.active_session` so step 2 knows which session to load.

### Step 2 — Conduct

OpenCV + MediaPipe hand control over your stems.

```bash
python 2_conduct.py
python 2_conduct.py -s mysong
python 2_conduct.py --no-audio   # camera only
```

**Stages**

1. **Edit** — Five instrument zones on screen. Wrist X selects zone; hand height sets volume; `M` mutes. Hold a **fist** (~0.5 s) to save levels and start the pipeline.
2. **Mixing** — Local stem mix → `sessions/<id>/mix.wav`
3. **Refining** — MusicGen polish (or local mastering if no token)
4. **Playback** — Plays refined mix once (`SPACE` to skip)
5. **Conduct** — Global pitch/tempo; `E` export; `SPACE` back to edit; `Q` quit (exports on quit)

**Exports:** `exports/<session>.wav` (and refined variants when the pipeline runs).

### Polish an export later

```bash
python refine.py mysong
python refine.py mysong --mood jazz --prompt "orchestral, cinematic"
```

Uses MusicGen when available; otherwise a local mastering chain (EQ, compression, limiting).

### Extra CLI

```bash
python run.py status -s mysong
python run.py render-stems -s mysong
```

## Web composer (`composer-app/`)

3D scene (piano, trumpet, flute, rigged hand) wired to the same `hackhcc` session pipeline.

```bash
cd composer-app
python main.py          # FastAPI + pywebview window at http://127.0.0.1:5000

# Or API only:
uvicorn app:app --reload --port 5000
```

**In-app flow:** start session → hum each track → render stems → conduct in the browser → **master** (mix + pitch/tempo) → **finalize** (MusicGen on `master.wav` → `final.wav`) → **publish** to Treble Trouble.

Publish prefers, in order: `sessions/<id>/final.wav` → `exports/<id>.wav` → a quick stem mixdown.

## What gets saved

```text
sessions/mysong/
  composition.json       # mood, tracks, notes, flags, conduct params
  hums/*.wav             # your humming (~5 s per part)
  stems/*.wav            # rendered instruments
  mix.wav                # local mix (conduct / web master)
  final.wav              # AI-polished mix (web finalize)
  master.wav             # web master before finalize

exports/
  mysong.wav             # desktop conduct export
  mysong_refined.wav     # optional refine.py output
```

Schema and agent ownership: [docs/CONTRACT.md](docs/CONTRACT.md)

## Project layout

```text
1_setup.py              # CLI step 1
2_conduct.py            # CLI step 2
refine.py               # polish exports/mysong.wav
run.py                  # optional orchestrator CLI
hackhcc/
  phases/setup/         # intent, hum, pitch, render
  phases/conduct.py     # five-stage conduct + export
  audio/                # mixer, playback, mastering
  vision/               # MediaPipe hand tracking
  stt/                  # ElevenLabs voice
composer-app/           # FastAPI + Three.js web UI
hack-hcc-2026/          # Godot assets (teammate)
assets/                 # templates, soundfont (auto-download)
docs/CONTRACT.md
```

## Not committed (gitignored)

`.env`, `venv/`, `sessions/`, `exports/`, `models/`, `.active_session`, `assets/soundfonts/*.sf2`
