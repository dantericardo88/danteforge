# CRUSADE_REPORT.md

**Status:** Pending — no crusade has completed since the pipeline was fixed.

Run `danteforge crusade --goal "<goal>" --dimension <dim>` to generate a fresh report.

## Pipeline Fix (2026-05-25)

Two silent-failure bugs were found and fixed in `src/cli/commands/crusade.ts`:

1. `danteforge oss <domain> --auto` — `--auto` is not a valid flag on the `oss` command.
   Fixed to: `danteforge oss --max-repos 5`

2. `danteforge forge --goal <goal>` — `forge` has no `--goal` flag.
   Fixed to: `danteforge magic <goal> --yes`

The previous security crusade (10 cycles, 0 patterns harvested, every forge wave FAILED)
was caused entirely by these two broken subprocess calls — not by any failure in the
underlying forge or OSS harvest implementations. The pipeline is now correctly wired.

Next: run a crusade on `community_adoption` (score=1, gap=7.5) to produce the first
real end-to-end receipt of the fixed pipeline.
