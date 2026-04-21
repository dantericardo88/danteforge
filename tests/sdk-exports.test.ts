import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

describe('SDK exports', () => {
  it('exports SDK_VERSION string', async () => {
    const sdk = await import('../src/sdk.js');
    assert.equal(typeof sdk.SDK_VERSION, 'string');
    assert.ok(sdk.SDK_VERSION.length > 0);
  });

  it('exports assess function', async () => {
    const sdk = await import('../src/sdk.js');
    assert.equal(typeof sdk.assess, 'function');
  });

  it('exports computeHarshScore function', async () => {
    const sdk = await import('../src/sdk.js');
    assert.equal(typeof sdk.computeHarshScore, 'function');
  });

  it('exports loadState function', async () => {
    const sdk = await import('../src/sdk.js');
    assert.equal(typeof sdk.loadState, 'function');
  });

  it('exports scanCompetitors function', async () => {
    const sdk = await import('../src/sdk.js');
    assert.equal(typeof sdk.scanCompetitors, 'function');
  });

  it('keeps SDK_VERSION aligned with package.json', async () => {
    const sdk = await import('../src/sdk.js');
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version: string };

    assert.equal(sdk.SDK_VERSION, pkg.version);
  });
});
