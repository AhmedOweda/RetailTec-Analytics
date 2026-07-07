# Restore app state into the freshly built out\ (mirroring from out2 first if present), then launch.
$src = Join-Path $PSScriptRoot 'out2\RetailTecAnalytics'
$dst = Join-Path $PSScriptRoot 'out\RetailTecAnalytics'
$bak = 'C:\RetailTec\_appstate_backup'

if (Test-Path $src) {
    robocopy $src $dst /MIR /NFL /NDL /NJH /NJS
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed rc=$LASTEXITCODE" }
    Write-Output "MIRROR_OK rc=$LASTEXITCODE"
}

if (Test-Path $bak) {
    Copy-Item "$bak\*" -Destination "$dst\_internal" -Recurse -Force
    Write-Output "STATE_RESTORED"
} else {
    Write-Output "NO_BACKUP_TO_RESTORE"
}

Start-Process -FilePath "$dst\RetailTecAnalytics.exe"
Write-Output "LAUNCHED"
