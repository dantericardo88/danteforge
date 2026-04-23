import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSkeletonOP,
  stringifyOP,
  parseOP,
  validateOP,
} from '../src/harvested/openpencil/op-codec.js';

describe('design command', () => {
  it('exports design function', async () => {
    const mod = await import('../src/cli/commands/design.js');
    assert.strictEqual(typeof mod.design, 'function');
  });

  it('design module resolves all dependencies', async () => {
    const mod = await import('../src/cli/commands/design.js');
    assert.ok(mod);
    assert.ok(Object.keys(mod).length > 0);
  });
});

describe('design --seed', () => {
  let tmpDir: string;
  let stateDir: string;
  const origCwd = process.cwd();

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-design-seed-'));
    stateDir = path.join(tmpDir, '.danteforge');
    process.chdir(tmpDir);
    // Minimal state so loadState doesn't error
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, 'STATE.yaml'), 'workflowStage: plan\nauditLog: []\n');
  });

  after(async () => {
    process.chdir(origCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes DESIGN.op to state dir when --seed is passed', async () => {
    const { design } = await import('../src/cli/commands/design.js');
    await design('My App', {
      seed: true,
      _loadState: async () => ({
        workflowStage: 'plan', auditLog: [], project: 'test',
        designEnabled: false, designFilePath: '', designFormatVersion: '',
        constitution: '', spec: '', clarify: '', plan: '', tasks: [],
        lastVerifyStatus: '', lastVerifyReceiptPath: '', totalTokensUsed: 0,
      } as never),
      _saveState: async () => {},
    });
    const designPath = path.join(stateDir, 'DESIGN.op');
    const content = await fs.readFile(designPath, 'utf8');
    const doc = JSON.parse(content);
    assert.ok(doc.nodes, 'written doc has nodes');
    assert.ok(Array.isArray(doc.nodes) && doc.nodes.length > 0);
    assert.strictEqual(doc.document.name, 'My App');
  });

  it('seed document passes canvas quality scorer', async () => {
    const { getCanvasSeedDocument } = await import('../src/core/canvas-defaults.js');
    const { scoreCanvasQuality } = await import('../src/core/canvas-quality-scorer.js');
    const doc = getCanvasSeedDocument({ projectName: 'Test' });
    const result = scoreCanvasQuality(doc);
    assert.strictEqual(result.gapFromTarget, 0, 'seed scores all 7 canvas quality dims >= 70');
    assert.ok(result.composite >= 90, `composite should be ≥90, got ${result.composite}`);
  });
});

describe('design command - createSkeletonOP roundtrip', () => {
  it('creates a skeleton that can be stringified', () => {
    const doc = createSkeletonOP('Test Project');
    const json = stringifyOP(doc);
    assert.ok(json.length > 0);
    assert.ok(json.startsWith('{'));
  });

  it('stringified skeleton can be re-parsed', () => {
    const doc = createSkeletonOP('Test Project');
    const json = stringifyOP(doc);
    const reparsed = parseOP(json);
    assert.strictEqual(reparsed.document.name, 'Test Project');
    assert.ok(Array.isArray(reparsed.nodes));
    assert.ok(reparsed.nodes.length >= 1);
  });

  it('re-parsed skeleton validates successfully', () => {
    const doc = createSkeletonOP('Test Project');
    const json = stringifyOP(doc);
    const reparsed = parseOP(json);
    const result = validateOP(reparsed);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('skeleton preserves project name through roundtrip', () => {
    const doc = createSkeletonOP('My App');
    const json = stringifyOP(doc);
    const reparsed = parseOP(json);
    assert.strictEqual(reparsed.document.name, 'My App');
  });

  it('skeleton preserves page configuration through roundtrip', () => {
    const doc = createSkeletonOP('Dashboard', 'Overview');
    const json = stringifyOP(doc);
    const reparsed = parseOP(json);
    assert.strictEqual(reparsed.document.pages[0].name, 'Overview');
  });

  it('skeleton preserves root frame dimensions through roundtrip', () => {
    const doc = createSkeletonOP('Layout Test');
    const json = stringifyOP(doc);
    const reparsed = parseOP(json);
    assert.strictEqual(reparsed.nodes[0].width, 1440);
    assert.strictEqual(reparsed.nodes[0].height, 900);
    assert.strictEqual(reparsed.nodes[0].type, 'frame');
  });
});
