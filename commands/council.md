---
name: council
description: "Multi-LLM council orchestration from Claude Code (or any host). Dispatch real work to Codex, Gemini CLI, Grok Build, and Claude itself while enforcing 'the one who builds is never the one who judges'. Uses actual CLI subscriptions where possible, not raw API keys."
---

# Multi-LLM Council from Claude Code

This is the practical guide for running a real "builder never judges" council using the tools you actually have on this machine.

## The Core Principle

**The agent that builds the code must never be one of the agents that scores or approves it.**

This single rule eliminates most score inflation and hallucinated quality.

## Current Council Members (What Actually Works Today)

| Role          | Tool                  | How to Dispatch                          | Notes |
|---------------|-----------------------|------------------------------------------|-------|
| **Builder**   | Codex (`codex exec`) or Gemini (`gemini --prompt --yolo`) | Headless subprocess | Best for execution |
| **Judge 1**   | Claude Code (you)     | Native (you are the orchestrator)       | Strong at review |
| **Judge 2**   | Gemini CLI (different model) or Codex | Headless subprocess with `--approval-mode plan` | Never the same instance that built |
| **Judge 3**   | Grok Build            | Via DanteForge skills (`/frontier`, `/review`, etc.) or embedded mode | Uses your actual Grok Build subscription. No API key needed. |

**Grok is special**: You do *not* want to use the raw xAI API here. You want to use the Grok Build TUI/subscription you already have. The best integration is through DanteForge skills that run inside Grok Build.

## How to Dispatch Real Work from This Window (Claude Code)

### 1. Using Codex (excellent headless)

```bash
codex exec -C "X:\Projects\SomeProject" `
  --sandbox workspace-write `
  -o "X:\tmp\codex-result.txt" `
  "Implement the frontier-100-draft-gate.mjs fix. Be careful with the self-score threshold."
```

Then read the output file and the git diff in the worktree.

### 2. Using Gemini CLI (headless + yolo)

```bash
gemini --prompt "Review this diff for architectural issues only. Do not make changes." `
  --approval-mode plan `
  --yolo
```

For pure review work, use `--approval-mode plan` (read-only judge mode).

### 3. Using Grok Build (your actual subscription)

The cleanest ways:

**Option A (Recommended for now)**: Use DanteForge skills inside Grok Build
- Run Grok Build normally.
- Type `/frontier --drive --target-dims 70` or `/review` or any DanteForge skill we installed.
- Grok Build will follow the high-quality workflow using *your* Grok subscription.

**Option B**: Matrix Kernel embedded mode
- Use `danteforge matrix-kernel run-wave` with `--adapter embedded`.
- This writes a Work Instruction Packet that Grok Build can execute inline using its own Edit/Write tools (no nested subprocess).

### 4. Using Claude Code as a Judge

You (Claude Code) are excellent at this. When another tool (Codex/Gemini) finishes a packet, you review the actual `git diff`, the lease violations, and the captured output.

## Recommended Council Pattern for Frontier Work

When pushing toward the 50-100 dimension frontier:

1. **Decompose** (you in Claude Code)
2. **Assign Builder** → Codex or Gemini (headless)
3. **Assign two independent Judges** (never the builder):
   - One via Gemini CLI in plan mode
   - One via Grok Build using a DanteForge review skill
4. **You (Claude)** act as the final synthesis judge + merger
5. Only promote the score / merge when you have consensus from at least two different LLMs that did *not* do the build.

This is exactly what the DanteForge Matrix Kernel's lease + court system was designed to enforce.

## Practical Commands You Can Run Right Now

From this Claude Code window:

```powershell
# Dispatch a build task to Codex
codex exec -C X:\Projects\DanteForge --sandbox workspace-write "..." 

# Dispatch a review task to Gemini (read-only)
gemini --prompt "..." --approval-mode plan

# Trigger a full autonomous frontier drive inside Grok Build
# (switch to your Grok Build window and type)
/frontier --drive --target-dims 70
```

## How DanteForge Helps Here

DanteForge already has:
- The adapter interface (`src/matrix/adapters/`)
- Working Codex and Gemini CLI adapters
- The lease system that can reject work that violates boundaries
- The `frontier --drive` command as the high-level orchestrator
- Native skills for Grok Build so you get clean `/frontier`, `/inferno`, etc.

The missing pieces for the "holy grail" council are mostly orchestration convenience, not fundamental architecture.

## Next-Level Pattern (When You Want More Automation)

Once the basic council feels natural, you can have Claude Code itself call:

```bash
danteforge frontier --drive --target-dims 80
```

And have it internally decide which council member gets which packet, while you stay in the loop as the ultimate synthesis layer.

This is currently the most powerful realistic setup available: one strong Claude Code window orchestrating real Codex, Gemini, and Grok Build subscriptions with structural anti-self-judging.

---

**This file is the current best practice.** Load it with `@commands/council.md` whenever you want to run council-style work from this window.