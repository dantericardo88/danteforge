---
name: daily-driver
description: Run the Daily Driver flow — score → prime → go → teach → proof arc. Full quality flywheel for every session.
contract_version: "danteforge.workflow/v1"
stages: [score, prime, go, teach, proof]
execution_mode: sequential
failure_policy: continue
verification_required: false
---

# /daily-driver — Daily Quality Flywheel

When the user invokes `/daily-driver`, execute the full Daily Driver flow in sequence:

1. Run `danteforge score` — get the current quality number and top 3 P0 gaps. Note the score and the three action items printed. PRIME.md is auto-refreshed.

2. Run `danteforge prime` — regenerate `.danteforge/PRIME.md` with the latest score, gaps, and anti-patterns. Tell the user to load it with `@.danteforge/PRIME.md` in their next Claude Code message.

3. Run `danteforge go` — launch the self-improve loop (5 cycles, target 9.0). Wait for it to complete. Report the before and after scores.

4. If the user has any corrections to capture from this session (AI mistakes, wrong approaches), run `danteforge teach "<correction text>"` for each one. Each call updates lessons.md and PRIME.md.

5. Run `danteforge proof --since yesterday` — show the score arc for today. Report before score, after score, and gain.

After all steps complete, report:
- Starting score and ending score
- How many cycles ran in `go`
- Any lessons captured via `teach`
- The proof arc gain for the day

CLI parity: `danteforge flow` (shows guidance) | individual commands as listed above
