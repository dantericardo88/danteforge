import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

async function collectTestFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('temporary workspace hygiene', () => {
  it('does not create .tmp-* test workspaces in the repository root', async () => {
    const testFiles = await collectTestFiles(path.join(process.cwd(), 'tests'));
    const offenders: string[] = [];
    const rootTmpPattern = /mkdtemp\(\s*path\.join\(\s*await fs\.realpath\(process\.cwd\(\)\),\s*['"]\.tmp-/;

    for (const file of testFiles) {
      const content = await fs.readFile(file, 'utf8');
      if (rootTmpPattern.test(content)) {
        offenders.push(path.relative(process.cwd(), file).replace(/\\/g, '/'));
      }
    }

    assert.deepEqual(offenders, [], 'Use os.tmpdir() for test workspaces so root .tmp-* folders do not accumulate');
  });
});
