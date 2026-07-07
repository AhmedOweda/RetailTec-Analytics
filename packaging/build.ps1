# RetailTec Analytics — production build
# =======================================
# Produces a self-contained folder (no Python/Node required on the customer
# machine) at packaging\out\RetailTecAnalytics\:
#   RetailTecAnalytics.exe   — starts API + web app on :7382, opens browser
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
& $py -m pip install pyinstaller pystray pillow cryptography --quiet

# Oracle Instant Client to bundle (redistributable under its BASIC_LICENSE).
# Override with RETAILTEC_IC_DIR; skipped with a warning if not found.
$ic = $env:RETAILTEC_IC_DIR
if (-not $ic) { $ic = 'C:\db_mcp\instantclient-basic-windows.x64-23.26.2.0.0\instantclient_23_0' }
$icArgs = @()
if (Test-Path "$ic\oci.dll") {
    $icArgs = @('--add-data', "$ic;instantclient")
    Write-Host "Bundling Oracle Instant Client from $ic"
} else {
    Write-Host "WARNING: Instant Client not found at $ic - exe will need it on the customer machine"
}
Push-Location "$root\backend"
& $py -m PyInstaller run_server.py `
    --name RetailTecAnalytics `
    --onedir --noconfirm --clean `
    --noconsole `
    --distpath "$root\packaging\out" `
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

Write-Host "== 4/5 Building one-click installer (if Inno Setup is installed) =="
$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (Test-Path $iscc) {
    & $iscc "$PSScriptRoot\installer.iss"
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup compile failed" }
    Write-Host "Installer: $root\packaging\Output\RetailTecAnalytics-Setup.exe"
} else {
    Write-Host "Inno Setup not found (skipping). Install it from https://jrsoftware.org/isdl.php"
    Write-Host "then run:  & '$iscc' '$PSScriptRoot\installer.iss'"
}

Write-Host "== 5/5 Done =="
Write-Host "Portable folder: $root\packaging\out\RetailTecAnalytics\RetailTecAnalytics.exe"
Write-Host "Installer (if built): $root\packaging\Output\RetailTecAnalytics-Setup.exe"
Write-Host "Customer prerequisite: Oracle Instant Client at C:\Oracle\instantclient."
