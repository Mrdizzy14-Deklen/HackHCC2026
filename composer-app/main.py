import threading

import uvicorn
import webview

from app import app


def run_server(server: uvicorn.Server) -> None:
    server.run()


def main() -> None:
    config = uvicorn.Config(app, host="127.0.0.1", port=5000, log_level="info")
    server = uvicorn.Server(config)

    thread = threading.Thread(target=run_server, args=(server,), daemon=True)
    thread.start()

    try:
        window = webview.create_window("Composer", "http://localhost:5000", maximized=True)
    except TypeError:
        window = webview.create_window("Composer", "http://localhost:5000")

    def on_closing() -> None:
        server.should_exit = True

    window.events.closing += on_closing

    webview.start()


if __name__ == "__main__":
    main()
