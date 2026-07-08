# TEMP (this machine): kill app, back up state, drop stale out2, build with local IC path.
$ErrorActionPreference = 'Stop'
taskkill /F /IM RetailTecAnalytics.exe 2>$null
& "$PSScriptRoot\backup_state_temp.ps1"
if (Test-Path "$PSScriptRoot\out2") {
    Remove-Item "$PSScriptRoot\out2" -Recurse -Force
    Write-Output "STALE_OUT2_REMOVED"
}
$env:RETAILTEC_IC_DIR = 'C:\db_mcp\instantclient_23_0'
& "$PSScriptRoot\build.ps1"
