---
name: wiki-status
description: "Display wiki health metrics: page count, link density, orphan pages, staleness, lint pass rate, anomaly flags."
---

# /wiki-status — Wiki Health Dashboard

When the user invokes `/wiki-status`, display wiki health metrics:

1. **Page count**: Total compiled entity pages in `wiki/`.

2. **Link density**: Average inbound + outbound links per page. Target: >3.0.

3. **Orphan ratio**: Fraction of pages with zero inbound links. Target: <5%.

4. **Staleness score**: Fraction of pages not updated in 30+ days. Target: <10%.

5. **Lint pass rate**: Fraction of pages with zero lint issues. Target: >95%.

6. **Last lint timestamp**: When the lint cycle last ran.

7. **PDSE anomaly count**: Number of active anomaly flags from PDSE score history. Any flag ≥15pt delta is surfaced as a warning.

Output formats:
- Default: human-readable dashboard
- `--json`: Structured JSON for programmatic use

CLI usage: `danteforge wiki-status [--json]`

If wiki is not initialized, suggests running `wiki-ingest --bootstrap`.
