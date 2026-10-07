#!/usr/bin/env python3
"""px7a 快照只读服务 (轻量版) — .65 常驻。
/api/status → var/status.json 原样投影; /healthz → 存活。
端口 8711 (避让 .69 旧 8710 语义)。"""
import json
import socketserver
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SNAPSHOT = ROOT / "var" / "status.json"
PORT = 8711


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/healthz":
            self._send(200, "ok", "text/plain")
        elif self.path == "/api/status":
            try:
                self._send(200, SNAPSHOT.read_bytes(), "application/json")
            except FileNotFoundError:
                self._send(503, '{"error":"snapshot not ready"}', "application/json")
        else:
            self._send(404, "not found", "text/plain")

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # 安静


class Server(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    print(f"px7a-lite status server on :{PORT} serving {SNAPSHOT}")
    Server(("0.0.0.0", PORT), Handler).serve_forever()
