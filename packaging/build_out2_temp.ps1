# TEMP: PyInstaller only, to out2 (out\RetailTecAnalytics has a stuck dir handle).
# webapp already bundled by the previous run of build.ps1.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$py   = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"

Push-Location "$root\backend"
& $py -m PyInstaller run_server.py `
    --name RetailTecAnalytics `
    --onedir --noconfirm --clean `
    --noconsole `
    --distpath "$root\packaging\out2" `
    --workpath "$root\packaging\work" `
    --specpath "$root\packaging" `
    --add-data "$root\backend\webapp;webapp" `
    --hidden-import uvicorn.logging `
    --hidden-import uvicorn.loops.auto `
    --hidden-import uvicorn.protocols.http.auto `
    --hidden-import uvicorn.protocols.websockets.auto `
    --hidden-import uvicorn.lifespan.on `
    --collect-all duckdb `
    --collect-all oracledb `
    --collect-all pystray
if ($LASTEXITCODE -ne 0) { throw "pyinstaller failed" }
Pop-Location
Write-Host "OUT2_BUILD_DONE"
