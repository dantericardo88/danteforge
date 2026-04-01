# DanteForge Production Runbook

**Version:** 1.0.0  
**Last Updated:** 2026-04-01  
**Audience:** Operations, SRE, DevOps

## Overview

This runbook provides operational procedures for running DanteForge in production environments. It covers common failure scenarios, debugging procedures, performance tuning, and incident response.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Common Failures](#common-failures)
3. [Debugging Procedures](#debugging-procedures)
4. [Performance Tuning](#performance-tuning)
5. [Monitoring & Alerting](#monitoring--alerting)
6. [Incident Response](#incident-response)
7. [Maintenance Procedures](#maintenance-procedures)

---

## Architecture Overview

### Components

```
┌─────────────────────────────────────────────┐
│  DanteForge CLI (Node.js Process)           │
│                                             │
│  ┌──────────────┐  ┌──────────────┐        │
│  │ Command      │  │ Core Engine  │        │
│  │ Parser       │──▶│ (autoforge,  │        │
│  │ (Commander)  │  │  party, etc) │        │
│  └──────────────┘  └──────────────┘        │
│         │                  │                │
│         ▼                  ▼                │
│  ┌──────────────────────────────┐          │
│  │  LLM Router                  │          │
│  │  (Ollama/Claude/OpenAI/Grok) │          │
│  └──────────────────────────────┘          │
│         │                                   │
└─────────┼───────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│  External Services                          │
│  • Ollama (local)                           │
│  • Claude API (Anthropic)                   │
│  • OpenAI API                               │
│  • Grok API (X.AI)                          │
│  • MCP Servers (Figma, GitHub, etc.)        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Filesystem                                 │
│  • ~/.danteforge/config.yaml (user config)  │
│  • .danteforge/STATE.yaml (project state)   │
│  • .danteforge/audit/ (audit logs)          │
│  • .danteforge/oss-repos/ (cached repos)    │
└─────────────────────────────────────────────┘
```

### Data Flow

1. User invokes CLI command
2. Command parsed, state loaded from `.danteforge/STATE.yaml`
3. LLM calls routed through circuit breaker
4. Results processed, state updated
5. Audit log appended to `.danteforge/audit/detailed.jsonl`

---

## Common Failures

### 1. LLM Provider Timeout

**Symptoms:**
- Commands hang with no progress
- Log shows: `LLM_TIMEOUT` or `LLM call timed out after 120s`
- No response from LLM provider

**Diagnosis:**

```bash
# Check audit logs for last LLM call
tail -n 100 .danteforge/audit/detailed.jsonl | grep '"eventType":"llm_call"'

# Check provider status
# Ollama: curl http://localhost:11434/api/tags
# Claude: Check https://status.anthropic.com
# OpenAI: Check https://status.openai.com
```

**Resolution:**

1. **Check provider health:**
   ```bash
   # Ollama
   curl http://localhost:11434/api/tags
   
   # If Ollama is down:
   ollama serve  # Restart Ollama
   ```

2. **Increase timeout (temporary):**
   ```bash
   export DANTEFORGE_LLM_TIMEOUT_MS=300000  # 5 minutes
   danteforge <command>  # Retry
   ```

3. **Switch provider:**
   ```bash
   danteforge config --set-default-provider claude
   # or
   danteforge <command> --provider claude
   ```

4. **Check network connectivity:**
   ```bash
   # Test connectivity to Anthropic
   curl -I https://api.anthropic.com
   
   # Test connectivity to OpenAI
   curl -I https://api.openai.com
   ```

**Prevention:**
- Monitor provider uptime
- Configure fallback provider in `~/.danteforge/config.yaml`
- Set appropriate timeout for your network: `DANTEFORGE_LLM_TIMEOUT_MS`

---

### 2. Out of Memory (OOM)

**Symptoms:**
- Process killed unexpectedly
- No error message
- Docker container restarts
- System logs show: `Out of memory: Killed process`

**Diagnosis:**

```bash
# Check memory usage during execution (Docker)
docker stats danteforge

# Check memory usage (Linux)
top -p $(pgrep -f danteforge)

# Check Node.js heap size
node --max-old-space-size=4096 dist/index.js <command>
```

**Resolution:**

1. **Increase memory limit (Docker):**
   ```bash
   docker run --memory 4g --memory-swap 4g danteforge/danteforge:latest
   ```

2. **Increase Node.js heap size:**
   ```bash
   export NODE_OPTIONS="--max-old-space-size=4096"  # 4GB
   danteforge <command>
   ```

3. **Reduce parallel operations:**
   ```bash
   danteforge party <goal> --max-agents 3  # Limit to 3 concurrent agents
   ```

4. **Enable state compression:**
   ```yaml
   # .danteforge/STATE.yaml
   compressionEnabled: true
   ```

5. **Clean up cached repos:**
   ```bash
   danteforge oss clean --older-than 30d
   ```

**Prevention:**
- Monitor memory usage with `docker stats` or Prometheus
- Set memory limits in production deployments
- Use `--max-agents` to limit concurrency
- Regularly clean up `.danteforge/oss-repos/`

---

### 3. Disk Full

**Symptoms:**
- Write errors: `ENOSPC: no space left on device`
- Audit logs fail to write
- Commands fail during file creation

**Diagnosis:**

```bash
# Check disk usage
df -h .danteforge/

# Find largest directories
du -sh .danteforge/* | sort -h

# Check audit log size
du -sh .danteforge/audit/
```

**Resolution:**

1. **Clean old artifacts:**
   ```bash
   danteforge clean --older-than 30d
   ```

2. **Compress audit logs:**
   ```bash
   gzip .danteforge/audit/*.jsonl
   ```

3. **Remove cached OSS repos:**
   ```bash
   danteforge oss clean --all  # WARNING: Removes all cached repos
   ```

4. **Increase disk allocation (Docker):**
   ```bash
   # Increase Docker volume size
   docker volume create --opt o=size=20G danteforge-data
   docker run -v danteforge-data:/app/.danteforge danteforge/danteforge
   ```

**Prevention:**
- Set up disk usage monitoring (alert at 80% full)
- Automated cleanup cron job: `danteforge clean --older-than 30d`
- Log rotation for audit logs
- Mount `.danteforge/` on separate volume with quota

---

### 4. Git Repository Corruption

**Symptoms:**
- Git commands fail: `fatal: not a git repository`
- Party mode fails with worktree errors
- State shows incorrect branch

**Diagnosis:**

```bash
# Check git repository health
git fsck --full

# Check worktrees
git worktree list

# Verify git configuration
git config --list
```

**Resolution:**

1. **Repair git repository:**
   ```bash
   git fsck --full
   git gc --aggressive --prune=now
   ```

2. **Clean up dangling worktrees:**
   ```bash
   git worktree prune
   
   # If worktrees still show up:
   rm -rf .git/worktrees/<name>
   ```

3. **Reset to known good state:**
   ```bash
   # WARNING: Destructive - only use as last resort
   git reset --hard origin/main
   ```

**Prevention:**
- Enable git worktree isolation: `danteforge party --isolation`
- Regular `git gc` in CI
- Backup `.git/` directory before major operations

---

### 5. Circuit Breaker Tripped

**Symptoms:**
- Repeated failures for LLM calls
- Log shows: `LLM_CIRCUIT_OPEN`
- All LLM requests fail immediately

**Diagnosis:**

```bash
# Check circuit breaker state in logs
tail -n 100 .danteforge/audit/detailed.jsonl | grep circuit

# Check STATE.yaml for circuit breaker status
grep -A 5 "circuitBreaker" .danteforge/STATE.yaml
```

**Resolution:**

1. **Wait for circuit breaker to reset (30-60 seconds):**
   ```bash
   # Circuit breaker auto-resets to HALF_OPEN after cooldown
   sleep 60
   danteforge <command>  # Retry
   ```

2. **Switch provider to bypass circuit breaker:**
   ```bash
   danteforge <command> --provider claude  # Use different provider
   ```

3. **Force circuit breaker reset (emergency only):**
   ```bash
   # Delete circuit breaker state
   # NOTE: This is a workaround - fix root cause instead
   rm .danteforge/circuit-breaker.json
   ```

**Prevention:**
- Monitor provider health to avoid triggering circuit breaker
- Set up fallback providers
- Investigate root cause of repeated failures

---

### 6. API Rate Limiting

**Symptoms:**
- HTTP 429 errors
- Log shows: `Rate limit exceeded`
- Commands fail after burst of activity

**Diagnosis:**

```bash
# Check audit logs for rate limit errors
grep "429\|rate.limit" .danteforge/audit/detailed.jsonl

# Count requests in last hour
awk '/llm_call/ {print $1}' .danteforge/audit/detailed.jsonl | \
  grep $(date -u +"%Y-%m-%dT%H") | wc -l
```

**Resolution:**

1. **Wait for rate limit reset:**
   ```bash
   # Check Retry-After header in logs
   # Wait specified time, then retry
   sleep 60
   danteforge <command>
   ```

2. **Switch to provider with higher limits:**
   ```bash
   danteforge config --set-default-provider claude
   ```

3. **Reduce request frequency:**
   ```bash
   # Use lower preset (fewer LLM calls)
   danteforge magic <goal> --level ember
   ```

4. **Batch operations:**
   ```bash
   # Process multiple tasks in single LLM call
   danteforge autoforge --batch-size 5
   ```

**Prevention:**
- Monitor request rate with metrics
- Set up backoff strategy
- Use local provider (Ollama) for development
- Upgrade API plan for higher limits

---

## Debugging Procedures

### Enable Verbose Logging

```bash
# Set log level to verbose
export DANTEFORGE_LOG_LEVEL=verbose
danteforge <command>

# Or use CLI flag
danteforge <command> --verbose
```

### Inspect Audit Logs

```bash
# View latest audit events
tail -f .danteforge/audit/detailed.jsonl | jq .

# Filter by event type
jq 'select(.eventType == "llm_call")' .danteforge/audit/detailed.jsonl

# Find errors
jq 'select(.status == "failure")' .danteforge/audit/detailed.jsonl

# Calculate total cost
jq -s 'map(.costUsd // 0) | add' .danteforge/audit/detailed.jsonl
```

### Debug LLM Calls

```bash
# Test LLM connectivity
danteforge doctor

# Probe specific provider
node -e "
const { probeLLMProvider } = require('./dist/index.js');
probeLLMProvider('ollama').then(console.log);
"

# Test with minimal prompt
echo "Test prompt" | danteforge autoforge --light
```

### Check System Health

```bash
# Run comprehensive health check
danteforge doctor

# Check specific components
danteforge doctor --check-llm
danteforge doctor --check-git
danteforge doctor --check-disk
```

### Trace Execution

```bash
# Enable Node.js tracing
node --trace-warnings dist/index.js <command>

# Profile CPU usage
node --prof dist/index.js <command>
node --prof-process isolate-*.log > profile.txt
```

---

## Performance Tuning

### Optimize LLM Usage

1. **Choose appropriate preset:**
   ```bash
   # For quick tasks: ember (low cost)
   danteforge magic <goal> --level ember
   
   # For complex tasks: blaze (balanced)
   danteforge magic <goal> --level blaze
   
   # For new projects: inferno (maximum depth)
   danteforge inferno <goal>
   ```

2. **Use local routing:**
   ```bash
   # Local transforms bypass LLM for simple tasks
   # Enabled by default, but verify in config:
   danteforge config --show | grep routingAggressiveness
   ```

3. **Batch operations:**
   ```bash
   # Process multiple tasks in fewer LLM calls
   danteforge autoforge --batch-size 5
   ```

### Reduce Memory Usage

1. **Limit concurrent agents:**
   ```bash
   danteforge party <goal> --max-agents 3
   ```

2. **Enable state compression:**
   ```yaml
   # .danteforge/STATE.yaml
   compressionEnabled: true
   ```

3. **Clean up cached data:**
   ```bash
   # Remove old OSS repos
   danteforge oss clean --older-than 30d
   
   # Clear checkpoint files
   rm .danteforge/checkpoints/*.json
   ```

### Optimize Git Operations

1. **Use shallow clones for OSS:**
   ```bash
   # OSS command uses shallow clones by default
   # But verify in config:
   git config --global clone.depth 1
   ```

2. **Prune worktrees:**
   ```bash
   # Automatically prune after party mode
   git worktree prune
   ```

---

## Monitoring & Alerting

### Key Metrics

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| LLM success rate | < 95% | < 90% | Check provider health |
| Average response time | > 30s | > 60s | Increase timeout |
| Memory usage | > 2GB | > 3GB | Reduce concurrency |
| Disk usage | > 80% | > 90% | Clean artifacts |
| Error rate | > 5% | > 10% | Check logs |

### Prometheus Metrics

```yaml
# /metrics endpoint (future enhancement)
- danteforge_llm_calls_total{provider, status}
- danteforge_llm_duration_seconds{provider}
- danteforge_command_duration_seconds{command}
- danteforge_memory_usage_bytes
- danteforge_disk_usage_bytes{path}
```

### Health Checks

```bash
# Kubernetes readiness probe
curl http://localhost:8080/ready

# Expected response (200 OK):
# {"status":"ready","llm":true,"git":true,"disk":true}

# Liveness probe
curl http://localhost:8080/health

# Expected response (200 OK):
# {"status":"healthy","uptime":3600}
```

---

## Incident Response

### Severity Levels

**P0 (Critical):**
- Complete service outage
- Data loss
- Security breach

**P1 (High):**
- Partial outage affecting multiple users
- Major feature broken
- Performance degradation > 50%

**P2 (Medium):**
- Single feature broken
- Workaround available
- Performance degradation < 50%

**P3 (Low):**
- Minor bug
- Cosmetic issue
- Feature request

### Response Procedures

#### P0: Critical Incident

1. **Immediate Actions:**
   - Stop affected deployments
   - Alert on-call engineer
   - Post to status page

2. **Investigation:**
   - Collect logs: `.danteforge/audit/detailed.jsonl`
   - Check STATE.yaml for corruption
   - Review recent changes (git log)

3. **Mitigation:**
   - Rollback to last known good version
   - Switch to fallback provider
   - Restore from backup

4. **Resolution:**
   - Fix root cause
   - Test fix in staging
   - Deploy to production
   - Post-mortem within 48 hours

#### P1: High-Priority Incident

1. **Triage:**
   - Determine impact (how many users?)
   - Check if workaround exists

2. **Investigation:**
   - Reproduce issue locally
   - Check logs for patterns
   - Identify affected version

3. **Fix:**
   - Develop fix with tests
   - Deploy hotfix or advise workaround
   - Monitor for recurrence

---

## Maintenance Procedures

### Weekly Maintenance

```bash
# Clean old artifacts
danteforge clean --older-than 7d

# Compress audit logs
gzip .danteforge/audit/*.jsonl

# Prune git worktrees
git worktree prune

# Check disk usage
df -h .danteforge/
```

### Monthly Maintenance

```bash
# Update dependencies
npm outdated
npm update

# Run security audit
npm audit
npm audit fix

# Clean OSS repos
danteforge oss clean --older-than 30d

# Verify backup integrity
./scripts/verify-backup.sh
```

### Before Upgrades

```bash
# Backup state
cp -r .danteforge .danteforge.backup.$(date +%Y%m%d)

# Run health check
danteforge doctor

# Run test suite
npm test

# Upgrade
npm install danteforge@latest

# Verify
danteforge --version
danteforge doctor
```

---

## Backup & Recovery

### What to Backup

**Critical:**
- `.danteforge/STATE.yaml` (project state)
- `~/.danteforge/config.yaml` (user config)
- `.danteforge/audit/` (audit logs)

**Optional:**
- `.danteforge/oss-repos/` (cached repos - can be re-downloaded)
- `.danteforge/checkpoints/` (can be regenerated)

### Backup Procedure

```bash
# Daily backup (automated)
#!/bin/bash
BACKUP_DIR="/backups/danteforge/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# Backup state and config
cp -r .danteforge/STATE.yaml "$BACKUP_DIR/"
cp -r ~/.danteforge/config.yaml "$BACKUP_DIR/"

# Backup audit logs (compressed)
tar czf "$BACKUP_DIR/audit.tar.gz" .danteforge/audit/

# Verify backup
ls -lh "$BACKUP_DIR"
```

### Recovery Procedure

```bash
# Restore from backup
BACKUP_DIR="/backups/danteforge/20260401"

# Restore state
cp "$BACKUP_DIR/STATE.yaml" .danteforge/

# Restore config
cp "$BACKUP_DIR/config.yaml" ~/.danteforge/

# Restore audit logs
tar xzf "$BACKUP_DIR/audit.tar.gz" -C .danteforge/

# Verify
danteforge doctor
```

---

## Emergency Contacts

- **On-Call Engineer:** [PagerDuty rotation]
- **Team Lead:** [Contact info]
- **Support Email:** support@danteforge.com
- **Status Page:** https://status.danteforge.com

---

## Appendix

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DANTEFORGE_LLM_TIMEOUT_MS` | 120000 | LLM call timeout (ms) |
| `DANTEFORGE_LOG_LEVEL` | info | Log level (silent/error/warn/info/verbose) |
| `DANTEFORGE_OPERATION_TIMEOUT_MS` | 300000 | Global operation timeout (ms) |
| `NODE_OPTIONS` | - | Node.js options (e.g., `--max-old-space-size=4096`) |
| `HTTP_PROXY` | - | HTTP proxy URL |
| `HTTPS_PROXY` | - | HTTPS proxy URL |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid configuration |
| 3 | LLM unavailable |
| 4 | Gate check failed |
| 5 | Test failure |
| 6 | Build failure |

### Log Formats

**Audit Log (JSONL):**
```json
{
  "timestamp": "2026-04-01T10:30:00.000Z",
  "correlationId": "abc123",
  "sessionId": "def456",
  "eventType": "llm_call",
  "provider": "ollama",
  "model": "qwen2.5-coder:7b",
  "tokensUsed": 1234,
  "costUsd": 0.001,
  "duration": 2500,
  "status": "success"
}
```

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-04-01  
**Next Review:** 2026-07-01
