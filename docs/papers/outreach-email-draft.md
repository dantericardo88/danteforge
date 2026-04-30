# Outreach Email Draft — DELEGATE-52 Replication Study

**Date drafted:** 2026-04-29
**Founder gate:** GATE-6 (per [docs/PRD-TIME-MACHINE-PUBLICATION-PLAN.md](../PRD-TIME-MACHINE-PUBLICATION-PLAN.md))
**Status:** awaiting founder review and personalization

> **NOTICE:** This is a peer-tone outreach draft prepared by the agent. The agent does NOT send the email. The founder reviews, personalizes (real names + addresses + final preprint URL), and sends. Sending is GATE-6.

---

## Recommended send conditions

Send AFTER:
1. Live DELEGATE-52 GATE-1 has fired and the comparison document's §5.4.2 placeholders are populated with real D1/D3/D4 numbers
2. arXiv preprint has been compiled, founder-reviewed, and submitted (GATE-5) — placeholder `[ARXIV_URL]` and `[DOI_URL]` need to be replaced
3. The repository's MIT license + `@danteforge/evidence-chain` v1.1.0 are tagged + published
4. The reproducibility appendix is locked at the version hash being cited

If sending BEFORE the live GATE-1 run, retitle as a "draft replication, request for early read" — the substrate-only version of the paper (Classes A/B/C/E/F/G) is publishable as honest replication, but the framing is "preliminary; live LLM replication awaits budget authorization."

---

## Recipients (founder to confirm + lookup)

**Primary recipients (paper authors):**
- Philippe Laban (Microsoft Research)
- Tobias Schnabel (Microsoft Research)
- Jennifer Neville (Microsoft Research)

**Suggested CCs:**
- Microsoft Research benchmarks team contact (founder lookup)
- Internal: `richard.porras@realempanada.com` (sender's address)

---

## Subject line options

**Strongest (post-GATE-1):**
> Replication of DELEGATE-52: cryptographic-substrate mitigation, full results table

**For early-read (pre-GATE-1):**
> Replication study of DELEGATE-52 in DanteForge — would love your read

**Most-academic:**
> Empirical replication of DELEGATE-52 with cryptographic substrate (DanteForge) — preprint + repo

---

## Email body — peer-tone, ~300 words

---

Subject: **Replication study of DELEGATE-52 in DanteForge — would love your read**

Dear Drs. Laban, Schnabel, and Neville,

We replicated your DELEGATE-52 benchmark using DanteForge's cryptographic evidence chain + Time Machine substrate. The full results table is in the attached arXiv preprint at [ARXIV_URL] (DOI: [DOI_URL]) and the substrate is MIT-licensed at https://github.com/realempanada/DanteForge. The full replication CLI is in the appendix; one command reproduces the result table.

Honest summary of what we found:

- **Substrate-only properties** (Classes A/B/C/E/G) all meet the PRD minimum-success criteria: byte-perfect tamper-evidence at 1000 commits, byte-identical reversibility, gap-free causal completeness, all five adversarial scenarios detected, and end-to-end integration with our constitutional gates.
- **Live DELEGATE-52 round-trip** (Class D, against the public 48-domain CDLA Permissive 2.0 release): [INSERT POST-GATE-1 NUMBERS HERE — D1 cost-of-substrate per edit, D3 causal-source identification rate, D4 corruption rate with substrate active vs your 25% baseline].
- **Scale** (Class F): tamper-evidence verifier meets the 10K and 100K thresholds after Pass 27 optimization (100K verify ~141 s, query ~7.3 s, restore ~4 ms). The 1M benchmark remains founder-gated and is not claimed.
- **What we did NOT test:** the 76 enterprise-license-restricted environments. We honor the license boundary.

We diverged from your findings on [DOMAINS — founder to fill in after GATE-1] — see §7 of the paper for the limitations we know about, and §6 for what we think the substrate-level result implies.

If you have time to read, we would value your peer feedback before broader distribution. Happy to send the full repro tarball, schedule a video call, or — if you are open to it — invite a Microsoft Research collaborator onto the v2 paper that addresses the gaps we identified in §7.

Thank you for the original DELEGATE-52 work; the framing of the document-corruption problem is the foundation we built on.

Sincerely,

Richard Porras
Real Empanada / DanteForge
richard.porras@realempanada.com
+1 (founder to add phone if desired)

---

## Personalization checklist (founder)

Before sending:

- [ ] Confirm recipient names + addresses against current Microsoft Research directory
- [ ] Replace `[ARXIV_URL]` with the actual arXiv ID (e.g., `https://arxiv.org/abs/2604.XXXXX`)
- [ ] Replace `[DOI_URL]` (Zenodo or similar)
- [ ] Replace `[INSERT POST-GATE-1 NUMBERS HERE]` block with the live D1/D3/D4 results from `.danteforge/evidence/delegate52-live-results.json`
- [ ] Replace `[DOMAINS — founder to fill in after GATE-1]` with the specific domains where DanteForge results diverged from the Microsoft baseline
- [ ] Confirm phone number / signature line preference
- [ ] Verify GATE-5 (arXiv submission) has actually fired and the preprint URL resolves
- [ ] Run the reproducibility CLI one more time to confirm `npm run check:proof-integrity` returns CLEAN against the cited git SHA

## What to attach

- The compiled PDF preprint
- A direct link to the GitHub repo (preferred over tarball — they can verify SHA + timestamp)
- Optional: link to a single shareable proof manifest under `.danteforge/evidence/`

## What NOT to do

- Do NOT include any of the synthetic G1 Sean Lippay artifacts. Those are internal substrate-composability validation, not customer-facing work, and they would confuse the recipient.
- Do NOT include the 76 withheld DELEGATE-52 environments or any reference to evaluating them. We did not test them.
- Do NOT claim DanteForge has "solved" the corruption problem. The substrate makes corruption invertible and detectable; it does not prevent the LLM from emitting corrupted intermediate states.

## Followup pattern (founder discretion)

If no response within 14 days, a single polite followup is appropriate. After that, do not pressure — the Microsoft Research team has competing priorities and the paper stands on its own merits via the open-source repo.
