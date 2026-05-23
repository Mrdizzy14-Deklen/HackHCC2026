from stt import SpeechListener

with SpeechListener() as listener:
    listener = SpeechListener(
        on_partial=lambda t: print("...", t.text),
        on_committed=lambda t: print("Done:", t.text),
    )
    listener.start()
    while True:
        caption = listener.partial_text
        if caption and "stop" in caption.lower():
            break
        caption = ""    
    listener.stop()