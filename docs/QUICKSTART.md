# DanteForge Quick Start

Five steps from install to your first automated improvement.

---

## Step 1 — Install

```bash
npm install -g danteforge
```

**What it does:** Installs the `danteforge` CLI globally.
**What you'll see:** Nothing. Run `danteforge --version` to confirm.

---

## Step 2 — Run `danteforge go` in your project

```bash
cd your-project
danteforge go
```

**What it does:** Asks 3 quick questions (what you're building, how you like to work, whether you have an API key), then shows your quality score.

**What you'll see:**
```
  What are you building? (brief description, Enter to skip)
  > A REST API for my SaaS app

  How do you want to work?
    1. Plan first  2. Improve one thing  3. Full autonomous push
  Enter choice [2]: 2

  How do you want to start?
    1. Offline first  2. Live AI is ready  3. Set up AI later
  Enter choice [1]: 1

  Overall  6.8/10  needs-work
  P0 gaps: Error handling (4.0)  Testing (5.5)  Security (6.2)
```

---

## Step 3 — Look at your top gap

DanteForge will highlight your weakest dimension and explain it in plain English:

```
  Your project is weakest at Error handling.
  Best next move:   add safer error messages and recovery paths.
  Expected outcome: fewer crashes and clearer failures for users.
  → danteforge improve "error handling"
```

Don't know what a term means? Run `danteforge explain <term>` — for example:
```bash
danteforge explain "error handling"
danteforge explain testing
```

---

## Step 4 — Apply one improvement

When prompted, choose option 2:
```
  What would you like to do?
    1. Review only
    2. Apply one improvement — targeted cycle, ~2-3 min
    3. Run auto-improve
  Your choice [2]: 2
```

Or run directly:
```bash
danteforge improve "error handling"
```

**What it does:** Runs one LLM-driven improvement cycle targeting your weakest gap, then re-scores.
**What you'll see:** A before/after score showing the gain from that cycle.

> No API key yet? Run `danteforge config --set-key "claude:<key>"` first, then retry.

---

## Step 5 — Check your new score

```bash
danteforge measure
```

**What it does:** Shows your updated score + top 3 gaps with human explanations.
**What you'll see:**
```
  7.2/10  — needs-work  (▲ +0.4 today)

  P0 gaps:
  1. Testing                6.0/10  — insufficient tests, bugs are harder to catch
     → danteforge improve "testing"
  2. Security               6.5/10  — security gaps that could expose user data
     → danteforge improve "security"
```

---

## What's next?

- Run `danteforge auto-improve` for a hands-off loop until 9.0/10
- Run `danteforge init --advanced` to set up adversarial scoring and competitive targeting
- Run `danteforge help --all` for all 100+ commands
- Run `danteforge explain <term>` for any unfamiliar concept
