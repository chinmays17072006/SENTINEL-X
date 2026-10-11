from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen
from zipfile import ZipFile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
VIEWS = ("command", "personnel", "environment", "infrastructure", "intelligence", "rescue")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(path: str) -> tuple[int, bytes, str]:
    try:
        with urlopen(f"{SentinelXRegressionTests.origin}{path}", timeout=4) as response:
            return response.status, response.read(), response.headers.get("Content-Type", "")
    except HTTPError as error:
        return error.code, error.read(), error.headers.get("Content-Type", "")


class SentinelXRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.port = free_port()
        cls.origin = f"http://127.0.0.1:{cls.port}"
        env = os.environ.copy()
        env.update({
            "PORT": str(cls.port),
            "MANUS_API_URL": "",
            "MANUS_API_KEY": "",
            "PYTHONDONTWRITEBYTECODE": "1",
        })
        cls.server = subprocess.Popen(
            [sys.executable, str(ROOT / "server.py")],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(100):
            if cls.server.poll() is not None:
                raise RuntimeError("Isolated SENTINEL-X test server exited during startup")
            try:
                with urlopen(cls.origin + "/", timeout=0.3) as response:
                    if response.status == 200:
                        break
            except Exception:
                time.sleep(0.1)
        else:
            cls.server.terminate()
            raise RuntimeError("Isolated SENTINEL-X test server did not become ready")

        cls.playwright = sync_playwright().start()
        chromium = shutil.which("chromium") or shutil.which("chromium-browser")
        options = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        if chromium:
            options["executable_path"] = chromium
        cls.browser = cls.playwright.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls) -> None:
        if getattr(cls, "browser", None):
            cls.browser.close()
        if getattr(cls, "playwright", None):
            cls.playwright.stop()
        if getattr(cls, "server", None) and cls.server.poll() is None:
            cls.server.terminate()
            try:
                cls.server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                cls.server.kill()
                cls.server.wait(timeout=5)

    def setUp(self) -> None:
        self.page_errors: list[str] = []
        self.page = self.browser.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))

    def tearDown(self) -> None:
        self.page.close()
        if self.page_errors:
            self.fail("Uncaught browser errors: " + " | ".join(self.page_errors))

    def open_app(self) -> None:
        response = self.page.goto(self.origin + "/", wait_until="domcontentloaded", timeout=10_000)
        if response is None:
            self.fail("The local app navigation returned no HTTP response")
        self.assertEqual(response.status, 200)
        self.page.wait_for_selector('[data-action="trace-open"]', timeout=10_000)

    def open_alert(self, title: str) -> None:
        card = self.page.locator(".alert-card").filter(has_text=title).first
        self.assertTrue(card.count(), f"Expected active alert card: {title}")
        card.locator('[data-action="investigate"]').click()
        self.page.wait_for_selector('[data-action="trace-acknowledge"]', timeout=3_000)

    def open_audit(self) -> str:
        self.page.locator('.nav-link[data-view="command"]').click()
        self.page.locator('[data-action="trace-open"]').click()
        self.page.locator('[data-action="trace-tab"][data-tab="audit"]').click()
        return self.page.locator(".trace-content").inner_text()

    def close_modal(self) -> None:
        self.page.locator('#modal-root .modal-actions [data-action="close-modal"]').click()

    def test_audit_only_records_completed_human_decisions(self) -> None:
        self.open_app()

        # Cancelled escalation is not an audit decision.
        self.open_alert("Equipment degradation")
        self.page.locator('[data-action="trace-escalate"]').click()
        self.close_modal()
        audit = self.open_audit()
        self.assertIn("No operator decisions recorded yet", audit)
        self.close_modal()

        # Acknowledge is an explicit incident action with actor and before/after data.
        self.open_alert("Equipment degradation")
        self.page.locator('[data-action="trace-acknowledge"]').click()
        audit = self.open_audit()
        self.assertIn("ACKNOWLEDGE", audit)
        self.assertIn("DEMO OPERATOR", audit)
        self.assertIn("BEFORE", audit)
        self.assertIn("AFTER", audit)
        self.assertIn("Alert acknowledged", audit)
        self.close_modal()

        # Escalation requires confirmation; cancelling it leaves the record count unchanged.
        self.open_alert("Equipment degradation")
        self.page.locator('[data-action="trace-escalate"]').click()
        self.close_modal()
        audit = self.open_audit()
        self.assertEqual(self.page.locator(".trace-audit-row").count(), 1)
        self.assertNotIn("ESCALATE", audit)
        self.close_modal()

        self.open_alert("Equipment degradation")
        self.page.locator('[data-action="trace-escalate"]').click()
        self.page.locator('[data-action="confirm-local"]').click()
        audit = self.open_audit()
        self.assertIn("ESCALATE", audit)
        self.assertIn("explicit confirmation", audit)
        self.assertEqual(self.page.locator(".trace-audit-row").count(), 2)
        self.close_modal()

        # Recommendation approval is also human-gated and cancellation is not recorded.
        self.page.locator('.nav-link[data-view="rescue"]').click()
        self.page.locator('[data-action="review-recommendation"]').first.click()
        self.close_modal()
        audit = self.open_audit()
        self.assertNotIn("APPROVE", audit)
        self.close_modal()

        self.page.locator('.nav-link[data-view="rescue"]').click()
        self.page.locator('[data-action="review-recommendation"]').first.click()
        self.page.locator('[data-action="confirm-local"]').click()
        audit = self.open_audit()
        self.assertIn("APPROVE", audit)
        self.assertIn("DEMO OPERATOR", audit)
        self.assertEqual(self.page.locator(".trace-audit-row").count(), 3)

    def test_cascadeguard_fits_inside_390px_panel(self) -> None:
        self.open_app()
        self.page.set_viewport_size({"width": 390, "height": 844})
        panel = self.page.locator(".panel").filter(has_text="CASCADEGUARD").first
        panel.wait_for()
        metrics = panel.evaluate('''panel => {
          const get = selector => {
            const element = panel.querySelector(selector);
            return {client: element.clientWidth, scroll: element.scrollWidth,
              overflow: getComputedStyle(element).overflowX};
          };
          const action = panel.querySelector('.cascade-summary > .btn').getBoundingClientRect();
          const bounds = panel.getBoundingClientRect();
          const controls = document.querySelector('.topbar-right');
          const controlsBounds = controls.getBoundingClientRect();
          controls.scrollLeft = controls.scrollWidth;
          const operatorRight = controls.querySelector('.operator-button').getBoundingClientRect().right;
          return {page: document.documentElement.scrollWidth,
            topbar: {client: controls.clientWidth, scroll: controls.scrollWidth,
              overflow: getComputedStyle(controls).overflowX,
              right: controlsBounds.right, operatorRight},
            panel: {client: panel.clientWidth, scroll: panel.scrollWidth},
            body: get('.panel-body'), summary: get('.cascade-summary'), note: get('.cascade-note'),
            chain: get('.chain'), actionRight: action.right, panelRight: bounds.right};
        }''')
        self.assertEqual(metrics["page"], 390, metrics)
        self.assertEqual(metrics["topbar"]["overflow"], "auto")
        self.assertGreater(metrics["topbar"]["scroll"], metrics["topbar"]["client"], metrics)
        self.assertLessEqual(metrics["topbar"]["operatorRight"], metrics["topbar"]["right"] + 1, metrics)
        self.assertLessEqual(metrics["panel"]["scroll"], metrics["panel"]["client"] + 1, metrics)
        self.assertLessEqual(metrics["body"]["scroll"], metrics["body"]["client"] + 1, metrics)
        self.assertLessEqual(metrics["summary"]["scroll"], metrics["summary"]["client"] + 1, metrics)
        self.assertLessEqual(metrics["note"]["scroll"], metrics["note"]["client"] + 1, metrics)
        self.assertEqual(metrics["chain"]["overflow"], "auto")
        self.assertGreater(metrics["chain"]["scroll"], metrics["chain"]["client"], metrics)
        self.assertLessEqual(metrics["actionRight"], metrics["panelRight"] + 1, metrics)

    def test_container_package_is_minimal_and_credential_free(self) -> None:
        dockerfile = (ROOT / "Dockerfile").read_text()
        deployment = (ROOT / "DEPLOYMENT.md").read_text()
        self.assertIn("PORT=3000", dockerfile)
        self.assertIn("public/ /app/public/", dockerfile)
        self.assertIn("USER 65534:65534", dockerfile)
        self.assertIn('healthPath: "/"', deployment)
        self.assertIn("one-way", deployment.lower())
        self.assertIn("does not submit a Publish request", deployment)

        with tempfile.TemporaryDirectory(prefix="sentinelx-package-test-") as temp_dir:
            output = Path(temp_dir) / "sentinelx.zip"
            subprocess.run(
                [sys.executable, str(ROOT / "package_production.py"), str(output)],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            with ZipFile(output) as archive:
                names = set(archive.namelist())
                prefix = "sentinelx-production/"
                required = {
                    prefix + "Dockerfile",
                    prefix + "DEPLOYMENT.md",
                    prefix + "server.py",
                    prefix + "public/index.html",
                    prefix + "public/app.js",
                    prefix + "public/operations.js",
                    prefix + "public/traceability.js",
                    prefix + "public/styles.css",
                    prefix + "public/manus-routes.json",
                }
                self.assertTrue(required.issubset(names), names)
                self.assertFalse(any("/tests/" in name or name.endswith(".env") for name in names), names)
                for name in names:
                    self.assertNotIn(b"AIza", archive.read(name), name)

    def test_desktop_and_presentation_sections_fit_and_keep_type_hierarchy(self) -> None:
        self.open_app()
        for width, height in ((1280, 800), (1600, 900)):
            self.page.set_viewport_size({"width": width, "height": height})
            for view in VIEWS:
                self.page.locator(f'.nav-link[data-view="{view}"]').click()
                report = self.page.evaluate('''() => {
                  const containers = '.dashboard-grid,.lower-grid,.section-grid,.panel,.panel-body';
                  const overflow = [...document.querySelectorAll(containers)]
                    .filter(e => e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 3)
                    .map(e => ({className: String(e.className), client: e.clientWidth, scroll: e.scrollWidth}));
                  return {width: innerWidth, page: document.documentElement.scrollWidth, overflow};
                }''')
                self.assertEqual(report["page"], width, f"{view} at {width}px: {report}")
                self.assertEqual(report["overflow"], [], f"{view} at {width}px: {report}")

            self.page.locator('.nav-link[data-view="command"]').click()
            fonts = self.page.evaluate('''() => {
              const size = selector => getComputedStyle(document.querySelector(selector)).fontSize;
              return {nav: size('.nav-link'), breadcrumb: size('.crumb'), kpi: size('.kpi-value'),
                mapTab: size('.map-type-switch button'), layer: size('.layer-toggle'),
                disclaimer: document.querySelector('.admin-ribbon').innerText};
            }''')
            self.assertEqual(fonts["nav"], "14px")
            self.assertEqual(fonts["breadcrumb"], "13px")
            self.assertEqual(fonts["kpi"], "26px")
            self.assertEqual(fonts["mapTab"], "11px")
            self.assertEqual(fonts["layer"], "11px")
            self.assertIn("AI-GENERATED SIMULATION", fonts["disclaimer"])

    def test_http_routes_and_client_files_do_not_expose_google_key(self) -> None:
        status, body, content_type = request("/")
        self.assertEqual(status, 200)
        self.assertIn(b"traceability.js", body)
        self.assertIn("text/html", content_type)

        status, body, content_type = request("/manus-routes.json")
        self.assertEqual(status, 200)
        self.assertIn("application/json", content_type)
        self.assertEqual(json.loads(body), {"routes": [{"path": "/", "title": "SENTINEL-X Command Center"}]})

        for query in ("maptype=invalid&zoom=12", "maptype=hybrid&zoom=8"):
            self.assertEqual(request("/api/map/static?" + query)[0], 400)
        status, body, _ = request("/api/map/static?maptype=hybrid&zoom=12")
        self.assertEqual(status, 502, "Test server must have Maps credentials unset and make no upstream request")
        self.assertIn(b"temporarily unavailable", body)
        self.assertNotIn(b"MANUS_API_KEY", body)

        for path in (ROOT / "public").rglob("*"):
            if path.is_file():
                self.assertNotIn(b"AIza", path.read_bytes(), str(path.relative_to(ROOT)))

        html = (ROOT / "public" / "index.html").read_text()
        self.assertLess(html.index("app.js"), html.index("operations.js"))
        self.assertLess(html.index("operations.js"), html.index("traceability.js"))

    def test_provenance_ages_to_stale_and_recovers_when_feed_resumes(self) -> None:
        self.open_app()
        self.page.locator("#feed-toggle").click()
        self.assertTrue(self.page.evaluate("state.livePaused"))
        self.page.locator('[data-action="trace-open"]').click()
        self.page.wait_for_selector("[data-trace-modal]")
        self.assertEqual(self.page.locator(".trace-signal-row").count(), 5)
        self.page.wait_for_timeout(10_300)
        self.assertEqual(self.page.locator('[data-action="trace-open"]').get_attribute("data-freshness"), "stale")
        self.assertEqual(self.page.locator(".trace-signal-meta small").filter(has_text="STALE").count(), 5)

        self.close_modal()
        self.page.locator("#feed-toggle").click()
        self.page.wait_for_timeout(5_500)
        self.assertFalse(self.page.evaluate("state.livePaused"))
        self.assertEqual(self.page.locator('[data-action="trace-open"]').get_attribute("data-freshness"), "fresh")

    def test_replay_opens_at_baseline_and_remains_read_only(self) -> None:
        self.open_app()
        self.page.wait_for_timeout(6_300)
        self.page.locator('[data-action="trace-open"]').click()
        self.page.locator('[data-action="trace-tab"][data-tab="replay"]').click()
        slider = self.page.locator("[data-trace-scrub]")
        self.assertGreaterEqual(int(slider.get_attribute("max") or "0"), 2)
        self.assertEqual(slider.input_value(), "0")
        self.assertEqual(self.page.locator(".trace-frame-heading strong").inner_text(), "BASELINE · INITIAL SIMULATION")
        self.assertIn("MISSION SAFETY", self.page.locator(".trace-frame-stat").nth(3).inner_text())

        live_risk = self.page.evaluate("state.mission.missionRisk")
        self.page.locator('[data-action="trace-next"]').click()
        self.assertEqual(slider.input_value(), "1")
        self.page.locator('[data-action="trace-prev"]').click()
        self.assertEqual(slider.input_value(), "0")
        slider.evaluate("element => { element.value = '0'; element.dispatchEvent(new Event('input', {bubbles:true})); }")
        self.assertEqual(self.page.evaluate("state.mission.missionRisk"), live_risk)

        self.page.locator('[data-action="trace-play"]').click()
        self.page.wait_for_timeout(1_250)
        self.assertGreater(int(slider.input_value()), 0)
        self.page.locator('[data-action="trace-play"]').click()
        self.assertEqual(self.page.locator('[data-action="trace-play"]').inner_text(), "PLAY")


if __name__ == "__main__":
    unittest.main(verbosity=2)
