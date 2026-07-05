# RetailTec Analytics — production build
# =======================================
# Produces a self-contained folder (no Python/Node required on the customer
# machine) at packaging\out\RetailTecAnalytics\:
#   RetailTecAnalytics.exe   — starts API + web app on :3001, opens browser
#   _internal\               — frozen Python runtime + bundled frontend
#
# Requirements on the BUILD machine only: Python 3.12 + Node 18+.
# Oracle Instant Client must exist on the CUSTOMER machine (C:\Oracle\instantclient)
# — same as today; it cannot be redistributed inside our installer.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$py   = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
if (-not (Test-Path $py)) { $py = "python" }

Write-Host "== 1/4 Building frontend =="
$env:ComSpec = "$env:SystemRoot\System32\cmd.exe"
Push-Location "$root\frontend"
npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
Pop-Location

Write-Host "== 2/4 Bundling frontend into backend\webapp =="
Remove-Item "$root\backend\webapp" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$root\frontend\dist" "$root\backend\webapp" -Recurse

Write-Host "== 3/4 Freezing backend with PyInstaller =="
& $py -m pip install pyinstaller --quiet
Push-Location "$root\backend"
& $py -m PyInstaller run_server.py `
    --name RetailTecAnalytics `
    --onedir --noconfirm --clean `
    --noconsole `

    --distpath "$root\packaging\out" `
    --workpath "$root\packaging\work" `
    --specpath "$root\packaging" `
    --add-data "$root\backend\webapp;webapp" `
    --hidden-import uvicorn.logging `
    --hidden-import uvicorn.loops.auto `
    --hidden-import uvicorn.protocols.http.auto `
    --hidden-import uvicorn.protocols.websockets.auto `
    --hidden-import uvicorn.lifespan.on `
    --collect-all duckdb `
    --collect-all oracledb
if ($LASTEXITCODE -ne 0) { throw "pyinstaller failed" }
Pop-Location

Write-Host "== 4/4 Done =="
Write-Host "Package: $root\packaging\out\RetailTecAnalytics\RetailTecAnalytics.exe"
Write-Host "Ship that folder (zip or wrap with Inno Setup). Customer needs only"
Write-Host "Oracle Instant Client at C:\Oracle\instantclient."
