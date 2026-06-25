@echo off
echo ============================================================
echo  Step 2 of 3 -- Build RetailTec Frontend  (Vite)
echo ============================================================
cd /d "%~dp0..\frontend"

echo Installing npm dependencies...
call npm install
if errorlevel 1 ( echo ERROR: npm install failed & pause & exit /b 1 )

echo Building production bundle...
call npm run build
if errorlevel 1 ( echo ERROR: vite build failed & pause & exit /b 1 )

echo.
echo  Done -- frontend\dist\
echo ============================================================
pause
