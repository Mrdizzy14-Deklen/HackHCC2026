# HackHCC2026

Multimodal music pipeline (v1): **setup** (intent → hum → pitch) then **conduct** (MediaPipe hands → pitch/tempo).

**Contract:** [docs/CONTRACT.md](docs/CONTRACT.md) — `composition.json` fields and which agent writes what.

## Voice input

All interactive prompts use **ElevenLabs STT** (no keyboard `input()`). Say your answer, then **"done"**, **"next"**, or **"finished"**. Hum capture uses **"ready"**, **"start"**, or **"go"** to begin recording.

Requires `ELEVENLABS_API_KEY` in `.env`.

## Quick start

```bash
cd HackHCC2026
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Full setup (voice prompts for mood/instruments, record hums, detect pitch) + conduct
python run.py setup -s mysong
python run.py conduct -s mysong

# ElevenLabs full setup: voice intent → hum → pitch (instruments pop up on screen)
python run.py setup-voice -s mysong
python run.py setup -s mysong --voice   # same pipeline via `setup`

# Intent only (headless STT), then hum + pitch separately:
python run.py setup-intent -s mysong --elevenlabs
python run.py setup-hum -s mysong
python run.py setup-pitch -s mysong

# Or intent + hum + pitch in one go:
python run.py setup-intent -s mysong --elevenlabs --continue

# Non-interactive setup (no mic prompts for intent)
python run.py setup -s mysong --mood upbeat --instruments trumpet,bass

# Dev: skip hum/pitch, go straight to conduct
python run.py demo --stub
```

## Setup pipeline

| Step | Command | Agent writes |
|------|---------|----------------|
| 1. Intent | `setup` (prompts) or `setup-intent` | `mood`, `tracks[]`, `intent.*` |
| 2. Hum | `setup-hum` (or part of `setup`) | `hums/*.wav`, `tracks[].hum_path` |
| 3. Pitch | `setup-pitch` (or part of `setup`) | `tracks[].notes`, `bpm`, `key` |
| Gate | auto on save | `setup_complete`, `allow_conduct` |

Conduct only runs when **hums + pitch** exist on every track (unless `--stub`).

## ElevenLabs (teammate)

```bash
export ELEVENLABS_API_KEY=your_key
python run.py new -s mysong
python examples/elevenlabs_intent_hook.py -s mysong --continue   # voice → intent → hum → pitch
```

Or in code:

```python
from hackhcc.phases.setup.intent import apply_intent_from_transcript
apply_intent_from_transcript("mysong", transcript, source="elevenlabs")
```

## Conduct controls

| Action | Effect |
|--------|--------|
| Raise hand / index finger | Higher pitch (semitones) |
| Open hand | Faster tempo + style label |
| **Q** | Quit |
| **S** | Save session |

## CLI reference

```bash
python run.py new -s ID
python run.py setup -s ID
python run.py setup-intent -s ID --mood upbeat --instruments trumpet,bass
python run.py setup-intent -s ID --transcript "upbeat song add trumpet"
python run.py setup-hum -s ID
python run.py setup-pitch -s ID
python run.py conduct -s ID
python run.py status -s ID
python run.py setup -s ID --stub          # dev: force conduct
python run.py demo --stub                 # stub + conduct
```

## Project layout

```text
HackHCC2026/
├── docs/CONTRACT.md
├── run.py
├── hackhcc/
│   ├── composition.py      # schema, gates, save/load
│   ├── orchestrator.py
│   ├── phases/
│   │   ├── setup/          # intent, hum, pitch, runner
│   │   └── conduct.py
│   ├── vision/
│   ├── audio/
│   └── stt/
├── sessions/<id>/          # gitignored
│   ├── composition.json
│   ├── intent.json
│   └── hums/*.wav
└── examples/
    ├── elevenlabs_intent_hook.py
    └── stt_example.py
```

## Legacy

`python main.py` → conduct only (requires `allow_conduct`).
