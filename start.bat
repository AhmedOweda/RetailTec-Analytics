@echo off
echo Starting RetailTec Analytics...

start "Backend - FastAPI" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000"
timeout /t 2 /nobreak >nul
start "Frontend - Vite" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 8 /nobreak >nul
start http://127.0.0.1:7383
