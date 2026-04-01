# Security Policy

## Supported Versions

We release security patches for the following versions:

| Version | Supported          | Notes                                    |
|---------|--------------------|------------------------------------------|
| 1.0.x   | ✅ Yes             | Current stable release                   |
| 0.9.x   | ⚠️ Limited         | Security patches only until 2026-06-01   |
| < 0.9   | ❌ No              | Please upgrade to 1.0.x                  |

**Recommendation:** Always use the latest 1.0.x release for the best security posture.

---

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue in DanteForge, please follow responsible disclosure practices:

### 🔒 Private Reporting (Preferred)

1. **Email:** [security@danteforge.dev](mailto:security@danteforge.dev)
   - Use PGP encryption if possible (key: [public key link])
   - Include: detailed description, steps to reproduce, impact assessment

2. **GitHub Security Advisories:** 
   - Navigate to [Security → Report a vulnerability](https://github.com/danteforge/danteforge/security/advisories/new)
   - This creates a private draft advisory for collaboration

### ⏱️ Response Timeline

- **Initial response:** Within 48 hours (business days)
- **Triage & assessment:** Within 5 business days
- **Patch development:** Target 30 days for critical issues, 90 days for moderate
- **Coordinated disclosure:** After patch is released and users have 7 days to upgrade

### ✅ What to Expect

1. **Acknowledgment:** We'll confirm receipt and provide a tracking ID
2. **Assessment:** We'll validate the issue and determine severity (Critical, High, Moderate, Low)
3. **Fix development:** We'll work on a patch (you may be invited to collaborate)
4. **Disclosure:** We'll coordinate public disclosure timing with you
5. **Credit:** We'll credit you in the security advisory (unless you prefer anonymity)

### 🏆 Security Researcher Recognition

We maintain a [Security Hall of Fame](./SECURITY_HALL_OF_FAME.md) to thank researchers who help keep DanteForge secure.

---

## Security Architecture

### Local-First Design

DanteForge is designed with a **local-first, zero-trust architecture**:

- ✅ **All code execution happens locally** on your machine (not cloud sandboxes)
- ✅ **State stored locally** in `.danteforge/STATE.yaml` (not transmitted)
- ✅ **API keys stored locally** in `~/.danteforge/config.yaml` (never logged or transmitted to DanteForge servers)
- ✅ **Audit logs stay local** for your compliance needs

### What Data is Transmitted?

When using LLM providers (Ollama, Claude, OpenAI, etc.), DanteForge transmits:

| Data Type              | Transmitted? | To Where?              | User Control                |
|------------------------|--------------|------------------------|-----------------------------|
| Source code (prompts)  | ✅ Yes       | LLM provider you choose| Use `--prompt` mode to avoid|
| API keys               | ❌ No        | Never                  | Stored in `~/.danteforge/`  |
| Audit logs             | ❌ No        | Never                  | Stored in `.danteforge/`    |
| Telemetry/analytics    | ❌ No        | Never                  | DanteForge has no telemetry |
| File paths             | ⚠️ Partial   | LLM provider (in prompts)| Use `--anonymize` (future) |

**User responsibility:** Review your LLM provider's data handling policies:
- [Anthropic (Claude) data policy](https://www.anthropic.com/legal/privacy)
- [OpenAI data policy](https://openai.com/policies/privacy-policy)
- [Google (Gemini) data policy](https://policies.google.com/privacy)
- [xAI (Grok) data policy](https://x.ai/legal/privacy-policy)

**Recommendation for sensitive codebases:** Use **Ollama (local-first)** to keep all data on your machine.

---

## Security Best Practices

### For Users

1. **API Key Storage**
   - ✅ Store keys in `~/.danteforge/config.yaml` (never commit to Git)
   - ✅ Set restrictive permissions: `chmod 600 ~/.danteforge/config.yaml`
   - ✅ Use environment variables for CI/CD: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
   - ❌ Never hardcode keys in project files

2. **Worktree Isolation**
   - ✅ Use `--isolation` flag for party mode (isolates agent work in temporary git worktrees)
   - ✅ Review changes before merging from worktrees
   - ⚠️ Worktrees are automatically cleaned up on success, kept on failure for debugging

3. **Code Review**
   - ✅ Always review AI-generated code before committing
   - ✅ Run `danteforge verify` to ensure tests pass
   - ✅ Use `danteforge doctor` to check for security misconfigurations

4. **Sensitive Data**
   - ❌ Avoid using DanteForge on codebases with hardcoded secrets
   - ✅ Use `.env` files + `.gitignore` for secrets
   - ✅ Run secret scanning tools (e.g., `gitleaks`, `trufflehog`) in CI

5. **Supply Chain Security**
   - ✅ Verify npm package signatures: `npm audit`
   - ✅ Use `npm ci` for deterministic installs
   - ✅ Check `THIRD_PARTY_NOTICES.md` for dependency licenses

### For Operators (Enterprise Deployments)

1. **Air-Gapped Environments**
   - ✅ DanteForge works fully offline with Ollama
   - ✅ No telemetry or "phone home" requests
   - ⚠️ OSS discovery (`/inferno` preset) requires internet access (use `--skip-oss` to disable)

2. **Audit Logging**
   - ✅ Enable detailed audit logs: `danteforge audit --enable-detailed`
   - ✅ Logs stored in `.danteforge/audit/detailed.jsonl` (JSONL format)
   - ✅ Integrate with SIEM: forward logs via `filebeat`, `fluentd`, etc.

3. **Network Security**
   - ✅ Ollama runs on `localhost:11434` by default (no external exposure)
   - ⚠️ If using remote Ollama, secure with TLS + authentication
   - ✅ LLM API calls use HTTPS (verify provider certificates)

4. **Access Control**
   - ✅ Use file system permissions to restrict `.danteforge/` directories
   - ✅ Consider role-based access for shared projects (future feature)

---

## Known Security Considerations

### 1. LLM Prompt Injection

**Risk:** Malicious code comments could attempt to manipulate LLM behavior

**Mitigation:**
- DanteForge uses structured prompts with clear role boundaries
- Code context is sandboxed from system instructions
- Hard gates enforce verification steps (tests must pass)

**User action:** Review AI-generated code before merging

### 2. Dependency Vulnerabilities

**Risk:** Third-party npm packages may have CVEs

**Mitigation:**
- We run `npm audit` in CI on every commit
- Automated Dependabot updates for security patches
- Quarterly manual dependency review

**User action:** Run `npm audit` in your DanteForge installation directory

### 3. Code Execution in Worktrees

**Risk:** AI-generated code runs in isolated worktrees during party mode

**Mitigation:**
- Worktrees are isolated git branches (cannot affect main codebase)
- Test execution happens in sandboxed subprocess
- Failed operations keep worktree for manual review

**User action:** Review worktree changes before merging (`git diff main..agent-NAME`)

### 4. File System Access

**Risk:** DanteForge has full file system access (required for code generation)

**Mitigation:**
- DanteForge only writes to `.danteforge/` and user-specified output paths
- No modifications outside project directory without explicit user commands
- Audit log records all file operations

**User action:** Use containerization (Docker) for additional isolation

---

## Compliance & Standards

### Supported Standards

- **OWASP Top 10:** We follow secure coding practices to mitigate OWASP risks
- **CWE Top 25:** Regular scanning for common weakness enumerations
- **NIST Cybersecurity Framework:** Aligned with Identify, Protect, Detect, Respond, Recover

### Compliance Use Cases

- **GDPR:** No PII collected by DanteForge (LLM provider policies apply)
- **SOC 2:** Audit logs + local-first architecture support SOC 2 requirements
- **HIPAA:** Use local Ollama mode to avoid transmitting PHI to cloud LLMs
- **FedRAMP:** Air-gapped deployment supported (no internet required with Ollama)

For enterprise compliance questionnaires, see [COMPLIANCE.md](./COMPLIANCE.md).

---

## Security Updates

We announce security updates through:

1. **GitHub Security Advisories:** [github.com/danteforge/danteforge/security/advisories](https://github.com/danteforge/danteforge/security/advisories)
2. **npm Security Advisories:** Automatically shown during `npm install`
3. **Mailing List:** [Subscribe to security updates](https://danteforge.dev/security-updates)
4. **Release Notes:** [CHANGELOG.md](./CHANGELOG.md) with `[SECURITY]` tags

**Critical updates:** We'll also post to our [Twitter/X](https://twitter.com/danteforge) and [Discord](https://discord.gg/danteforge).

---

## Security Tooling

We use the following tools to maintain security:

- **Static Analysis:** ESLint with security rules, TypeScript strict mode
- **Dependency Scanning:** `npm audit`, Dependabot, Snyk
- **Secret Scanning:** `gitleaks` in CI
- **Fuzz Testing:** (roadmap for v1.1.0)
- **Penetration Testing:** Annual third-party audits (planned post-1.0)

---

## Bug Bounty Program

We do not currently have a paid bug bounty program, but we plan to launch one in Q2 2026 for:

- Critical vulnerabilities: $500-$2,000
- High severity: $200-$500
- Moderate severity: $50-$200
- Hall of Fame recognition for all valid reports

---

## Questions?

For non-sensitive security questions, use [GitHub Discussions](https://github.com/danteforge/danteforge/discussions).

For sensitive issues, email [security@danteforge.dev](mailto:security@danteforge.dev).

---

**Last updated:** 2026-04-01  
**Policy version:** 1.0.0
