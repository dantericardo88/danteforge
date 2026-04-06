// Clarify engine tests — gap detection and consistency analysis
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateClarifyQuestions, runConsistencyCheck } from '../src/harvested/spec/clarify-engine.js';

// Ensure no LLM is available by pointing DANTEFORGE_HOME at empty temp dir
let originalHome: string | undefined;
let tempHome: string;
const tempDirs: string[] = [];

async function makeTempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-clarify-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
  return dir;
}

describe('clarify-engine — fallback gap detection', () => {
  before(async () => {
    originalHome = process.env.DANTEFORGE_HOME;
    tempHome = await makeTempHome();
    process.env.DANTEFORGE_HOME = tempHome;
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

  it('returns 4 gaps for empty spec (no persona, performance, error, security)', async () => {
    const gaps = await generateClarifyQuestions('');
    assert.equal(gaps.length, 4);
    const questions = gaps.map(g => g.question);
    assert.ok(questions.some(q => q.includes('persona')));
    assert.ok(questions.some(q => q.includes('performance')));
    assert.ok(questions.some(q => q.includes('error') || q.includes('failure')));
    assert.ok(questions.some(q => q.includes('security')));
  });

  it('returns fewer gaps when spec contains "persona"', async () => {
    const gaps = await generateClarifyQuestions('The target persona is a developer.');
    assert.ok(gaps.length < 4, `Expected fewer than 4 gaps, got ${gaps.length}`);
    assert.ok(!gaps.some(g => g.question.includes('persona')));
  });

  it('returns fewer gaps when spec contains "performance"', async () => {
    const gaps = await generateClarifyQuestions('Performance target is < 100ms latency.');
    assert.ok(gaps.length < 4);
    assert.ok(!gaps.some(g => g.question.includes('performance')));
  });

  it('returns fewer gaps when spec contains "error"', async () => {
    const gaps = await generateClarifyQuestions('Error handling: retry 3 times then fail.');
    assert.ok(gaps.length < 4);
    assert.ok(!gaps.some(g => g.question.includes('error') || g.question.includes('failure')));
  });

  it('returns fewer gaps when spec contains "security"', async () => {
    const gaps = await generateClarifyQuestions('Security: all endpoints require JWT auth.');
    assert.ok(gaps.length < 4);
    assert.ok(!gaps.some(g => g.question.includes('security')));
  });

  it('returns 0 gaps when spec covers all keywords', async () => {
    const spec = 'The primary persona is a developer. Performance target: 50ms. Error handling with retry. Security via OAuth.';
    const gaps = await generateClarifyQuestions(spec);
    assert.equal(gaps.length, 0);
  });

  it('each gap has id, question, and context fields', async () => {
    const gaps = await generateClarifyQuestions('');
    for (const gap of gaps) {
      assert.equal(typeof gap.id, 'number');
      assert.equal(typeof gap.question, 'string');
      assert.equal(typeof gap.context, 'string');
      assert.ok(gap.question.length > 0);
      assert.ok(gap.context.length > 0);
    }
  });

  it('runConsistencyCheck returns empty array when no LLM available', async () => {
    const violations = await runConsistencyCheck('Some spec', 'Some constitution');
    assert.ok(Array.isArray(violations));
    assert.equal(violations.length, 0);
  });
});

describe('clarify-engine — _llmCaller injection', () => {
  it('parseQuestions parses [QUESTION] [CONTEXT] format', async () => {
    const mockLLM = async () => [
      '1. [QUESTION] Who are the users? [CONTEXT] No persona defined',
      '2. [QUESTION] What is the SLA? [CONTEXT] Performance gap',
    ].join('\n');

    const questions = await generateClarifyQuestions('empty spec', { _llmCaller: mockLLM });
    assert.equal(questions.length, 2);
    assert.equal(questions[0].question, 'Who are the users?');
    assert.equal(questions[0].context, 'No persona defined');
    assert.equal(questions[1].question, 'What is the SLA?');
  });

  it('parseQuestions handles numbered lines without [QUESTION] markers', async () => {
    const mockLLM = async () => [
      '1. How will authentication work with existing SSO?',
      '2. What is the expected throughput for the data pipeline?',
      '3. Short',  // Too short — should be skipped
    ].join('\n');

    const questions = await generateClarifyQuestions('spec', { _llmCaller: mockLLM });
    assert.equal(questions.length, 2);
    assert.ok(questions[0].question.includes('authentication'));
  });

  it('falls back to detectBasicGaps when LLM returns no parseable questions', async () => {
    const mockLLM = async () => 'No issues found with this specification.';

    const questions = await generateClarifyQuestions('', { _llmCaller: mockLLM });
    // detectBasicGaps returns 4 questions for empty spec
    assert.equal(questions.length, 4);
  });

  it('falls back to local analysis when LLM throws', async () => {
    const mockLLM = async () => { throw new Error('LLM timeout'); };

    const questions = await generateClarifyQuestions('', { _llmCaller: mockLLM });
    assert.equal(questions.length, 4);
  });

  it('runConsistencyCheck parses VIOLATION lines', async () => {
    const mockLLM = async () => [
      'Analysis results:',
      '- VIOLATION: Missing rate limiting as required by constitution',
      '- VIOLATION: No audit trail for admin actions',
    ].join('\n');

    const violations = await runConsistencyCheck('spec', 'constitution', { _llmCaller: mockLLM });
    assert.equal(violations.length, 2);
    assert.ok(violations[0].includes('rate limiting'));
    assert.ok(violations[1].includes('audit trail'));
  });

  it('runConsistencyCheck returns empty for no violations', async () => {
    const mockLLM = async () => 'No violations found.';

    const violations = await runConsistencyCheck('spec', 'constitution', { _llmCaller: mockLLM });
    assert.equal(violations.length, 0);
  });

  it('runConsistencyCheck falls back on LLM error', async () => {
    const mockLLM = async () => { throw new Error('API error'); };

    const violations = await runConsistencyCheck('spec', 'constitution', { _llmCaller: mockLLM });
    assert.equal(violations.length, 0);
  });
});
