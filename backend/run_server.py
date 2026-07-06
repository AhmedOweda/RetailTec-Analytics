"""
RetailTec Analytics — packaged entry point
==========================================
Starts the API + bundled web app on one port and opens the browser.
This is what the PyInstaller build wraps into RetailTecAnalytics.exe.
"""
import os
import sys
import threading
import time
import webbrowser

# When frozen by PyInstaller, resources live next to the executable
if getattr(sys, "frozen", False):
    BASE = os.path.dirname(sys.executable)
    os.chdir(BASE)                 # settings.json, warehouse, backups live here
    sys.path.insert(0, BASE)
    # Built as a windowed app (console=False) → there is NO console, so
    # sys.stdout / sys.stderr are None. uvicorn and the logging module would
    # crash writing to them. Redirect both to a rolling log file next to the exe.
    try:
        _logf = open(os.path.join(BASE, "retailtec.log"), "a",
                     buffering=1, encoding="utf-8", errors="replace")
        sys.stdout = _logf
        sys.stderr = _logf
    except Exception:
        # Last resort: swallow output so a None stream never crashes the app.
        import io
        sys.stdout = sys.stderr = io.StringIO()

PORT = int(os.environ.get("RETAILTEC_PORT", "7382"))


def _open_browser():
    time.sleep(2.5)
    try:
        webbrowser.open(f"http://127.0.0.1:{PORT}")
    except Exception:
        pass


def _run_with_tray(app):
    """Run uvicorn in a background thread and show a system-tray icon with
    'Open dashboard' and 'Quit'. Gives the windowless (no-console) build a way
    to be controlled. Raises if pystray/Pillow aren't available so the caller
    can fall back to a plain run."""
    import uvicorn
    import pystray
    from PIL import Image, ImageDraw

    config = uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="info")
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, daemon=True).start()

    # Simple brand-coloured tray glyph (no external asset needed)
    img = Image.new("RGB", (64, 64), "#160b33")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([14, 14, 50, 50], radius=8, fill="#7c3aed")

    def _open(icon, item):
        webbrowser.open(f"http://127.0.0.1:{PORT}")

    def _quit(icon, item):
        server.should_exit = True
        icon.stop()

    icon = pystray.Icon(
        "RetailTecAnalytics", img, "RetailTec Analytics",
        menu=pystray.Menu(
            pystray.MenuItem("Open dashboard", _open, default=True),
            pystray.MenuItem("Quit", _quit),
        ),
    )
    icon.run()   # blocks on the main thread until Quit


def main():
    import uvicorn
    from main import app
    threading.Thread(target=_open_browser, daemon=True).start()
    try:
        _run_with_tray(app)          # windowed build: controllable via the tray
    except Exception as e:
        print(f"[run_server] tray unavailable ({e}); running without it")
        uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")


if __name__ == "__main__":
    main()
