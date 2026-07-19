"""Export a clip to MP4 by screenshotting the SAME React preview — headless.

Option B ("one renderer"): instead of re-implementing the look with an ffmpeg
filtergraph (fonts/blur/karaoke/overlays all diverge), we load the frontend's
own render route in a headless browser, step it frame by frame
(``window.__render.seek(t)``), capture each frame as a PNG, pipe the PNGs to
ffmpeg, and mux the clip's source audio. The frames are produced by Chrome
rendering the exact preview CSS/DOM, so the export matches the preview by
construction — same fonts, same blur, same caption karaoke, same overlays.

**Chrome is required** (``channel="chrome"``): the source videos are H.264/AAC,
which Playwright's bundled open-source Chromium cannot decode. Install once with:

    pip install playwright && playwright install chrome

The frontend must be reachable at ``config.RENDER_BASE_URL`` (the Vite dev server
in development, or the built app served by FastAPI).
"""
from __future__ import annotations

import shutil
import subprocess
import threading
from pathlib import Path
from typing import Callable

from . import config, store


def _render_url(project_id: str, clip_id: str) -> str:
    base = config.RENDER_BASE_URL.rstrip("/")
    return f"{base}/?render=1&project={project_id}&clip={clip_id}"


def _frame_url(project_id: str) -> str:
    """Render route in single-frame mode (no clip: the page mounts a virtual
    whole-video clip and just waits to be seeked)."""
    base = config.RENDER_BASE_URL.rstrip("/")
    return f"{base}/?render=1&project={project_id}&frame=1"


def capture_frame(project: dict, t: float, quality: int | None = None) -> bytes:
    """Return one JPEG of the fully composed output (captions + reframe + scenes)
    at time `t`, captured from the same headless renderer as export.

    Raises RuntimeError on any failure (missing browser, page error)."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:  # pragma: no cover - setup guidance
        raise RuntimeError(
            "playwright n'est pas installé — lancez scripts/setup-render.sh "
            "(pip install playwright && playwright install chrome)"
        ) from exc

    url = _frame_url(project["id"])
    q = config.RENDER_JPEG_QUALITY if quality is None else quality
    with sync_playwright() as pw:
        browser = _launch_browser(pw)
        try:
            page = browser.new_page(device_scale_factor=1)
            page.set_default_timeout(config.RENDER_PAGE_TIMEOUT_MS)
            perr: list[str] = []
            page.on("pageerror", lambda e: perr.append(str(e)))
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_function(
                "window.__render && (window.__render.ready || window.__render.error)",
                timeout=config.RENDER_READY_TIMEOUT_MS,
            )
            meta = page.evaluate("window.__render.error ? null : window.__render.meta")
            if meta is None:
                raise RuntimeError(
                    page.evaluate("window.__render && window.__render.error")
                    or (perr[-1] if perr else "erreur inconnue"))
            w, h = int(meta["w"]), int(meta["h"])
            page.set_viewport_size({"width": w, "height": h})
            page.evaluate("(t) => window.__render.seek(t)", float(t))
            return page.screenshot(type="jpeg", quality=q,
                                   clip={"x": 0, "y": 0, "width": w, "height": h})
        finally:
            browser.close()


# Real Chrome binaries a `channel="chrome"` install can leave around, tried as
# an explicit executable when the channel lookup itself fails.
_CHROME_PATHS = (
    "/opt/google/chrome/chrome",
    "/opt/google/chrome/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
)

_LAUNCH_ARGS = ["--autoplay-policy=no-user-gesture-required",
                "--disable-background-media-suspend"]


def _launch_browser(pw):
    """Launch a Chrome/Chromium able to decode H.264. Tries, in order: an
    explicit executable (RENDER_BROWSER_EXECUTABLE), the configured channel
    (system Chrome), then well-known Chrome paths. Raises with everything tried."""
    attempts: list[str] = []

    exe = config.RENDER_BROWSER_EXECUTABLE
    if exe:
        try:
            return pw.chromium.launch(executable_path=exe, headless=True, args=_LAUNCH_ARGS)
        except Exception as e:  # noqa: BLE001
            attempts.append(f"executable={exe}: {e}")

    channel = config.RENDER_BROWSER_CHANNEL
    if channel:
        try:
            return pw.chromium.launch(channel=channel, headless=True, args=_LAUNCH_ARGS)
        except Exception as e:  # noqa: BLE001
            attempts.append(f"channel={channel}: {e}")

    for path in _CHROME_PATHS:
        if Path(path).exists():
            try:
                return pw.chromium.launch(executable_path=path, headless=True, args=_LAUNCH_ARGS)
            except Exception as e:  # noqa: BLE001
                attempts.append(f"{path}: {e}")

    raise RuntimeError(
        "Aucun navigateur de rendu lançable. Installez Google Chrome "
        "(scripts/setup-render.sh → `playwright install chrome`) ou pointez "
        "RENDER_BROWSER_EXECUTABLE sur le binaire chrome. Tentatives : "
        + " | ".join(attempts or ["aucune"])
    )


def _ffmpeg_cmd(fps: float, start: float, dur: float, frames_dir: Path,
                source: Path, out: Path) -> list[str]:
    """Assemble the captured JPEG sequence + the source's audio (seeked to the
    clip) into the final MP4."""
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-framerate", f"{fps:.5f}", "-start_number", "0",
        "-i", str(frames_dir / "%06d.jpg"),
        "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(source),
        "-map", "0:v:0", "-map", "1:a:0?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", "-shortest", str(out),
    ]


def _render_chunk(url: str, lo: int, hi: int, frames_dir: Path, start: float,
                  fps: float, quality: int, on_frame: Callable[[], None],
                  cancel: "threading.Event | None", errors: list[str]) -> None:
    """One worker: drive its own headless browser to capture frames [lo, hi) to
    ``frames_dir/{i:06d}.jpg``. Sequential (forward) seeks within the chunk are
    cheap; splitting into contiguous chunks keeps them sequential. Any failure is
    appended to the shared ``errors`` list."""
    from playwright.sync_api import sync_playwright
    try:
        with sync_playwright() as pw:
            browser = _launch_browser(pw)
            try:
                page = browser.new_page(device_scale_factor=1)
                page.set_default_timeout(config.RENDER_PAGE_TIMEOUT_MS)
                perr: list[str] = []
                page.on("pageerror", lambda e: perr.append(str(e)))
                page.goto(url, wait_until="domcontentloaded")
                page.wait_for_function(
                    "window.__render && (window.__render.ready || window.__render.error)",
                    timeout=config.RENDER_READY_TIMEOUT_MS,
                )
                meta = page.evaluate("window.__render.error ? null : window.__render.meta")
                if meta is None:
                    raise RuntimeError(
                        page.evaluate("window.__render && window.__render.error")
                        or (perr[-1] if perr else "erreur inconnue"))
                w, h = int(meta["w"]), int(meta["h"])
                page.set_viewport_size({"width": w, "height": h})
                clip_box = {"x": 0, "y": 0, "width": w, "height": h}
                for i in range(lo, hi):
                    if cancel is not None and cancel.is_set():
                        raise RuntimeError("cancelled")
                    t = start + i / fps
                    page.evaluate("(t) => window.__render.seek(t)", t)
                    # JPEG (not PNG): lossless PNG encode of a full-res frame is
                    # the biggest per-frame cost; q≈90 is visually identical once
                    # it's H.264-encoded anyway, and far faster to capture.
                    frame = page.screenshot(type="jpeg", quality=quality, clip=clip_box)
                    (frames_dir / f"{i:06d}.jpg").write_bytes(frame)
                    on_frame()
            finally:
                browser.close()
    except Exception as exc:  # noqa: BLE001 - surfaced to the job via `errors`
        errors.append(str(exc))


def render_clip(project: dict, clip: dict, out_path: Path,
                progress: Callable[[float], None] | None = None,
                cancel: threading.Event | None = None) -> None:
    """Render one clip to ``out_path`` by capturing the headless preview, frame by
    frame, across ``RENDER_PARALLELISM`` browsers in parallel, then muxing.

    Raises RuntimeError on any failure (browser, page error, ffmpeg)."""
    try:
        import playwright.sync_api  # noqa: F401 - fail early with guidance
    except ImportError as exc:  # pragma: no cover - setup guidance
        raise RuntimeError(
            "playwright n'est pas installé — lancez scripts/setup-render.sh "
            "(pip install playwright && playwright install chrome)"
        ) from exc

    out_path.parent.mkdir(parents=True, exist_ok=True)
    source = store.source_path(project)
    url = _render_url(project["id"], clip["id"])

    # Scalars are known from the project/clip (the page computes frameCount the
    # same way) — only the pixel geometry (w/h) is read per worker from the page.
    fps = float(project.get("fps") or 30)
    start = float(clip["start"])
    dur = max(float(clip["end"]) - start, 0.05)
    frame_count = max(1, round(dur * fps))
    workers = max(1, min(config.RENDER_PARALLELISM, frame_count))

    frames_dir = out_path.parent / f".{out_path.stem}_frames"
    shutil.rmtree(frames_dir, ignore_errors=True)
    frames_dir.mkdir(parents=True, exist_ok=True)

    done = [0]
    lock = threading.Lock()
    errors: list[str] = []

    def on_frame() -> None:
        with lock:
            done[0] += 1
            if progress is not None:
                progress(min(done[0] / frame_count, 0.98))

    # Contiguous chunks: [round(k·N/W), round((k+1)·N/W)).
    bounds = [round(k * frame_count / workers) for k in range(workers + 1)]
    threads: list[threading.Thread] = []
    for k in range(workers):
        lo, hi = bounds[k], bounds[k + 1]
        if hi <= lo:
            continue
        th = threading.Thread(
            target=_render_chunk,
            args=(url, lo, hi, frames_dir, start, fps,
                  config.RENDER_JPEG_QUALITY, on_frame, cancel, errors),
            daemon=True,
        )
        th.start()
        threads.append(th)
    for th in threads:
        th.join()

    try:
        if errors:
            raise RuntimeError("; ".join(errors[:3]))
        if cancel is not None and cancel.is_set():
            raise RuntimeError("cancelled")
        produced = len(list(frames_dir.glob("*.jpg")))
        if produced < frame_count:
            raise RuntimeError(f"frames manquantes ({produced}/{frame_count})")
        proc = subprocess.run(
            _ffmpeg_cmd(fps, start, dur, frames_dir, source, out_path),
            capture_output=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"ffmpeg a échoué ({proc.returncode}) : "
                f"{proc.stderr.decode('utf-8', 'replace')[-1500:]}")
        if progress is not None:
            progress(1.0)
    finally:
        shutil.rmtree(frames_dir, ignore_errors=True)
