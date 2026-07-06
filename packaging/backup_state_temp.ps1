$dst = 'C:\RetailTec Analytics\RetailTec-Analytics\packaging\out\RetailTecAnalytics\_internal'
$bak = 'C:\RetailTec Analytics\_appstate_backup'
Copy-Item "$dst\settings.json","$dst\.jwt_secret" -Destination $bak -Force
Copy-Item "$dst\retailtec_*.db*" -Destination $bak -Force
Get-ChildItem $bak | Select-Object -ExpandProperty Name
Write-Output "BACKUP_OK"
