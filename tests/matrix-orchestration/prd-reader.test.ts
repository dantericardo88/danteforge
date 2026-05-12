// Tests for src/matrix-orchestration/prd-reader.ts
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  extractProjectIntent,
  validateProjectIntent,
  parseMarkdownSections,
  PrdExtractionError,
} from '../../src/matrix-orchestration/prd-reader.js';
import { loadOrch, readAuditLog } from '../../src/matrix-orchestration/state-io.js';
import type { ProjectIntent } from '../../src/matrix-orchestration/types.js';

const tmpDirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-orch-test-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function fakePrd(): string {
  return [
    '# AgentDeck',
    '',
    'AgentDeck is a CLI tool that lets developers compose multi-agent pipelines from yaml.',
    'It targets developers building autonomous coding workflows.',
    '',
    '## Key Features',
    '- yaml pipeline composition',
    '- replay and resume',
    '- per-agent budget caps',
    '',
    '## Non-Goals',
    '- GUI editor',
    '- enterprise SSO',
    '',
    '## Competitors',
    '- AutoGen',
    '- CrewAI',
  ].join('\n');
}

function llmResponse(overrides: Partial<Record<string, unknown>> = {}): string {
  const base = {
    projectName: 'AgentDeck',
    goal: 'Compose multi-agent pipelines from yaml.',
    projectType: 'cli_tool',
    targetUser: 'developer',
    keyFeatures: ['yaml pipelines', 'replay', 'budget caps'],
    constraintEmphasis: ['cost_critical'],
    nonGoals: ['GUI editor'],
    competitiveCategoryBoundary: { direct: ['AutoGen'], adjacent: [], research: [] },
    frontierFraming: {
      target: 'oss_frontier',
      matchLeaderOn: [], exceedLeaderOn: ['replay'], defineNewCategoryOn: [],
    },
    confidence: 0.85,
    ...overrides,
  };
  return JSON.stringify(base);
}

describe('parseMarkdownSections', () => {
  it('splits a markdown doc by heading levels and ignores fenced code blocks', () => {
    const md = ['# Title', 'pre', '## Sub', 'body', '```', '# not-a-heading', '```'].join('\n');
    const sections = parseMarkdownSections(md);
    assert.ok(sections.find(s => s.heading === 'Title'));
    assert.ok(sections.find(s => s.heading === 'Sub'));
    assert.ok(!sections.find(s => s.heading === 'not-a-heading'));
  });
});

describe('validateProjectIntent', () => {
  it('accepts a well-formed payload', () => {
    const r = validateProjectIntent(JSON.parse(llmResponse()));
    assert.equal(r.ok, true, r.errors.join('; '));
  });
  it('rejects missing fields', () => {
    const r = validateProjectIntent({ projectName: 'x' });
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  });
  it('rejects invalid enum values', () => {
    const r = validateProjectIntent(JSON.parse(llmResponse({ projectType: 'not-a-real-type' })));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.includes('projectType')));
  });
});

describe('extractProjectIntent — prompt mode', () => {
  it('emits the prompt and throws without calling the LLM', async () => {
    const cwd = await tmp();
    const prdPath = path.join(cwd, 'prd.md');
    await fs.writeFile(prdPath, fakePrd(), 'utf8');
    let emitted = '';
    let llmCalls = 0;
    await assert.rejects(
      extractProjectIntent(prdPath, {
        cwd,
        mode: 'prompt',
        _stdoutWrite: (s) => { emitted += s; },
        _llmCaller: async () => { llmCalls++; return ''; },
        _isLLMAvailable: async () => true,
      }),
      (err: unknown) => err instanceof PrdExtractionError,
    );
    assert.ok(emitted.includes('You extract structured project intent'));
    assert.equal(llmCalls, 0);
  });
});

describe('extractProjectIntent — llm mode', () => {
  it('parses LLM JSON, persists projectIntent, and writes an audit event', async () => {
    const cwd = await tmp();
    const prdPath = path.join(cwd, 'prd.md');
    await fs.writeFile(prdPath, fakePrd(), 'utf8');
    const intent = await extractProjectIntent(prdPath, {
      cwd,
      mode: 'llm',
      _llmCaller: async () => llmResponse(),
      _isLLMAvailable: async () => true,
      _now: () => '2026-05-12T00:00:00.000Z',
    });
    assert.equal(intent.projectName, 'AgentDeck');
    assert.equal(intent.sourcePath, prdPath);
    assert.equal(intent.extractedAt, '2026-05-12T00:00:00.000Z');
    const saved = await loadOrch<ProjectIntent>(cwd, 'projectIntent');
    assert.deepEqual(saved, intent);
    const audit = await readAuditLog(cwd);
    assert.ok(audit.some(e => e.kind === 'stage_completed' && e.stage === 'reading_prd'));
  });

  it('tolerates fenced code blocks around the JSON', async () => {
    const cwd = await tmp();
    const prdPath = path.join(cwd, 'prd.md');
    await fs.writeFile(prdPath, fakePrd(), 'utf8');
    const wrapped = '```json\n' + llmResponse() + '\n```';
    const intent = await extractProjectIntent(prdPath, {
      cwd, mode: 'llm',
      _llmCaller: async () => wrapped,
      _isLLMAvailable: async () => true,
    });
    assert.equal(intent.projectName, 'AgentDeck');
  });

  it('throws when LLM response is not valid JSON', async () => {
    const cwd = await tmp();
    const prdPath = path.join(cwd, 'prd.md');
    await fs.writeFile(prdPath, fakePrd(), 'utf8');
    await assert.rejects(
      extractProjectIntent(prdPath, {
        cwd, mode: 'llm',
        _llmCaller: async () => 'not json at all',
        _isLLMAvailable: async () => true,
      }),
      (err: unknown) => err instanceof PrdExtractionError && /JSON/i.test((err as Error).message),
    );
  });

  it('throws when confidence is below minConfidence', async () => {
    const cwd = await tmp();
    const prdPath = path.join(cwd, 'prd.md');
    await fs.writeFile(prdPath, fakePrd(), 'utf8');
    await assert.rejects(
      extractProjectIntent(prdPath, {
        cwd, mode: 'llm',
        minConfidence: 0.9,
        _llmCaller: async () => llmResponse({ confidence: 0.5 }),
        _isLLMAvailable: async () => true,
      }),
      (err: unknown) => err instanceof PrdExtractionError && /confidence/i.test((err as Error).message),
    );
  });
});

describe('extractProjectIntent — local mode', () => {
  it('extracts heuristically from markdown when LLM is not available', async () => {
    const cwd = await tmp();
    const prdPath = path.join(cwd, 'prd.md');
    await fs.writeFile(prdPath, fakePrd(), 'utf8');
    const intent = await extractProjectIntent(prdPath, {
      cwd,
      mode: 'local',
      minConfidence: 0.3,
      _isLLMAvailable: async () => false,
    });
    assert.equal(intent.projectName, 'AgentDeck');
    assert.ok(intent.keyFeatures.length >= 3);
    assert.ok(intent.confidence < 0.5);
  });

  it('respects the _readFile injection seam', async () => {
    const cwd = await tmp();
    let reads = 0;
    const intent = await extractProjectIntent('/virtual/path.md', {
      cwd,
      mode: 'local',
      minConfidence: 0.3,
      _readFile: async (p) => { reads++; assert.equal(p, '/virtual/path.md'); return fakePrd(); },
    });
    assert.equal(reads, 1);
    assert.equal(intent.sourcePath, '/virtual/path.md');
  });

  it('falls back from llm-mode to local when isLLMAvailable returns false', async () => {
    const cwd = await tmp();
    const prdPath = path.join(cwd, 'prd.md');
    await fs.writeFile(prdPath, fakePrd(), 'utf8');
    let llmCalls = 0;
    const intent = await extractProjectIntent(prdPath, {
      cwd, mode: 'llm',
      minConfidence: 0.3,
      _llmCaller: async () => { llmCalls++; return llmResponse(); },
      _isLLMAvailable: async () => false,
    });
    assert.equal(llmCalls, 0);
    assert.ok(intent.confidence < 0.5);
  });
});
