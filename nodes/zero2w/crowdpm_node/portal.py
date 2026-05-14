from __future__ import annotations

import html
import json
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlparse

if TYPE_CHECKING:
    from .service import NodeService


HTML_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CrowdPM Node Setup</title>
  <style>
    body {{ font-family: sans-serif; margin: 0; background: #f6f4ef; color: #182126; }}
    main {{ max-width: 760px; margin: 0 auto; padding: 24px; }}
    .card {{ background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 8px 30px rgba(0,0,0,.08); margin-bottom: 16px; }}
    label {{ display:block; font-weight:600; margin: 12px 0 6px; }}
    input, select {{ width:100%; padding:12px; border-radius:10px; border:1px solid #c5cbd0; font-size:16px; }}
    button {{ background:#0b8f5a; color:white; border:none; border-radius:999px; padding:12px 18px; font-size:16px; cursor:pointer; }}
    code {{ background:#eef2f4; padding:2px 5px; border-radius:4px; }}
    .muted {{ color:#5f6a72; }}
    .status {{ padding: 12px 14px; border-radius: 12px; background:#eef7f2; }}
  </style>
</head>
<body>
<main>
  <div class="card">
    <h1>CrowdPM node setup</h1>
    <p class="muted">Connect this node to your Wi-Fi first. After it gets internet access, this page will show the CrowdPM pairing code and approval link.</p>
    <div class="status">
      <div><strong>Status:</strong> <span id="stage">{stage}</span></div>
      <div id="message">{message}</div>
    </div>
  </div>

  <div class="card">
    <h2>Wi-Fi</h2>
    <form method="post" action="/configure">
      <label for="ssid">Wi-Fi network</label>
      <input id="ssid" name="ssid" list="ssid-list" value="{ssid}" placeholder="Enter SSID" required>
      <datalist id="ssid-list">
        {ssid_options}
      </datalist>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" placeholder="Leave blank for open Wi-Fi">
      <p class="muted">When you submit, the node will try to join your Wi-Fi and keep this setup network alive long enough to show the pairing code.</p>
      <button type="submit">Save Wi-Fi and continue</button>
    </form>
  </div>

  <div class="card">
    <h2>Pairing</h2>
    <p><strong>User code:</strong> <code id="user-code">{user_code}</code></p>
    <p><strong>Approval link:</strong> <a id="approval-link" href="{verification_uri_complete}" target="_blank" rel="noreferrer">{verification_uri_complete}</a></p>
    <p class="muted">The code appears only after the node reaches the internet. That is why Wi-Fi setup has to happen first.</p>
  </div>

  <div class="card">
    <h2>Node state</h2>
    <pre id="debug">{debug_json}</pre>
  </div>
</main>
<script>
async function refreshStatus() {{
  try {{
    const response = await fetch('/status');
    const data = await response.json();
    document.getElementById('stage').textContent = data.portal.stage;
    document.getElementById('message').textContent = data.portal.message;
    document.getElementById('user-code').textContent = data.pairing.user_code || 'pending';
    const link = data.pairing.verification_uri_complete || '';
    const linkEl = document.getElementById('approval-link');
    linkEl.textContent = link || 'pending';
    linkEl.href = link || '#';
    document.getElementById('debug').textContent = JSON.stringify(data, null, 2);
  }} catch (error) {{
    console.log(error);
  }}
}}
setInterval(refreshStatus, 3000);
refreshStatus();
</script>
</body>
</html>
"""


CAPTIVE_PATHS = {
    "/generate_204",
    "/gen_204",
    "/hotspot-detect.html",
    "/connecttest.txt",
    "/ncsi.txt",
    "/canonical.html",
    "/redirect",
    "/success.txt",
}


class PortalServer:
    def __init__(self, service: "NodeService", host: str, port: int):
        self.service = service
        self.host = host
        self.port = port
        self.httpd = ThreadingHTTPServer((host, port), self._build_handler())
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def _build_handler(self):
        service = self.service

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args) -> None:
                service.log("portal", format % args)

            def do_GET(self) -> None:  # noqa: N802
                parsed = urlparse(self.path)
                if parsed.path == "/status":
                    body = json.dumps(service.public_status(), indent=2).encode("utf-8")
                    self.send_response(HTTPStatus.OK)
                    self.send_header("content-type", "application/json")
                    self.send_header("content-length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                if parsed.path in CAPTIVE_PATHS:
                    self.send_response(HTTPStatus.FOUND)
                    self.send_header("Location", "/")
                    self.end_headers()
                    return
                if parsed.path == "/" or parsed.path == "/index.html":
                    snapshot = service.public_status(include_visible_networks=True)
                    visible_networks = snapshot["network"].get("visible_networks", [])
                    options = []
                    for item in visible_networks:
                        ssid = html.escape(item.get("ssid", ""))
                        signal = item.get("signal")
                        security = html.escape(item.get("security", ""))
                        options.append(f'<option value="{ssid}">{ssid} ({signal}% {security})</option>')
                    body = HTML_TEMPLATE.format(
                        stage=html.escape(snapshot["portal"]["stage"]),
                        message=html.escape(snapshot["portal"]["message"]),
                        ssid=html.escape(snapshot["wifi"].get("ssid") or ""),
                        user_code=html.escape(snapshot["pairing"].get("user_code") or "pending"),
                        verification_uri_complete=html.escape(snapshot["pairing"].get("verification_uri_complete") or ""),
                        ssid_options="\n".join(options),
                        debug_json=html.escape(json.dumps(snapshot, indent=2)),
                    ).encode("utf-8")
                    self.send_response(HTTPStatus.OK)
                    self.send_header("content-type", "text/html; charset=utf-8")
                    self.send_header("content-length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_response(HTTPStatus.FOUND)
                self.send_header("Location", "/")
                self.end_headers()

            def do_POST(self) -> None:  # noqa: N802
                parsed = urlparse(self.path)
                if parsed.path != "/configure":
                    self.send_response(HTTPStatus.NOT_FOUND)
                    self.end_headers()
                    return
                content_length = int(self.headers.get("content-length", "0"))
                raw_body = self.rfile.read(content_length).decode("utf-8")
                form = parse_qs(raw_body)
                ssid = (form.get("ssid") or [""])[0].strip()
                password = (form.get("password") or [""])[0]
                if not ssid:
                    self.send_response(HTTPStatus.BAD_REQUEST)
                    self.end_headers()
                    self.wfile.write(b"ssid required")
                    return
                service.configure_wifi(ssid, password)
                self.send_response(HTTPStatus.FOUND)
                self.send_header("Location", "/")
                self.end_headers()

        return Handler

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
