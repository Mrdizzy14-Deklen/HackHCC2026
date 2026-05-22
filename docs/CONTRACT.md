# Composition contract (v1)

`sessions/<session_id>/composition.json` is the **single source of truth**.  
Only the **orchestrator** (`hackhcc.composition.save_composition`) should merge writes.  
Specialists return **patches** or write **files under the session folder**, then call orchestrator helpers.

## Session folder layout

```text
sessions/<session_id>/
├── composition.json      # canonical document (orchestrator)
├── manifest.json         # derived snapshot (orchestrator)
├── intent.json           # optional copy of voice intent (intent agent)
├── hums/
│   ├── melody.wav        # hum capture agent
│   └── bass.wav
└── conduct_automation.jsonl   # conduct phase only
```

## `composition.json` fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | int | Schema version (currently `1`) |
| `session_id` | string | Folder name |
| `phase` | string | `setup` \| `conduct` \| `review` \| `export` \| `done` |
| `generation_mode` | string | `realize_only` (v1) |
| `bpm` | int | Tempo; pitch agent may estimate |
| `key` | string | e.g. `C`, `Am`; pitch agent may estimate |
| `mood` | string | From voice/intent (e.g. `upbeat`, `sad`) |
| `tracks[]` | array | Instruments/parts (see below) |
| `intent` | object | Voice setup metadata (see below) |
| `conduct` | object | Live conduct params (conduct runtime) |
| `flags` | object | Pipeline gates (orchestrator only) |
| `created_at` | ISO string | Session creation |

### `tracks[]` item

| Field | Type | Writer | Description |
|-------|------|--------|-------------|
| `id` | string | **intent** | Stable id (`melody`, `bass`) |
| `name` | string | **intent** | Display name |
| `instrument` | string | **intent** | e.g. `trumpet`, `synth`, `drums` |
| `role` | string | **intent** | `melody` \| `bass` \| `chords` \| `perc` |
| `hum_path` | string | **hum_capture** | Relative path, e.g. `hums/melody.wav` |
| `notes` | array | **pitch** | Detected notes (see below) |

### `notes[]` item

| Field | Type | Writer | Description |
|-------|------|--------|-------------|
| `start_ms` | int | **pitch** | Note onset in milliseconds |
| `duration_ms` | int | **pitch** | Note length |
| `midi` | int | **pitch** | MIDI note number (0–127) |
| `confidence` | float | **pitch** | 0–1 |

### `intent` object

| Field | Type | Writer | Description |
|-------|------|--------|-------------|
| `raw_transcript` | string | **intent** (ElevenLabs STT) | Full spoken setup text |
| `source` | string | **intent** | `cli` \| `elevenlabs` \| `hardcoded` |

### `conduct` object

| Field | Type | Writer | Description |
|-------|------|--------|-------------|
| `pitch_shift_semitones` | float | **conduct** | Live transpose |
| `tempo_multiplier` | float | **conduct** | Live tempo scale |
| `style_preset` | string | **conduct** | `mellow` \| `neutral` \| `bright` |

### `flags` object

| Flag | Set by | Meaning |
|------|--------|---------|
| `intent_complete` | orchestrator | Mood + ≥1 track defined |
| `hums_complete` | orchestrator | Every track has `hum_path` file on disk |
| `pitch_complete` | orchestrator | Every track has ≥1 note |
| `setup_complete` | orchestrator | All setup gates passed |
| `allow_conduct` | orchestrator | Same as `setup_complete` in v1 |
| `allow_export` | orchestrator | After conduct/review (later) |

**Gate rule:** `setup_complete` and `allow_conduct` are set only when `intent_complete`, `hums_complete`, and `pitch_complete` are all true.

## Who writes what

| Agent / module | Reads | Writes | Must not write |
|----------------|-------|--------|----------------|
| **intent** (`hackhcc.phases.setup.intent`) | — | `mood`, `tracks[]`, `intent.*` | `notes`, `conduct`, `flags` |
| **hum_capture** (`hackhcc.phases.setup.hum`) | `tracks[]` | `hums/*.wav`, `tracks[].hum_path` | `notes`, `flags` |
| **pitch** (`hackhcc.phases.setup.pitch`) | `hums/*` | `tracks[].notes`, `bpm`, `key` | `tracks[]` structure (except notes) |
| **orchestrator** (`hackhcc.composition`) | full doc | `flags`, `phase`, merge all | — |
| **conduct** (`hackhcc.phases.conduct`) | full doc | `conduct`, `conduct_automation.jsonl` | `tracks[].notes` |
| **review** (future) | full doc | patch events | — |
| **export** (future) | full doc | `exports/*` | `composition` melody |

## ElevenLabs integration (teammate)

Hook for realtime STT during setup:

```python
from hackhcc.phases.setup.intent import apply_intent_from_transcript

# After SpeechListener commits text:
apply_intent_from_transcript(session_id, transcript, source="elevenlabs")
```

Or merge structured output:

```python
from hackhcc.phases.setup.intent import apply_intent

apply_intent(session_id, mood="upbeat", instruments=["trumpet", "bass"], source="elevenlabs")
```

`apply_intent_from_transcript` uses simple keyword parsing in v1; teammate can replace with LLM intent parser without changing the contract.

## Orchestrator API (Python)

```python
from hackhcc.composition import (
    load_composition,
    save_composition,
    evaluate_setup_gates,
    try_mark_setup_complete,
)

comp = load_composition(session_id)
# ... specialist updates comp ...
save_composition(comp)
ok, errors = evaluate_setup_gates(comp)
if ok:
    try_mark_setup_complete(session_id)
```

## CLI (v1)

```bash
python run.py new -s mysong
python run.py setup -s mysong              # full interactive setup
python run.py setup -s mysong --stub       # skip to conduct (dev only)
python run.py setup-intent -s mysong --mood upbeat --instruments trumpet,bass
python run.py setup-hum -s mysong          # record hums only
python run.py setup-pitch -s mysong        # run pitch on existing hums
```
