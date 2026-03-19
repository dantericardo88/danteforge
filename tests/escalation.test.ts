import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Escalation', () => {
  it('attempt 1 produces polite feedback', async () => {
    const { buildEscalatingFeedback } = await import('../src/core/escalation.js');
    const feedback = buildEscalatingFeedback(1, 3, ['Tests not run', 'Build not verified']);

    assert.ok(feedback.includes('Task Incomplete'));
    assert.ok(feedback.includes('Tests not run'));
    assert.ok(feedback.includes('Build not verified'));
    assert.ok(!feedback.includes('FINAL'));
    assert.ok(!feedback.includes('STOP'));
  });

  it('attempt 2 produces firm feedback with DO/DON\'T', async () => {
    const { buildEscalatingFeedback } = await import('../src/core/escalation.js');
    const feedback = buildEscalatingFeedback(2, 3, ['Tests failed']);

    assert.ok(feedback.includes('Second Attempt'));
    assert.ok(feedback.includes('DO:'));
    assert.ok(feedback.includes('DO NOT:'));
  });

  it('attempt 3 produces final warning', async () => {
    const { buildEscalatingFeedback } = await import('../src/core/escalation.js');
    const feedback = buildEscalatingFeedback(3, 3, ['Build failing']);

    assert.ok(feedback.includes('FINAL ATTEMPT'));
    assert.ok(feedback.includes('last chance'));
  });

  it('planning loop triggers hard STOP override', async () => {
    const { buildEscalatingFeedback } = await import('../src/core/escalation.js');
    const loopResult = {
      detected: true,
      type: 'planning' as const,
      evidence: '12 reads, 0 writes',
      severity: 'HIGH' as const,
    };

    const feedback = buildEscalatingFeedback(1, 3, ['Tests not run'], loopResult);
    assert.ok(feedback.includes('STOP'));
    assert.ok(feedback.includes('Planning Loop'));
    assert.ok(feedback.includes('writing'));
  });

  it('action loop triggers different approach message', async () => {
    const { buildEscalatingFeedback } = await import('../src/core/escalation.js');
    const loopResult = {
      detected: true,
      type: 'action' as const,
      evidence: '"npm test" repeated 5x',
      severity: 'HIGH' as const,
    };

    const feedback = buildEscalatingFeedback(1, 3, ['Tests failing'], loopResult);
    assert.ok(feedback.includes('STOP'));
    assert.ok(feedback.includes('Action Loop'));
    assert.ok(feedback.includes('different approach'));
  });
});
