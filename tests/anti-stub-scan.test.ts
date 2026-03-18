import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempRoots: string[] = [];
const scriptPath = path.resolve('scripts', 'check-anti-stub.mjs');

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-anti-stub-'));
  tempRoots.push(root);
  return root;
}

function runScan(root: string) {
  return spawnSync(process.execPath, [scriptPath, '--root', root], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
}

describe('anti-stub scan', () => {
  it('passes for clean implementation files and exempt doctrine/config files', async () => {
    const root = await makeWorkspace();

    await fs.mkdir(path.join(root, 'src', 'core'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src', 'core', 'service.ts'),
      'export function status() { return "ready"; }\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(root, 'src', 'core', 'pdse-config.ts'),
      [
        'export const ANTI_STUB_PATTERNS = [',
        "  'TODO',",
        "  'FIXME',",
        "  'placeholder',",
        '];',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(root, 'src', 'core', 'pdse.ts'),
      [
        '// Anti-stub scan keeps doctrine vocabulary out of placeholder enforcement.',
        'export function score() {',
        '  return 100;',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = runScan(root);
    assert.strictEqual(result.status ?? 0, 0, result.stderr);
    assert.match(result.stdout, /Anti-stub scan passed/i);
  });

  it('fails when a production implementation file contains stub markers', async () => {
    const root = await makeWorkspace();

    await fs.mkdir(path.join(root, 'src', 'core'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src', 'core', 'service.ts'),
      [
        'export function buildReleasePlan() {',
        '  // TODO: implement real release plan generation',
        '  return null;',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = runScan(root);
    assert.notStrictEqual(result.status ?? 0, 0);
    assert.match(result.stderr, /service\.ts/i);
    assert.match(result.stderr, /\bTODO\b/);
  });
});
