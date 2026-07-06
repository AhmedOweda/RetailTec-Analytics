# TEMP: mirror out2 build into out, restore app state, launch.
$src = 'C:\RetailTec Analytics\RetailTec-Analytics\packaging\out2\RetailTecAnalytics'
$dst = 'C:\RetailTec Analytics\RetailTec-Analytics\packaging\out\RetailTecAnalytics'
$bak = 'C:\RetailTec Analytics\_appstate_backup'

robocopy $src $dst /MIR /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { throw "robocopy failed rc=$LASTEXITCODE" }
Write-Output "MIRROR_OK rc=$LASTEXITCODE"

Copy-Item "$bak\*" -Destination "$dst\_internal" -Force
Write-Output "STATE_RESTORED"

Start-Process -FilePath "$dst\RetailTecAnalytics.exe"
Write-Output "LAUNCHED"
