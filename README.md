# SENTINEL-X — AI Mission Safety & Decision Intelligence

> **Hackathon simulation prototype.** SENTINEL-X demonstrates a decision-support command center with simulated personnel, environmental risk, infrastructure/cyber indicators, scenario controls, audit history, and incident replay. It does not connect to real personnel, sensors, dispatchers, or operational systems. AI-generated outputs are illustrative only; human approval is required.

## Live demos

- **GitHub Pages (static frontend):** https://chinmays17072006.github.io/SENTINEL-X/ — available after the GitHub Pages workflow deploys successfully.
- **Existing full prototype on Manus:** [Open the SENTINEL-X prototype](https://sentinelx-mmfhbx3g.manus.space/)
- **Container deployment on Render:** [Open SENTINEL-X on Render](https://sentinel-x-6onw.onrender.com/)

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
- **Deploy configuration:** `render.yaml` describes a Render Docker web service.
- **Optional map proxy:** server-side environment variables `MANUS_API_URL` and `MANUS_API_KEY`. Do not commit credentials or expose them to browser code.
- **GitHub Pages:** an automated workflow publishes the static files from `public/`. The GitHub Pages version uses the local schematic map fallback; GitHub Pages cannot execute the Python map proxy.
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

## Deploy a public copy

A Render Blueprint configuration is included in `render.yaml`.

1. Sign in to [Render](https://dashboard.render.com/).
2. Choose **New → Blueprint** (or the option to create a Blueprint).
3. Connect GitHub if prompted and select `chinmays17072006/SENTINEL-X`.
4. Review the `sentinel-x` web service described by `render.yaml`, then apply/create it.
5. Wait for the Docker build and deploy to finish. Open the generated `https://...onrender.com` URL and test the app.

Render's free web services can spin down after 15 minutes without traffic and can take around a minute to wake up. For the hackathon submission, keep the current Manus live demo as your primary link until the separate deployment has finished and been tested.

GitHub stores the source code; **GitHub Pages alone will not run `server.py` or the `/api/map/static` proxy**.

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
├── .gitignore
├── DEPLOYMENT.md
├── Dockerfile
├── README.md
├── package_production.py
├── render.yaml
├── requirements-test.txt
├── run_tests.sh
├── server.py
├── public/
│   ├── app.js
│   ├── index.html
│   ├── manus-routes.json
│   ├── operations.js
│   ├── sentinelx-logo.svg
│   ├── styles.css
│   └── traceability.js
└── tests/
    └── test_sentinelx.py
```

## Responsible-use disclaimer

SENTINEL-X is a prototype for demonstrating a potential safety decision-support interface. Personnel statuses, alerts, risk scores, route overlays, recommendations, and analytics are simulations and should not be treated as real-world intelligence or used to make operational safety decisions.
