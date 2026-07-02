@echo off
echo Starting RetailTec Analytics...

start "Backend - FastAPI" cmd /k "cd /d C:\RetailTec Analytics\RetailTec-Analytics\backend && uvicorn main:app --reload --port 8000"
timeout /t 2 /nobreak >nul
start "Frontend - Vite" cmd /k "cd /d C:\RetailTec Analytics\RetailTec-Analytics\frontend && npm run dev"

timeout /t 5 /nobreak >nul
start http://localhost:3000
