# AI Spend Auditor — End-to-End Demo
# Run from the project root: ./demo.ps1

$AUDIT = { bun run src/cli/index.tsx $args }

function Run-Step {
  param([string]$Desc, [scriptblock]$Cmd)
  Write-Host $Desc -ForegroundColor Green
  & $Cmd
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED at: $Desc" -ForegroundColor Red; exit $LASTEXITCODE }
}

Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   AI Spend Auditor — End-to-End Demo        ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Remove-Item -Path ".audit" -Recurse -ErrorAction SilentlyContinue

Run-Step "Step 1: Initialize workspace" { & $AUDIT init --company "Demo Corp" }

Run-Step "Step 2a: Ingest subscriptions"     { & $AUDIT ingest test-data/subscriptions.csv }
Run-Step "Step 2b: Ingest usage"             { & $AUDIT ingest test-data/usage.csv }
Run-Step "Step 2c: Ingest transactions"      { & $AUDIT ingest test-data/transactions.csv }
Run-Step "Step 2d: Ingest expense reports"   { & $AUDIT ingest test-data/expense-reports.csv }
Run-Step "Step 2e: Ingest committed expenses" { & $AUDIT ingest test-data/committed-expenses.csv }
Run-Step "Step 2f: Ingest invoices"          { & $AUDIT ingest test-data/test-invoices/inv-001.pdf }

Run-Step "Step 3: Run investigation" { & $AUDIT investigate }
Run-Step "Step 4: Browse findings"   { & $AUDIT findings }
Run-Step "Step 5: System status"     { & $AUDIT status }
Run-Step "Step 6: Generate report"   { & $AUDIT report }

Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Demo complete                              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
