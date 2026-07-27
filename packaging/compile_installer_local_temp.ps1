# Compile installer.iss with Inno Setup 6 (ISCC). "temp"-named but LOAD-BEARING:
# _fullbuild2.ps1 calls this — do not delete (same rule as backup_state_temp /
# finish_deploy_temp). Checks the per-user install first (winget default on this
# machine), then Program Files (x86).
$candidates = @(
    'C:\Users\Ahmed\AppData\Local\Programs\Inno Setup 6\ISCC.exe',
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
)
$iscc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "ISCC.exe not found in: $($candidates -join '; ')" }
Write-Output "ISCC: $iscc"
& $iscc (Join-Path $PSScriptRoot 'installer.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC failed rc=$LASTEXITCODE" }
Write-Output 'ISCC_OK'
