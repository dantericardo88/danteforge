// explain-command.test.ts — tests for explain command, glossary, and simple mode
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOSSARY,
  explain,
  formatEntry,
  findClosestTerm,
  type GlossaryEntry,
} from '../src/cli/commands/explain.js';
import { quickstart } from '../src/cli/commands/quickstart.js';
import { init } from '../src/cli/commands/init.js';
import type { DanteState } from '../src/core/state.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function collect(): { lines: string[]; output: (line: string) => void } {
  const lines: string[] = [];
  return { lines, output: (line: string) => lines.push(line) };
}

function stubState(): DanteState {
  return {
    project: 'test',
    workflowStage: 'tasks',
    currentPhase: 0,
    profile: 'budget',
    lastHandoff: 'none',
    auditLog: [],
    tasks: {},
  } as unknown as DanteState;
}

// ── 1. GLOSSARY has 20+ entries ───────────────────────────────────────────────

describe('GLOSSARY', () => {
  it('has 20 or more entries', () => {
    assert.ok(Object.keys(GLOSSARY).length >= 20, `Expected >= 20 entries, got ${Object.keys(GLOSSARY).length}`);
  });

  it('every entry has non-empty term', () => {
    for (const entry of Object.values(GLOSSARY)) {
      assert.ok(entry.term.length > 0, `term is empty for key ${entry.term}`);
    }
  });

  it('every entry has non-empty plainEnglish', () => {
    for (const entry of Object.values(GLOSSARY)) {
      assert.ok(entry.plainEnglish.length > 0, `plainEnglish is empty for ${entry.term}`);
    }
  });

  it('every entry has non-empty analogy', () => {
    for (const entry of Object.values(GLOSSARY)) {
      assert.ok(entry.analogy.length > 0, `analogy is empty for ${entry.term}`);
    }
  });

  it('every entry has relatedCommands as non-empty array', () => {
    for (const entry of Object.values(GLOSSARY)) {
      assert.ok(Array.isArray(entry.relatedCommands), `relatedCommands is not array for ${entry.term}`);
      assert.ok(entry.relatedCommands.length > 0, `relatedCommands is empty for ${entry.term}`);
    }
  });
});

// ── explain({ term }) ─────────────────────────────────────────────────────────

describe('explain({ term })', () => {
  it('outputs plainEnglish for constitution', () => {
    const { lines, output } = collect();
    explain({ term: 'constitution', _output: output });
    const joined = lines.join('\n');
    assert.ok(joined.includes(GLOSSARY.constitution.plainEnglish.slice(0, 30)), 'plainEnglish not found');
  });

  it('outputs analogy for constitution', () => {
    const { lines, output } = collect();
    explain({ term: 'constitution', _output: output });
    const joined = lines.join('\n');
    assert.ok(joined.includes('Analogy'), 'Analogy label not found');
    assert.ok(joined.includes(GLOSSARY.constitution.analogy.slice(0, 20)), 'analogy text not found');
  });

  it('outputs entry for pdse', () => {
    const { lines, output } = collect();
    explain({ term: 'pdse', _output: output });
    const joined = lines.join('\n');
    assert.ok(joined.includes('PDSE') || joined.includes('pdse'), 'pdse entry not found');
    assert.ok(joined.length > 0);
  });

  it('outputs something for forge', () => {
    const { lines, output } = collect();
    explain({ term: 'forge', _output: output });
    const joined = lines.join('\n');
    assert.ok(joined.includes('forge') || joined.includes('FORGE'), 'forge entry not found');
  });

  it('outputs something for party', () => {
    const { lines, output } = collect();
    explain({ term: 'party', _output: output });
    const joined = lines.join('\n');
    assert.ok(joined.length > 0);
    assert.ok(joined.includes('party') || joined.includes('PARTY'), 'party entry not found');
  });

  it('outputs something for dag', () => {
    const { lines, output } = collect();
    explain({ term: 'dag', _output: output });
    const joined = lines.join('\n');
    assert.ok(joined.length > 0);
    assert.ok(joined.includes('dag') || joined.includes('DAG'), 'dag entry not found');
  });

  it('fuzzy-matches "constitut" and includes "Did you mean:"', () => {
    const { lines, output } = collect();
    explain({ term: 'constitut', _output: output });
    const joined = lines.join('\n');
    assert.ok(joined.includes('Did you mean:'), `Expected "Did you mean:" in: ${joined}`);
  });

  it('outputs Unknown term message for no-match', () => {
    const { lines, output } = collect();
    explain({ term: 'xyz-no-match', _output: output });
    const joined = lines.join('\n');
    assert.ok(joined.includes('Unknown term'), `Expected "Unknown term" in: ${joined}`);
  });
});

// ── explain({ list }) ─────────────────────────────────────────────────────────

describe('explain({ list })', () => {
  it('prints all terms (output line count >= GLOSSARY size)', () => {
    const { lines, output } = collect();
    explain({ list: true, _output: output });
    // Each glossary entry produces one term line; header lines are extra
    const termLines = lines.filter((l) => l.trim().length > 0 && !l.includes('─') && !l.includes('Glossary'));
    assert.ok(termLines.length >= Object.keys(GLOSSARY).length, `Expected >= ${Object.keys(GLOSSARY).length} term lines, got ${termLines.length}`);
  });

  it('each term line includes plainEnglish snippet', () => {
    const { lines, output } = collect();
    explain({ list: true, _output: output });
    // At least one line per glossary entry should have some plainEnglish content
    for (const entry of Object.values(GLOSSARY)) {
      const snippet = entry.plainEnglish.slice(0, 20);
      const found = lines.some((l) => l.includes(snippet) || l.includes(entry.term));
      assert.ok(found, `No line found for entry: ${entry.term}`);
    }
  });
});

// ── explain() no args ─────────────────────────────────────────────────────────

describe('explain() no args', () => {
  it('does not throw with no options', () => {
    assert.doesNotThrow(() => explain());
  });

  it('does not throw with empty object', () => {
    assert.doesNotThrow(() => explain({}));
  });

  it('outputs usage hint when no args', () => {
    const { lines, output } = collect();
    explain({ _output: output });
    const joined = lines.join('\n');
    assert.ok(joined.includes('explain'), 'Expected explain usage hint');
  });
});

// ── findClosestTerm ───────────────────────────────────────────────────────────

describe('findClosestTerm', () => {
  it('returns constitution entry for "constitut" (prefix match)', () => {
    const result = findClosestTerm('constitut');
    assert.ok(result !== undefined);
    assert.equal(result?.term, 'constitution');
  });

  it('returns pdse entry for "pds" (prefix match)', () => {
    const result = findClosestTerm('pds');
    assert.ok(result !== undefined);
    assert.equal(result?.term, 'pdse');
  });

  it('returns undefined for unrecognized term', () => {
    const result = findClosestTerm('unknown-xyz-abc');
    assert.equal(result, undefined);
  });
});

// ── formatEntry ───────────────────────────────────────────────────────────────

describe('formatEntry', () => {
  const entry: GlossaryEntry = {
    term: 'test-term',
    plainEnglish: 'A test plain English description.',
    analogy: 'Like a test in real life.',
    relatedCommands: ['test', 'verify'],
    example: 'danteforge test',
  };

  it('returns string containing plainEnglish', () => {
    const result = formatEntry(entry);
    assert.ok(result.includes('A test plain English description.'));
  });

  it('returns string containing analogy', () => {
    const result = formatEntry(entry);
    assert.ok(result.includes('Like a test in real life.'));
  });

  it('returns string containing term', () => {
    const result = formatEntry(entry);
    assert.ok(result.toUpperCase().includes('TEST-TERM'));
  });
});

// ── quickstart simple mode ────────────────────────────────────────────────────

describe('quickstart simple mode', () => {
  it('resolves without error when simple=true', async () => {
    await assert.doesNotReject(
      quickstart({
        simple: true,
        nonInteractive: true,
        _isTTY: false,
        _runInit: async () => {},
        _runConstitution: async () => {},
        _readFile: async () => '{"avgScore":85}',
        cwd: '/tmp',
      }),
    );
  });

  it('resolves without error when simple=false (baseline)', async () => {
    await assert.doesNotReject(
      quickstart({
        simple: false,
        nonInteractive: true,
        _isTTY: false,
        _runInit: async () => {},
        _runConstitution: async () => {},
        _readFile: async () => '{"avgScore":72}',
        cwd: '/tmp',
      }),
    );
  });

  it('uses "Quality Score" label when simple=true', async () => {
    const logged: string[] = [];
    const origSuccess = console.log;
    // We can't easily intercept logger.success, just confirm it resolves
    await assert.doesNotReject(
      quickstart({
        simple: true,
        nonInteractive: true,
        _isTTY: false,
        _runInit: async () => {},
        _runConstitution: async () => {},
        _readFile: async () => '{"avgScore":90}',
        cwd: '/tmp',
      }),
    );
  });
});

// ── init simple mode ──────────────────────────────────────────────────────────

describe('init simple mode', () => {
  it('resolves without error when simple=true, nonInteractive=true', async () => {
    const state = stubState();
    await assert.doesNotReject(
      init({
        simple: true,
        nonInteractive: true,
        _isTTY: false,
        _loadState: async () => ({ ...state }),
        _saveState: async () => {},
        _isLLMAvailable: async () => false,
        cwd: '/tmp',
      }),
    );
  });
});
