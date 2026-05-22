# Agents

See [docs/CONTRACT.md](../../docs/CONTRACT.md) for field ownership.

| Agent | v1 module | Status |
|-------|-----------|--------|
| **intent** | `hackhcc/phases/setup/intent.py` | CLI + transcript parser; ElevenLabs hook in `examples/` |
| **hum_capture** | `hackhcc/phases/setup/hum.py` | Mic record → `hums/*.wav` |
| **pitch** | `hackhcc/phases/setup/pitch.py` | librosa YIN → `tracks[].notes` |
| **conduct** | `hackhcc/phases/conduct.py` | MediaPipe |
| **timbre** | — | v2 |
| **critique** | — | v2 |
| **final_generator** | — | v2 |
| **orchestrator** | `hackhcc/composition.py` | flags + gates only |
