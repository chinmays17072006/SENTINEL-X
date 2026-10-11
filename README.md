# SENTINEL-X — AI Mission Safety & Decision Intelligence

> **Hackathon simulation prototype.** SENTINEL-X demonstrates a decision-support command center with simulated personnel, environmental risk, infrastructure/cyber indicators, scenario controls, audit history, and incident replay. It does not connect to real personnel, sensors, dispatchers, or operational systems. AI-generated outputs are illustrative only; human approval is required.

## Live demo

[Open the SENTINEL-X prototype on Manus](https://sentinelx-mmfhbx3g.manus.space/)

## Highlights

- Mission command-center dashboard and simulated live feed
- Soldier/personnel intelligence and risk indicators
- Environment and digital-twin scenario controls
- Infrastructure and cyber monitoring concepts
- AI intelligence and what-if/rescue workflows
- Provenance, human-decision audit trail, and incident replay
- Local schematic map fallback, with an optional server-side static-map proxy

## Architecture

- **Frontend:** plain HTML, CSS, and JavaScript in `public/`
- **Backend:** `server.py`, a small Python HTTP server that serves the frontend and exposes `GET /api/map/static`
- **Container:** `Dockerfile` (Python 3.12)
- **Configuration:** optional server-side environment variables `MANUS_API_URL` and `MANUS_API_KEY` enable the platform Maps proxy. Do not commit credentials or expose them to browser code.
- **State:** simulation state, audit history, and replay data are in memory and reset on restart.

## Run locally

Requires Python 3.12 or a compatible recent Python version.

```bash
python3 server.py
```

Open [http://localhost:3000](http://localhost:3000). The app uses port 3000 by default; set `PORT` to override it. With map-proxy environment variables unset, the local simulated map fallback remains available.

## Run with Docker

```bash
docker build -t sentinel-x .
docker run --rm -p 3000:3000 sentinel-x
```

If using a supported platform Maps proxy, configure `MANUS_API_URL` and `MANUS_API_KEY` as **runtime secrets** in your host's environment settings. Never add real keys to source code, Docker build arguments, screenshots, or logs.

## Hosting notes

GitHub stores the source; it does not run the Python server. **GitHub Pages alone will not run `server.py` or the `/api/map/static` proxy.** For a standalone live deployment with all app routes, use a Python/container host that supports the included `Dockerfile`, and configure runtime secrets there if required. For judging, the Manus live demo above is the working prototype link.

## Tests

The project includes browser regression tests in `tests/` and a runner in `run_tests.sh`.

```bash
python3 -m pip install -r requirements-test.txt
python3 -m playwright install chromium
sh run_tests.sh
```

The tests expect permission to open a local HTTP server and a working Playwright Chromium browser.

## Repository layout

```text
.
├── Dockerfile
├── DEPLOYMENT.md
├── README.md
├── app.config.ts
├── package_production.py
├── public/
│   ├── app.js
│   ├── index.html
│   ├── operations.js
│   ├── sentinelx-logo.svg
│   ├── styles.css
│   └── traceability.js
├── server.py
├── tests/
└── run_tests.sh
```

## Responsible-use disclaimer

SENTINEL-X is a prototype for demonstrating a potential safety decision-support interface. Personnel statuses, alerts, risk scores, route overlays, recommendations, and analytics are simulations and should not be treated as real-world intelligence or used to make operational safety decisions.
