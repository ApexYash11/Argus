# Argus 60-second demo rehearsal. Run, then screen-record over it.
# Usage: .\demo-video.ps1
$ErrorActionPreference = "Stop"
$WD = "C:\demo-acme"

Write-Host "=== resetting demo workspace ===" -ForegroundColor Cyan
Remove-Item -Path $WD -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $WD -Force | Out-Null
Copy-Item "test-data\*.csv" $WD -Force
Start-Sleep -Seconds 2

Write-Host "`n=== 1/6 demo (bootstrap) ===" -ForegroundColor Cyan
argus --dir $WD demo
Start-Sleep -Seconds 2

Write-Host "`n=== 2/6 status ===" -ForegroundColor Cyan
argus --dir $WD status
Start-Sleep -Seconds 2

Write-Host "`n=== 3/6 findings ===" -ForegroundColor Cyan
argus --dir $WD findings
Start-Sleep -Seconds 2

Write-Host "`n=== 4/6 shareable report ===" -ForegroundColor Cyan
argus --dir $WD report --share
Start-Sleep -Seconds 2

Write-Host "`n=== 5/6 digest ===" -ForegroundColor Cyan
argus --dir $WD digest
Start-Sleep -Seconds 2

Write-Host "`n=== 6/6 web viewer (open browser, then Ctrl+C here) ===" -ForegroundColor Cyan
argus --dir $WD web --open
