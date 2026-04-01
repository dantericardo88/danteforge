# Troubleshooting Guide

**Quick solutions to common DanteForge issues.**

---

## Diagnostic Command

Before diving into specific errors, run the health check:

```bash
danteforge doctor

# For detailed diagnostics:
danteforge doctor --verbose
```

This will detect:
- Missing configuration
- Ollama connection issues
- Stale state files
- Broken gates
- Test failures
- File permission problems

---

## Common Errors

### <a id="error-ollama-connection"></a>❌ Ollama Connection Errors

#### Error: `ECONNREFUSED: Connection refused to http://localhost:11434`

**Cause:** Ollama server is not running

**Fix:**
```bash
# Start Ollama server
ollama serve

# Verify it's running
curl http://localhost:11434
# Should return: "Ollama is running"

# Pull a model if you haven't already
ollama pull qwen2.5-coder:32b
```

**Alternative fix:** Use a cloud provider instead:
```bash
# Edit config to use Claude/OpenAI as default
danteforge config
# Set defaultProvider: anthropic (or openai, grok, gemini)
```

---

#### Error: `Ollama model 'qwen2.5-coder:32b' not found`

**Cause:** Model not pulled locally

**Fix:**
```bash
# List available models
ollama list

# Pull the recommended model
ollama pull qwen2.5-coder:32b

# Or pull a smaller/faster model
ollama pull qwen2.5-coder:7b
ollama pull deepseek-coder:6.7b
```

**Update config to use your pulled model:**
```yaml
# ~/.danteforge/config.yaml
llm:
  ollama:
    model: qwen2.5-coder:7b  # Match your pulled model
```

---

### <a id="error-gate-checks"></a>🚫 Gate Check Failures

#### Error: `GateError: Gate blocked: No constitution defined`

**Cause:** Trying to run `forge`, `plan`, or `tasks` without a project constitution

**Fix:**
```bash
# Generate a constitution
danteforge constitution "Build a modern web app with React, TypeScript, and Tailwind CSS"

# This creates .danteforge/CONSTITUTION.md
```

**Skip gates (not recommended for production):**
```bash
danteforge forge --light "your goal"
```

---

#### Error: `GateError: Gate blocked: No SPEC.md found`

**Cause:** Trying to run `plan` or `tasks` before generating a spec

**Fix:**
```bash
# Generate a spec from your idea
danteforge specify "Add user authentication with email/password and OAuth"

# This creates .danteforge/SPEC.md
```

---

#### Error: `GateError: Gate blocked: No PLAN.md found`

**Cause:** Trying to run `forge` or `tasks` before planning

**Fix:**
```bash
# Generate a plan
danteforge plan

# Or use a magic preset that includes planning
danteforge magic "your goal"
```

---

### <a id="error-api-keys"></a>🔑 API Key Errors

#### Error: `CONFIG_MISSING_KEY: ANTHROPIC_API_KEY not configured`

**Cause:** Trying to use Claude without an API key

**Fix:**
```bash
# Interactive config
danteforge config

# Or manually edit ~/.danteforge/config.yaml:
llm:
  anthropicApiKey: sk-ant-api03-...

# Or use environment variable
export ANTHROPIC_API_KEY=sk-ant-api03-...
```

**Get an API key:**
- Claude: https://console.anthropic.com/
- OpenAI: https://platform.openai.com/api-keys
- Grok: https://console.x.ai/
- Gemini: https://aistudio.google.com/app/apikey

---

#### Error: `LLM_AUTH_FAILED: Invalid authentication (401)`

**Cause:** API key is incorrect or expired

**Fix:**
```bash
# Verify your key works
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: YOUR_KEY_HERE" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'

# Should return a valid response, not 401

# If key is invalid, regenerate at provider console:
# - Claude: https://console.anthropic.com/settings/keys
# - OpenAI: https://platform.openai.com/api-keys

# Update DanteForge config
danteforge config
```

---

### <a id="error-verification"></a>✅ Verification Failures

#### Error: `Verification failed: Tests are failing (3/10 passed)`

**Cause:** DanteForge requires tests to pass before marking work as complete

**Fix:**
```bash
# See detailed test output
danteforge verify --verbose

# Run tests manually to debug
npm test

# Auto-repair with convergence loop
danteforge magic "Fix failing tests" --convergence-cycles 3

# Or investigate specific failures
npm test -- --reporter=verbose
```

**Common test failure causes:**
- Missing dependencies (`npm install <package>`)
- Syntax errors (run `npm run typecheck`)
- Import path issues (check relative paths)
- Environment variables not set (check `.env.example`)

---

#### Error: `Verification failed: Build errors detected`

**Cause:** TypeScript compilation or build step failing

**Fix:**
```bash
# See build errors
npm run build

# Or typecheck only
npm run typecheck

# Common fixes:
# 1. Missing type definitions
npm install --save-dev @types/node @types/react

# 2. tsconfig.json misconfigured
danteforge doctor --check-tsconfig

# 3. Syntax errors
# Fix errors shown in build output
```

---

### <a id="error-state-management"></a>📋 State & Workflow Errors

#### Error: `State file corrupted or invalid YAML`

**Cause:** `.danteforge/STATE.yaml` is malformed

**Fix:**
```bash
# Backup current state
cp .danteforge/STATE.yaml .danteforge/STATE.yaml.backup

# Reset state (will lose current task tracking)
rm .danteforge/STATE.yaml
danteforge init

# Or manually fix YAML syntax errors
# Common issues:
# - Inconsistent indentation (use 2 spaces, not tabs)
# - Unquoted strings with special characters
# - Missing colons after keys
```

**Validate YAML syntax:**
```bash
# Install yamllint
npm install -g yaml-lint

# Check syntax
yamllint .danteforge/STATE.yaml
```

---

#### Error: `Audit log entry failed to write`

**Cause:** File permission issues or disk full

**Fix:**
```bash
# Check disk space
df -h .

# Check permissions
ls -la .danteforge/

# Fix permissions
chmod -R u+w .danteforge/

# If disk is full, clean up
npm cache clean --force
rm -rf node_modules coverage dist
npm ci
```

---

### <a id="error-git-worktrees"></a>🌳 Git Worktree Errors

#### Error: `Worktree creation failed: .git/worktrees already exists`

**Cause:** Previous party mode run didn't clean up worktrees

**Fix:**
```bash
# List active worktrees
git worktree list

# Remove stale worktrees
git worktree remove .danteforge/worktrees/agent-architect --force
git worktree remove .danteforge/worktrees/agent-implementer --force

# Or prune all stale worktrees
git worktree prune

# Clean up lock files
rm -rf .git/worktrees/*/locked
```

---

#### Error: `Cannot merge worktree: uncommitted changes`

**Cause:** Agent work in worktree has uncommitted changes

**Fix:**
```bash
# Review changes in the worktree
cd .danteforge/worktrees/agent-architect
git diff
git status

# Commit or stash changes
git add .
git commit -m "Agent work from party mode"

# Or discard changes
git reset --hard HEAD
```

---

### <a id="error-budget"></a>💰 Budget & Token Errors

#### Error: `BUDGET_EXCEEDED: Agent architect exceeded budget ($1.50 > $1.00)`

**Cause:** Magic preset hit its budget limit

**Fix:**
```bash
# Use a higher-budget preset
danteforge blaze "your goal"  # $1.50 budget
danteforge nova "your goal"   # $3.00 budget

# Or increase budget manually
danteforge forge "your goal" --max-budget 2.0

# Or use local Ollama (no budget limit)
danteforge config
# Set defaultProvider: ollama
```

---

#### Error: `Token estimation warning: This operation may use ~50,000 tokens ($0.75)`

**Cause:** Large prompt warning (not an error, just a heads-up)

**Action:**
- Press `y` to continue
- Or cancel and use a lighter preset (`/ember` instead of `/magic`)
- Or reduce scope (split feature into smaller tasks)

---

### <a id="error-network"></a>🌐 Network & Provider Errors

#### Error: `LLM_TIMEOUT: Request to api.anthropic.com timed out after 120s`

**Cause:** Network latency or provider downtime

**Fix:**
```bash
# Check provider status
# - Claude: https://status.anthropic.com/
# - OpenAI: https://status.openai.com/

# Retry with longer timeout
danteforge forge "your goal" --timeout 300

# Or switch to local Ollama
danteforge config
# Set defaultProvider: ollama
```

---

#### Error: `LLM_RATE_LIMITED: Rate limit exceeded (429)`

**Cause:** Too many requests to cloud provider (this is what drove you to DanteForge!)

**Fix:**
```bash
# Immediate fix: Switch to Ollama (no rate limits)
danteforge config
# Set defaultProvider: ollama

# Or wait and retry (provider rate limits reset hourly/daily)
# Check your provider's rate limit policy:
# - Claude: https://console.anthropic.com/settings/limits
# - OpenAI: https://platform.openai.com/account/limits

# Long-term fix: Use DanteForge's token optimization
# - Prefer /ember or /magic over /blaze or /inferno
# - Use --light flag to skip gates (saves 1-2 LLM calls)
```

---

### <a id="error-platform"></a>🖥️ Platform-Specific Errors

#### Windows: `'node' is not recognized as an internal or external command`

**Cause:** Node.js not in PATH or not installed

**Fix:**
1. Download Node.js from https://nodejs.org/ (LTS version recommended)
2. Install with "Add to PATH" option checked
3. Restart terminal
4. Verify: `node --version`

---

#### macOS: `Permission denied when installing globally`

**Cause:** npm global install requires sudo (not recommended)

**Fix:**
```bash
# Option 1: Use npm config to change global prefix (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
source ~/.zshrc

# Now install without sudo
npm install -g danteforge

# Option 2: Use sudo (not recommended)
sudo npm install -g danteforge

# Option 3: Use npx (no install needed)
npx danteforge@latest magic "your goal"
```

---

#### Linux: `EACCES: permission denied, mkdir '/usr/local/lib/node_modules/danteforge'`

**Cause:** Global install directory not writable

**Fix:**
```bash
# Option 1: Fix npm permissions (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g danteforge

# Option 2: Use a Node version manager (nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install --lts
npm install -g danteforge
```

---

## Error Code Reference

DanteForge uses structured error codes for easier troubleshooting:

### Setup Errors (DF-SETUP-XXX)

| Code | Error | Solution |
|------|-------|----------|
| DF-SETUP-001 | Ollama not installed | Install from https://ollama.com/download |
| DF-SETUP-002 | Ollama not running | Run `ollama serve` |
| DF-SETUP-003 | Model not pulled | Run `ollama pull qwen2.5-coder:32b` |
| DF-SETUP-004 | Config file missing | Run `danteforge config` |
| DF-SETUP-005 | Invalid config YAML | Fix syntax in `~/.danteforge/config.yaml` |

### Config Errors (DF-CONFIG-XXX)

| Code | Error | Solution |
|------|-------|----------|
| DF-CONFIG-001 | API key not configured | Run `danteforge config` |
| DF-CONFIG-002 | Invalid API key format | Check key format (should start with `sk-` for most providers) |
| DF-CONFIG-003 | Unknown provider | Use: `ollama`, `anthropic`, `openai`, `grok`, or `gemini` |
| DF-CONFIG-004 | Model not available | Check model name matches provider's offerings |

### Workflow Errors (DF-WORKFLOW-XXX)

| Code | Error | Solution |
|------|-------|----------|
| DF-WORKFLOW-001 | Gate check failed: No constitution | Run `danteforge constitution "your goal"` |
| DF-WORKFLOW-002 | Gate check failed: No spec | Run `danteforge specify "your goal"` |
| DF-WORKFLOW-003 | Gate check failed: No plan | Run `danteforge plan` |
| DF-WORKFLOW-004 | Gate check failed: Tests not passing | Run `danteforge verify`, fix failures |
| DF-WORKFLOW-005 | State file corrupted | Reset state: `rm .danteforge/STATE.yaml && danteforge init` |

### Execution Errors (DF-EXEC-XXX)

| Code | Error | Solution |
|------|-------|----------|
| DF-EXEC-001 | Budget exceeded | Use higher-budget preset or increase `--max-budget` |
| DF-EXEC-002 | Timeout | Increase `--timeout` or check network |
| DF-EXEC-003 | Rate limited | Switch to Ollama or wait for rate limit reset |
| DF-EXEC-004 | Empty LLM response | Retry or switch providers |
| DF-EXEC-005 | Circuit breaker open | Provider is down; wait 5 min or switch providers |

### Verification Errors (DF-VERIFY-XXX)

| Code | Error | Solution |
|------|-------|----------|
| DF-VERIFY-001 | Tests failing | Fix test failures, then re-run `danteforge verify` |
| DF-VERIFY-002 | Build errors | Fix TypeScript/compile errors |
| DF-VERIFY-003 | Lint errors | Run `npm run lint:fix` |
| DF-VERIFY-004 | Anti-stub violations | Remove `TODO`, `FIXME`, `TBD` placeholders |
| DF-VERIFY-005 | Test coverage below threshold | Add tests to meet coverage requirements |

---

## Advanced Diagnostics

### Enable Debug Logging

```bash
# Set debug level in config
danteforge config
# Add:
log:
  level: debug  # Options: error, warn, info, debug

# Or use environment variable
export DANTEFORGE_LOG_LEVEL=debug
danteforge forge "your goal"
```

### Inspect Audit Logs

```bash
# View recent audit entries
tail -n 50 .danteforge/audit/detailed.jsonl

# Search for specific errors
grep -i "error" .danteforge/audit/detailed.jsonl

# Pretty-print JSON
jq . .danteforge/audit/detailed.jsonl | less
```

### Check State File

```bash
# View current state
cat .danteforge/STATE.yaml

# Pretty-print
yq eval .danteforge/STATE.yaml

# Check specific fields
yq eval '.currentPhase' .danteforge/STATE.yaml
yq eval '.tasks' .danteforge/STATE.yaml
```

### Test LLM Connection

```bash
# Test Ollama
curl http://localhost:11434/api/tags

# Test Claude
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":10,"messages":[{"role":"user","content":"test"}]}'

# Test OpenAI
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"test"}],"max_tokens":10}'
```

---

## Still Stuck?

1. **Run doctor:** `danteforge doctor --verbose`
2. **Check logs:** `.danteforge/audit/detailed.jsonl`
3. **Search issues:** https://github.com/danteforge/danteforge/issues
4. **Ask community:** https://github.com/danteforge/danteforge/discussions
5. **File bug:** https://github.com/danteforge/danteforge/issues/new?template=bug_report.yml

**Include in bug reports:**
- DanteForge version (`danteforge --version`)
- OS and Node.js version (`node --version`)
- Full error message
- Output of `danteforge doctor --verbose`
- Steps to reproduce

---

**Happy debugging! 🔧**
