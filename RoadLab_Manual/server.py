"""Local-only static server. No Python packages required."""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import webbrowser


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description="RoadLab local 3D simulator")
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--open", action="store_true", help="Open your default browser")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent / "pc"
    handler = functools.partial(Handler, directory=str(root))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    except OSError as exc:
        raise SystemExit(f"Cannot start local server: {exc}. Try --port 8768") from exc
    url = f"http://localhost:{args.port}"
    print(f"RoadLab Manual: {url}\nOpen in Chrome or Edge. Ctrl+C stops this server.", flush=True)
    if args.open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
