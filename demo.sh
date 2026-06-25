#!/usr/bin/env bash
# AI Spend Auditor — End-to-End Demo
# Run from project root: ./demo.sh
# Requires Bun installed

set -e

AUDIT="bun run src/cli/index.tsx"

echo "╔══════════════════════════════════════════════╗"
echo "║   AI Spend Auditor — End-to-End Demo        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Step 1: Initialize workspace
echo "── Step 1: Initialize workspace ──"
rm -rf .audit
$AUDIT init --company "Demo Corp"
echo ""

# Step 2: Ingest test data
echo "── Step 2: Ingest all test data ──"
echo "  Ingesting subscriptions.csv..."
$AUDIT ingest test-data/subscriptions.csv
echo "  Ingesting usage.csv..."
$AUDIT ingest test-data/usage.csv
echo "  Ingesting transactions.csv..."
$AUDIT ingest test-data/transactions.csv
echo "  Ingesting expense-reports.csv..."
$AUDIT ingest test-data/expense-reports.csv
echo "  Ingesting committed-expenses.csv..."
$AUDIT ingest test-data/committed-expenses.csv
echo "  Ingesting invoices..."
$AUDIT ingest test-data/test-invoices/inv-001.pdf
echo ""

# Step 3: Run investigation
echo "── Step 3: Run investigation engine ──"
$AUDIT investigate
echo ""

# Step 4: Browse findings
echo "── Step 4: Browse findings ──"
$AUDIT findings
echo ""

# Step 5: Show status
echo "── Step 5: System status ──"
$AUDIT status
echo ""

# Step 6: Generate report
echo "── Step 6: Generate report ──"
$AUDIT report
echo ""

echo "╔══════════════════════════════════════════════╗"
echo "║   Demo complete                              ║"
echo "╚══════════════════════════════════════════════╝"
