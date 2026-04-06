# DanteForge - Quick Start Guide

**Get from zero to your first AI-assisted implementation in under 10 minutes.**

---

## What is DanteForge?

DanteForge is a **local-first AI development CLI** that helps you build features faster while keeping costs low. Unlike cloud-based AI coding assistants, DanteForge:

- 🏠 **Runs locally** with Ollama (free, unlimited)
- 💰 **Saves 5-10x on tokens** with intelligent routing and compression
- 🎯 **Enforces quality** with hard gates, TDD, and verification
- 🤝 **Multi-agent orchestration** for complex workflows
- 📊 **Full audit trail** for enterprise compliance

**Perfect for:** Developers hitting rate limits on Claude Code, Cursor, or GitHub Copilot.

---

## Prerequisites

- **Node.js 18+** (check: `node --version`)
- **Git** (check: `git --version`)
- **Ollama** (optional but recommended for local-first mode)
  - Install: [ollama.com/download](https://ollama.com/download)
  - Start: `ollama serve`
  - Pull model: `ollama pull qwen2.5-coder:32b` (recommended) or `ollama pull llama3.1:70b`

**Optional:** API keys for Claude, OpenAI, Grok, or Gemini (for cloud fallback)

---

## Installation

### Option 1: npm (Recommended)

```bash
npm install -g danteforge
danteforge --version  # Should show v1.0.0+
```

### Option 2: From Source

```bash
git clone https://github.com/DanteForge/danteforge.git
cd danteforge
npm ci
npm run build
npm link  # Makes 'danteforge' available globally
```

---

## First Run: Interactive Setup

Run the setup wizard to configure your environment:

```bash
danteforge init
```

This will:
- ✅ Detect your project type (Node.js, Python, etc.)
- ✅ Check for Ollama installation
- ✅ Offer to configure LLM providers (API keys optional)
- ✅ Recommend a magic level based on your project size
- ✅ Generate a sample constitution

**Example output:**
```
🔍 Detected: Node.js project (package.json found)
🏠 Ollama detected at http://localhost:11434 ✓
💡 Recommended: /magic preset (moderate budget, 2-wave autoforge)
📝 Constitution generated at .danteforge/CONSTITUTION.md
✅ Ready to forge!
```

---

## Your First Feature: "Hello World"

Let's build a simple feature using the `magic` preset (balanced power, ~$0.50 budget).

### Step 1: Describe what you want

```bash
danteforge magic "Add a CLI command that prints 'Hello, [name]' with colorful output using chalk library"
```

### Step 2: Watch DanteForge work

The `magic` preset will:
1. 📋 **Plan** the implementation (architecture decisions)
2. 🔨 **Forge** the code in 2 waves
3. ✅ **Verify** tests pass
4. 📖 **Synthesize** documentation

**Expected output:**
```
🪄 Running /magic preset...
📋 Phase 1: Creating implementation plan...
   → Identified: New CLI command, needs Commander.js, chalk dependency
   → Plan: 2 waves (setup dependencies, implement command)

🔨 Wave 1/2: Setting up dependencies...
   ✓ Added chalk@5.3.0 to package.json
   ✓ Created src/commands/hello.ts

🔨 Wave 2/2: Implementing hello command...
   ✓ Added command handler with color support
   ✓ Registered command in CLI router
   ✓ Added 3 unit tests

✅ Verification: All tests passing (5/5)
📖 Synthesized: IMPLEMENTATION.md updated

💰 Token usage: 2,847 tokens (~$0.03 with local Ollama)
⏱️  Completed in 47 seconds
```

### Step 3: Test your new feature

```bash
node dist/index.js hello Alice
# Output: Hello, Alice! 👋 (in colorful text)
```

---

## Common Workflows

### 🎯 Fix a Bug with TDD

```bash
danteforge forge "Fix the date formatting bug in src/utils/format.ts - dates should be ISO 8601"
```

- DanteForge will write a failing test first, then fix the code.

### 🚀 Build a Full Feature (Canvas Preset)

```bash
danteforge canvas "Build a settings page with theme toggle (light/dark mode)"
```

- The `canvas` preset runs: **Design** → **Forge** → **UX Refine** → **Verify**
- Generates `.op` design files (OpenPencil format) for version-controlled design

### 🧪 Just Run Tests

```bash
danteforge verify
```

- Runs your test suite and updates `.danteforge/STATE.yaml` with results

### 🏥 Health Check

```bash
danteforge doctor
```

- Diagnoses common issues (missing config, stale state, broken gates)
- Run with `--fix` to auto-repair

---

## Understanding Magic Levels

DanteForge has **7 presets** (spark → inferno), each with different power/cost:

| Preset      | Budget  | Best For                          | Waves | OSS Discovery |
|-------------|---------|-----------------------------------|-------|---------------|
| `spark`     | ~$0.05  | Quick ideas, planning only        | 0     | ❌            |
| `ember`     | ~$0.15  | Small bug fixes                   | 1     | ❌            |
| `canvas`    | ~$0.75  | Design-first features             | 6     | ❌            |
| `magic`     | ~$0.50  | **Default - most tasks**          | 2     | ❌            |
| `blaze`     | ~$1.50  | Complex features                  | 10    | ❌            |
| `nova`      | ~$3.00  | High-complexity, no OSS needed    | 10    | ❌            |
| `inferno`   | ~$5.00  | New domains, needs research       | 10    | ✅ (20-30%)   |

**Rule of thumb:**
- First time tackling a new domain? → `/inferno` (discovers patterns from OSS)
- Follow-up work on the same domain? → `/magic` or `/blaze`

---

## Configuration

### LLM Provider Setup

Edit `~/.danteforge/config.yaml`:

```yaml
llm:
  defaultProvider: ollama  # or: anthropic, openai, grok, gemini
  
  # Optional API keys (only needed for cloud providers)
  anthropicApiKey: sk-ant-...
  openaiApiKey: sk-...
  grokApiKey: xai-...
  geminiApiKey: ...

  # Ollama settings (for local mode)
  ollama:
    baseUrl: http://localhost:11434
    model: qwen2.5-coder:32b  # or llama3.1:70b, deepseek-coder:33b
```

### Project Settings

Edit `.danteforge/config.yaml` (project-specific):

```yaml
project:
  name: my-awesome-app
  type: nodejs
  testCommand: npm test
  buildCommand: npm run build
```

---

## Troubleshooting

### ❌ "Ollama connection refused"

**Problem:** DanteForge can't reach Ollama at `http://localhost:11434`

**Fix:**
```bash
# Start Ollama server
ollama serve

# Pull a model if you haven't already
ollama pull qwen2.5-coder:32b
```

### ❌ "Gate check failed: CONSTITUTION.md not found"

**Problem:** You're trying to run `forge` without a project constitution

**Fix:**
```bash
danteforge constitution "Build a modern web app with React, TypeScript, and Tailwind"
```

Or skip the gate (not recommended):
```bash
danteforge forge --light "your goal here"
```

### ❌ "Tests failing after forge"

**Problem:** Verification step found failing tests

**Fix:**
```bash
# Run verify to see details
danteforge verify

# Auto-repair with convergence loop
danteforge magic "Fix failing tests" --convergence-cycles 3
```

### ❌ "ModuleNotFoundError: No module named 'anthropic'"

**Problem:** You're trying to use a cloud provider without the SDK installed

**Fix:**
```bash
npm install -g @anthropic-ai/sdk  # for Claude
# or
npm install -g openai             # for OpenAI
```

### 🔍 More Help

- **Full troubleshooting guide:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **Error code reference:** [TROUBLESHOOTING.md#error-codes](./TROUBLESHOOTING.md#error-codes)
- **GitHub Discussions:** [Ask the community](https://github.com/danteforge/danteforge/discussions)
- **Run diagnostics:** `danteforge doctor --verbose`

---

## Next Steps

Once you're comfortable with the basics:

1. 📖 **Read the full docs:** [README.md](./README.md)
2. 🎓 **Learn advanced patterns:** [ADVANCED.md](./ADVANCED.md)
3. 🏢 **Enterprise deployment:** [COMPLIANCE.md](./COMPLIANCE.md)
4. 🤝 **Contribute:** [CONTRIBUTING.md](./CONTRIBUTING.md)
5. 📺 **Watch tutorials:** [Video demos](https://github.com/danteforge/danteforge#videos)

---

## Why DanteForge vs. Claude Code / Cursor?

| Feature                     | Claude Code | Cursor | **DanteForge** |
|-----------------------------|-------------|--------|----------------|
| **Local execution**         | ❌          | ❌     | ✅ (Ollama)    |
| **Token optimization**      | ❌          | ❌     | ✅ (5-10x)     |
| **Hard quality gates**      | ❌          | ❌     | ✅ (TDD enforced)|
| **Multi-agent orchestration**| ❌         | ❌     | ✅ (Party mode)|
| **Full audit trail**        | ❌          | ❌     | ✅ (STATE.yaml)|
| **Self-improving (lessons)**| ❌          | ❌     | ✅             |
| **Cost (per 100 features)** | ~$50-100    | ~$30-60| **~$5-10**     |

**TL;DR:** DanteForge is built for developers who want **control, cost efficiency, and quality** without vendor lock-in.

---

## Get Help

- 🐛 **Found a bug?** [File an issue](https://github.com/danteforge/danteforge/issues/new?template=bug_report.yml)
- 💡 **Feature request?** [Submit an idea](https://github.com/danteforge/danteforge/issues/new?template=feature_request.yml)
- 💬 **Questions?** [GitHub Discussions](https://github.com/danteforge/danteforge/discussions)
- 📧 **Enterprise support?** [Contact us](mailto:enterprise@danteforge.dev)

---

**Happy forging! 🔨✨**
