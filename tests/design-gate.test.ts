import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { requireDesign, runGate, GateError } from '../src/core/gates.js';

afterEach(() => {
  process.exitCode = 0;
});

describe('requireDesign export', () => {
  it('is exported as a function', () => {
    assert.strictEqual(typeof requireDesign, 'function');
  });
});

describe('requireDesign light mode', () => {
  it('does not throw when light=true', async () => {
    await requireDesign(true);
  });

  it('resolves to undefined in light mode', async () => {
    const result = await requireDesign(true);
    assert.strictEqual(result, undefined);
  });
});

describe('requireDesign gate checks', () => {
  let originalCwd: string;
  let tmpDir: string;

  before(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-design-gate-'));
    process.chdir(tmpDir);
  });

  after(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws GateError when DESIGN.op is missing', async () => {
    try {
      await requireDesign(false);
      assert.fail('Should have thrown GateError');
    } catch (err) {
      assert.ok(err instanceof GateError);
      assert.strictEqual(err.gate, 'requireDesign');
      assert.ok(err.message.includes('No DESIGN.op found'));
    }
  });

  it('runGate returns false when DESIGN.op is missing', async () => {
    const result = await runGate(() => requireDesign(false));
    assert.strictEqual(result, false);
  });

  it('passes when valid DESIGN.op exists', async () => {
    const stateDir = path.join(tmpDir, '.danteforge');
    await fs.mkdir(stateDir, { recursive: true });

    const validOP = JSON.stringify({
      formatVersion: '1.0.0',
      generator: 'test',
      created: new Date().toISOString(),
      document: { name: 'Test', pages: [{ id: 'p1', type: 'page', name: 'Main' }] },
      nodes: [{ id: 'f1', type: 'frame', name: 'Root' }],
    });
    await fs.writeFile(path.join(stateDir, 'DESIGN.op'), validOP);

    // Should not throw
    await requireDesign(false);
  });

  it('throws GateError for malformed JSON in DESIGN.op', async () => {
    const stateDir = path.join(tmpDir, '.danteforge');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, 'DESIGN.op'), '{ this is not valid json }');

    try {
      await requireDesign(false);
      assert.fail('Should have thrown GateError');
    } catch (err) {
      assert.ok(err instanceof GateError);
      assert.ok(err.message.includes('malformed'));
    }
  });

  it('throws GateError for JSON missing required .op fields', async () => {
    const stateDir = path.join(tmpDir, '.danteforge');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, 'DESIGN.op'), JSON.stringify({ formatVersion: '1.0.0' }));

    try {
      await requireDesign(false);
      assert.fail('Should have thrown GateError');
    } catch (err) {
      assert.ok(err instanceof GateError);
      assert.ok(err.message.includes('malformed') || err.message.includes('Missing'));
    }
  });
});
