@echo off
setlocal
echo ============================================================
echo  Step 1 of 3 -- Build RetailTec Backend  (PyInstaller)
echo ============================================================
cd /d "%~dp0.."

echo [1/3] Installing PyInstaller...
python -m pip install -r backend/requirements-build.txt --quiet
if errorlevel 1 ( echo ERROR: pip install failed & pause & exit /b 1 )

echo [2/3] Installing runtime requirements...
python -m pip install -r backend/requirements.txt --quiet
if errorlevel 1 ( echo ERROR: pip install failed & pause & exit /b 1 )

echo [3/3] Running PyInstaller...
python -m PyInstaller ^
  --name backend ^
  --noconsole ^
  --onedir ^
  --distpath backend\dist ^
  --workpath backend\build_temp ^
  --specpath backend ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.loops ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.protocols ^
  --hidden-import uvicorn.protocols.http ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.websockets ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  --hidden-import uvicorn.lifespan ^
  --hidden-import uvicorn.lifespan.on ^
  --hidden-import oracledb ^
  --hidden-import oracledb.impl ^
  --hidden-import oracledb.impl.thin ^
  --collect-all oracledb ^
  --add-data "cache_config.json;." ^
  backend\launcher.py

if errorlevel 1 ( echo ERROR: PyInstaller failed & pause & exit /b 1 )

echo.
echo  Done -- backend\dist\backend\backend.exe
echo ============================================================
pause
