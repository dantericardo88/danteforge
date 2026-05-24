// tests/lessons-velocity.test.ts
// Tests for the --velocity and --dedupe flags in the lessons command.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { lessons } from '../src/cli/commands/lessons.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-vel-test-'));
  await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
  await fs.mkdir(path.join(dir, '.danteforge', 'compete'), { recursive: true });
  return dir;
}

interface MatrixDimension {
  id: string;
  sprint_history?: Array<{ dimensionId?: string; before: number; after: number; date: string }>;
}

function writeMatrix(dir: string, dimensions: MatrixDimension[]): Promise<void> {
  const p = path.join(dir, '.danteforge', 'compete', 'matrix.json');
  return fs.writeFile(p, JSON.stringify({ dimensions }, null, 2), 'utf8');
}

// Capture stdout output from the lessons command by intercepting process.stdout.write.
async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (...a: unknown[]) => boolean }).write = (chunk: unknown) => {
    if (typeof chunk === 'string') chunks.push(chunk);
    return true;
  };
  try {
    await fn();
  } finally {
    (process.stdout as unknown as { write: (...a: unknown[]) => boolean }).write = orig;
  }
  return chunks.join('');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('lessons --velocity flag', () => {
  let tmpDir: string;
  before(async () => { tmpDir = await makeTmpDir(); });
  after(async () => { try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ok */ } });

  it('prints the velocity report header when matrix.json has sprint data', async () => {
    await writeMatrix(tmpDir, [
      {
        id: 'testing',
        sprint_history: [
          { dimensionId: 'testing', before: 7.0, after: 8.0, date: '2026-04-01' },
          { dimensionId: 'testing', before: 8.0, after: 9.0, date: '2026-04-15' },
        ],
      },
    ]);
    const output = await captureStdout(() =>
      lessons(undefined, {
        velocity: true,
        _matrixPath: path.join(tmpDir, '.danteforge', 'compete', 'matrix.json'),
      }),
    );
    assert.ok(output.includes('Improvement Velocity Report'), `Expected header in: ${output}`);
  });

  it('shows totalSprints correctly in the report table', async () => {
    await writeMatrix(tmpDir, [
      {
        id: 'testing',
        sprint_history: [
          { before: 6.0, after: 7.0, date: '2026-04-01' },
          { before: 7.0, after: 8.0, date: '2026-04-10' },
          { before: 8.0, after: 9.0, date: '2026-04-20' },
        ],
      },
    ]);
    const output = await captureStdout(() =>
      lessons(undefined, {
        velocity: true,
        _matrixPath: path.join(tmpDir, '.danteforge', 'compete', 'matrix.json'),
      }),
    );
    assert.ok(output.includes('3'), `Expected 3 in: ${output}`);
  });

  it('handles empty sprint_history without crashing', async () => {
    await writeMatrix(tmpDir, [{ id: 'testing', sprint_history: [] }]);
    const output = await captureStdout(() =>
      lessons(undefined, {
        velocity: true,
        _matrixPath: path.join(tmpDir, '.danteforge', 'compete', 'matrix.json'),
      }),
    );
    assert.ok(output.includes('0'), `Expected 0 total sprints in: ${output}`);
  });

  it('handles dimensions with no sprint_history field', async () => {
    await writeMatrix(tmpDir, [{ id: 'testing' }]);
    // Should not throw
    await assert.doesNotReject(() =>
      lessons(undefined, {
        velocity: true,
        _matrixPath: path.join(tmpDir, '.danteforge', 'compete', 'matrix.json'),
      }),
    );
  });

  it('gracefully handles missing matrix.json', async () => {
    const dir2 = await makeTmpDir();
    try {
      // No matrix.json written
      await assert.doesNotReject(() =>
        lessons(undefined, {
          velocity: true,
          _matrixPath: path.join(dir2, '.danteforge', 'compete', 'matrix.json'),
        }),
      );
    } finally {
      await fs.rm(dir2, { recursive: true, force: true });
    }
  });

  it('aggregates sprint entries from multiple dimensions', async () => {
    await writeMatrix(tmpDir, [
      {
        id: 'dim1',
        sprint_history: [{ dimensionId: 'dim1', before: 5.0, after: 7.0, date: '2026-04-01' }],
      },
      {
        id: 'dim2',
        sprint_history: [{ dimensionId: 'dim2', before: 6.0, after: 8.0, date: '2026-04-05' }],
      },
    ]);
    const output = await captureStdout(() =>
      lessons(undefined, {
        velocity: true,
        _matrixPath: path.join(tmpDir, '.danteforge', 'compete', 'matrix.json'),
      }),
    );
    // 2 total sprints
    assert.ok(output.includes('2'), `Expected 2 sprints in: ${output}`);
  });
});

describe('lessons --dedupe flag', () => {
  it('removes near-duplicate lessons and reports counts', async () => {
    const dir = await makeTmpDir();
    try {
      // Use near-identical content so Jaccard similarity is high (>0.70).
      const sharedText = 'always validate user input data parameters before processing handling running operations';
      const lessonsContent = [
        `## [Workflow] ${sharedText} first`,
        '_Added: 2026-04-01T00:00:00Z_',
        `**Rule:** ${sharedText}`,
        '',
        `## [Workflow] ${sharedText} second`,
        '_Added: 2026-04-02T00:00:00Z_',
        `**Rule:** ${sharedText}`,
      ].join('\n');

      await fs.writeFile(path.join(dir, '.danteforge', 'lessons.md'), lessonsContent, 'utf8');

      await lessons(undefined, { dedupe: true, _cwd: dir });

      const result = await fs.readFile(path.join(dir, '.danteforge', 'lessons.md'), 'utf8');
      // The two near-duplicate entries should have been deduplicated — expect 1 remaining
      const blockCount = (result.match(/^## /gm) ?? []).length;
      assert.ok(blockCount <= 1, `Expected <= 1 block after dedup, got ${blockCount}`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not crash when lessons.md does not exist', async () => {
    const dir = await makeTmpDir();
    try {
      await assert.doesNotReject(() => lessons(undefined, { dedupe: true, _cwd: dir }));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
