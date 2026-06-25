@echo off
echo ============================================================
echo  Step 3 of 3 -- Package RetailTec Analytics  (electron-builder)
echo ============================================================
cd /d "%~dp0.."

echo Checking that backend and frontend are built...
if not exist "backend\dist\backend\backend.exe" (
  echo ERROR: backend\dist\backend\backend.exe not found.
  echo        Run build\build-backend.bat first.
  pause & exit /b 1
)
if not exist "frontend\dist\index.html" (
  echo ERROR: frontend\dist\index.html not found.
  echo        Run build\build-frontend.bat first.
  pause & exit /b 1
)

echo Installing Electron dependencies...
call npm install
if errorlevel 1 ( echo ERROR: npm install failed & pause & exit /b 1 )

echo Building Windows installer (no code signing -- internal build)...

REM Skip code signing -- avoids winCodeSign symlink errors on non-admin Windows
set CSC_IDENTITY_AUTO_DISCOVERY=false
set CSC_LINK=
set WIN_CSC_LINK=

call npx electron-builder --win
if errorlevel 1 ( echo ERROR: electron-builder failed & pause & exit /b 1 )

echo.
echo  Done -- installer is in dist-electron\
echo  Look for: RetailTec Analytics Setup 2.0.0.exe
echo.
echo  Optional: to add a custom icon later, place a valid 256x256 .ico file at
echo            electron\assets\icon.ico  and re-run this script.
echo ============================================================
pause
