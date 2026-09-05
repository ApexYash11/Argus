# Slice 2 Spec — Proactive Alerts (webhook/Slack + digest)

## Goal
Findings reach the user without running a command. Secrets stay out of `audit.yaml`
(plaintext, often committed) — webhook URL comes from env or flag.

## UX
```bash
export ARGUS_WEBHOOK_URL="https://hooks.slack.com/services/..."   # Slack incoming webhook
bun run src/cli/index.tsx investigate --alert-min high             # posts critical+high findings
bun run src/cli/index.tsx investigate --webhook https://... --alert-min warning
bun run src/cli/index.tsx digest                                    # weekly markdown summary to stdout
bun run src/cli/index.tsx digest --period Q1-2026
```
- Alerting is fire-and-forget: webhook failure logs one line, never fails the run.
- Default `--alert-min` is `high` (critical + high). Values: `critical|high|warning|info`.
- Each finding posts once (per `finding` event from supervisor).
- `digest` prints markdown: money-found hero, new/open by severity, top 5 leaks,
  review-quality note. Pipe it to email/cron.

## Payload
Slack Block Kit–compatible JSON (works with Slack incoming webhooks; generic
JSON receivers get `text` fallback):
```json
{
  "text": "[high] duplicate payments — Acme Corp — 4,200 INR (85%)",
  "blocks": [ ... section with title, impact, confidence, vendor, finding id ... ]
}
```

## Files
- NEW `src/alerts/webhook.ts`: `SEVERITIES`, `shouldAlert()`, `formatSlack()`,
  `postWebhook()` (fetch, 10s timeout, throws on non-2xx), `resolveWebhook()`
  (flag > env `ARGUS_WEBHOOK_URL` > none).
- EDIT `src/cli/commands/investigate.ts`: accept `{ webhookUrl?, alertMin? }`,
  after each `finding` event call `notifyFinding()` without awaiting failure.
- EDIT `src/cli/index.tsx`: `investigate --webhook --alert-min`; new `digest`
  command + help text.
- NEW `src/cli/commands/digest.ts`: `generateDigest(period?)` → markdown string.
- TEST `src/__tests__/alerts.ts`: threshold logic, Slack payload shape/escaping,
  live POST against localhost `Bun.serve` receiver.

## Acceptance
- [ ] No webhook configured → zero behavior change, no network calls.
- [ ] Bad webhook URL → one-line warning, exit 0, findings still persisted.
- [ ] `digest` on empty workspace → valid markdown with zeros, no crash.
- [ ] `bun src/__tests__/alerts.ts` passes; `report-share.ts` still passes.
- [ ] No new dependencies.

## Out of scope
Retry queues, email provider, cron/daemon setup, per-agent routing rules.
