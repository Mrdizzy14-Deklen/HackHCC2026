# HackHCC2026

Hum a melody → get instrument stems → **conduct** the mix with your hands.

## Setup

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # ELEVENLABS_API_KEY for voice prompts
sudo dnf install fluidsynth   # better piano stems (Fedora)
```

## Run (two steps)

```bash
# 1 — mood, instruments, hum, pitch, render stems (5s instrument per part, looped to 30s at mix)
python 1_setup.py -s mysong --text --mood upbeat --instruments piano

# 2 — camera: raise hand = pitch up, open hand = tempo up (Q quit, S save)
python 2_conduct.py
```

Step 1 saves the session name; step 2 picks it up automatically.

### Voice instead of typing

```bash
python 1_setup.py -s mysong
python 2_conduct.py
```

### Optional flags (step 1)

| Flag | Effect |
|------|--------|
| `--text` | Type mood/instruments instead of voice |
| `--musicgen` | Cloud stems via Replicate (`REPLICATE_API_TOKEN` in `.env`) |
| `--no-render` | Skip stems; conduct uses raw hums |

## What gets saved

```text
sessions/mysong/
  composition.json    # mood, tracks, notes, flags
  hums/*.wav          # your humming
  stems/*.wav         # rendered instruments (conduct plays these)
```

Details: [docs/CONTRACT.md](docs/CONTRACT.md)

## Project layout

```text
1_setup.py          # step 1
2_conduct.py          # step 2
hackhcc/              # app code
  phases/setup/       # intent, hum, pitch, render
  phases/conduct.py   # MediaPipe + audio
  audio/              # stems playback, piano render
  vision/             # hand tracking
  stt/                # ElevenLabs voice
assets/               # templates, soundfont (auto-download)
docs/CONTRACT.md
```

## Extra CLI (optional)

```bash
python run.py status -s mysong
python run.py render-stems -s mysong
```

## Not committed (gitignored)

`.env`, `venv/`, `sessions/`, `models/`, `.active_session`, `assets/soundfonts/*.sf2`
