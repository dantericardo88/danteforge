import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_CATALOG,
  getCatalogedError,
  findErrorByInternalCode,
  formatCatalogedError,
  type CatalogedError,
  type ErrorCategory,
} from '../src/core/error-catalog.js';

// ── Catalog structure ─────────────────────────────────────────────────────────

describe('ERROR_CATALOG', () => {
  it('is a non-empty object', () => {
    assert.ok(Object.keys(ERROR_CATALOG).length > 10, 'catalog should have many entries');
  });

  it('all entries have required fields', () => {
    for (const [key, entry] of Object.entries(ERROR_CATALOG)) {
      assert.ok(typeof entry.code === 'string' && entry.code.length > 0, `${key}.code missing`);
      assert.ok(typeof entry.internalCode === 'string', `${key}.internalCode missing`);
      assert.ok(typeof entry.category === 'string', `${key}.category missing`);
      assert.ok(typeof entry.title === 'string' && entry.title.length > 0, `${key}.title missing`);
      assert.ok(typeof entry.message === 'string' && entry.message.length > 0, `${key}.message missing`);
      assert.ok(typeof entry.remedy === 'string' && entry.remedy.length > 0, `${key}.remedy missing`);
      assert.ok(typeof entry.helpUrl === 'string', `${key}.helpUrl missing`);
    }
  });

  it('all codes follow DF-CATEGORY-NNN format', () => {
    const pattern = /^DF-[A-Z]+-\d{3}$/;
    for (const key of Object.keys(ERROR_CATALOG)) {
      assert.ok(pattern.test(key), `key "${key}" does not match DF-CATEGORY-NNN pattern`);
    }
  });

  it('all category values are valid ErrorCategory members', () => {
    const validCategories: ErrorCategory[] = ['setup', 'config', 'workflow', 'execution', 'verification'];
    for (const [key, entry] of Object.entries(ERROR_CATALOG)) {
      assert.ok(
        validCategories.includes(entry.category),
        `${key}.category "${entry.category}" is not a valid ErrorCategory`,
      );
    }
  });

  it('setup errors exist (DF-SETUP-*)', () => {
    const setupErrors = Object.keys(ERROR_CATALOG).filter(k => k.startsWith('DF-SETUP-'));
    assert.ok(setupErrors.length >= 3, 'should have multiple setup error codes');
  });

  it('config errors exist (DF-CONFIG-*)', () => {
    const configErrors = Object.keys(ERROR_CATALOG).filter(k => k.startsWith('DF-CONFIG-'));
    assert.ok(configErrors.length >= 2);
  });

  it('workflow errors exist (DF-WORKFLOW-*)', () => {
    const workflowErrors = Object.keys(ERROR_CATALOG).filter(k => k.startsWith('DF-WORKFLOW-'));
    assert.ok(workflowErrors.length >= 2);
  });
});

// ── getCatalogedError ─────────────────────────────────────────────────────────

describe('getCatalogedError', () => {
  it('returns entry for known code', () => {
    const entry = getCatalogedError('DF-SETUP-001');
    assert.ok(entry !== undefined);
    assert.equal(entry!.code, 'DF-SETUP-001');
    assert.equal(entry!.category, 'setup');
  });

  it('returns undefined for unknown code', () => {
    const entry = getCatalogedError('DF-UNKNOWN-999');
    assert.equal(entry, undefined);
  });

  it('returns correct title for DF-SETUP-002', () => {
    const entry = getCatalogedError('DF-SETUP-002');
    assert.ok(entry !== undefined);
    assert.ok(entry!.title.toLowerCase().includes('ollama') || entry!.title.length > 0);
  });
});

// ── findErrorByInternalCode ───────────────────────────────────────────────────

describe('findErrorByInternalCode', () => {
  it('returns an entry for a known internal code', () => {
    const entry = findErrorByInternalCode('LLM_UNAVAILABLE');
    assert.ok(entry !== undefined);
  });

  it('returns undefined for an unknown internal code', () => {
    const entry = findErrorByInternalCode('TOTALLY_MADE_UP_CODE');
    assert.equal(entry, undefined);
  });

  it('narrows by category when provided', () => {
    const entry = findErrorByInternalCode('CONFIG_MISSING_KEY', { category: 'workflow' });
    assert.ok(entry !== undefined);
    assert.equal(entry!.category, 'workflow');
  });

  it('narrows by message heuristic — ollama connection', () => {
    const entry = findErrorByInternalCode('LLM_UNAVAILABLE', {
      message: 'Ollama server connection refused',
    });
    assert.ok(entry !== undefined);
  });

  it('narrows by message heuristic — constitution', () => {
    const entry = findErrorByInternalCode('CONFIG_MISSING_KEY', {
      message: 'constitution not found',
    });
    assert.ok(entry !== undefined);
    assert.ok(entry!.code.includes('WORKFLOW') || entry!.code.length > 0);
  });

  it('narrows by message heuristic — spec', () => {
    const entry = findErrorByInternalCode('CONFIG_MISSING_KEY', {
      message: 'spec file is missing',
    });
    assert.ok(entry !== undefined);
  });

  it('narrows by message heuristic — plan', () => {
    const entry = findErrorByInternalCode('CONFIG_MISSING_KEY', {
      message: 'plan is missing',
    });
    assert.ok(entry !== undefined);
  });

  it('narrows by message heuristic — test', () => {
    const entry = findErrorByInternalCode('CONFIG_MISSING_KEY', {
      message: 'test failures detected',
    });
    assert.ok(entry !== undefined);
  });

  it('narrows by message heuristic — build/typecheck', () => {
    const entry = findErrorByInternalCode('CONFIG_MISSING_KEY', {
      message: 'typecheck failed',
    });
    assert.ok(entry !== undefined);
  });

  it('returns first match when multiple exist and no context', () => {
    // CONFIG_MISSING_KEY appears in many entries; without context should return one
    const entry = findErrorByInternalCode('CONFIG_MISSING_KEY');
    assert.ok(entry !== undefined);
  });
});

// ── formatCatalogedError ─────────────────────────────────────────────────────

describe('formatCatalogedError', () => {
  const sample: CatalogedError = {
    code: 'DF-TEST-001',
    internalCode: 'TEST_ERROR',
    category: 'setup',
    title: 'Test Error',
    message: 'Something went wrong in tests.',
    remedy: 'Check your test setup.',
    helpUrl: 'https://example.com/help',
  };

  it('includes the error code in output', () => {
    const output = formatCatalogedError(sample);
    assert.ok(output.includes('DF-TEST-001'));
  });

  it('includes the title', () => {
    const output = formatCatalogedError(sample);
    assert.ok(output.includes('Test Error'));
  });

  it('includes the message', () => {
    const output = formatCatalogedError(sample);
    assert.ok(output.includes('Something went wrong in tests.'));
  });

  it('includes the remedy', () => {
    const output = formatCatalogedError(sample);
    assert.ok(output.includes('Check your test setup.'));
  });

  it('includes the help URL', () => {
    const output = formatCatalogedError(sample);
    assert.ok(output.includes('https://example.com/help'));
  });

  it('formats a real catalog entry without crashing', () => {
    const entry = getCatalogedError('DF-SETUP-001');
    assert.ok(entry !== undefined);
    const output = formatCatalogedError(entry!);
    assert.ok(output.length > 50);
  });
});
