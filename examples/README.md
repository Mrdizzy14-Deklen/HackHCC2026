# Examples

Main app uses `1_setup.py` and `2_conduct.py`.

**STT only** (requires `ELEVENLABS_API_KEY` in `.env`):

```bash
python examples/stt_example.py
```

**Intent from code:**

```python
from hackhcc.phases.setup.intent import apply_intent_from_transcript
apply_intent_from_transcript("mysong", "upbeat song with piano", source="elevenlabs")
```
