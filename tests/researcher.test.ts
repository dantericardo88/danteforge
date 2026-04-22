// Researcher agent tests — structured analysis fallback paths
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { research } from '../src/harvested/gsd/agents/researcher.js';

let originalHome: string | undefined;
const tempDirs: string[] = [];

describe('researcher — fallback template (no LLM)', () => {
  before(async () => {
    originalHome = process.env.DANTEFORGE_HOME;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-researcher-'));
    tempDirs.push(dir);
    await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
    process.env.DANTEFORGE_HOME = dir;
  });

  after(async () => {
    if (originalHome !== undefined) {
      process.env.DANTEFORGE_HOME = originalHome;
    } else {
      delete process.env.DANTEFORGE_HOME;
    }
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('returns structured template with topic name', async () => {
    const result = await research('GraphQL API design');
    assert.ok(result.includes('GraphQL API design'));
  });

  it('template has Key Concepts section', async () => {
    const result = await research('auth patterns');
    assert.ok(result.includes('## Key Concepts'));
  });

  it('template has Relevant Patterns section', async () => {
    const result = await research('auth patterns');
    assert.ok(result.includes('## Relevant Patterns'));
  });

  it('template has Potential Risks section', async () => {
    const result = await research('auth patterns');
    assert.ok(result.includes('## Potential Risks'));
  });

  it('template has Recommended Approach section', async () => {
    const result = await research('auth patterns');
    assert.ok(result.includes('## Recommended Approach'));
  });

  it('handles empty topic string', async () => {
    const result = await research('');
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0);
    assert.ok(result.includes('## Key Concepts'));
  });
});

describe('researcher — _llmCaller injection', () => {
  it('returns LLM research when available', async () => {
    const mockLLM = async () => '## Key Concepts\nOAuth 2.0 provides delegated authorization...';
    const result = await research('OAuth', { _llmCaller: mockLLM });
    assert.ok(result.includes('OAuth 2.0'));
  });

  it('falls back when LLM returns empty string', async () => {
    const mockLLM = async () => '';
    const result = await research('caching', { _llmCaller: mockLLM });
    assert.ok(result.includes('## Key Concepts'));
    assert.ok(result.includes('caching'));
  });

  it('falls back when LLM throws', async () => {
    const mockLLM = async () => { throw new Error('Network error'); };
    const result = await research('testing', { _llmCaller: mockLLM });
    assert.ok(result.includes('## Key Concepts'));
    assert.ok(result.includes('testing'));
  });
});
