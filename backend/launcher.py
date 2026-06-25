"""
RetailTec Analytics — Backend Launcher
=======================================
PyInstaller entry point. Starts the FastAPI app via uvicorn programmatically.
Do NOT import this from main.py — it is only used by PyInstaller.

Build command (see build/build-backend.bat):
    pyinstaller --name backend --noconsole --onedir backend/launcher.py ...
"""
import multiprocessing
import sys
import os

# Required on Windows for PyInstaller + multiprocessing (uvicorn uses it)
multiprocessing.freeze_support()

# When running from a PyInstaller bundle, resolve paths relative to the exe
if getattr(sys, 'frozen', False):
    # _MEIPASS is the temp folder where PyInstaller extracts files
    bundle_dir = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
    # Exe lives one level above _MEIPASS in --onedir mode
    exe_dir = os.path.dirname(sys.executable)
    os.chdir(exe_dir)
    sys.path.insert(0, bundle_dir)

import uvicorn  # noqa: E402  (import after sys.path fix)

if __name__ == '__main__':
    uvicorn.run(
        'main:app',
        host='127.0.0.1',
        port=8000,
        log_level='error',
        access_log=False,
        reload=False,
    )
