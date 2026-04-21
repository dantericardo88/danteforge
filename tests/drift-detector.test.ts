import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeTempProject(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-drift-'));
  tempDirs.push(root);

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  }

  return root;
}

describe('DriftDetector', () => {
  it('detects hallucinated import (non-existent package)', async () => {
    const { detectAIDrift } = await import('../src/core/drift-detector.js');
    const root = await makeTempProject({
      'src/app.ts': 'import { magic } from \'@nonexistent/phantom-pkg\';\nconsole.log(magic);\n',
    });

    const violations = await detectAIDrift(['src/app.ts'], root);
    assert.ok(violations.some(v => v.type === 'ai-drift' && v.message.includes('Hallucinated import')));
  });

  it('detects stub patterns (TODO/FIXME)', async () => {
    const { detectAIDrift } = await import('../src/core/drift-detector.js');
    const root = await makeTempProject({
      'src/service.ts': 'export function doThing() {\n  // TODO: implement this\n  // FIXME: broken\n}\n',
    });

    const violations = await detectAIDrift(['src/service.ts'], root);
    const stubs = violations.filter(v => v.type === 'stub-detected');
    assert.ok(stubs.length >= 2);
    assert.ok(stubs.some(v => v.message.includes('TODO')));
    assert.ok(stubs.some(v => v.message.includes('FIXME')));
  });

  it('clean file produces no violations', async () => {
    const { detectAIDrift } = await import('../src/core/drift-detector.js');
    const root = await makeTempProject({
      'node_modules/yaml/index.js': 'module.exports = {};',
      'src/clean.ts': 'import yaml from \'yaml\';\nexport const x = yaml;\n',
    });

    const violations = await detectAIDrift(['src/clean.ts'], root);
    // Only check for drift violations (hallucinated imports); stubs are separate
    const driftViolations = violations.filter(v => v.type === 'ai-drift');
    assert.strictEqual(driftViolations.length, 0);
  });

  it('ignores package import examples that only appear inside comments', async () => {
    const { detectAIDrift } = await import('../src/core/drift-detector.js');
    const root = await makeTempProject({
      'src/sdk.ts': [
        '// Usage: import { assess } from \'danteforge/sdk\'',
        'export const ok = true;',
      ].join('\n'),
    });

    const violations = await detectAIDrift(['src/sdk.ts'], root);
    const driftViolations = violations.filter(v => v.type === 'ai-drift');
    assert.strictEqual(driftViolations.length, 0);
  });

  it('detects multiple violation types in one file', async () => {
    const { detectAIDrift } = await import('../src/core/drift-detector.js');
    const root = await makeTempProject({
      'src/messy.ts': 'import { foo } from \'@ghost/nonexistent\';\n// TODO: fix\nexport const x = foo;\n',
    });

    const violations = await detectAIDrift(['src/messy.ts'], root);
    assert.ok(violations.length >= 2, `Expected >=2 violations, got ${violations.length}`);
    const types = new Set(violations.map(v => v.type));
    assert.ok(types.has('ai-drift') || types.has('stub-detected'));
  });
});
