$dst = Join-Path $PSScriptRoot 'out\RetailTecAnalytics\_internal'
$bak = 'C:\RetailTec\_appstate_backup'
New-Item -ItemType Directory -Force -Path $bak | Out-Null
if (Test-Path $dst) {
    Copy-Item "$dst\settings.json","$dst\.jwt_secret" -Destination $bak -Force -ErrorAction SilentlyContinue
    Copy-Item "$dst\retailtec_*.db*" -Destination $bak -Force -ErrorAction SilentlyContinue
    if (Test-Path "$dst\backups") { Copy-Item "$dst\backups" -Destination $bak -Recurse -Force }
    Get-ChildItem $bak | Select-Object -ExpandProperty Name
    Write-Output "BACKUP_OK"
} else {
    Write-Output "NO_STATE_DIR (fresh build, nothing to back up)"
}
