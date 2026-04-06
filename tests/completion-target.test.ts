// Completion Target — tests for load/save, all 3 modes, prompt parsing,
// getOrPromptCompletionTarget fallback behavior, and checkPassesTarget.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import {
  loadCompletionTarget,
  saveCompletionTarget,
  promptUserForCompletionTarget,
  getOrPromptCompletionTarget,
  formatCompletionTarget,
  checkPassesTarget,
  type CompletionTarget,
  type CompletionTargetOptions,
} from '../src/core/completion-target.js';

// ── Mock readline builder ─────────────────────────────────────────────────────

function mockReadline(answers: string[]): CompletionTargetOptions['_readline'] {
  let idx = 0;
  return {
    question: (_prompt: string, cb: (a: string) => void) => {
      cb(answers[idx++] ?? '');
    },
    close: () => {},
  };
}

// ── loadCompletionTarget / saveCompletionTarget ───────────────────────────────

describe('loadCompletionTarget', () => {
  it('returns null when file does not exist', async () => {
    const result = await loadCompletionTarget('/nonexistent/path');
    assert.equal(result, null);
  });

  it('round-trips a feature-universe target', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'completion-target-test-'));
    try {
      const target: CompletionTarget = {
        mode: 'feature-universe',
        minScore: 9.0,
        featureCoverage: 90,
        description: 'Test target',
        definedAt: '2026-04-04T00:00:00Z',
        definedBy: 'user-prompted',
      };
      await saveCompletionTarget(target, tmpDir, async (p, c) => {
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, c, 'utf-8');
      });
      const loaded = await loadCompletionTarget(tmpDir, async (p) => fs.readFile(p, 'utf-8'));
      assert.ok(loaded !== null);
      assert.equal(loaded!.mode, 'feature-universe');
      assert.equal(loaded!.minScore, 9.0);
      assert.equal(loaded!.featureCoverage, 90);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });

  it('round-trips a custom target with criteria', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'completion-target-test2-'));
    try {
      const target: CompletionTarget = {
        mode: 'custom',
        minScore: 8.5,
        customCriteria: ['All auth flows work', 'Page load < 2s'],
        description: 'Custom: All auth flows work; Page load < 2s',
        definedAt: '2026-04-04T00:00:00Z',
        definedBy: 'user-prompted',
      };
      await saveCompletionTarget(target, tmpDir, async (p, c) => {
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, c, 'utf-8');
      });
      const loaded = await loadCompletionTarget(tmpDir, async (p) => fs.readFile(p, 'utf-8'));
      assert.equal(loaded!.customCriteria?.length, 2);
    } finally {
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});

// ── promptUserForCompletionTarget ─────────────────────────────────────────────

describe('promptUserForCompletionTarget — feature-universe mode (choice 1)', () => {
  it('returns feature-universe target when user selects 1', async () => {
    const target = await promptUserForCompletionTarget({
      _readline: mockReadline(['1', '9.0', '90']),
      _now: () => '2026-04-04T00:00:00Z',
    });
    assert.equal(target.mode, 'feature-universe');
    assert.equal(target.minScore, 9.0);
    assert.equal(target.featureCoverage, 90);
    assert.equal(target.definedBy, 'user-prompted');
  });

  it('returns feature-universe as default when user presses Enter', async () => {
    const target = await promptUserForCompletionTarget({
      _readline: mockReadline(['', '9.0', '90']),
      _now: () => '2026-04-04T00:00:00Z',
    });
    assert.equal(target.mode, 'feature-universe');
  });

  it('clamps minScore to 0-10 range', async () => {
    const target = await promptUserForCompletionTarget({
      _readline: mockReadline(['1', '99', '90']),
      _now: () => '2026-04-04T00:00:00Z',
    });
    assert.equal(target.minScore, 10);
  });

  it('clamps coverage to 0-100 range', async () => {
    const target = await promptUserForCompletionTarget({
      _readline: mockReadline(['1', '9.0', '200']),
      _now: () => '2026-04-04T00:00:00Z',
    });
    assert.equal(target.featureCoverage, 100);
  });
});

describe('promptUserForCompletionTarget — dimension-based mode (choice 2)', () => {
  it('returns dimension-based target when user selects 2', async () => {
    const target = await promptUserForCompletionTarget({
      _readline: mockReadline(['2', '9.0']),
      _now: () => '2026-04-04T00:00:00Z',
    });
    assert.equal(target.mode, 'dimension-based');
    assert.equal(target.minScore, 9.0);
    assert.equal(target.featureCoverage, undefined);
    assert.equal(target.definedBy, 'user-prompted');
  });

  it('uses 9.0 when user presses Enter on min score', async () => {
    const target = await promptUserForCompletionTarget({
      _readline: mockReadline(['2', '']),
      _now: () => '2026-04-04T00:00:00Z',
    });
    assert.equal(target.minScore, 9.0);
  });
});

describe('promptUserForCompletionTarget — custom mode (choice 3)', () => {
  it('returns custom target with user-entered criteria', async () => {
    const target = await promptUserForCompletionTarget({
      _readline: mockReadline(['3', 'All tests pass', 'Coverage > 85%', '', '8.5']),
      _now: () => '2026-04-04T00:00:00Z',
    });
    assert.equal(target.mode, 'custom');
    assert.equal(target.minScore, 8.5);
    assert.deepEqual(target.customCriteria, ['All tests pass', 'Coverage > 85%']);
  });

  it('uses default criterion when no criteria entered', async () => {
    const target = await promptUserForCompletionTarget({
      _readline: mockReadline(['3', '', '9.0']), // blank line immediately → no criteria
      _now: () => '2026-04-04T00:00:00Z',
    });
    assert.equal(target.mode, 'custom');
    assert.ok(target.customCriteria && target.customCriteria.length > 0);
  });
});

// ── getOrPromptCompletionTarget ───────────────────────────────────────────────

describe('getOrPromptCompletionTarget', () => {
  it('returns existing target when file exists', async () => {
    const existing: CompletionTarget = {
      mode: 'dimension-based', minScore: 8.0,
      description: 'Existing', definedAt: '2026-01-01T00:00:00Z', definedBy: 'user-prompted',
    };
    const result = await getOrPromptCompletionTarget('/fake', false, {
      _readFile: async () => JSON.stringify(existing),
    });
    assert.equal(result.mode, 'dimension-based');
    assert.equal(result.minScore, 8.0);
  });

  it('returns default when file missing and not interactive', async () => {
    const result = await getOrPromptCompletionTarget('/nonexistent', false, {
      _readFile: async () => { throw new Error('not found'); },
    });
    assert.equal(result.mode, 'feature-universe');
    assert.equal(result.definedBy, 'default');
  });

  it('prompts user when file missing and interactive=true', async () => {
    let promptCalled = false;
    const result = await getOrPromptCompletionTarget('/nonexistent', true, {
      _readFile: async () => { throw new Error('not found'); },
      _writeFile: async () => {},
      _readline: {
        question: (_p: string, cb: (a: string) => void) => {
          promptCalled = true;
          cb('1'); // feature-universe choice
        },
        close: () => {},
      },
      _now: () => '2026-04-04T00:00:00Z',
    });
    assert.ok(promptCalled, 'Prompt should have been called');
    assert.equal(result.mode, 'feature-universe');
    assert.equal(result.definedBy, 'user-prompted');
  });

  it('saves the prompted target to disk', async () => {
    let savedContent = '';
    await getOrPromptCompletionTarget('/fake', true, {
      _readFile: async () => { throw new Error('not found'); },
      _writeFile: async (_p: string, c: string) => { savedContent = c; },
      _readline: mockReadline(['2', '9.0']),
      _now: () => '2026-04-04T00:00:00Z',
    });
    assert.ok(savedContent.length > 0, 'Should have saved the target');
    const parsed = JSON.parse(savedContent) as CompletionTarget;
    assert.equal(parsed.mode, 'dimension-based');
  });
});

// ── formatCompletionTarget ────────────────────────────────────────────────────

describe('formatCompletionTarget', () => {
  it('formats feature-universe mode', () => {
    const target: CompletionTarget = {
      mode: 'feature-universe', minScore: 9.0, featureCoverage: 90,
      description: 'Feature universe', definedAt: '', definedBy: 'default',
    };
    const formatted = formatCompletionTarget(target);
    assert.ok(formatted.includes('Feature Universe'));
    assert.ok(formatted.includes('9'));
    assert.ok(formatted.includes('90%'));
  });

  it('formats dimension-based mode', () => {
    const target: CompletionTarget = {
      mode: 'dimension-based', minScore: 8.5,
      description: 'Standard dims', definedAt: '', definedBy: 'user-prompted',
    };
    const formatted = formatCompletionTarget(target);
    assert.ok(formatted.includes('18-Dimension'));
    assert.ok(formatted.includes('8.5'));
  });

  it('formats custom mode with criteria', () => {
    const target: CompletionTarget = {
      mode: 'custom', minScore: 9.0,
      customCriteria: ['Tests pass', 'Coverage > 85%'],
      description: 'Custom', definedAt: '', definedBy: 'user-prompted',
    };
    const formatted = formatCompletionTarget(target);
    assert.ok(formatted.includes('Custom'));
    assert.ok(formatted.includes('Tests pass'));
    assert.ok(formatted.includes('Coverage > 85%'));
  });
});

// ── checkPassesTarget ─────────────────────────────────────────────────────────

describe('checkPassesTarget', () => {
  it('passes when score >= minScore for dimension-based', () => {
    const target: CompletionTarget = { mode: 'dimension-based', minScore: 9.0, description: '', definedAt: '', definedBy: 'default' };
    assert.equal(checkPassesTarget(9.0, target), true);
    assert.equal(checkPassesTarget(9.5, target), true);
    assert.equal(checkPassesTarget(8.9, target), false);
  });

  it('requires both score AND coverage for feature-universe', () => {
    const target: CompletionTarget = { mode: 'feature-universe', minScore: 9.0, featureCoverage: 90, description: '', definedAt: '', definedBy: 'default' };
    assert.equal(checkPassesTarget(9.0, target, 90), true);
    assert.equal(checkPassesTarget(9.0, target, 89), false);  // coverage too low
    assert.equal(checkPassesTarget(8.9, target, 95), false);  // score too low
    assert.equal(checkPassesTarget(9.5, target, 95), true);
  });

  it('passes for custom mode when score >= minScore', () => {
    const target: CompletionTarget = { mode: 'custom', minScore: 8.5, customCriteria: ['x'], description: '', definedAt: '', definedBy: 'user-prompted' };
    assert.equal(checkPassesTarget(8.5, target), true);
    assert.equal(checkPassesTarget(8.4, target), false);
  });
});
