# Magic Levels

Token-Optimized Magic Preset System

| Command | Intensity | Token Level | Combines (Best Of) | Primary Use Case | Expected Quality Level |
| --- | --- | --- | --- | --- | --- |
| /spark | Planning | Zero | review + constitution + specify + clarify + tech-decide + plan + tasks | Every new idea or project start | Level 1: Sketch (proves idea works) |
| /ember | Light | Very Low | Budget magic + light checkpoints + basic loop detect | Quick features, prototyping, token-conscious work | Level 2: Prototype (investor-ready) |
| /canvas | Design-First | Low-Medium | Design generation + autoforge + UX token extraction + verify | Frontend-heavy features where visual design drives implementation | Level 3: Alpha (internal team use) |
| /magic | Balanced (Default) | Low-Medium | Balanced party lanes + autoforge reliability + verify + lessons | Daily main command - 80% of all work | Level 4: Beta (paid beta customers) |
| /blaze | High | High | Full party + strong autoforge + synthesize + retro + self-improve | Big features needing real power | Level 5: Customer-Ready (production launch) |
| /nova | Very High | High-Max | Planning prefix + blaze execution + inferno polish (no OSS) | Feature sprints that need planning + deep execution without OSS overhead | Level 6: Enterprise-Grade (Fortune 500) |
| /inferno | Maximum | Maximum | Full party + max autoforge + deep OSS mining + evolution | First big attack on new matrix dimension | Level 6: Enterprise-Grade (Fortune 500) |

## Usage Rule

- /canvas for frontend-heavy features where visual design drives implementation.
- First-time new matrix dimension + fresh OSS discovery -> /inferno
- All follow-up PRD gap closing -> /magic

## Quality Standards

Each preset targets a specific **maturity level** (1-6). The convergence loop uses this target to prevent "premature done":

- **Sketch (Level 1)**: Proves the idea works — happy path only, no tests, raw UI
- **Prototype (Level 2)**: Investor-ready — basic tests (50%+ coverage), input validation, README
- **Alpha (Level 3)**: Internal team use — 70%+ coverage, structured logging, accessible UI
- **Beta (Level 4)**: Paid beta customers — 80%+ coverage, error recovery, HTTPS enforced
- **Customer-Ready (Level 5)**: Production launch — 85%+ coverage, monitoring, pen-tested
- **Enterprise-Grade (Level 6)**: Fortune 500 — 90%+ coverage, multi-tenant, SOC2/GDPR ready

After the main build pipeline, DanteForge runs a **maturity assessment**. If the current level is below the target, it triggers **focused remediation** (3 autoforge waves) to close critical quality gaps.

See `docs/MATURITY-SYSTEM.md` for detailed explanations and the 8 quality dimensions.

## Notes

- /magic remains the default balanced preset and the hero command.
- All preset execution paths default to the budget profile unless you override --profile.
- /spark is planning-only with tech-decide (use --skip-tech-decide to bypass).
- /canvas is design-first: generates DESIGN.op, autoforges from it, and extracts tokens.
- /blaze, /nova, and /inferno add full party orchestration on top of autoforge reliability.
- /nova adds a planning prefix (constitution + plan + tasks) without OSS.
- Add --with-design to /blaze, /nova, or /inferno to include design + ux-refine steps.
- Run `danteforge maturity --preset <level>` to check if your code meets the quality standard.
