// 7 Levels Deep — Root Cause Analysis Engine tests
// 15 tests per PRD section 6. All LLM calls are injected via _llmCaller to avoid real API calls.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  SevenLevelsEngine,
  shouldTriggerSevenLevels,
  truncateCode,
  type SevenLevelsConfig,
} from '../src/core/seven-levels.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFailure(overrides: Partial<Parameters<SevenLevelsEngine['analyze']>[0]> = {}) {
  return {
    type: 'pdse_below_threshold',
    details: 'PDSE score 68 — incomplete implementation',
    pdseScore: 68,
    ...overrides,
  };
}

function makeContext(overrides: Partial<Parameters<SevenLevelsEngine['analyze']>[1]> = {}) {
  return {
    taskDescription: 'Add OAuth2 authentication to the Express API',
    generatedCode: 'function refreshToken() { return { success: true }; }',
    systemPrompt: 'You are a backend engineer.',
    modelId: 'grok-3',
    providerId: 'grok',
    ...overrides,
  };
}

/**
 * Returns a mock LLM caller that returns responses in sequence.
 * Once exhausted, repeats the last response.
 */
function mockLLM(responses: string[]): (prompt: string) => Promise<string> {
  let idx = 0;
  return async (_prompt: string) => {
    const response = responses[idx] ?? responses[responses.length - 1] ?? '{"answer":"fallback","confidence":0.7,"actionable":false,"suggestedFix":""}';
    idx++;
    return response;
  };
}

function actionableResponse(answer: string, confidence = 0.85): string {
  return JSON.stringify({ answer, confidence, actionable: true, suggestedFix: `Fix: ${answer.slice(0, 30)}` });
}

function nonActionableResponse(answer: string, confidence = 0.75): string {
  return JSON.stringify({ answer, confidence, actionable: false, suggestedFix: '' });
}

function makeConfig(overrides: Partial<SevenLevelsConfig> = {}): SevenLevelsConfig {
  return {
    minDepth: 3,
    maxDepth: 7,
    earlyStop: true,
    confidenceThreshold: 0.6,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SevenLevelsEngine', () => {

  // Test 1: earlyStop=true stops at L3 when actionable+confident response given
  it('earlyStop=true stops at level 3 when actionable root cause found', async () => {
    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: true,
      minDepth: 3,
      _llmCaller: mockLLM([
        nonActionableResponse('Token refresh stub detected'),       // L1
        nonActionableResponse('Missing OAuth2 PKCE logic'),         // L2
        actionableResponse('Model guessed OAuth2 flow variant', 0.9), // L3 — stop here
      ]),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());
    assert.strictEqual(result.depthReached, 3);
    assert.strictEqual(result.rootCauseDomain, 'model');
    assert.ok(result.rootCause.includes('Model guessed'));
  });

  // Test 2: earlyStop=false reaches all 7 levels
  it('earlyStop=false always runs to maxDepth', async () => {
    const allResponses = Array.from({ length: 7 }, (_, i) =>
      actionableResponse(`Analysis at level ${i + 1}`, 0.9),
    );

    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      minDepth: 3,
      maxDepth: 7,
      _llmCaller: mockLLM(allResponses),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());
    assert.strictEqual(result.depthReached, 7);
    assert.strictEqual(result.levels.length, 7);
  });

  // Test 3: Each level's prompt includes all previous levels' findings
  it("each level's prompt includes all previous levels' findings", async () => {
    const capturedPrompts: string[] = [];

    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 3,
      _llmCaller: async (prompt: string) => {
        capturedPrompts.push(prompt);
        return nonActionableResponse(`Finding ${capturedPrompts.length}`);
      },
    }));

    await engine.analyze(makeFailure(), makeContext());

    // L1 prompt has no previous levels
    assert.ok(!capturedPrompts[0]!.includes('Level 1 (symptom):'));

    // L2 prompt includes L1 answer
    assert.ok(capturedPrompts[1]!.includes('Finding 1'));

    // L3 prompt includes L1 and L2 answers
    assert.ok(capturedPrompts[2]!.includes('Finding 1'));
    assert.ok(capturedPrompts[2]!.includes('Finding 2'));
  });

  // Test 4: Domain classification — L1 → 'symptom', L7 → 'root_truth'
  it('classifies domains correctly for all 7 levels', async () => {
    const expectedDomains = ['symptom', 'code', 'model', 'context', 'system', 'architecture', 'root_truth'];
    const responses = Array.from({ length: 7 }, () => nonActionableResponse('analysis'));

    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 7,
      _llmCaller: mockLLM(responses),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());

    for (let i = 0; i < 7; i++) {
      assert.strictEqual(result.levels[i]!.domain, expectedDomains[i], `Level ${i + 1} domain mismatch`);
    }
  });

  // Test 5: Lesson extraction produces generalized (not instance-specific) lesson
  it('lessonForFuture is generalized and does not contain task-specific text', async () => {
    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 3,
      _llmCaller: mockLLM([
        nonActionableResponse('stub found'),
        nonActionableResponse('missing PKCE'),
        nonActionableResponse('model lacks protocol knowledge', 0.8),
      ]),
    }));

    const result = await engine.analyze(makeFailure(), makeContext({ taskDescription: 'my-unique-task-xyz-9999' }));

    // Lesson should NOT be the exact task description
    assert.ok(!result.lessonForFuture.includes('my-unique-task-xyz-9999'));
    // Lesson should include domain info and failure class
    assert.ok(result.lessonForFuture.length > 10);
    assert.ok(result.lessonForFuture.includes('pdse_below_threshold') || result.lessonForFuture.includes('MODEL'));
  });

  // Test 6: modelAttribution is set from context.modelId
  it('modelAttribution is set from context.modelId', async () => {
    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 3,
      _llmCaller: mockLLM([nonActionableResponse('s1'), nonActionableResponse('s2'), actionableResponse('s3')]),
    }));

    const result = await engine.analyze(makeFailure(), makeContext({ modelId: 'claude-sonnet-4-6', providerId: 'claude' }));
    assert.strictEqual(result.modelAttribution, 'claude-sonnet-4-6');
  });

  // Test 7: minDepth:5 forces at least 5 levels even when L3 returns actionable
  it('minDepth:5 forces at least 5 levels even when L3 is strongly actionable', async () => {
    const responses = [
      nonActionableResponse('symptom'),
      nonActionableResponse('code issue'),
      actionableResponse('model gap', 0.99),  // Very actionable at L3
      actionableResponse('context gap', 0.99),
      actionableResponse('system gap', 0.99),
    ];

    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: true,
      minDepth: 5,
      maxDepth: 7,
      _llmCaller: mockLLM(responses),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());
    assert.ok(result.depthReached >= 5, `Expected depth >= 5, got ${result.depthReached}`);
  });

  // Test 8: maxDepth:3 stops at 3 even if root cause not found
  it('maxDepth:3 stops at 3 levels even without finding root cause', async () => {
    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: true,
      minDepth: 1,
      maxDepth: 3,
      _llmCaller: mockLLM([
        nonActionableResponse('no fix yet'),
        nonActionableResponse('still no fix'),
        nonActionableResponse('no fix found'),
      ]),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());
    assert.strictEqual(result.depthReached, 3);
  });

  // Test 9: Empty generatedCode doesn't crash
  it('empty generatedCode in context does not throw', async () => {
    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 3,
      _llmCaller: mockLLM([
        nonActionableResponse('s1'),
        nonActionableResponse('s2'),
        actionableResponse('s3'),
      ]),
    }));

    await assert.doesNotReject(
      () => engine.analyze(makeFailure(), makeContext({ generatedCode: '' })),
    );
  });

  // Test 10: Very long code is truncated in prompt
  it('very long generatedCode is truncated to prevent prompt overflow', async () => {
    const capturedPrompts: string[] = [];
    const longCode = 'x'.repeat(10000);

    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 1,
      _llmCaller: async (prompt: string) => {
        capturedPrompts.push(prompt);
        return nonActionableResponse('result');
      },
    }));

    await engine.analyze(makeFailure(), makeContext({ generatedCode: longCode }));

    // The L1 prompt contains a codeSnippet — verify it's truncated
    const firstPrompt = capturedPrompts[0]!;
    assert.ok(
      firstPrompt.includes('[truncated'),
      'Expected truncation marker in prompt containing long code',
    );
    // The raw long code should not appear fully
    assert.ok(firstPrompt.length < longCode.length + 1000, 'Prompt should be shorter than raw code');
  });

  // Test 11: analyze() result feeds into retry prompt correctly
  it('analyze() result rootCause and suggestedFix are non-empty strings for retry prompt', async () => {
    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: true,
      minDepth: 3,
      _llmCaller: mockLLM([
        nonActionableResponse('Token refresh stub detected'),
        nonActionableResponse('Missing OAuth2 PKCE logic'),
        actionableResponse('Model does not understand PKCE flow variant', 0.9),
      ]),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());

    // Simulate building a retry prompt from the result
    const retryPrompt = `Surface issue: ${result.levels[0]!.answer}\nRoot cause (${result.rootCauseDomain}): ${result.rootCause}\nSuggested approach: ${result.suggestedFix}`;

    assert.ok(result.rootCause.length > 0, 'rootCause should be non-empty');
    assert.ok(result.suggestedFix.length > 0, 'suggestedFix should be non-empty');
    assert.ok(retryPrompt.includes('Root cause'), 'retry prompt should include root cause section');
    assert.ok(retryPrompt.includes('Surface issue'), 'retry prompt should include surface issue');
  });

  // Test 12: result.lessonForFuture is a non-empty string suitable for the lessons system
  it('lessonForFuture is a non-empty string with domain classification', async () => {
    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 4,
      _llmCaller: mockLLM([
        nonActionableResponse('stub at refresh endpoint'),
        nonActionableResponse('hardcoded return bypasses real logic'),
        nonActionableResponse('model assumed simple flow'),
        actionableResponse('context lacked OAuth2 variant specification', 0.85),
      ]),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());

    assert.ok(result.lessonForFuture.length > 10, 'lesson should be non-empty');
    // Should contain domain marker
    assert.ok(
      result.lessonForFuture.includes('[') && result.lessonForFuture.includes(']'),
      'lesson should include domain classification in brackets',
    );
  });

  // Test 13: shouldTriggerSevenLevels — score 82 with threshold 80 → NOT triggered
  it('shouldTriggerSevenLevels returns false when score is above threshold', () => {
    const result = shouldTriggerSevenLevels(82, 80);
    assert.strictEqual(result, false, 'Score 82 above threshold 80 should NOT trigger 7LD');
  });

  // Test 14: shouldTriggerSevenLevels — score 72 with threshold 80 → triggered
  it('shouldTriggerSevenLevels returns true when score is below threshold', () => {
    const result = shouldTriggerSevenLevels(72, 80);
    assert.strictEqual(result, true, 'Score 72 below threshold 80 should trigger 7LD');
  });

  // Test 15: Confidence below threshold overrides actionable to false
  it('low confidence (below threshold) forces actionable to false', async () => {
    const lowConfidenceResponse = JSON.stringify({
      answer: 'This looks fixable',
      confidence: 0.3,  // below default threshold of 0.6
      actionable: true,  // model says actionable — should be overridden
      suggestedFix: 'some fix',
    });

    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 3,
      confidenceThreshold: 0.6,
      _llmCaller: mockLLM([
        lowConfidenceResponse,
        lowConfidenceResponse,
        lowConfidenceResponse,
      ]),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());

    // All levels should have actionable=false because confidence (0.3) < threshold (0.6)
    for (const level of result.levels) {
      assert.strictEqual(
        level.actionable,
        false,
        `Level ${level.level} with confidence 0.3 should not be actionable`,
      );
    }
  });

});

// ─── Static Helper Tests ──────────────────────────────────────────────────────

describe('truncateCode', () => {
  it('returns code unchanged when below maxChars', () => {
    const code = 'function foo() {}';
    assert.strictEqual(truncateCode(code, 100), code);
  });

  it('truncates code and appends truncation marker', () => {
    const code = 'x'.repeat(5000);
    const result = truncateCode(code, 2000);
    assert.ok(result.includes('[truncated'));
    assert.ok(result.length < code.length);
  });

  it('truncates exactly at maxChars boundary', () => {
    const code = 'a'.repeat(100);
    const result = truncateCode(code, 100);
    // Exactly 100 chars: should NOT be truncated
    assert.strictEqual(result, code);
  });
});

// ─── shouldTriggerSevenLevels edge cases ──────────────────────────────────

describe('shouldTriggerSevenLevels — edge cases', () => {
  it('returns false when score exactly equals threshold (not strictly below)', () => {
    assert.strictEqual(shouldTriggerSevenLevels(80, 80), false);
  });

  it('returns true when score is undefined (always triggers)', () => {
    assert.strictEqual(shouldTriggerSevenLevels(undefined, 80), true);
  });

  it('returns true for score just below threshold (79 < 80)', () => {
    assert.strictEqual(shouldTriggerSevenLevels(79, 80), true);
  });

  it('returns true for score of 0 (critical failure)', () => {
    assert.strictEqual(shouldTriggerSevenLevels(0, 80), true);
  });
});

// ─── SevenLevelsEngine — parsing edge cases ───────────────────────────────

describe('SevenLevelsEngine — response parsing edge cases', () => {

  it('handles markdown-fenced JSON response from LLM', async () => {
    // Some LLMs return ```json fences despite instructions
    const fencedResponse = '```json\n{"answer":"Stale OAuth token","confidence":0.8,"actionable":true,"suggestedFix":"Refresh token"}\n```';

    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 1,
      _llmCaller: mockLLM([fencedResponse]),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());
    assert.ok(result.levels[0]!.answer.includes('Stale OAuth token'), 'Should strip markdown fences and parse JSON');
    assert.ok(result.levels[0]!.confidence >= 0.7);
  });

  it('falls back to plain text when JSON is malformed', async () => {
    // Not valid JSON at all
    const plainTextResponse = 'The model failed to implement PKCE because it defaulted to implicit flow';

    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 1,
      _llmCaller: mockLLM([plainTextResponse]),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());
    // Should use the plain text as the answer
    assert.ok(
      result.levels[0]!.answer.length > 10,
      'Should extract meaningful answer from plain text fallback',
    );
    // Plain text fallback has confidence 0.7 and actionable=false
    assert.strictEqual(result.levels[0]!.confidence, 0.7);
  });

  it('handles empty string response — falls back to (empty response)', async () => {
    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 1,
      _llmCaller: mockLLM(['']),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());
    assert.strictEqual(result.levels[0]!.answer, '(empty response)');
  });

  it('clamps confidence to [0, 1] range when LLM returns out-of-range value', async () => {
    const outOfRangeResponse = JSON.stringify({
      answer: 'Some finding',
      confidence: 1.5,  // over 1.0
      actionable: true,
      suggestedFix: 'Do something',
    });

    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 1,
      _llmCaller: mockLLM([outOfRangeResponse]),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());
    assert.ok(result.levels[0]!.confidence <= 1.0, 'Confidence should be clamped to ≤ 1.0');
    assert.ok(result.levels[0]!.confidence >= 0.0, 'Confidence should be clamped to ≥ 0.0');
  });

  it('LLM failure at a level is recovered — analysis continues with fallback', async () => {
    let callCount = 0;
    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      minDepth: 3,
      maxDepth: 3,
      _llmCaller: async (_prompt: string) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Simulated LLM timeout at level 2');
        }
        return nonActionableResponse(`Result for call ${callCount}`);
      },
    }));

    // Should not throw — level 2 uses fallback JSON
    await assert.doesNotReject(() => engine.analyze(makeFailure(), makeContext()));
    assert.strictEqual(callCount, 3, 'Should still attempt all 3 levels');
  });
});

// ─── extractSuggestedFix fallback ─────────────────────────────────────────

describe('SevenLevelsEngine — extractSuggestedFix fallback', () => {
  it('falls back to deepest level answer when no actionable levels found', async () => {
    // All levels return very low confidence → none are actionable
    const lowConf = JSON.stringify({ answer: 'Low confidence finding', confidence: 0.2, actionable: false, suggestedFix: '' });

    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 3,
      confidenceThreshold: 0.6,
      _llmCaller: mockLLM([lowConf, lowConf, lowConf]),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());
    // extractSuggestedFix should fall back to deepest level since none are actionable
    assert.ok(result.suggestedFix.length > 0, 'suggestedFix should never be empty');
    assert.ok(
      result.suggestedFix.includes('[') && result.suggestedFix.includes(']'),
      'suggestedFix should include domain classification',
    );
  });
});

// ─── extractLesson — long answer truncation ────────────────────────────────

describe('SevenLevelsEngine — extractLesson truncation', () => {
  it('truncates very long answer in lesson (> 400 chars)', async () => {
    // Return an answer that is 500 chars long
    const longAnswer = 'A'.repeat(500);
    const longResponse = JSON.stringify({
      answer: longAnswer,
      confidence: 0.5,
      actionable: false,
      suggestedFix: '',
    });

    const engine = new SevenLevelsEngine(makeConfig({
      earlyStop: false,
      maxDepth: 1,
      _llmCaller: mockLLM([longResponse]),
    }));

    const result = await engine.analyze(makeFailure(), makeContext());
    // Lesson should truncate the answer and add '...'
    assert.ok(result.lessonForFuture.includes('...'), 'Long answer in lesson should be truncated with ...');
    assert.ok(result.lessonForFuture.length < longAnswer.length + 100, 'Lesson should be shorter than full answer');
  });
});
