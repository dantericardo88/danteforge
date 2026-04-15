// tests/matrix-confirm.test.ts — confirmMatrix() gate

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { confirmMatrix } from '../src/core/matrix-confirm.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

function makeMatrix(): CompeteMatrix {
  return {
    project: 'test',
    competitors: ['Aider'],
    competitors_closed_source: [],
    competitors_oss: ['Aider'],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 5.0,
    dimensions: [
      {
        id: 'functionality',
        label: 'Functionality',
        weight: 1.0,
        category: 'quality',
        frequency: 'high',
        scores: { self: 5.0, Aider: 8.0 },
        gap_to_leader: 3.0,
        leader: 'Aider',
        gap_to_closed_source_leader: 0,
        closed_source_leader: 'none',
        gap_to_oss_leader: 3.0,
        oss_leader: 'Aider',
        status: 'in-progress',
        sprint_history: [],
        next_sprint_target: 9.0,
      },
    ],
  };
}

describe('confirmMatrix()', () => {
  it('returns true immediately when _confirm returns true', async () => {
    const m = makeMatrix();
    const result = await confirmMatrix(m, {
      _isTTY: true,
      _confirm: async () => true,
      _stdout: () => {},
    });
    assert.ok(result);
  });

  it('returns true immediately in non-TTY mode (CI safe)', async () => {
    const m = makeMatrix();
    const result = await confirmMatrix(m, {
      _isTTY: false,
      _stdout: () => {},
    });
    assert.ok(result, 'non-TTY must auto-confirm');
  });

  it('includes competitor names in output', async () => {
    const m = makeMatrix();
    const lines: string[] = [];
    await confirmMatrix(m, {
      _isTTY: true,
      _confirm: async () => true,
      _stdout: (l) => lines.push(l),
    });
    const output = lines.join('\n');
    assert.ok(output.includes('Aider'), 'must show competitor name');
  });

  it('includes dimension id and self-score in output', async () => {
    const m = makeMatrix();
    const lines: string[] = [];
    await confirmMatrix(m, {
      _isTTY: true,
      _confirm: async () => true,
      _stdout: (l) => lines.push(l),
    });
    const output = lines.join('\n');
    assert.ok(output.includes('functionality'), 'must show dimension id');
    assert.ok(output.includes('5.0'), 'must show self score');
  });

  it('enters amendment loop when _confirm returns false', async () => {
    const m = makeMatrix();
    let loopEntered = false;
    // _confirm returns false once (triggers loop), then askQuestion returns '5' (save & continue)
    let confirmCount = 0;
    await confirmMatrix(m, {
      _isTTY: true,
      _confirm: async () => {
        confirmCount++;
        if (confirmCount === 1) return false; // trigger amendment
        return true;
      },
      _askQuestion: async () => { loopEntered = true; return '5'; }, // save & continue
      _stdout: () => {},
      _saveMatrix: async () => {},
    });
    assert.ok(loopEntered, 'amendment loop must be entered when user declines');
  });

  it('amendment option 1 calls removeCompetitor and saves', async () => {
    const m = makeMatrix();
    let saved = false;
    let confirmCount = 0;
    const questions: string[] = [];
    await confirmMatrix(m, {
      _isTTY: true,
      _confirm: async () => { confirmCount++; return confirmCount > 1; },
      _askQuestion: async (q) => {
        questions.push(q);
        if (questions.length === 1) return '1';    // choose: remove competitor
        if (questions.length === 2) return 'Aider'; // name to remove
        return '5'; // save & continue
      },
      _stdout: () => {},
      _saveMatrix: async () => { saved = true; },
    });
    assert.ok(saved, 'matrix must be saved after amendment');
    assert.ok(!m.competitors.includes('Aider'), 'Aider must be removed');
  });

  it('amendment option 2 calls dropDimension and saves', async () => {
    const m = makeMatrix();
    let saved = false;
    let confirmCount = 0;
    const questions: string[] = [];
    await confirmMatrix(m, {
      _isTTY: true,
      _confirm: async () => { confirmCount++; return confirmCount > 1; },
      _askQuestion: async (q) => {
        questions.push(q);
        if (questions.length === 1) return '2';           // drop dimension
        if (questions.length === 2) return 'functionality'; // id
        return '5';
      },
      _stdout: () => {},
      _saveMatrix: async () => { saved = true; },
    });
    assert.ok(saved);
    assert.ok(!m.dimensions.find(d => d.id === 'functionality'), 'dimension must be dropped');
  });

  it('amendment option 6 returns false (abort)', async () => {
    const m = makeMatrix();
    let confirmCount = 0;
    const result = await confirmMatrix(m, {
      _isTTY: true,
      _confirm: async () => { confirmCount++; return false; },
      _askQuestion: async () => '6', // abort
      _stdout: () => {},
      _saveMatrix: async () => {},
    });
    assert.ok(!result, 'abort must return false');
  });
});
