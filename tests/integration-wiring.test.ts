import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkIntegrationWiring,
  computeWiringBonus,
  type IntegrationWiringResult,
} from '../src/core/integration-wiring.js';
import { computeErrorHandlingScore } from '../src/core/harsh-scorer.js';
import type { MaturityAssessment } from '../src/core/maturity-engine.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSourceFiles(files: Record<string, string>) {
  // Normalize to forward slashes for cross-platform path matching
  const normalize = (p: string) => p.replace(/\\/g, '/');
  return {
    _readSourceFiles: async () => Object.keys(files),
    _readFileContent: async (p: string) => {
      const normalizedP = normalize(p);
      const key = Object.keys(files).find(k => normalizedP.endsWith(normalize(k))) ?? p;
      const content = files[key];
      if (content === undefined) throw new Error(`not found: ${p}`);
      return content;
    },
    _existsFile: async (_p: string) => true,
  };
}

function makeExistsNone() {
  return { _existsFile: async () => false };
}

function makeStubAssessment(errorHandlingScore = 50): MaturityAssessment {
  return {
    overallScore: 60,
    maturityLevel: 3,
    dimensions: {
      functionality: 70, testing: 60, errorHandling: errorHandlingScore,
      security: 65, uxPolish: 55, documentation: 60, performance: 60, maintainability: 65,
    },
    gaps: [],
    recommendation: 'proceed',
    timestamp: new Date().toISOString(),
  } as unknown as MaturityAssessment;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('checkIntegrationWiring', () => {
  it('circuitBreakerInvoked:true when source files contain call pattern', async () => {
    const result = await checkIntegrationWiring({
      ...makeSourceFiles({
        'src/core/llm.ts': 'const breaker = new CircuitBreaker(); await breaker.execute(fn);',
      }),
    });
    assert.equal(result.flags.circuitBreakerInvoked, true);
  });

  it('circuitBreakerInvoked:false when no call sites found', async () => {
    const result = await checkIntegrationWiring({
      ...makeSourceFiles({
        'src/core/llm.ts': 'import { CircuitBreaker } from "./circuit-breaker.js"; // unused import',
      }),
    });
    assert.equal(result.flags.circuitBreakerInvoked, false);
  });

  it('circuitBreakerInvoked:false when circuit-breaker file does not exist', async () => {
    const result = await checkIntegrationWiring({
      _existsFile: async (p) => !p.includes('circuit-breaker'),
      _readSourceFiles: async () => ['src/core/llm.ts'],
      _readFileContent: async () => 'circuitBreaker.execute(fn);',
    });
    assert.equal(result.flags.circuitBreakerInvoked, false);
  });

  it('errorHierarchyThrown:true when custom errors are thrown in source', async () => {
    const result = await checkIntegrationWiring({
      ...makeSourceFiles({
        'src/core/llm.ts': 'throw new LLMError("rate limited");',
      }),
    });
    assert.equal(result.flags.errorHierarchyThrown, true);
  });

  it('errorHierarchyThrown:false when no throw sites found', async () => {
    const result = await checkIntegrationWiring({
      ...makeSourceFiles({
        'src/core/llm.ts': 'import type { LLMError } from "./errors.js";',
      }),
    });
    assert.equal(result.flags.errorHierarchyThrown, false);
  });

  it('auditLoggerWired:true when 2+ files use audit pattern', async () => {
    const result = await checkIntegrationWiring({
      ...makeSourceFiles({
        'src/core/a.ts': 'state.auditLog.push({ action: "forge" });',
        'src/core/b.ts': 'state.auditLog.push({ action: "verify" });',
      }),
    });
    assert.equal(result.flags.auditLoggerWired, true);
  });

  it('auditLoggerWired:false when only 1 file uses audit pattern', async () => {
    const result = await checkIntegrationWiring({
      ...makeSourceFiles({
        'src/core/a.ts': 'state.auditLog.push({ action: "forge" });',
        'src/core/b.ts': 'no audit here',
      }),
    });
    assert.equal(result.flags.auditLoggerWired, false);
  });

  it('wiringScore is higher when more flags are true', async () => {
    const allTrue = await checkIntegrationWiring({
      ...makeSourceFiles({
        'src/core/a.ts': [
          'new CircuitBreaker(); circuitBreaker.execute(fn);',
          'throw new LLMError("x");',
          'state.auditLog.push({});',
        ].join('\n'),
        'src/core/b.ts': 'state.auditLog.push({});',
      }),
    });
    const noneTrue = await checkIntegrationWiring({
      ...makeSourceFiles({ 'src/core/a.ts': 'const x = 1;' }),
      ...makeExistsNone(),
    });
    assert.ok(allTrue.wiringScore > noneTrue.wiringScore, `allTrue(${allTrue.wiringScore}) should > noneTrue(${noneTrue.wiringScore})`);
  });

  it('unwiredModules contains circuit-breaker when it exists but is not called', async () => {
    const result = await checkIntegrationWiring({
      _existsFile: async () => true, // all files "exist"
      _readSourceFiles: async () => ['src/core/a.ts'],
      _readFileContent: async () => 'const x = 1; // nothing wired',
    });
    assert.ok(result.unwiredModules.some(m => m.includes('circuit-breaker')));
  });

  it('wiringScore is 20 (base) when no flags are true and no files exist', async () => {
    const result = await checkIntegrationWiring({
      ...makeSourceFiles({ 'src/core/a.ts': 'const x = 1;' }),
      ...makeExistsNone(),
    });
    assert.equal(result.wiringScore, 20);
  });

  it('wiringScore does not exceed 100', async () => {
    const result = await checkIntegrationWiring({
      ...makeSourceFiles({
        'src/core/a.ts': [
          'circuitBreaker.execute(fn);',
          'throw new LLMError("x");',
          'state.auditLog.push({});',
          'rateLimiter.consume(1);',
        ].join('\n'),
        'src/core/b.ts': 'state.auditLog.push({});',
      }),
    });
    assert.ok(result.wiringScore <= 100);
  });
});

describe('computeWiringBonus', () => {
  it('returns 0 when all flags are false', () => {
    const result: IntegrationWiringResult = {
      wiringScore: 20,
      flags: { circuitBreakerInvoked: false, errorHierarchyThrown: false, auditLoggerWired: false, rateLimiterInvoked: false },
      unwiredModules: [],
    };
    assert.equal(computeWiringBonus(result), 0);
  });

  it('returns 10 per true flag', () => {
    const result: IntegrationWiringResult = {
      wiringScore: 60,
      flags: { circuitBreakerInvoked: true, errorHierarchyThrown: true, auditLoggerWired: false, rateLimiterInvoked: false },
      unwiredModules: [],
    };
    assert.equal(computeWiringBonus(result), 20);
  });
});

describe('computeErrorHandlingScore with wiring', () => {
  it('gives partial credit for circuit breaker that exists but is not wired', () => {
    const assessment = makeStubAssessment(50);
    const flags = { hasErrorHierarchy: false, hasCircuitBreaker: true, hasResilienceModule: false, hasE2EErrorHandlingTest: false };
    const noWiring: IntegrationWiringResult = {
      wiringScore: 20,
      flags: { circuitBreakerInvoked: false, errorHierarchyThrown: false, auditLoggerWired: false, rateLimiterInvoked: false },
      unwiredModules: ['circuit-breaker'],
    };
    const fullWiring: IntegrationWiringResult = {
      wiringScore: 60,
      flags: { circuitBreakerInvoked: true, errorHierarchyThrown: false, auditLoggerWired: false, rateLimiterInvoked: false },
      unwiredModules: [],
    };
    const partialScore = computeErrorHandlingScore(assessment, flags, noWiring);
    const fullScore = computeErrorHandlingScore(assessment, flags, fullWiring);
    assert.ok(fullScore > partialScore, `wired (${fullScore}) should score higher than unwired (${partialScore})`);
  });

  it('gives partial credit for error hierarchy that exists but is not thrown', () => {
    const assessment = makeStubAssessment(50);
    const flags = { hasErrorHierarchy: true, hasCircuitBreaker: false, hasResilienceModule: false, hasE2EErrorHandlingTest: false };
    const noWiring: IntegrationWiringResult = {
      wiringScore: 20,
      flags: { circuitBreakerInvoked: false, errorHierarchyThrown: false, auditLoggerWired: false, rateLimiterInvoked: false },
      unwiredModules: ['errors'],
    };
    const fullWiring: IntegrationWiringResult = {
      wiringScore: 40,
      flags: { circuitBreakerInvoked: false, errorHierarchyThrown: true, auditLoggerWired: false, rateLimiterInvoked: false },
      unwiredModules: [],
    };
    const partialScore = computeErrorHandlingScore(assessment, flags, noWiring);
    const fullScore = computeErrorHandlingScore(assessment, flags, fullWiring);
    assert.ok(fullScore > partialScore, `thrown error hierarchy (${fullScore}) should score higher than unthrown (${partialScore})`);
  });

  it('backward-compatible: works without wiringResult', () => {
    const assessment = makeStubAssessment(50);
    const flags = { hasErrorHierarchy: true, hasCircuitBreaker: true, hasResilienceModule: false, hasE2EErrorHandlingTest: false };
    const score = computeErrorHandlingScore(assessment, flags); // no wiringResult
    assert.ok(typeof score === 'number');
    assert.ok(score >= 0 && score <= 95);
  });
});
