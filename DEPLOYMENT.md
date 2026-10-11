# SENTINEL-X deployment guide

SENTINEL-X is a self-contained simulation prototype. It serves a browser interface and a same-origin Python endpoint for optional static-map imagery. It does not connect to real personnel, sensors, dispatchers, or operational systems.

## Run locally

Requires Python 3.12 or a compatible recent Python 3 version.

```sh
python3 server.py
```

Open `http://localhost:3000`. Set `PORT` to change the server port. `GET /` serves the UI and can be used as a simple health check.

## Run with Docker

```sh
docker build -t sentinel-x .
docker run --rm -p 3000:3000 sentinel-x
```

The included Dockerfile runs as an unprivileged user and listens on `0.0.0.0:$PORT` (default `3000`).

## Optional map proxy

`GET /api/map/static` serves a map image through a server-side proxy when both `MANUS_API_URL` and `MANUS_API_KEY` are set in the runtime environment. Configure them as secrets in the hosting provider; do not commit them, put them in browser code, or bake them into the container image. When they are unavailable, the UI uses its local simulated map fallback.

## Hosting

GitHub is used to store and review the source code. GitHub Pages alone cannot run `server.py` or the `/api/map/static` endpoint. To host a standalone version of the app, use a Python/container hosting service that supports the included Dockerfile. The existing Manus demo remains available at https://sentinelx-mmfhbx3g.manus.space/.

## Tests

```sh
python3 -m pip install -r requirements-test.txt
python3 -m playwright install chromium
sh run_tests.sh
```

The browser regression tests use Playwright and expect local HTTP server access and Chromium.

## Runtime behavior and limitations

Simulation state and audit/replay history are held in memory and reset when the server restarts. Risk scores, alerts, route overlays, personnel status, and recommendations are illustrative AI-generated simulation data. They are not real-world intelligence and must not be used for operational safety decisions.
