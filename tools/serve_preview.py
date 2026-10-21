#!/usr/bin/env python3
"""Serve the Russian Launchpad preview locally (no backend needed).

Serves /workspace so you can open:
  http://localhost:8010/rl-webapp-frontend/     (main preview)
  http://localhost:8010/rl-scorm/dist_unpacked/ (SCORM standalone)
  http://localhost:8010/rl-xapi/dist/           (xAPI mock LRS)
  http://localhost:8010/rl-cmi5/dist/mock-launcher.html (cmi5 mock launch)
  http://localhost:8010/rl-telegram/            (Telegram Mini App demo mode)
"""
import http.server, os, socketserver, sys, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8010

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".wasm": "application/wasm", ".json": "application/json",
                      ".webmanifest": "application/manifest+json"}
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

if __name__ == "__main__":
    with socketserver.TCPServer(("0.0.0.0", PORT), functools.partial(Handler, directory=ROOT)) as httpd:
        print(f"Russian Launchpad preview → http://localhost:{PORT}/rl-webapp-frontend/")
        httpd.serve_forever()
