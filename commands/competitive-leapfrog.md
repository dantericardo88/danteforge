---
name: competitive-leapfrog
description: Run the Competitive Leapfrog flow — score gaps against competitors, sprint to close them with automated inferno cycles, print victory when you're ahead.
contract_version: "danteforge.workflow/v1"
stages: [compete-init, compete-auto, score, prime]
execution_mode: autonomous
failure_policy: continue
verification_required: false
---

# /competitive-leapfrog — Competitive Leapfrog Flow

When the user invokes `/competitive-leapfrog`, execute the full Competitive Harvest Loop:

1. Check whether the CHL matrix exists at `.danteforge/compete/matrix.json`. If it does not exist or the user has not run `--init` before, run `danteforge compete --init` first — this bootstraps the 18-dimension benchmark matrix against the 27-competitor universe. This step takes several minutes.

2. Run `danteforge compete --report` — display the current competitive gap table. Note which dimension has the largest weighted gap (this is the top sprint target).

3. Run `danteforge compete --sprint --auto` — this starts the autonomous sprint loop:
   - Picks the highest-priority gap (weight × gap × frequency)
   - Runs `danteforge inferno` targeting that dimension with a specific goal
   - Rescores post-sprint using the harsh scorer
   - Updates the matrix
   - If your score on that dimension now meets or exceeds the competitor's: prints a victory message
   - Continues to the next gap
   - Loops up to 5 cycles (default), then stops and reports remaining gaps

4. After the auto-sprint loop completes, run `danteforge score` — show the updated overall score.

5. Run `danteforge prime` — refresh PRIME.md with the new competitive position. Tell the user to reload `@.danteforge/PRIME.md`.

After all steps complete, report:
- Which dimensions were sprinted on (up to 5)
- Victory messages for any dimension where you overtook the competitor
- Overall score before and after
- Which dimension is next (if gaps remain)
- Command to continue: `danteforge compete --sprint --auto`

CLI parity: `danteforge compete --init` then `danteforge compete --sprint --auto`
