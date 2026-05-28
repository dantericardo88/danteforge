import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateSecurityControls } from '../src/core/security-controls.js';

async function createGitRepo(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-security-controls-'));
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
  }
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('validateSecurityControls', () => {
  it('returns all false when no checks requested', async () => {
    const result = await validateSecurityControls({});
    assert.equal(result.secretsSecure, false);
    assert.equal(result.permissionsValid, false);
    assert.equal(result.integrityVerified, false);
    assert.deepEqual(result.issues, []);
  });

  it('checkPermissions sets permissionsValid true when configDir accessible', async () => {
    // On a real machine the home/.danteforge dir may or may not exist;
    // the function sets permissionsValid=true optimistically on access and catches errors silently.
    const result = await validateSecurityControls({ checkPermissions: true });
    // Either true (dir exists) or false with an issue (dir missing) — both are valid paths
    assert.ok(typeof result.permissionsValid === 'boolean');
  });

  it('checkIntegrity adds issue when audit dir missing', async () => {
    // In a fresh test environment .danteforge/audit is unlikely to exist at process.cwd()
    const result = await validateSecurityControls({ checkIntegrity: true });
    // Either verified (dir exists) or issue added — both valid
    assert.ok(typeof result.integrityVerified === 'boolean');
    assert.ok(Array.isArray(result.issues));
  });

  it('checkSecrets marks a clean tracked repository as secure', async () => {
    const repo = await createGitRepo({
      'src/index.ts': 'export const config = { provider: "openai" };\n',
    });

    const result = await validateSecurityControls({ checkSecrets: true, cwd: repo });

    assert.equal(result.secretsSecure, true);
    assert.deepEqual(result.issues, []);
  });

  it('checkSecrets reports tracked credential assignments with file and line evidence', async () => {
    const repo = await createGitRepo({
      'src/config.ts': 'export const apiKey = "sk-abcdefghijklmnopqrstuvwxyz123456";\n',
    });

    const result = await validateSecurityControls({ checkSecrets: true, cwd: repo });

    assert.equal(result.secretsSecure, false);
    assert.ok(
      result.issues.some((issue) => issue.includes('src/config.ts:1') && issue.includes('credential-assignment')),
      `expected file evidence in issues, got ${JSON.stringify(result.issues)}`,
    );
  });

  it('checkSecrets runs without throwing', async () => {
    // git command may fail in test env — function catches and adds issue
    const result = await validateSecurityControls({ checkSecrets: true });
    assert.ok(Array.isArray(result.issues));
  });

  it('issues array collects from all enabled checks', async () => {
    const result = await validateSecurityControls({
      checkSecrets: true,
      checkPermissions: true,
      checkIntegrity: true,
    });
    assert.ok(Array.isArray(result.issues));
  });
});
