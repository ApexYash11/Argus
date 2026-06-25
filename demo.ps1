# AI Spend Auditor — End-to-End Demo
# Run this from the project root: ./demo.ps1
# Requires Bun installed and `audit` alias set up, or use `bun run src/cli/index.tsx`

$AUDIT = { bun run src/cli/index.tsx }

Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   AI Spend Auditor — End-to-End Demo        ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Step 1: Initialize workspace
Write-Host "── Step 1: Initialize workspace ──" -ForegroundColor Green
Remove-Item -Path ".audit" -Recurse -ErrorAction SilentlyContinue
& $AUDIT init --company "Demo Corp"
if ($LASTEXITCODE -ne 0) { Write-Host "FAILED"; exit 1 }
Write-Host ""

# Step 2: Ingest test data
Write-Host "── Step 2: Ingest all test data ──" -ForegroundColor Green
Write-Host "  Ingesting subscriptions.csv..." -ForegroundColor Yellow
& $AUDIT ingest test-data/subscriptions.csv
Write-Host "  Ingesting usage.csv..." -ForegroundColor Yellow
& $AUDIT ingest test-data/usage.csv
Write-Host "  Ingesting transactions.csv..." -ForegroundColor Yellow
& $AUDIT ingest test-data/transactions.csv
Write-Host "  Ingesting expense-reports.csv..." -ForegroundColor Yellow
& $AUDIT ingest test-data/expense-reports.csv
Write-Host "  Ingesting committed-expenses.csv..." -ForegroundColor Yellow
& $AUDIT ingest test-data/committed-expenses.csv
Write-Host "  Ingesting invoices..." -ForegroundColor Yellow
& $AUDIT ingest test-data/test-invoices/inv-001.pdf
Write-Host ""

# Step 3: Run investigation
Write-Host "── Step 3: Run investigation engine ──" -ForegroundColor Green
& $AUDIT investigate
Write-Host ""

# Step 4: Browse findings
Write-Host "── Step 4: Browse findings ──" -ForegroundColor Green
& $AUDIT findings
Write-Host ""

# Step 5: Show status
Write-Host "── Step 5: System status ──" -ForegroundColor Green
& $AUDIT status
Write-Host ""

# Step 6: Generate report
Write-Host "── Step 6: Generate report ──" -ForegroundColor Green
& $AUDIT report
Write-Host ""

Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Demo complete                              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
