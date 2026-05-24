// Actionable errors tests — Node built-in test runner (no Jest/Vitest)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichError,
  formatActionableError,
  ERROR_SUGGESTIONS,
} from '../src/core/actionable-errors.js';

// ---------------------------------------------------------------------------
// enrichError — known patterns
// ---------------------------------------------------------------------------

describe('enrichError — known patterns', () => {
  it('maps ENOENT .danteforge to init suggestion', () => {
    const ae = enrichError(new Error('ENOENT .danteforge/STATE.yaml'));
    assert.ok(ae.suggestion.includes('danteforge init'), 'suggestion should mention init');
    assert.notEqual(ae.code, 'ERR_UNKNOWN');
  });

  it('maps "No config found" to config --setup suggestion', () => {
    const ae = enrichError('No config found in ~/.danteforge');
    assert.ok(ae.suggestion.includes('config --setup'), 'suggestion should mention config --setup');
    assert.notEqual(ae.code, 'ERR_UNKNOWN');
  });

  it('maps "No constitution" to constitution command suggestion', () => {
    const ae = enrichError(new Error('No constitution found — run the wizard first'));
    assert.ok(ae.suggestion.includes('constitution'), 'suggestion should mention constitution');
  });

  it('maps "No spec found" to specify command suggestion', () => {
    const ae = enrichError('No spec found');
    assert.ok(ae.suggestion.includes('specify'), 'suggestion should mention specify');
  });

  it('maps "LLM timeout" to ollama / --prompt suggestion', () => {
    const ae = enrichError(new Error('LLM timeout after 30s'));
    assert.ok(
      ae.suggestion.includes('ollama') || ae.suggestion.includes('--prompt'),
      'suggestion should mention ollama or --prompt',
    );
  });

  it('maps "Rate limit" to wait / ollama suggestion', () => {
    const ae = enrichError('Rate limit exceeded');
    assert.ok(ae.suggestion.includes('60'), 'suggestion should mention wait time');
  });

  it('maps "429" HTTP error to retry / provider suggestion', () => {
    const ae = enrichError(new Error('HTTP 429 Too Many Requests'));
    assert.ok(ae.suggestion.includes('60') || ae.suggestion.includes('ollama'));
  });

  it('maps "connection refused" to ollama serve suggestion', () => {
    const ae = enrichError(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
    assert.ok(ae.suggestion.includes('ollama'), 'suggestion should mention ollama');
  });

  it('maps "No plan found" to plan command suggestion', () => {
    const ae = enrichError('No plan found in project');
    assert.ok(ae.suggestion.includes('plan'), 'suggestion should mention plan');
  });

  it('maps "gate failed" to verify / --light suggestion', () => {
    const ae = enrichError(new Error('gate failed: tests required'));
    assert.ok(
      ae.suggestion.includes('verify') || ae.suggestion.includes('--light'),
      'suggestion should mention verify or --light',
    );
  });

  it('maps "TypeScript error" to typecheck suggestion', () => {
    const ae = enrichError(new Error('TypeScript error: Property X does not exist'));
    assert.ok(ae.suggestion.includes('typecheck'), 'suggestion should mention typecheck');
  });

  it('maps "permission denied" to permissions suggestion', () => {
    const ae = enrichError(new Error('permission denied: /usr/local/bin/dforge'));
    assert.ok(ae.suggestion.toLowerCase().includes('permission'), 'suggestion should mention permission');
  });
});

// ---------------------------------------------------------------------------
// enrichError — unknown patterns
// ---------------------------------------------------------------------------

describe('enrichError — unknown patterns', () => {
  it('returns a non-empty code for unrecognized messages', () => {
    // 'some totally unknown xyzzy' has no known pattern — falls to generic fallback
    // The generic 'error' catch-all may still match if the word 'error' appears,
    // so use a message guaranteed to have no matching pattern.
    const ae = enrichError(new Error('xyzzy plugh twisty passages'));
    assert.ok(ae.code.length > 0, 'code should be non-empty');
    assert.ok(ae.suggestion.length > 0, 'should still have a helpful suggestion');
  });

  it('still includes the original message in the result', () => {
    const ae = enrichError(new Error('mystery failure 99'));
    assert.ok(ae.message.includes('mystery failure 99'), 'original message should be preserved');
  });

  it('provides a generic helpful suggestion for unknown errors', () => {
    const ae = enrichError('something weird happened');
    assert.ok(ae.suggestion.length > 10, 'generic suggestion should be non-trivial');
    assert.ok(
      ae.suggestion.includes('--debug') || ae.suggestion.includes('audit.log'),
      'generic suggestion should point to debug output',
    );
  });
});

// ---------------------------------------------------------------------------
// enrichError — context
// ---------------------------------------------------------------------------

describe('enrichError — context matching', () => {
  it('uses command context to improve pattern matching', () => {
    // Error message alone is generic, but command context hints at the issue
    const ae = enrichError(new Error('file not found'), { command: 'forge' });
    // Should still resolve without throwing
    assert.ok(ae.code.length > 0);
    assert.ok(ae.message.length > 0);
    assert.ok(ae.suggestion.length > 0);
  });
});

// ---------------------------------------------------------------------------
// formatActionableError
// ---------------------------------------------------------------------------

describe('formatActionableError', () => {
  it('includes the error code', () => {
    const ae = enrichError('No config found');
    const formatted = formatActionableError(ae);
    assert.ok(formatted.includes(ae.code), 'formatted output should include error code');
  });

  it('includes the suggestion with → arrow', () => {
    const ae = enrichError('No config found');
    const formatted = formatActionableError(ae);
    assert.ok(formatted.includes('→'), 'formatted output should include arrow');
    assert.ok(formatted.includes(ae.suggestion));
  });

  it('includes docsRef when available', () => {
    const ae = enrichError('No config found');
    if (ae.docsRef) {
      const formatted = formatActionableError(ae);
      assert.ok(formatted.includes('Docs:'), 'should include Docs: line when docsRef set');
    }
  });
});

// ---------------------------------------------------------------------------
// ERROR_SUGGESTIONS shape
// ---------------------------------------------------------------------------

describe('ERROR_SUGGESTIONS map', () => {
  it('contains at least 20 patterns', () => {
    assert.ok(
      Object.keys(ERROR_SUGGESTIONS).length >= 20,
      `expected at least 20 patterns, got ${Object.keys(ERROR_SUGGESTIONS).length}`,
    );
  });

  it('all suggestions are non-empty strings', () => {
    for (const [pattern, suggestion] of Object.entries(ERROR_SUGGESTIONS)) {
      assert.ok(
        typeof suggestion === 'string' && suggestion.length > 0,
        `suggestion for pattern "${pattern}" must be a non-empty string`,
      );
    }
  });
});
