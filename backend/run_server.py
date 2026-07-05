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

PORT = int(os.environ.get("RETAILTEC_PORT", "3001"))


def _open_browser():
    time.sleep(2.5)
    try:
        webbrowser.open(f"http://127.0.0.1:{PORT}")
    except Exception:
        pass


def main():
    import uvicorn
    from main import app
    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")


if __name__ == "__main__":
    main()
