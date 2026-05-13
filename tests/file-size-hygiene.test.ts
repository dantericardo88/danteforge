import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildFileSizeRefactorPlan,
  countMaintainableLoc,
  inspectSourceFileSizes,
  writeFileSizeRefactorPlan,
} from '../src/core/file-size-hygiene.js';

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'df-file-size-'));
}

async function writeLines(filePath: string, lineCount: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    Array.from({ length: lineCount }, (_, index) => `export const value${index} = ${index};`).join('\n'),
    'utf8',
  );
}

describe('file-size hygiene', () => {
  it('counts non-blank, non-comment LOC', () => {
    const loc = countMaintainableLoc([
      '',
      '// comment',
      'const a = 1;',
      '/* block',
      'still comment',
      '*/',
      'const b = 2;',
    ].join('\n'));

    assert.equal(loc, 2);
  });

  it('reports oversized source files and ignores tests/generated output', async () => {
    const cwd = await makeWorkspace();
    try {
      await writeLines(path.join(cwd, 'src', 'small.ts'), 12);
      await writeLines(path.join(cwd, 'src', 'large.ts'), 752);
      await writeLines(path.join(cwd, 'src', 'large.test.ts'), 900);
      await writeLines(path.join(cwd, 'dist', 'generated.ts'), 900);
      await fs.writeFile(path.join(cwd, '.file-size-allowlist'), 'src/large.ts\n', 'utf8');

      const report = await inspectSourceFileSizes(cwd);

      assert.equal(report.summary.totalFiles, 2);
      assert.equal(report.summary.hardViolations, 1);
      assert.equal(report.summary.grandfathered, 1);
      assert.deepEqual(report.files.map(file => file.relativePath).sort(), ['src/large.ts', 'src/small.ts']);
      assert.equal(report.files.find(file => file.relativePath === 'src/large.ts')?.status, 'legacy');
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('writes a maintainable refactor plan for files above the target size', async () => {
    const cwd = await makeWorkspace();
    try {
      await writeLines(path.join(cwd, 'src', 'commands', 'big.ts'), 760);
      const report = await inspectSourceFileSizes(cwd);
      const markdown = buildFileSizeRefactorPlan(report);

      assert.match(markdown, /src\/commands\/big\.ts/);
      assert.match(markdown, /Suggested Split/);

      const planPath = await writeFileSizeRefactorPlan(cwd, report);
      const written = await fs.readFile(planPath, 'utf8');
      assert.equal(written, markdown);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
