$candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe'
)
$iscc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "ISCC.exe not found in any known location" }
Write-Output "Using $iscc"
& $iscc (Join-Path $PSScriptRoot 'installer.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC failed rc=$LASTEXITCODE" }
$out = Join-Path $PSScriptRoot 'Output\RetailTecAnalytics-Setup.exe'
$mb  = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Output "INSTALLER_OK $out ($mb MB)"
