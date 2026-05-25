import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { community } from '../src/cli/commands/community.js';
import { assessCommunityAdoptionReadiness } from '../src/core/community-adoption.js';

const tempDirs: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-community-cmd-'));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(dir, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }
  return dir;
}

after(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('community command', () => {
  it('reports adoption readiness with missing required surfaces', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'sample-tool', version: '0.1.0' }),
    });
    const lines: string[] = [];

    const result = await community({ cwd, _stdout: (line) => lines.push(line) });

    assert.ok(result.readiness.missingRequired.includes('package-metadata'));
    assert.ok(result.readiness.nextActions.length > 0);
    assert.ok(lines.join('\n').includes('Community adoption readiness'));
  });

  it('generates a real adoption pack and improves local readiness', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'sample-tool', version: '0.1.0', license: 'MIT' }),
    });
    const before = await assessCommunityAdoptionReadiness(cwd);

    const result = await community({ cwd, fix: true, _stdout: () => {} });

    assert.ok(result.improvements.includes('Generated community adoption pack'));
    assert.ok(result.readiness.score > before.score);
    await assert.doesNotReject(() => fs.access(path.join(cwd, 'docs', 'ONBOARDING.md')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, 'docs', 'COMMANDS.md')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, '.github', 'ISSUE_TEMPLATE', 'bug_report.yml')));
  });

  it('emits machine-readable JSON for automation', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'sample-tool', version: '0.1.0' }),
    });
    const lines: string[] = [];

    const result = await community({ cwd, json: true, failBelow: 90, _stdout: (line) => lines.push(line) });
    const parsed = JSON.parse(lines.join('\n')) as { scorePercent: number; passed: boolean; missingRequired: string[] };

    assert.equal(parsed.scorePercent, result.scorePercent);
    assert.equal(parsed.passed, false);
    assert.ok(parsed.missingRequired.includes('package-metadata'));
  });
});
