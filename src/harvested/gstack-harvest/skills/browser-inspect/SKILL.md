---
name: browser-inspect
domain: fullstack
source: gstack-harvest
version: 0.8.0
requires:
  - browse-binary
integrates:
  - verify
  - ux-refine
  - qa
---

# Browser Inspect Skill

## Iron Law
Every verification claim about a web application MUST be backed by runtime evidence (screenshot, accessibility snapshot, or console capture). File-existence checks alone are insufficient for web projects.

## Process
1. **Navigate**: `danteforge browse goto <url>` — confirm page loads with HTTP 200.
2. **Screenshot**: `danteforge browse screenshot` — capture PNG evidence to `.danteforge/evidence/`.
3. **Accessibility**: `danteforge browse accessibility` — capture accessibility tree for a11y audit.
4. **Console**: `danteforge browse console` — check for JavaScript errors.
5. **Network**: `danteforge browse network` — verify no failed API calls.
6. **Performance**: `danteforge browse perf` — check Core Web Vitals (LCP, CLS, FID).

## Red Flags
- Screenshot shows blank page or error state
- Accessibility tree has no landmark elements
- Console output contains uncaught exceptions
- Network log shows 5xx responses on critical endpoints
- LCP > 4000ms indicates severely degraded performance

## Checklist
- [ ] Page navigation succeeds (HTTP 200)
- [ ] Screenshot shows expected UI state
- [ ] No critical accessibility violations
- [ ] No uncaught JavaScript errors in console
- [ ] No 5xx network responses
- [ ] Core Web Vitals within acceptable thresholds
- [ ] Evidence files saved to `.danteforge/evidence/`
- [ ] Audit log updated with evidence paths
