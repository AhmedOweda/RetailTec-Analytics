$iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'
if (-not (Test-Path $iscc)) { $iscc = Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe' }
if (-not (Test-Path $iscc)) { throw "ISCC.exe not found" }
& $iscc (Join-Path $PSScriptRoot 'installer.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC failed rc=$LASTEXITCODE" }
$out = Join-Path $PSScriptRoot 'Output\RetailTecAnalytics-Setup.exe'
$mb  = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Output "INSTALLER_OK $out ($mb MB)"
