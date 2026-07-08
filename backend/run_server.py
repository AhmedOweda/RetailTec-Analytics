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
    """Run uvicorn in a background thread and show a system-tray icon that
    actually helps the user: open dashboard, sync now, restart, open logs/data
    folder, autostart toggle, quit. Raises if pystray/Pillow aren't available
    so the caller can fall back to a plain run."""
    import subprocess
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

    _restart = {"want": False}

    def _open(icon, item):
        webbrowser.open(f"http://127.0.0.1:{PORT}")

    def _sync_now(icon, item):
        """Incremental refresh from the tray — same guard as the scheduler."""
        def _worker():
            from datetime import datetime
            from services import scheduler
            from db import sync as db_sync
            import asyncio as aio
            if scheduler._sync_state["running"]:
                return
            scheduler._mark_start("incremental")
            try:
                aio.run(db_sync.incremental(
                    days=7, progress_cb=scheduler._progress, triggered_by="tray"))
                scheduler._sync_state.update(
                    running=False, step="Done", done=3,
                    last_sync=datetime.now().isoformat())
            except Exception as e:
                scheduler._sync_state.update(running=False, error=str(e), step="Error")
        threading.Thread(target=_worker, daemon=True).start()

    def _syncing(item):
        try:
            from services.scheduler import get_sync_state
            return bool(get_sync_state().get("running"))
        except Exception:
            return False

    def _open_logs(icon, item):
        p = os.path.join(os.path.dirname(sys.executable) if getattr(sys, "frozen", False)
                         else os.getcwd(), "retailtec.log")
        if os.path.exists(p):
            os.startfile(p)

    def _open_data(icon, item):
        # Settings + warehouses live in _internal for the packaged build
        p = getattr(sys, "_MEIPASS", os.getcwd())
        os.startfile(p)

    _RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
    _REG_NAME = "RetailTecAnalytics"

    def _autostart_on():
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as k:
                winreg.QueryValueEx(k, _REG_NAME)
            return True
        except OSError:
            return False

    def _toggle_autostart(icon, item):
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0,
                                winreg.KEY_SET_VALUE) as k:
                if _autostart_on():
                    winreg.DeleteValue(k, _REG_NAME)
                else:
                    winreg.SetValueEx(k, _REG_NAME, 0, winreg.REG_SZ,
                                      f'"{sys.executable}"')
        except Exception as e:
            print(f"[tray] autostart toggle failed: {e}")

    def _restart_app(icon, item):
        _restart["want"] = True
        server.should_exit = True
        icon.stop()

    def _quit(icon, item):
        server.should_exit = True
        icon.stop()

    menu_items = [
        pystray.MenuItem("Open dashboard", _open, default=True),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Sync now (last 7 days)", _sync_now),
        pystray.MenuItem("Syncing…", None, enabled=False, visible=_syncing),
        pystray.MenuItem("Restart", _restart_app),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Open log file", _open_logs),
        pystray.MenuItem("Open data folder", _open_data),
    ]
    if getattr(sys, "frozen", False):
        menu_items.append(pystray.MenuItem(
            "Start with Windows", _toggle_autostart,
            checked=lambda item: _autostart_on()))
    menu_items += [
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(f"Running on 127.0.0.1:{PORT}", None, enabled=False),
        pystray.MenuItem("Quit", _quit),
    ]

    icon = pystray.Icon("RetailTecAnalytics", img, "RetailTec Analytics",
                        menu=pystray.Menu(*menu_items))
    icon.run()   # blocks on the main thread until Quit/Restart

    if _restart["want"]:
        time.sleep(1.5)   # let uvicorn release the port
        args = [sys.executable] if getattr(sys, "frozen", False) \
            else [sys.executable] + sys.argv
        subprocess.Popen(args, cwd=os.getcwd(), close_fds=True)


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
