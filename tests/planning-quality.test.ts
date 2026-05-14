// Planning quality tests — scorePlan, dependency detection, traceability.
// Uses Node.js built-in test runner + injected dependencies (no real FS/LLM).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scorePlan,
  buildDependencyGraph,
  buildTraceabilityReport,
  extractRequirements,
} from '../src/core/plan-quality-scorer.js';
import { appendDependencySection, validateDependencies } from '../src/cli/commands/tasks.js';
import { traceability } from '../src/cli/commands/traceability.js';

// ── scorePlan — high-quality plan ─────────────────────────────────────────────

describe('scorePlan — high-quality plan', () => {
  const GOOD_PLAN = `
# Implementation Plan

## Phase 1 — Authentication (effort: M)
1. Implement JWT token issuance in src/auth/token.ts - verify: tokens expire after 1h - effort: S
   - Done when: unit tests pass, token.sign() returns valid JWT
2. Create user login endpoint src/routes/login.ts - verify: returns 401 on bad password - effort: M
   - Done when: integration test with bad creds returns 401
3. Configure CORS middleware src/middleware/cors.ts - verify: OPTIONS requests succeed - effort: S
   - Done when: browser preflight returns 200

## Phase 2 — Data Layer (effort: L, depends on Phase 1)
4. Build database schema src/db/schema.sql - verify: migrations run without error - effort: M
   Depends on task 1
5. Implement repository pattern src/db/user-repo.ts - verify: CRUD tests pass - effort: L
   Depends on task 4
6. Add connection pooling src/db/pool.ts - effort: S
   After task 4

## Dependencies
- 4 → 1
- 5 → 4
- 6 → 4
`;

  const GOOD_SPEC = `
# Spec

1. Users must be able to authenticate with JWT tokens
2. Login endpoint must reject invalid credentials
3. CORS must allow browser cross-origin requests
4. Database must support user data persistence
5. Repository pattern for data access isolation
`;

  it('returns high spec coverage for good plan vs matching spec', () => {
    const result = scorePlan(GOOD_PLAN, GOOD_SPEC);
    assert.ok(result.specCoverage >= 5, `specCoverage ${result.specCoverage} should be >= 5`);
  });

  it('returns high task granularity for verb+noun+path tasks', () => {
    const result = scorePlan(GOOD_PLAN, GOOD_SPEC);
    assert.ok(result.taskGranularity >= 5, `taskGranularity ${result.taskGranularity} should be >= 5`);
  });

  it('returns high dependency ordering for numbered + dep references', () => {
    const result = scorePlan(GOOD_PLAN, GOOD_SPEC);
    assert.ok(result.dependencyOrdering >= 5, `dependencyOrdering ${result.dependencyOrdering} should be >= 5`);
  });

  it('returns positive estimation score for effort tags', () => {
    const result = scorePlan(GOOD_PLAN, GOOD_SPEC);
    assert.ok(result.estimationPresent >= 3, `estimationPresent ${result.estimationPresent} should be >= 3`);
  });

  it('returns positive acceptance criteria score for Done when clauses', () => {
    const result = scorePlan(GOOD_PLAN, GOOD_SPEC);
    assert.ok(result.acceptanceCriteria >= 3, `acceptanceCriteria ${result.acceptanceCriteria} should be >= 3`);
  });

  it('overall score is above 5 for a good plan', () => {
    const result = scorePlan(GOOD_PLAN, GOOD_SPEC);
    assert.ok(result.overallScore >= 5, `overallScore ${result.overallScore} should be >= 5`);
  });

  it('suggestions array is shorter for a good plan', () => {
    const result = scorePlan(GOOD_PLAN, GOOD_SPEC);
    // Good plan may still have some suggestions but not all 5
    assert.ok(result.suggestions.length <= 3, `too many suggestions: ${result.suggestions.length}`);
  });
});

// ── scorePlan — vague/bad plan ────────────────────────────────────────────────

describe('scorePlan — vague plan', () => {
  const VAGUE_PLAN = `
# Plan

Do the authentication stuff.
Maybe add a database somehow.
Handle errors and things.
`;

  const SPEC = `
1. Users must authenticate with JWT
2. Database persistence required
3. Proper error handling
`;

  it('returns low task granularity for vague plan', () => {
    const result = scorePlan(VAGUE_PLAN, SPEC);
    assert.ok(result.taskGranularity <= 5, `taskGranularity ${result.taskGranularity} should be <= 5`);
  });

  it('returns low estimation score for plan with no effort tags', () => {
    const result = scorePlan(VAGUE_PLAN, SPEC);
    assert.ok(result.estimationPresent <= 3, `estimationPresent ${result.estimationPresent} should be <= 3`);
  });

  it('returns low acceptance criteria score for plan with no Done when', () => {
    const result = scorePlan(VAGUE_PLAN, SPEC);
    assert.ok(result.acceptanceCriteria <= 3, `acceptanceCriteria ${result.acceptanceCriteria} should be <= 3`);
  });

  it('has suggestions when plan is vague', () => {
    const result = scorePlan(VAGUE_PLAN, SPEC);
    assert.ok(result.suggestions.length > 0, 'should produce improvement suggestions');
  });

  it('overall score is lower for vague plan than good plan', () => {
    const good = scorePlan(`
# Plan
1. Implement JWT auth src/auth.ts - effort: S - Done when: tests pass
2. Build database src/db.ts - effort: M - Done when: CRUD tests green
   Depends on task 1
`, SPEC);
    const bad = scorePlan(VAGUE_PLAN, SPEC);
    assert.ok(good.overallScore > bad.overallScore, `good (${good.overallScore}) should outscore bad (${bad.overallScore})`);
  });
});

// ── scorePlan — no spec ───────────────────────────────────────────────────────

describe('scorePlan — no spec provided', () => {
  it('returns neutral spec coverage (5) when spec is empty', () => {
    const result = scorePlan('1. Implement auth', '');
    assert.strictEqual(result.specCoverage, 5);
  });

  it('still scores other dimensions normally', () => {
    const plan = `
1. Implement auth endpoint src/auth.ts - effort: M
   Done when: 200 status returned for valid creds
2. Build user model src/models/user.ts - effort: S
   Done when: model tests pass
`;
    const result = scorePlan(plan);
    assert.ok(result.taskGranularity >= 4, `granularity should be reasonable: ${result.taskGranularity}`);
  });

  it('returns a result object with all 5 dimensions', () => {
    const result = scorePlan('some plan text');
    assert.ok('specCoverage' in result);
    assert.ok('taskGranularity' in result);
    assert.ok('dependencyOrdering' in result);
    assert.ok('estimationPresent' in result);
    assert.ok('acceptanceCriteria' in result);
    assert.ok('overallScore' in result);
    assert.ok('suggestions' in result);
  });

  it('overall score is a number between 0 and 10', () => {
    const result = scorePlan('random text here');
    assert.ok(result.overallScore >= 0 && result.overallScore <= 10);
  });
});

// ── buildDependencyGraph ──────────────────────────────────────────────────────

describe('buildDependencyGraph', () => {
  it('detects "depends on task N" references', () => {
    const tasks = `
1. Implement base module
2. Build API layer - depends on task 1
3. Add tests - depends on task 2
`;
    const graph = buildDependencyGraph(tasks);
    assert.ok(graph.tasks.includes('1'));
    assert.ok(graph.tasks.includes('2'));
    assert.ok(graph.tasks.includes('3'));
    const dep2 = graph.edges.find(e => e.taskId === '2');
    assert.ok(dep2?.dependsOn.includes('1'));
  });

  it('detects "after task N" references', () => {
    const tasks = `
1. Setup database
2. Seed data - after task 1
`;
    const graph = buildDependencyGraph(tasks);
    const dep = graph.edges.find(e => e.taskId === '2');
    assert.ok(dep?.dependsOn.includes('1'));
  });

  it('detects "requires task N" references', () => {
    const tasks = `
1. Create schema
2. Write migrations - requires task 1
`;
    const graph = buildDependencyGraph(tasks);
    const dep = graph.edges.find(e => e.taskId === '2');
    assert.ok(dep?.dependsOn.includes('1'));
  });

  it('identifies root tasks (no dependencies)', () => {
    const tasks = `
1. Base setup
2. Build on base - depends on task 1
`;
    const graph = buildDependencyGraph(tasks);
    assert.ok(graph.roots.includes('1'));
    assert.ok(!graph.roots.includes('2'));
  });

  it('identifies leaf tasks (nothing depends on them)', () => {
    const tasks = `
1. Base setup
2. Final step - depends on task 1
`;
    const graph = buildDependencyGraph(tasks);
    assert.ok(graph.leaves.includes('2'));
    assert.ok(!graph.leaves.includes('1'));
  });

  it('marks acyclic graph correctly', () => {
    const tasks = `
1. Task A
2. Task B - depends on task 1
3. Task C - depends on task 2
`;
    const graph = buildDependencyGraph(tasks);
    assert.ok(graph.isAcyclic);
  });

  it('detects circular dependency', () => {
    // We simulate a cycle by having tasks reference each other
    // Note: the parser only detects declared deps — true cycles need explicit notation
    const tasks = `
1. Task A - depends on task 3
2. Task B - depends on task 1
3. Task C - depends on task 2
`;
    const graph = buildDependencyGraph(tasks);
    assert.ok(!graph.isAcyclic, 'should detect the cycle 1→3→2→1');
  });

  it('returns empty edges for tasks with no dependency declarations', () => {
    const tasks = `
1. Setup
2. Build
3. Test
`;
    const graph = buildDependencyGraph(tasks);
    const withDeps = graph.edges.filter(e => e.dependsOn.length > 0);
    assert.strictEqual(withDeps.length, 0);
  });
});

// ── appendDependencySection ───────────────────────────────────────────────────

describe('appendDependencySection', () => {
  it('appends Dependencies section when deps exist', () => {
    const tasks = `
1. Setup base
2. Build API - depends on task 1
`;
    const result = appendDependencySection(tasks);
    assert.ok(result.includes('## Dependencies'));
    assert.ok(result.includes('Task 2'));
  });

  it('does not append section when no deps exist', () => {
    const tasks = '1. Do thing A\n2. Do thing B\n';
    const result = appendDependencySection(tasks);
    assert.ok(!result.includes('## Dependencies'));
  });

  it('does not add duplicate Dependencies section', () => {
    const tasks = `
1. Task A
2. Task B - depends on task 1

## Dependencies
- Task 2 → Task 1
`;
    const result = appendDependencySection(tasks);
    const count = (result.match(/## Dependencies/g) ?? []).length;
    assert.strictEqual(count, 1);
  });
});

// ── extractRequirements ───────────────────────────────────────────────────────

describe('extractRequirements', () => {
  it('extracts REQ-NNN labeled requirements', () => {
    const spec = `
REQ-001: Users must be able to log in
REQ-002: System must support JWT tokens
`;
    const reqs = extractRequirements(spec);
    assert.ok(reqs.some(r => r.id === 'REQ-001'));
    assert.ok(reqs.some(r => r.id === 'REQ-002'));
  });

  it('extracts numbered requirements', () => {
    const spec = `
1. Users must authenticate
2. Tokens must expire after 1 hour
3. System must log failed attempts
`;
    const reqs = extractRequirements(spec);
    assert.strictEqual(reqs.length, 3);
    assert.strictEqual(reqs[0].id, 'REQ-1');
  });

  it('extracts bulleted requirements with sufficient content', () => {
    const spec = `
- Users need to login with email and password credentials
- Tokens should expire after one hour of inactivity
`;
    const reqs = extractRequirements(spec);
    assert.ok(reqs.length >= 2);
  });

  it('ignores heading lines', () => {
    const spec = `
# Authentication Requirements
1. Users must be able to log in
`;
    const reqs = extractRequirements(spec);
    assert.strictEqual(reqs.length, 1);
  });
});

// ── buildTraceabilityReport ───────────────────────────────────────────────────

describe('buildTraceabilityReport', () => {
  const SPEC = `
1. Users must authenticate with JWT tokens
2. Login endpoint must reject invalid credentials with 401
3. Database must persist user records
`;

  const PLAN_COVERING = `
1. Implement JWT authentication token issuance - src/auth/token.ts
2. Create login endpoint that returns 401 for invalid credentials - src/routes/login.ts
3. Build database user repository for persisting user records - src/db/user-repo.ts
`;

  it('marks requirements as covered when plan tasks match', () => {
    const report = buildTraceabilityReport(SPEC, PLAN_COVERING);
    const covered = report.rows.filter(r => r.covered);
    assert.ok(covered.length >= 2, `expected >=2 covered, got ${covered.length}`);
  });

  it('marks requirements as missing when plan has no matching tasks', () => {
    const sparseSpec = `
1. Users must authenticate with JWT tokens
2. System must support OAuth2 social login providers
`;
    const sparseplan = '1. Implement basic auth check\n';
    const report = buildTraceabilityReport(sparseSpec, sparseplan);
    const missing = report.rows.filter(r => !r.covered);
    assert.ok(missing.length >= 1);
  });

  it('computes coverage percentage correctly', () => {
    const report = buildTraceabilityReport(SPEC, PLAN_COVERING);
    assert.ok(report.coveragePercent >= 0 && report.coveragePercent <= 100);
    assert.strictEqual(report.totalRequirements, report.rows.length);
  });

  it('returns 100% coverage for empty spec', () => {
    const report = buildTraceabilityReport('', 'some plan');
    assert.strictEqual(report.coveragePercent, 100);
    assert.strictEqual(report.totalRequirements, 0);
  });

  it('each row has reqId, requirementText, coveringTasks, covered', () => {
    const report = buildTraceabilityReport(SPEC, PLAN_COVERING);
    for (const row of report.rows) {
      assert.ok(typeof row.reqId === 'string');
      assert.ok(typeof row.requirementText === 'string');
      assert.ok(Array.isArray(row.coveringTasks));
      assert.ok(typeof row.covered === 'boolean');
    }
  });
});

// ── traceability command (injected reader) ─────────────────────────────────────

describe('traceability command', () => {
  it('calls _readFile for spec and plan paths', async () => {
    const calls: string[] = [];
    const spec = '1. Users must be able to login with email and password\n2. Tokens must expire after 1 hour\n';
    const plan = '1. Implement login endpoint for users email password - src/auth.ts\n2. Configure token expiry timeout - src/token.ts\n';
    const savedExitCode = process.exitCode;

    await traceability({
      _readFile: async (p) => {
        calls.push(p);
        if (p.includes('SPEC') || p.includes('AGENTS')) return spec;
        if (p.includes('TASKS') || p.includes('PLAN')) return plan;
        throw new Error('not found');
      },
      json: false,
    });

    // Reset exitCode — traceability sets it to 1 on uncovered reqs
    process.exitCode = savedExitCode;
    assert.ok(calls.length >= 1, 'should have called _readFile');
  });

  it('outputs JSON when --json flag is set', async () => {
    const spec = 'REQ-001: Users must login\n';
    const plan = '1. Implement user login - src/auth.ts\n';

    let jsonOutput = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      jsonOutput += String(chunk);
      return true;
    };

    try {
      await traceability({
        _readFile: async (p) => {
          if (p.includes('SPEC')) return spec;
          if (p.includes('TASKS')) return plan;
          throw new Error('not found');
        },
        json: true,
      });
    } finally {
      process.stdout.write = origWrite;
    }

    const parsed = JSON.parse(jsonOutput) as { rows: unknown[]; coveragePercent: number };
    assert.ok(Array.isArray(parsed.rows));
    assert.ok(typeof parsed.coveragePercent === 'number');
  });

  it('outputs non-empty rows in JSON for matching spec+plan', async () => {
    const spec = 'REQ-001: Users must authenticate with tokens\nREQ-002: System must handle logout\n';
    const plan = '1. Implement authentication token system - src/auth.ts\n2. Add logout handler endpoint - src/logout.ts\n';
    const savedExitCode = process.exitCode;

    let jsonOutput = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      jsonOutput += String(chunk);
      return true;
    };

    try {
      await traceability({
        _readFile: async (p) => {
          if (p.includes('SPEC') || p.includes('AGENTS')) return spec;
          if (p.includes('TASKS') || p.includes('PLAN')) return plan;
          throw new Error('not found');
        },
        json: true,
      });
    } finally {
      process.stdout.write = origWrite;
    }

    process.exitCode = savedExitCode;

    const parsed = JSON.parse(jsonOutput) as { rows: Array<{ reqId: string }>; totalRequirements: number };
    assert.ok(parsed.totalRequirements >= 2, `expected >=2 requirements, got ${parsed.totalRequirements}`);
    assert.ok(parsed.rows.some(r => r.reqId === 'REQ-001'));
  });

  it('handles missing spec gracefully (falls back to AGENTS.md)', async () => {
    const plan = '1. Implement feature - src/feature.ts\n';
    const savedExitCode = process.exitCode;

    // Should not throw even when SPEC.md and AGENTS.md are missing
    await assert.doesNotReject(async () => {
      await traceability({
        _readFile: async (p) => {
          if (p.includes('TASKS') || p.includes('PLAN')) return plan;
          throw new Error('file not found');
        },
        json: true,
      });
    });

    process.exitCode = savedExitCode;
  });
});
