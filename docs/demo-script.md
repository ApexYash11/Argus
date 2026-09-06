# Argus 60-Second Demo Script (record-ready)

Target: 60 seconds, no voiceover needed (commands + output tell the story).
Record with any screen recorder at 1080p, terminal font 16pt+.

## Setup (before recording)

```powershell
cd D:\Argus
Remove-Item -Path C:\demo-acme -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path C:\demo-acme | Out-Null
Copy-Item test-data\*.csv C:\demo-acme\
```

## Script (timestamps are narration cues, not cuts)

| Time | Type this | Why it lands |
|---|---|---|
| 0:00 | `argus --dir C:\demo-acme demo` | One command: workspace + 5 files + investigation. Output shows files ingested + findings count. |
| 0:15 | `argus --dir C:\demo-acme status` | LLM banner (green check), 7/7 agents, Spend & Burn with trend. |
| 0:25 | `argus --dir C:\demo-acme findings` | The money table — pause 3s here. |
| 0:32 | `argus --dir C:\demo-acme report --share` | Forwardable HTML moment. Open the file in a browser (pre-open `C:\demo-acme\.audit\report.html`). Scroll the hero + top-5. |
| 0:45 | `argus --dir C:\demo-acme web --open` | Browser viewer: findings, burn, runway simulator. Drag the cut slider. |
| 0:55 | `argus --dir C:\demo-acme digest` | Weekly summary. End card: "argus chat — ask in plain English". |

Total: ~60s. If `demo` takes >15s on first run (LLM schema assist), pre-run it once — schema cache makes take two instant.

## Automated rehearsal

```powershell
.\demo-video.ps1   # runs the same sequence with 2s pauses for recording
```
