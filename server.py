#!/usr/bin/env python3
"""Small Preview server with a protected, cached Google Static Maps image route."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen
import os
import threading
import time

PROJECT_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = PROJECT_DIR / "public"
MAP_CENTER = "34.108,-117.289"  # Demonstration-only map center; not a live mission location.
MAP_TYPES = {"hybrid", "satellite", "terrain", "roadmap"}
MAP_CACHE_SECONDS = 600
MAX_MAP_BYTES = 4 * 1024 * 1024
_MAP_CACHE = {}
_MAP_CACHE_LOCK = threading.Lock()


class SentinelHandler(SimpleHTTPRequestHandler):
    server_version = "SentinelXPreview/1.0"

    def _send_text(self, status: int, message: str, head_only: bool = False) -> None:
        payload = (message.rstrip() + "\n").encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if not head_only:
            self.wfile.write(payload)

    def _load_map_image(self, map_type: str, zoom: int):
        cache_key = (map_type, zoom)
        now = time.monotonic()
        with _MAP_CACHE_LOCK:
            cached = _MAP_CACHE.get(cache_key)
            if cached and cached[0] > now:
                return cached[1], cached[2]

            api_base = os.environ.get("MANUS_API_URL", "").rstrip("/")
            server_key = os.environ.get("MANUS_API_KEY", "")
            if not api_base or not server_key:
                raise RuntimeError("map service unavailable")

            query = urlencode({
                "center": MAP_CENTER,
                "zoom": str(zoom),
                "size": "640x360",
                "scale": "2",
                "maptype": map_type,
                "key": server_key,
            })
            # Do not log or return this upstream URL: it contains the server credential.
            upstream = f"{api_base}/v1/maps/proxy/maps/api/staticmap?{query}"
            request = Request(upstream, headers={"Accept": "image/png,image/jpeg"})
            with urlopen(request, timeout=20) as response:
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
                data = response.read(MAX_MAP_BYTES + 1)
            if len(data) > MAX_MAP_BYTES or content_type not in {"image/png", "image/jpeg"}:
                raise RuntimeError("unexpected map response")
            if content_type == "image/png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
                raise RuntimeError("invalid map image")
            if content_type == "image/jpeg" and not data.startswith(b"\xff\xd8"):
                raise RuntimeError("invalid map image")
            _MAP_CACHE[cache_key] = (time.monotonic() + MAP_CACHE_SECONDS, data, content_type)
            for expired_key, entry in list(_MAP_CACHE.items()):
                if entry[0] <= time.monotonic():
                    _MAP_CACHE.pop(expired_key, None)
            return data, content_type

    def _serve_static_map(self, head_only: bool = False) -> None:
        query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
        map_type = query.get("maptype", ["hybrid"])[0].lower()
        zoom_text = query.get("zoom", ["12"])[0]
        if map_type not in MAP_TYPES:
            self._send_text(400, "Unsupported map type.", head_only)
            return
        if not zoom_text.isdecimal():
            self._send_text(400, "Invalid map zoom.", head_only)
            return
        zoom = int(zoom_text)
        if not 9 <= zoom <= 18:
            self._send_text(400, "Map zoom must be between 9 and 18.", head_only)
            return
        try:
            data, content_type = self._load_map_image(map_type, zoom)
        except (HTTPError, URLError, TimeoutError, OSError, RuntimeError, ValueError):
            # Never reflect upstream bodies, the key, or the credential-bearing URL.
            self._send_text(502, "Google Maps imagery is temporarily unavailable; local simulation map remains active.", head_only)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", f"public, max-age={MAP_CACHE_SECONDS}")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-SENTINEL-MAP-SOURCE", "Google Static Maps; simulation overlays only")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if not head_only:
            self.wfile.write(data)

    def do_GET(self) -> None:
        if urlsplit(self.path).path == "/api/map/static":
            self._serve_static_map()
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if urlsplit(self.path).path == "/api/map/static":
            self._serve_static_map(head_only=True)
            return
        super().do_HEAD()


def main() -> None:
    port = int(os.environ.get("PORT", "3000"))
    handler = partial(SentinelHandler, directory=str(PUBLIC_DIR))
    server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    print(f"SENTINEL-X Preview listening on 0.0.0.0:{port}; static Maps images use private server-side credentials", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
