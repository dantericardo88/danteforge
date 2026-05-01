import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

describe('DELEGATE-52 preflight script', () => {
  const scriptPath = resolve(process.cwd(), 'scripts', 'preflight-delegate52.mjs');

  it('is ESM-clean and free of mojibake status text', () => {
    const body = readFileSync(scriptPath, 'utf8');
    assert.doesNotMatch(body, /require\s*\(/);
    assert.doesNotMatch(body, /Ã|Â/);
    assert.match(body, /\$2/);
    assert.match(body, /not GATE-1/i);
  });

  it('fails closed before live execution when credentials are missing', () => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: tmpdir(),
      env,
      encoding: 'utf8',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ANTHROPIC_API_KEY/i);
    assert.doesNotMatch(result.stdout + result.stderr, /Starting\.\.\./);
  });
});
