import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('coverage infrastructure', () => {
  const pkgPath = resolve('package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  it('c8 is listed in devDependencies', () => {
    assert.ok(
      pkg.devDependencies?.c8,
      'Expected "c8" to be present in devDependencies',
    );
  });

  it('test:coverage script exists in package.json', () => {
    assert.ok(
      pkg.scripts?.['test:coverage'],
      'Expected "test:coverage" script to be defined in package.json',
    );
    assert.ok(
      pkg.scripts['test:coverage'].includes('c8'),
      'Expected test:coverage script to invoke c8',
    );
  });

  it('check-coverage.mjs script exists on disk', () => {
    const scriptPath = resolve('scripts', 'check-coverage.mjs');
    assert.ok(
      existsSync(scriptPath),
      `Expected ${scriptPath} to exist`,
    );
  });
});
