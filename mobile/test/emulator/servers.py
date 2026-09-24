#!/usr/bin/env python3
"""Fixtures for the on-emulator self-test (reached from Android at 10.0.2.2).

  :8080  OpenAI-compatible mock AI (+ /last-request, /source for the research engine)
  :2323  Telnet server with RFC 854 option negotiation that echoes each line
"""
import json
import socket
import socketserver
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LAST = {"body": None}

REPLY = {
    "reply": "selftest reply",
    "commands": [{"cmd": "show vlan brief", "why": "List VLANs"}],
    "needs": [],
}


class Http(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        raw = self.rfile.read(length)
        if self.path.rstrip("/").endswith("/chat/completions"):
            LAST["body"] = json.loads(raw or b"{}")
            self._send(200, json.dumps({"choices": [{"message": {"role": "assistant", "content": json.dumps(REPLY)}}]}))
        else:
            self._send(404, "{}")

    def do_GET(self):
        if self.path == "/last-request":
            self._send(200, json.dumps(LAST["body"] or {}))
        elif self.path == "/source":
            text = "<html><body><h1>Release notes</h1>" + ("<p>New command: show platform software status control-processor brief</p>" * 12) + "</body></html>"
            self._send(200, text, "text/html")
        else:
            self._send(200, "ok", "text/plain")

    def log_message(self, fmt, *args):
        print("http", fmt % args, flush=True)


IAC, DO, WILL, WONT, DONT, SB, SE = 255, 253, 251, 252, 254, 250, 240


class Telnet(socketserver.BaseRequestHandler):
    def handle(self):
        s = self.request
        s.sendall(bytes([IAC, DO, 1, IAC, WILL, 3, IAC, SB, 24, 1, IAC, SE]))
        s.sendall(b"\r\nUser Access Verification\r\n\r\nUsername: ")
        buf = b""
        while True:
            chunk = s.recv(1024)
            if not chunk:
                return
            i = 0
            while i < len(chunk):
                b = chunk[i]
                if b == IAC and i + 2 < len(chunk) + 1:
                    i += 3
                    continue
                buf += bytes([b])
                i += 1
            while b"\r" in buf:
                line, buf = buf.split(b"\r", 1)
                line = line.strip(b"\n").decode(errors="replace")
                print("telnet line", repr(line), flush=True)
                s.sendall(("\r\nECHO:" + line + "\r\nSwitch#").encode())


class ThreadedTCP(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    t = ThreadedTCP(("0.0.0.0", 2323), Telnet)
    threading.Thread(target=t.serve_forever, daemon=True).start()
    print("telnet on :2323", flush=True)
    print("http on :8080", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8080), Http).serve_forever()
