# Migrating from Claude Code to DanteForge

**For developers hitting rate limits and seeking a local-first alternative.**

---

## Why Migrate?

If you're experiencing any of these pain points with Claude Code (or Cursor/Copilot):

- 🚫 **Rate limits** blocking your workflow during peak hours
- 💸 **High API costs** ($50-100/month for moderate usage)
- 🔒 **Data privacy concerns** (code sent to cloud providers)
- ⏱️ **Slow response times** during API congestion
- 📊 **No audit trail** for compliance requirements

**DanteForge offers:**
- ✅ **Unlimited local execution** with Ollama (free)
- ✅ **5-10x token savings** through intelligent routing
- ✅ **Full data control** (local-first architecture)
- ✅ **Consistent performance** (local models don't rate limit)
- ✅ **Enterprise audit logs** (SOC2/GDPR compliant)

---

## Quick Migration Path

### Step 1: Install DanteForge

```bash
npm install -g danteforge
danteforge --version  # Should show v1.0.0+
```

### Step 2: Install Ollama (for local-first mode)

```bash
# Download from https://ollama.com/download
# Or use package manager:

# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# Download installer from https://ollama.com/download/windows

# Start Ollama and pull a model
ollama serve
ollama pull qwen2.5-coder:32b  # Recommended for coding
```

### Step 3: Configure (Optional)

If you want cloud fallback (use your existing API keys):

```bash
danteforge config

# Or manually edit ~/.danteforge/config.yaml:
llm:
  defaultProvider: ollama  # Use local first
  anthropicApiKey: sk-ant-...  # Your Claude Code key (optional fallback)
  openaiApiKey: sk-...          # Your Cursor key (optional fallback)
```

### Step 4: Initialize your project

```bash
cd your-project
danteforge init
```

---

## Feature Comparison

| Feature | Claude Code | Cursor | **DanteForge** |
|---------|------------|--------|----------------|
| **Execution Model** | Cloud-only | Cloud-only | **Local-first** (Ollama) |
| **Cost per 100 features** | ~$50-100 | ~$30-60 | **~$5-10** (or $0 with Ollama) |
| **Rate limits** | ❌ Frequent | ❌ Frequent | ✅ **None** (local) |
| **Offline mode** | ❌ No | ❌ No | ✅ **Yes** (Ollama) |
| **Multi-agent orchestration** | ❌ No | ❌ No | ✅ **Yes** (Party mode) |
| **Structured workflow** | Ad-hoc prompting | Ad-hoc prompting | **12-stage pipeline** |
| **Quality gates** | ❌ None | ❌ None | ✅ **Hard gates** (TDD enforced) |
| **Audit trail** | ❌ No | ❌ No | ✅ **Full** (STATE.yaml) |
| **Self-improving** | ❌ No | ❌ No | ✅ **Yes** (lessons system) |
| **Token optimization** | ❌ No | ❌ No | ✅ **5-10x savings** |

---

## Command Mapping

### Claude Code → DanteForge

| Claude Code Workflow | DanteForge Equivalent | Notes |
|---------------------|----------------------|-------|
| Paste spec, ask "build this" | `danteforge magic "your spec"` | Uses balanced `/magic` preset |
| "Write tests first, then implement" | `danteforge forge "your goal"` | TDD enforced by default |
| "Plan this feature" | `danteforge plan "your goal"` | Creates PLAN.md artifact |
| "Fix this bug" | `danteforge forge "Fix: description"` | Auto-detects from git diff |
| "Review this code" | `danteforge verify` | Runs tests + quality checks |
| Manual prompting for complex features | `danteforge inferno "your goal"` | Max power: OSS discovery + 10 waves |
| N/A (no equivalent) | `danteforge party "your goal"` | Multi-agent parallel execution |

### Cursor → DanteForge

| Cursor Workflow | DanteForge Equivalent | Notes |
|----------------|----------------------|-------|
| Cmd+K inline edit | `danteforge forge "edit X in file.ts"` | Scoped to specific change |
| Chat mode feature request | `danteforge magic "your request"` | Balanced power/cost |
| "Add tests for this" | Built-in (`forge` enforces TDD) | Tests generated automatically |
| Composer multi-file edits | `danteforge blaze "your goal"` | 10-wave complex feature mode |
| N/A | `danteforge canvas "UI feature"` | Design-first workflow |

---

## Workflow Differences

### Claude Code/Cursor Workflow
```
1. Open editor
2. Select code or file
3. Type prompt in chat
4. Review suggested changes
5. Accept/reject edits
6. Manually run tests
7. (Repeat until it works)
```

### DanteForge Workflow
```
1. Define goal: danteforge magic "add feature X"
2. DanteForge auto-runs:
   → Plan (architecture decisions)
   → Forge (implementation in waves)
   → Verify (tests must pass)
   → Synthesize (documentation)
3. Review changes in .danteforge/
4. Commit when ready
```

**Key difference:** DanteForge **enforces structure** and **requires verification**, so you don't ship broken code.

---

## Configuration Migration

### Migrating API Keys

If you already have Claude/OpenAI API keys from Claude Code or Cursor:

**Claude Code keys:**
```bash
# Claude Code stores keys in ~/.claude/config (varies by platform)
# Copy your ANTHROPIC_API_KEY

# Add to DanteForge:
danteforge config
# Enter key when prompted, or edit ~/.danteforge/config.yaml:
llm:
  anthropicApiKey: sk-ant-api03-...  # Your Claude Code key
```

**Cursor keys:**
```bash
# Cursor uses OpenAI keys
# Add to DanteForge:
danteforge config
# Or edit ~/.danteforge/config.yaml:
llm:
  openaiApiKey: sk-...  # Your Cursor key
```

**Recommended:** Use **Ollama** as default, keep cloud keys as fallback:

```yaml
llm:
  defaultProvider: ollama  # Free, unlimited
  anthropicApiKey: sk-ant-...  # Fallback for complex tasks
  openaiApiKey: sk-...          # Another fallback option
```

### Project Configuration

Claude Code and Cursor don't use project-level config files. DanteForge stores project state in `.danteforge/`:

```bash
your-project/
├── .danteforge/
│   ├── STATE.yaml           # Project state (current phase, tasks)
│   ├── CONSTITUTION.md      # Project principles
│   ├── SPEC.md              # Feature specs
│   ├── PLAN.md              # Implementation plan
│   ├── TASKS.md             # Task breakdown
│   ├── audit/               # Audit logs (for compliance)
│   └── evidence/            # Verification receipts
```

**Git integration:**
- Add `.danteforge/` to your repo (recommended for team collaboration)
- Or add to `.gitignore` if using DanteForge for personal workflow only

---

## Breaking Changes from v0.9.x → v1.0.0

If you were an early DanteForge user:

### 1. Config File Location
- **Old:** `.danteforge/config.yaml` (project-level)
- **New:** `~/.danteforge/config.yaml` (user-level for API keys), `.danteforge/config.yaml` (project settings only)

### 2. Command Changes
- **Removed:** `danteforge oss-researcher` (replaced by `danteforge oss`)
- **Renamed:** `danteforge magic --light` → `danteforge ember`
- **New:** `danteforge canvas` (design-first preset)

### 3. Error Codes
- **Old:** Generic error messages
- **New:** Structured error codes (`DF-SETUP-001`, etc.) with help URLs

### 4. State Schema
- **Old:** `lastVerifiedAt` field
- **New:** `lastVerifyStatus` (pass/fail/skip) + `lastVerifyReceiptPath`

**Migration script:**
```bash
# Automatically migrates old state to new schema
danteforge doctor --migrate
```

---

## Common Migration Issues

### ❌ "Ollama connection refused"

**Cause:** Ollama isn't running

**Fix:**
```bash
ollama serve  # Start Ollama server
ollama pull qwen2.5-coder:32b  # Pull a model
```

Verify: `curl http://localhost:11434` should return `Ollama is running`

---

### ❌ "Command not found: danteforge"

**Cause:** Global install failed or PATH issue

**Fix:**
```bash
# Reinstall globally
npm install -g danteforge

# Or use npx (no install needed)
npx danteforge@latest magic "your goal"

# Or install from source
git clone https://github.com/danteforge/danteforge.git
cd danteforge
npm ci && npm run build && npm link
```

---

### ❌ "Gate check failed: CONSTITUTION.md not found"

**Cause:** DanteForge enforces a constitution before running workflows

**Fix:**
```bash
# Generate a constitution
danteforge constitution "Build a modern web app with React and TypeScript"

# Or skip gates for quick tasks (not recommended)
danteforge forge --light "your goal"
```

---

### ❌ "Tests failing after forge"

**Cause:** DanteForge requires tests to pass (fail-closed verification)

**Fix:**
```bash
# Run verify to see details
danteforge verify

# Auto-repair with convergence loop
danteforge magic "Fix failing tests" --convergence-cycles 3

# Or manually fix and re-verify
npm test
danteforge verify
```

---

### ❌ "Token usage too high"

**Cause:** Using cloud provider instead of local Ollama

**Fix:**
```bash
# Switch to Ollama in config
danteforge config
# Set defaultProvider: ollama

# Or use a lighter preset
danteforge ember "small task"  # ~$0.15 instead of ~$0.50
```

---

## Data Privacy Considerations

### What Claude Code/Cursor Send to the Cloud

- ✅ All your source code (in prompts)
- ✅ File paths and project structure
- ✅ Git history context
- ✅ Clipboard contents
- ❌ API keys (stored locally, but transmitted when used)

### What DanteForge Sends (with Ollama)

- ❌ **Nothing** (100% local execution)

### What DanteForge Sends (with cloud providers)

- ✅ Source code in prompts (only what's needed for the task)
- ⚠️ File paths (can be anonymized with `--anonymize` flag - roadmap v1.1)
- ❌ API keys (never transmitted, only used for authentication)
- ❌ Audit logs (stored locally only)

**Recommendation for sensitive codebases:**
1. Use Ollama for all operations
2. Or use `--prompt` mode (copies prompt to clipboard, you paste manually into cloud UI)
3. Never use cloud providers for codebases with secrets or PII

---

## Team Migration Strategy

### For Individual Developers

1. **Week 1:** Install DanteForge + Ollama, run personal projects in parallel with Claude Code
2. **Week 2:** Migrate your most common workflows (bug fixes, small features)
3. **Week 3:** Adopt `/magic` or `/blaze` for larger features
4. **Week 4:** Fully migrate, uninstall Claude Code extension

### For Teams (5-20 developers)

1. **Pilot Phase (2 weeks):**
   - Select 2-3 early adopters
   - Install DanteForge on non-critical projects
   - Document team-specific workflows

2. **Training Phase (1 week):**
   - Internal workshop: DanteForge basics
   - Create team-specific CONSTITUTION.md templates
   - Set up shared Ollama server (optional)

3. **Migration Phase (2 weeks):**
   - Gradual team rollout (5 devs at a time)
   - Weekly feedback sessions
   - Update CI/CD to run `danteforge verify`

4. **Optimization Phase (ongoing):**
   - Track token savings vs. previous costs
   - Tune magic levels for team workflows
   - Contribute lessons to team knowledge base

### For Enterprises (50+ developers)

See [COMPLIANCE.md](./COMPLIANCE.md) for:
- Centralized Ollama deployment
- Air-gapped environments
- SIEM integration for audit logs
- Role-based access control (roadmap)

---

## Cost Comparison

### Claude Code Monthly Cost (Moderate Usage)

| Task Type | Frequency | Claude Code Cost | DanteForge (Ollama) | DanteForge (Cloud) |
|-----------|-----------|------------------|---------------------|-------------------|
| Small bugs (5 min tasks) | 20/month | ~$20 | **$0** | ~$3 |
| Medium features (30 min) | 10/month | ~$40 | **$0** | ~$5 |
| Large features (2 hrs) | 5/month | ~$50 | **$0** | ~$10 |
| **Total** | **35 tasks** | **~$110** | **$0** | **~$18** |

**Savings:** $110/month → $0/month (100% with Ollama) or $18/month (84% savings with cloud fallback)

**Team of 10:** $1,100/month → $0/month = **$13,200/year savings**

---

## FAQ

### Q: Can I use DanteForge alongside Claude Code?

**A:** Yes! They don't conflict. Use Claude Code for quick edits, DanteForge for structured workflows.

### Q: Will DanteForge work without internet?

**A:** Yes, with Ollama installed. OSS discovery (`/inferno` preset) requires internet, but you can skip it with `--skip-oss`.

### Q: How do I share DanteForge state with my team?

**A:** Commit `.danteforge/` to Git. Team members can pick up where you left off.

### Q: Can I use my existing Claude API key?

**A:** Yes! Add it to `~/.danteforge/config.yaml` as a fallback. But Ollama is recommended for cost savings.

### Q: What if Ollama is too slow on my laptop?

**A:** Use a smaller model (`ollama pull qwen2.5-coder:7b`) or use cloud providers for complex tasks only.

### Q: How do I migrate in-progress work from Claude Code?

**A:** Copy your code to a branch, initialize DanteForge (`danteforge init`), then run `danteforge magic "continue building X"` with your notes.

---

## Getting Help

- 📖 **Full docs:** [README.md](./README.md)
- 🚀 **Quick start:** [USER_QUICKSTART.md](./USER_QUICKSTART.md)
- 🛠️ **Troubleshooting:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- 💬 **Community:** [GitHub Discussions](https://github.com/danteforge/danteforge/discussions)
- 🐛 **Bug reports:** [GitHub Issues](https://github.com/danteforge/danteforge/issues/new?template=bug_report.yml)

---

**Welcome to DanteForge! 🔨✨**

You're now free from rate limits and in control of your development workflow.
