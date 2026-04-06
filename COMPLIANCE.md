# Enterprise Compliance Guide

**DanteForge compliance capabilities for enterprise buyers and regulated industries.**

---

## Overview

DanteForge is designed with **local-first, zero-trust architecture** to support compliance requirements across industries. This document outlines how DanteForge helps organizations meet regulatory and compliance standards.

**Key Principle:** DanteForge **does not collect, transmit, or store** user data on DanteForge servers. All execution happens locally, giving you full control over your code and data.

---

## Compliance Summary

| Standard | Support Level | Notes |
|----------|--------------|-------|
| **GDPR** | ✅ Full | No PII collected; local-first architecture |
| **SOC 2 Type II** | ✅ Supported | Audit logs + local execution support controls |
| **HIPAA** | ✅ Supported | Use Ollama (local) to avoid PHI transmission |
| **FedRAMP** | ⚠️ Partial | Air-gapped deployment supported; certification TBD |
| **ISO 27001** | ✅ Supported | Security controls align with standard |
| **CCPA** | ✅ Full | No personal data collected |
| **PCI DSS** | ⚠️ User-managed | Don't process payment data with cloud LLMs |

---

## GDPR (General Data Protection Regulation)

### Data Processing

**What DanteForge collects:**
- ❌ None (no telemetry, no analytics, no user tracking)

**What DanteForge stores locally:**
- ✅ Project state (`.danteforge/STATE.yaml`)
- ✅ Audit logs (`.danteforge/audit/detailed.jsonl`)
- ✅ API keys (user-managed, in `~/.danteforge/config.yaml`)

**What DanteForge transmits:**
- ❌ Nothing when using Ollama (local execution)
- ⚠️ Source code prompts when using cloud LLM providers (Anthropic, OpenAI, etc.)
  - **User responsibility:** Review your LLM provider's GDPR compliance
  - **Mitigation:** Use Ollama for codebases with personal data

### GDPR Rights

| Right | DanteForge Support |
|-------|-------------------|
| **Right to Access** | N/A (no data collected) |
| **Right to Erasure** | N/A (all data is local; user can delete `.danteforge/` directory) |
| **Right to Portability** | ✅ All data in open formats (YAML, JSON, Markdown) |
| **Right to Object** | N/A (no automated decision-making) |
| **Data Breach Notification** | N/A (no centralized data storage) |

### GDPR Compliance Checklist

- [x] No cookies or tracking
- [x] No centralized data collection
- [x] User controls all data (local storage)
- [x] Open data formats (YAML, JSON, Markdown)
- [x] Transparent data flow (see [SECURITY.md](./SECURITY.md))
- [x] LLM provider policies documented

**For EU-based teams:** Use Ollama (local) or EU-based LLM providers with GDPR compliance (e.g., Anthropic Claude with EU data residency).

---

## SOC 2 Type II

### Control Objectives

DanteForge supports SOC 2 Trust Service Criteria:

#### 1. Security (CC)

| Control | DanteForge Feature |
|---------|-------------------|
| **Access Control** | File system permissions on `.danteforge/` and `~/.danteforge/` directories |
| **Logical Access** | API keys stored locally (not transmitted) |
| **Encryption** | HTTPS for cloud LLM API calls |
| **Audit Logging** | Detailed audit logs in `.danteforge/audit/detailed.jsonl` |

#### 2. Availability (A)

| Control | DanteForge Feature |
|---------|-------------------|
| **System Monitoring** | `danteforge doctor` health checks |
| **Incident Response** | Circuit breakers for LLM provider failures |
| **Backup & Recovery** | Git version control for all artifacts |

#### 3. Processing Integrity (PI)

| Control | DanteForge Feature |
|---------|-------------------|
| **Quality Gates** | Hard gates enforce constitution, spec, plan, tests |
| **Verification** | `danteforge verify` ensures tests pass before completion |
| **Audit Trail** | All state changes logged with timestamp + user |

#### 4. Confidentiality (C)

| Control | DanteForge Feature |
|---------|-------------------|
| **Data Classification** | API keys stored in `~/.danteforge/` (restrictive permissions) |
| **Access Restrictions** | Worktree isolation prevents cross-agent data leakage |
| **Encryption in Transit** | TLS for cloud provider API calls |

#### 5. Privacy (P)

| Control | DanteForge Feature |
|---------|-------------------|
| **Data Minimization** | No telemetry; only stores what's needed for workflow |
| **Consent** | User explicitly configures API keys (opt-in) |
| **Data Retention** | User controls retention (delete `.danteforge/` anytime) |

### SOC 2 Audit Support

**Audit log format:**
```jsonl
{"timestamp":"2026-04-01T12:00:00Z","user":"john.doe","command":"forge","goal":"Add auth","result":"success","duration":47}
{"timestamp":"2026-04-01T12:01:00Z","user":"john.doe","command":"verify","result":"pass","testsRun":15,"testsPassed":15}
```

**Fields captured:**
- `timestamp` (ISO 8601)
- `user` (from Git config `user.name`)
- `command` (danteforge command executed)
- `goal` or `description`
- `result` (success/failure)
- `duration` (seconds)
- Additional context (tests run, tokens used, etc.)

**Export audit logs for SIEM:**
```bash
# Export last 30 days
jq 'select(.timestamp > "2026-03-01")' .danteforge/audit/detailed.jsonl > audit-march-2026.json

# Forward to SIEM (Splunk, ELK, etc.)
tail -f .danteforge/audit/detailed.jsonl | your-siem-forwarder
```

---

## HIPAA (Health Insurance Portability and Accountability Act)

### PHI Protection

**Risk:** Source code may contain Protected Health Information (PHI) in comments, test data, or variable names.

**DanteForge Mitigation:**

1. **Use Ollama (local execution):**
   ```yaml
   # ~/.danteforge/config.yaml
   llm:
     defaultProvider: ollama  # PHI never leaves your machine
   ```

2. **Or use Business Associate Agreement (BAA) providers:**
   - ⚠️ Anthropic Claude does NOT offer BAAs for API usage (as of 2026-04)
   - ⚠️ OpenAI offers BAAs for enterprise customers only
   - ✅ **Recommended:** Use Ollama for HIPAA-covered entities

3. **Redact PHI before cloud transmission (if unavoidable):**
   ```bash
   # Future feature (roadmap v1.1):
   danteforge forge "your goal" --anonymize
   # This will redact identifiers before sending to LLM
   ```

### HIPAA Compliance Checklist

- [ ] Deploy Ollama on air-gapped servers
- [ ] Ensure `.danteforge/` directories are encrypted at rest
- [ ] Use file system permissions (`chmod 700 .danteforge/`)
- [ ] Document LLM provider BAA status
- [ ] Train developers on PHI handling policies
- [ ] Audit logs forwarded to SIEM for breach detection

**For HIPAA-covered entities:** We recommend **Ollama-only deployments** until BAA-compliant cloud providers become available.

---

## FedRAMP (Federal Risk and Authorization Management Program)

### Air-Gapped Deployment

DanteForge supports **fully offline, air-gapped environments:**

1. **Install from tarball:**
   ```bash
   # On internet-connected machine:
   npm pack danteforge
   # Produces: danteforge-1.0.0.tgz

   # Transfer to air-gapped machine:
   scp danteforge-1.0.0.tgz admin@airgapped-server:/tmp/

   # On air-gapped machine:
   npm install -g /tmp/danteforge-1.0.0.tgz
   ```

2. **Install Ollama offline:**
   ```bash
   # Download Ollama installer on internet-connected machine
   # Transfer to air-gapped server

   # Pull model on internet-connected machine
   ollama pull qwen2.5-coder:32b
   ollama save qwen2.5-coder:32b qwen-model.tar

   # Transfer model file, then load on air-gapped server
   ollama load qwen-model.tar
   ```

3. **Disable OSS discovery:**
   ```bash
   # OSS discovery requires internet; skip it
   danteforge magic "your goal"  # No internet needed
   danteforge blaze "your goal"  # No internet needed

   # Or explicitly skip OSS
   danteforge inferno "your goal" --skip-oss
   ```

### FedRAMP Moderate Controls

| Control Family | DanteForge Support |
|---------------|-------------------|
| **AC (Access Control)** | File system permissions; no centralized auth (yet) |
| **AU (Audit & Accountability)** | ✅ Detailed audit logs |
| **CM (Configuration Management)** | ✅ Git version control for artifacts |
| **IA (Identification & Authentication)** | ⚠️ Relies on OS-level auth (no built-in MFA) |
| **SC (System & Communications Protection)** | ✅ TLS for cloud APIs; local-only with Ollama |

**FedRAMP Certification:** Not currently pursued. DanteForge is a local CLI tool, not a cloud service. Agencies using DanteForge in air-gapped environments can conduct their own ATO (Authority to Operate) assessments.

---

## ISO 27001 (Information Security Management)

### Security Controls Mapping

| ISO 27001 Control | DanteForge Implementation |
|------------------|--------------------------|
| **A.9.1 Access Control** | File permissions on config/state directories |
| **A.9.4 Secret Management** | API keys stored in `~/.danteforge/config.yaml` (not in Git) |
| **A.12.1 Operational Procedures** | Hard gates enforce workflow discipline |
| **A.12.3 Backup** | Git version control for all artifacts |
| **A.12.4 Logging & Monitoring** | Audit logs in `.danteforge/audit/` |
| **A.14.2 Secure Development** | Anti-stub doctrine, TDD enforcement |
| **A.18.1 Data Privacy** | No PII collected; GDPR alignment |

### Risk Assessment

**Threat Model:**

1. **LLM Prompt Injection**
   - **Risk:** Malicious code comments manipulate LLM behavior
   - **Mitigation:** Structured prompts, hard gates, test verification

2. **API Key Leakage**
   - **Risk:** Keys committed to Git or logged
   - **Mitigation:** Keys stored in `~/.danteforge/` (not `.danteforge/`), warnings on commit

3. **Dependency Vulnerabilities**
   - **Risk:** npm packages have CVEs
   - **Mitigation:** `npm audit` in CI, Dependabot auto-updates

4. **Code Execution in Worktrees**
   - **Risk:** AI-generated code runs during verification
   - **Mitigation:** Worktree isolation, tests run in sandboxed subprocess

**Residual Risks:**
- LLM provider outages (cloud mode)
- Zero-day vulnerabilities in dependencies
- User misconfiguration (e.g., committing API keys)

---

## CCPA (California Consumer Privacy Act)

### Data Collection

**Personal Information Collected:** None

DanteForge does not:
- ❌ Sell personal information
- ❌ Share personal information with third parties
- ❌ Track users across websites
- ❌ Collect biometric data
- ❌ Create user profiles

**User Responsibility:** When using cloud LLM providers, review their CCPA policies:
- [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)

---

## PCI DSS (Payment Card Industry Data Security Standard)

### Scope

**DanteForge is out of scope** for PCI DSS compliance unless you:
- Store cardholder data in your codebase (don't do this!)
- Process payment data with LLMs (very high risk!)

**Recommendations:**

1. **Never commit payment data to Git**
   ```bash
   # Add to .gitignore
   echo "*.pem" >> .gitignore
   echo "payment-keys/" >> .gitignore
   ```

2. **Redact sensitive data before using cloud LLMs**
   ```bash
   # Don't use DanteForge on codebases with:
   # - Credit card numbers
   # - CVV codes
   # - API keys for payment processors
   ```

3. **Use Ollama for sensitive codebases**
   ```bash
   danteforge config
   # Set defaultProvider: ollama
   ```

---

## Enterprise Deployment Patterns

### 1. Centralized Ollama Server

**For teams of 10-50 developers:**

```bash
# Server setup (Ubuntu 22.04)
sudo apt update
sudo apt install -y nvidia-driver-535 nvidia-cuda-toolkit
curl -fsSL https://ollama.com/install.sh | sh

# Pull models
ollama pull qwen2.5-coder:32b
ollama pull llama3.1:70b

# Configure server to accept remote connections
export OLLAMA_HOST=0.0.0.0:11434
ollama serve

# Client configuration (each developer)
# ~/.danteforge/config.yaml
llm:
  ollama:
    baseUrl: http://ollama-server.internal.company.com:11434
    model: qwen2.5-coder:32b
```

**Benefits:**
- Centralized model management
- GPU acceleration (faster inference)
- Cost savings (one server vs. N laptops)

**Considerations:**
- Network latency (10-50ms typical)
- Single point of failure (use load balancer for HA)
- Secure with TLS + authentication (future DanteForge feature)

---

### 2. Air-Gapped Environment

**For high-security or classified environments:**

1. **Offline installation** (see FedRAMP section above)
2. **Internal PyPI/npm mirror:**
   ```bash
   # Use Verdaccio for npm packages
   # Transfer DanteForge tarball manually
   ```

3. **Disable all internet access:**
   ```yaml
   # ~/.danteforge/config.yaml
   llm:
     defaultProvider: ollama
   # No cloud fallback configured
   ```

---

### 3. Multi-Region Compliance

**For global teams with data residency requirements:**

```yaml
# EU developers
llm:
  defaultProvider: anthropic
  anthropicApiKey: sk-ant-eu-...  # EU-based API endpoint (if available)

# US developers
llm:
  defaultProvider: anthropic
  anthropicApiKey: sk-ant-us-...  # US-based API endpoint
```

**Note:** As of 2026-04, Anthropic does not offer regional API endpoints. Use Ollama for guaranteed data locality.

---

## Audit & Reporting

### Generate Compliance Reports

```bash
# Export audit logs for specific time period
jq 'select(.timestamp >= "2026-01-01" and .timestamp < "2026-02-01")' \
  .danteforge/audit/detailed.jsonl > audit-jan-2026.json

# Count successful vs. failed operations
jq '.result' .danteforge/audit/detailed.jsonl | sort | uniq -c

# Identify users with most activity
jq '.user' .danteforge/audit/detailed.jsonl | sort | uniq -c | sort -nr

# Token usage by provider
jq 'select(.tokensUsed) | {provider, tokensUsed}' \
  .danteforge/audit/detailed.jsonl | jq -s 'group_by(.provider) | map({provider: .[0].provider, total: map(.tokensUsed) | add})'
```

### SIEM Integration Examples

**Splunk:**
```bash
# Install Splunk Universal Forwarder
# Configure inputs.conf:
[monitor:///home/*/.danteforge/audit/detailed.jsonl]
sourcetype = danteforge:audit
index = dev_tools
```

**ELK Stack:**
```bash
# Filebeat configuration
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /home/*/.danteforge/audit/detailed.jsonl
    json.keys_under_root: true
output.elasticsearch:
  hosts: ["elasticsearch.internal:9200"]
```

**Datadog:**
```bash
# Use Datadog Agent with log collection
# Add to datadog.yaml:
logs:
  - type: file
    path: "/home/*/.danteforge/audit/detailed.jsonl"
    service: danteforge
    source: json
```

---

## Security Questionnaire (for RFPs)

### Common Enterprise Questions

**Q: Does DanteForge collect telemetry or user data?**  
A: No. DanteForge has zero telemetry. All data stays on your machines.

**Q: Where is data stored?**  
A: Locally in `.danteforge/` (project directory) and `~/.danteforge/` (user config). No cloud storage.

**Q: Is data encrypted at rest?**  
A: User responsibility. Use full-disk encryption (BitLocker, FileVault, LUKS) or encrypt `.danteforge/` directories.

**Q: Is data encrypted in transit?**  
A: Yes, when using cloud LLM providers (HTTPS/TLS). Local Ollama uses `localhost` (no network transmission).

**Q: Do you offer SSO/SAML integration?**  
A: Not currently. DanteForge is a local CLI tool. Access control is via OS-level permissions.

**Q: Can we run DanteForge in an air-gapped environment?**  
A: Yes. Install from tarball, use Ollama for local execution, skip OSS discovery.

**Q: Do you have a Bug Bounty program?**  
A: Planned for Q2 2026 (see [SECURITY.md](./SECURITY.md#bug-bounty-program)).

**Q: Have you had a third-party penetration test?**  
A: Planned post-v1.0.0 GA (annual cadence). Results will be published.

**Q: Do you offer a Business Associate Agreement (BAA) for HIPAA?**  
A: Not applicable. DanteForge does not process data on behalf of customers (all local execution).

**Q: What is your incident response policy?**  
A: See [SECURITY.md](./SECURITY.md#reporting-a-vulnerability) for vulnerability disclosure timeline (48-hour initial response, 30-day patch target for critical issues).

---

## Compliance Roadmap

### v1.1.0 (Q2 2026)

- [ ] Anonymization mode (`--anonymize` flag to redact identifiers)
- [ ] Enhanced audit log schema (role-based fields)
- [ ] SIEM integration examples (Splunk, ELK, Datadog)

### v1.2.0 (Q3 2026)

- [ ] Role-based access control (RBAC)
- [ ] Multi-factor authentication (MFA) for shared Ollama servers
- [ ] Compliance dashboard (visualize audit logs)

### v2.0.0 (Q4 2026)

- [ ] FedRAMP Moderate certification (if demand from federal agencies)
- [ ] ISO 27001 certification (if demand from enterprise)
- [ ] SOC 2 Type II report (if demand from SaaS companies)

---

## Enterprise Support

For compliance questionnaires, security reviews, or custom compliance requirements:

- **Enterprise inquiries:** [enterprise@danteforge.dev](mailto:enterprise@danteforge.dev)
- **Security questions:** [security@danteforge.dev](mailto:security@danteforge.dev)
- **Compliance audits:** We provide audit log schemas and documentation for your compliance team

---

**Last updated:** 2026-04-01  
**Document version:** 1.0.0
