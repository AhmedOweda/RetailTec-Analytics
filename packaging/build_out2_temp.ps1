# TEMP: PyInstaller only, to out2 (use when out\RetailTecAnalytics has a stuck dir handle).
# webapp must already be bundled by a previous run of build.ps1.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$py   = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
if (-not (Test-Path $py)) { $py = "python" }

$ic = $env:RETAILTEC_IC_DIR
if (-not $ic) { $ic = 'C:\db_mcp\instantclient-basic-windows.x64-23.26.2.0.0\instantclient_23_0' }
$icArgs = @()
if (Test-Path "$ic\oci.dll") {
    $icArgs = @('--add-data', "$ic;instantclient")
    Write-Host "Bundling Oracle Instant Client from $ic"
} else {
    Write-Host "WARNING: Instant Client not found at $ic"
}

Push-Location "$root\backend"
& $py -m PyInstaller run_server.py `
    --name RetailTecAnalytics `
    --onedir --noconfirm --clean `
    --noconsole `
    --icon "$root\packaging\app.ico" `
    --add-data "$root\packaging\app.ico;." `
    --distpath "$root\packaging\out2" `
    --workpath "$root\packaging\work" `
    --specpath "$root\packaging" `
    --add-data "$root\backend\webapp;webapp" `
    @icArgs `
    --hidden-import uvicorn.logging `
    --hidden-import uvicorn.loops.auto `
    --hidden-import uvicorn.protocols.http.auto `
    --hidden-import uvicorn.protocols.websockets.auto `
    --hidden-import uvicorn.lifespan.on `
    --collect-all duckdb `
    --collect-all oracledb `
    --collect-all cryptography `
    --collect-all pystray
if ($LASTEXITCODE -ne 0) { throw "pyinstaller failed" }
Pop-Location
Write-Host "OUT2_BUILD_DONE"
