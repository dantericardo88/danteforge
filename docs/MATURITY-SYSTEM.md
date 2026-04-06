# DanteForge Maturity-Aware Quality Scoring System

## For Founders: Understanding Code Quality Levels

DanteForge scores your code across 18 quality dimensions (8 base + 10 extended) and maps it to one of 6 maturity levels. Each level represents a real-world readiness milestone — from proving the idea works to landing Fortune 500 contracts.

This is not arbitrary. The system analyzes your actual code, tests, documentation, security practices, and error handling to tell you what your code is ready for — and what it needs to get to the next level.

---

## The 6 Maturity Levels

### Level 1: Sketch (0-20 points)

**Your code proves the idea works.**

Good for:
- Demos to your co-founder
- Internal proof-of-concept
- "Does this even work?" validation

What this means:
- Happy path only — core feature works
- No tests (or manual testing only)
- Basic try/catch, crashes are OK
- Hardcoded values acceptable
- Functional but raw UI
- Code comments only
- Performance not measured
- Copy-paste code is fine

Example: You built a login form that accepts a username and password. It works when you type valid credentials. No error messages, no edge cases, no tests.

---

### Level 2: Prototype (21-40 points)

**Your code is ready to show investors.**

Good for:
- Investor demos
- Business model validation
- Showing potential to stakeholders

What this means:
- Main features work, some edge cases handled
- Basic unit tests (≥50% coverage)
- Logs errors to console
- Input validation on critical paths
- Consistent styling, basic responsive design
- README with setup steps
- Works with <100 records
- Functions extracted, some reuse

Example: Your login form now validates email format, shows an error message when credentials are wrong, has a loading spinner, and has 5 unit tests covering the happy path.

---

### Level 3: Alpha (41-60 points)

**Your code is ready for your team to use daily.**

Good for:
- Internal team use
- Dogfooding your own product
- Pre-beta testing

What this means:
- All features work, most edge cases covered
- ≥70% test coverage, integration tests
- Typed errors, structured logging
- OWASP awareness, no obvious security holes
- Accessible (WCAG A), loading states
- API docs, architecture guide
- Profiled, no obvious bottlenecks
- Modular code with clear boundaries

Example: Your login form handles network failures gracefully, supports password reset, has full keyboard navigation, logs auth attempts to a structured log service, and is covered by 15 unit tests + 3 E2E tests.

---

### Level 4: Beta (61-75 points)

**Your code is ready for early customers who expect it to work.**

Good for:
- Paid beta customers
- Early adopters
- Limited production release

What this means:
- Graceful degradation, error recovery
- ≥80% test coverage, E2E + load tests
- User-facing error messages, retry logic
- Secrets in env vars, HTTPS enforced, rate limiting
- Polished UI, empty states, WCAG AA compliance
- User guides, troubleshooting docs
- p90 < 500ms for key operations
- Plugin architecture, extension points

Example: Your login form has retry logic for network failures, shows user-friendly error messages ("Incorrect password" instead of "401 Unauthorized"), prevents brute-force attacks with rate limiting, and is fully accessible with screen readers.

---

### Level 5: Customer-Ready (76-88 points)

**Your code is ready for paying customers who trust you with their business.**

Good for:
- Production launch
- Paying customers
- Business-critical use cases

What this means:
- Battle-tested, monitoring and alerts
- ≥85% test coverage, chaos testing
- Sentry/DataDog integration, PII scrubbing
- Pen-tested, SOC2/GDPR ready
- Delightful UX, animations, WCAG AAA
- Videos, changelog, migration guides
- p99 < 1s, CDN, caching
- Versioned APIs, backward compatibility

Example: Your login form is monitored with uptime alerts, integrates with Sentry for error tracking, supports OAuth and 2FA, has comprehensive audit logs, and has been pen-tested for vulnerabilities.

---

### Level 6: Enterprise-Grade (89-100 points)

**Your code is ready for Fortune 500 companies who will audit everything.**

Good for:
- Fortune 500 contracts
- Mission-critical systems
- Regulated industries (healthcare, finance)

What this means:
- Multi-tenant architecture, RBAC, SLAs
- ≥90% test coverage, formal verification
- Zero-downtime deploys, auto-rollback
- Bug bounty program, annual security audits, zero-trust
- White-label support, i18n/l10n, certifications
- Compliance docs (SOC2, HIPAA, etc.), disaster recovery plans
- 99.99% uptime SLA, auto-scaling
- OpenAPI specs, SDK generators

Example: Your login form supports SSO with SAML/OAuth, enforces complex password policies configurable per tenant, has complete audit trails for compliance, supports 10+ languages, and has been certified for SOC2 Type II.

---

## Which Preset Should I Use?

DanteForge's magic presets automatically target specific maturity levels:

```
┌─────────────┬─────────────┬──────────────────────────────────┐
│ Preset      │ Target      │ When to Use                      │
├─────────────┼─────────────┼──────────────────────────────────┤
│ spark       │ Sketch      │ New project idea, just planning  │
│ ember       │ Prototype   │ Quick features, MVP work         │
│ canvas      │ Alpha       │ Design-first frontend features   │
│ magic       │ Beta        │ Daily work, most features        │
│ blaze       │ Customer    │ Production-ready features        │
│ nova        │ Enterprise  │ Big feature sprints              │
│ inferno     │ Enterprise  │ New matrix dimensions, OSS work  │
└─────────────┴─────────────┴──────────────────────────────────┘
```

**Decision Tree:**

1. **Just validating an idea?** → `spark` (Sketch)
2. **Need to show investors?** → `ember` (Prototype)
3. **Building a UI-heavy feature?** → `canvas` (Alpha)
4. **Daily feature work?** → `magic` (Beta)
5. **Shipping to real customers?** → `blaze` (Customer-Ready)
6. **Enterprise deal or new major feature?** → `nova` or `inferno` (Enterprise)

---

## How the Reflection Gate Prevents "Premature Done"

DanteForge's convergence loop includes a **reflection gate** that checks if your code meets the target maturity level for your chosen preset. If not, it triggers **focused remediation**.

Here's how it works:

### 1. After Initial Build

After the main autoforge/party pipeline, DanteForge runs a maturity assessment:

```
Target: Beta (Level 4, 61+ points)
Current: Prototype (Level 2, 38 points)
Gap: -23 points
```

### 2. Gap Analysis

The system identifies **critical gaps** (>20 points) and **major gaps** (10-20 points):

```
Critical Gaps:
- Testing: 45/100 (need 70+) → "Increase test coverage and add E2E tests"
- Security: 50/100 (need 70+) → "Move secrets to .env, run npm audit"

Major Gaps:
- Error Handling: 55/100 (need 70+) → "Add try/catch blocks and custom error classes"
```

### 3. Focused Remediation

If critical gaps exist, the convergence loop runs **3 focused autoforge waves** targeting those specific dimensions:

```
Wave 1: Boost Testing dimension (add E2E tests, improve coverage)
Wave 2: Boost Security dimension (move API keys to env vars, add rate limiting)
Wave 3: Boost Error Handling dimension (add custom error classes, structured logging)
```

### 4. Re-Assessment

After remediation, the system re-checks maturity:

```
Target: Beta (Level 4, 61+ points)
Current: Beta (Level 4, 65 points)
Status: PASS ✅
```

### 5. Exit Criteria

The loop exits when **one of these conditions is met**:

- Current level ≥ Target level (success)
- Max convergence cycles reached (partial success, warns)
- No critical gaps remain (acceptable)

This prevents you from thinking you're "done" when your code is actually at Sketch level but you're shipping to customers.

---

## Example Output

Running `danteforge maturity --preset magic` might show:

```
════════════════════════════════════════════════════════════
  DanteForge Maturity Assessment
════════════════════════════════════════════════════════════

Current Level: Prototype (2/6)
Target Level:  Beta (4/6)
Overall Score: 38/100
Use Case:      Show investors

Quality Dimensions:
  ✅ Functionality        72/100
  ⚠️  Documentation       65/100
  ⚠️  Maintainability     62/100
  ❌ Testing              45/100
  ❌ Security             50/100
  ❌ Error Handling       55/100
  ❌ UX Polish            48/100
  ❌ Performance          60/100

Critical Gaps (2):
  - Testing: 45/100 (need 70+)
    → Increase test coverage and add E2E tests
  - Security: 50/100 (need 70+)
    → Run npm audit, move secrets to .env, remove dangerous patterns

What This Means:
  Your code is at Prototype level (38/100).

  Your code is ready to show investors. Works well enough to validate
  the business model.

  Target: Beta level (4/6).

  Critical gaps (2):
  - Testing: 45/100 (need 70+)
  - Security: 50/100 (need 70+)

Next Steps:
  1. Increase test coverage and add E2E tests
  2. Run npm audit, move secrets to .env, remove dangerous patterns
  3. Add try/catch blocks and create custom error classes

Recommendation: ❌ Blocked — critical gaps must be fixed

════════════════════════════════════════════════════════════
```

---

## The 18 Quality Dimensions Explained

### Base Dimensions (8)

### 1. Functionality (20% weight)

**What it measures:**
- PDSE completeness score (does the code match the spec?)
- Integration fitness (does it fit the existing architecture?)

**How to improve:**
- Complete all features in your spec
- Make sure code integrates cleanly with existing systems
- Handle edge cases mentioned in the plan

---

### 2. Testing (15% weight)

**What it measures:**
- Test coverage percentage (from `.c8rc.json` or coverage summary)
- Presence of test files
- Integration and E2E tests

**How to improve:**
- Add unit tests for critical logic
- Write integration tests for multi-component flows
- Add E2E tests for user workflows
- Configure `.c8rc.json` with coverage thresholds

---

### 3. Error Handling (10% weight)

**What it measures:**
- Ratio of try/catch blocks to functions
- Presence of custom error classes
- Proper error throwing

**How to improve:**
- Wrap risky operations in try/catch
- Create custom error classes (`class AuthError extends Error`)
- Use typed errors instead of throwing strings

---

### 4. Security (15% weight)

**What it measures:**
- Dangerous patterns (eval, innerHTML, SQL injection risks)
- Secrets management (.env file present, no hardcoded secrets)
- Input validation

**How to improve:**
- Move all secrets to `.env` files
- Run `npm audit` and fix vulnerabilities
- Remove `eval()` and `innerHTML` usage
- Use parameterized SQL queries
- Add rate limiting and input validation

---

### 5. UX Polish (10% weight)

**What it measures (web projects only):**
- Loading states (spinners, skeleton screens)
- Accessibility (ARIA labels, keyboard nav)
- Responsive design (Tailwind config)

**How to improve:**
- Add loading spinners for async operations
- Add ARIA labels to all interactive elements
- Ensure full keyboard navigation
- Use responsive design utilities (Tailwind)

---

### 6. Documentation (10% weight)

**What it measures:**
- PDSE clarity score (are docs clear and accurate?)
- PDSE freshness score (are docs up to date?)

**How to improve:**
- Update stale documentation
- Add architecture guides
- Write API documentation
- Keep README current

---

### 7. Performance (10% weight)

**What it measures:**
- Nested loops (O(n²) anti-patterns)
- SELECT * queries
- Await in loops

**How to improve:**
- Refactor nested loops to use efficient algorithms
- Replace `SELECT *` with specific column lists
- Replace `await` in loops with `Promise.all()`
- Profile your code and optimize bottlenecks

---

### 8. Maintainability (10% weight)

**What it measures:**
- PDSE testability score (is code easy to test?)
- Constitution alignment (does code follow project standards?)
- Function size (penalizes >100 LOC functions)

**How to improve:**
- Break large functions into smaller ones (<100 LOC)
- Extract shared logic into reusable modules
- Follow your project's constitution/coding standards
- Add dependency injection for testability

---

### Extended Dimensions (10)

The extended dimensions cover operational readiness, strategic alignment, and ecosystem concerns. They are scored alongside the base 8 and contribute to the overall maturity level.

#### 9. Spec-Driven Pipeline (`specDrivenPipeline`)

**What it measures:** How faithfully the codebase follows the spec-to-plan-to-tasks pipeline. Checks for the presence and completeness of SPEC.md, PLAN.md, and TASKS.md artifacts, and whether the implementation matches the spec.

#### 10. Convergence Self-Healing (`convergenceSelfHealing`)

**What it measures:** Whether the project uses convergence loops effectively. Scores based on verify receipt history, convergence cycle usage, and whether the maturity gate catches regressions before they ship.

#### 11. Token Economy (`tokenEconomy`)

**What it measures:** How efficiently the project uses LLM tokens. Evaluates routing aggressiveness, local transform usage, context compression, and budget adherence across magic preset runs.

#### 12. Ecosystem MCP (`ecosystemMcp`)

**What it measures:** Integration with the Model Context Protocol ecosystem. Checks for MCP server configuration, tool handler coverage, and whether external MCP tools are leveraged for workflows like Figma, browsing, or database access.

#### 13. Enterprise Readiness (`enterpriseReadiness`)

**What it measures:** Preparedness for enterprise deployment. Evaluates configuration management, audit trail completeness, safe self-edit policy enforcement, RBAC readiness, and compliance documentation.

#### 14. Community Adoption (`communityAdoption`)

**What it measures:** How well the project supports community contribution and adoption. Checks for CONTRIBUTING.md, SECURITY.md, issue templates, skill documentation, and plugin extensibility.

#### 15. CI/CD Integration (`ciCdIntegration`)

**What it measures:** Whether verification and quality gates are wired into continuous integration. Scores based on presence of CI config, verify receipt automation, and coverage threshold enforcement.

#### 16. Observability (`observability`)

**What it measures:** Runtime visibility into the system. Evaluates structured logging, execution telemetry, circuit breaker instrumentation, and cost tracking.

#### 17. Resilience (`resilience`)

**What it measures:** How well the system handles failures. Scores based on circuit breaker coverage, retry logic, graceful degradation paths, and advisory mode fallbacks.

#### 18. Developer Experience (`developerExperience`)

**What it measures:** How easy it is for developers to use and extend the tool. Evaluates CLI help quality, spinner/progress feedback, error message clarity, and interactive wizard availability.

---

## FAQ

### Q: Why does my code score 38/100 when all my tests pass?

A: Passing tests is just one dimension (Testing). The maturity system also checks security, error handling, UX polish, performance, documentation, functionality completeness, and maintainability. A green CI build doesn't mean production-ready code.

### Q: I'm just prototyping. Do I need to care about this?

A: No! If you're at Sketch level (prototyping), that's perfectly fine. Use the `spark` or `ember` presets which target lower maturity levels. The system is designed to match your actual needs — not force you to over-engineer.

### Q: Can I override the target maturity level?

A: Yes. The `--preset` flag sets the target automatically, but you can manually adjust it by choosing a different preset. Or run `danteforge maturity` without a preset to get a neutral assessment against Beta (level 4) as the default.

### Q: How often should I run maturity checks?

A: Run it:
- Before shipping to production (`blaze` or higher)
- After major refactors
- When preparing for a demo or investor meeting
- As part of your CI/CD pipeline (use `--json` for automation)

### Q: What if I disagree with a score?

A: The scoring heuristics are opinionated but based on industry best practices. If a dimension seems off, check the markdown report in `.danteforge/evidence/maturity/latest.md` for details. You can also open an issue to suggest improvements to the scoring logic.

### Q: Does this replace code review?

A: No. This is an automated quality gate. You still need human code review for architecture decisions, business logic correctness, and nuanced judgment calls.

---

## Integration with Convergence Loops

When you run a magic preset (e.g., `danteforge magic`), the convergence loop uses maturity scoring to decide if your code is "done":

1. **Run verify** (tests pass)
2. **Run maturity assessment** (check quality dimensions)
3. **If maturity < target**: Run 3 focused remediation waves
4. **Re-check maturity**
5. **Repeat** up to `convergenceCycles` times

This ensures that "done" means "meets quality standards for the chosen preset" — not just "tests pass."

---

## Further Reading

- `commands/maturity.md` — CLI command reference
- `docs/MAGIC-LEVELS.md` — Preset comparison table
- `.danteforge/evidence/maturity/latest.md` — Your latest maturity report
