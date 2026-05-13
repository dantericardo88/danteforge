// THIRD_PARTY_NOTICES generator tests
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  generateThirdPartyNotices,
  LicenseViolation,
} from '../../src/matrix-orchestration/reporting/third-party-notices.js';

const tmpDirs: string[] = [];
async function tmpCwd(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'tpn-'));
  tmpDirs.push(d);
  return d;
}
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
});

describe('third-party-notices', () => {
  it('throws LicenseViolation when a blocked license is present', async () => {
    const cwd = await tmpCwd();
    await assert.rejects(
      generateThirdPartyNotices(
        {
          projectName: 'fixture',
          patterns: [{
            repoUrl: 'https://github.com/x/y',
            licenseText: 'GNU GENERAL PUBLIC LICENSE Version 3',
            copyType: 'direct',
          }],
        },
        { cwd, writeToDisk: false },
      ),
      (err: unknown) => err instanceof LicenseViolation && err.licenseName === 'GPL-3.0',
    );
  });

  it('lists allowed licenses with attribution', async () => {
    const cwd = await tmpCwd();
    const md = await generateThirdPartyNotices(
      {
        projectName: 'fixture',
        patterns: [{
          repoUrl: 'https://github.com/foo/bar',
          patternName: 'token-cache',
          licenseText: 'MIT License',
          copyType: 'direct',
        }],
      },
      { cwd, writeToDisk: false },
    );
    assert.match(md, /MIT/);
    assert.match(md, /token-cache/);
    assert.match(md, /github\.com\/foo\/bar/);
  });

  it('renders clean-room attribution when copyType is clean_room', async () => {
    const cwd = await tmpCwd();
    const md = await generateThirdPartyNotices(
      {
        projectName: 'fixture',
        patterns: [{
          repoUrl: 'https://github.com/x/y',
          licenseText: 'Apache License Version 2.0',
          copyType: 'clean_room',
        }],
      },
      { cwd, writeToDisk: false },
    );
    assert.match(md, /clean-room/);
  });

  it('writes THIRD_PARTY_NOTICES.md to disk when writeToDisk is true', async () => {
    const cwd = await tmpCwd();
    await generateThirdPartyNotices(
      {
        projectName: 'fixture',
        patterns: [{
          repoUrl: 'https://github.com/x/y',
          licenseText: 'ISC',
          copyType: 'direct',
        }],
      },
      { cwd },
    );
    const body = await fs.readFile(path.join(cwd, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    assert.match(body, /ISC/);
  });

  it('emits a no-patterns message when patterns list is empty', async () => {
    const cwd = await tmpCwd();
    const md = await generateThirdPartyNotices(
      { projectName: 'fixture', patterns: [] },
      { cwd, writeToDisk: false },
    );
    assert.match(md, /No third-party patterns/);
  });
});
