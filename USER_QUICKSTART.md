# DanteForge — Quick Start

## 30 seconds to your first score

```bash
npm install -g danteforge
cd your-project
danteforge go
```

DanteForge will ask 3 quick questions, then show your quality score and the single highest-value next improvement.

---

## What you'll see

```
  DanteForge - Project State
  -------------------------------------------------

  Overall  6.8/10  needs-work

  P0 gaps (below 7.0):
    Error handling          ======....  4.0/10
    Testing                 =======...  5.5/10
    Security                =======...  6.2/10

  Recommended next step:
    Your project is weakest at Error handling.
    Best next move:   add safer error messages and recovery paths.
    Expected outcome: fewer crashes and clearer failures for users.
    → danteforge improve "error handling"

  What would you like to do?
    1. Review only           — see full score details, no changes made
    2. Apply one improvement — targeted cycle, ~2-3 min  (recommended)
    3. Run auto-improve      — autonomous loop, 5-20 min
    Enter to skip
```

---

## No API key?

DanteForge works without an API key for scoring and planning.

```bash
danteforge go       # score + guidance, no API needed
danteforge measure  # fast score only
```

To add a provider later:
```bash
danteforge config --set-key "claude:<your-key>"
# or: openai:<key>, grok:<key>, gemini:<key>
```

---

## The 3 commands you need

| What you want | Command |
|--------------|---------|
| See where you stand | `danteforge go` |
| Improve one thing | `danteforge improve "your goal"` |
| Improve everything hands-off | `danteforge auto-improve` |

---

## Going deeper

Once comfortable with `go` and `improve`:

- **`danteforge init --advanced`** — set up LLM provider, adversarial scoring, and competitive targeting
- **`danteforge explain <term>`** — look up any concept in plain English
- **`danteforge help --all`** — see all 100+ commands

---

## Troubleshooting

**"No LLM detected"** — Run `danteforge doctor` to diagnose, or `danteforge config --set-key` to add a provider.

**"No project found"** — Run `danteforge go` from inside your project directory.

**Stuck?** — Run `danteforge help` for the 6 essential commands.
