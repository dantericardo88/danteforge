// planner.ts tests — phase planning agent (no-LLM fallback path)
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { planPhase } from '../src/harvested/gsd/agents/planner.js';

// planPhase falls back to buildFallbackPlan when no LLM is configured.
// The fallback always returns an array beginning with "Review and clarify requirements"
// and ending with "Verify all acceptance criteria are met".
// Tests are written to be LLM-agnostic: they accept any non-empty string[] result
// because planPhase may or may not call the LLM depending on environment config.

describe('planPhase — fallback plan structure', () => {
  it('returns a non-empty array for a simple requirement', async () => {
    const tasks = await planPhase('Add a login page');
    assert.ok(Array.isArray(tasks), 'Should return an array');
    assert.ok(tasks.length >= 1, 'Should return at least one task');
    for (const task of tasks) {
      assert.strictEqual(typeof task, 'string', 'Each task should be a string');
      assert.ok(task.length > 0, 'Each task should be non-empty');
    }
  });

  it('returns a non-empty array for multi-sentence requirements', async () => {
    const requirements = 'Add OAuth2 authentication. Write tests. Deploy to production.';
    const tasks = await planPhase(requirements);
    assert.ok(Array.isArray(tasks));
    assert.ok(tasks.length >= 1);
  });

  it('returns a non-empty array for multi-line requirements', async () => {
    const requirements = [
      'Implement user registration',
      'Add email verification',
      'Create password reset flow',
    ].join('\n');
    const tasks = await planPhase(requirements);
    assert.ok(Array.isArray(tasks));
    assert.ok(tasks.length >= 1);
  });

  it('handles empty requirements gracefully', async () => {
    const tasks = await planPhase('');
    assert.ok(Array.isArray(tasks));
    assert.ok(tasks.length >= 1);
  });
});

describe('planPhase — fallback plan content (forced via _llmCaller returning empty)', () => {
  // Force the fallback path by injecting a _llmCaller that returns empty string,
  // which triggers parseNumberedList to return [] and falls through to buildFallbackPlan.

  it('fallback plan always starts with "Review and clarify requirements"', async () => {
    const tasks = await planPhase('Build a REST API for user management', { _llmCaller: async () => '' });
    assert.strictEqual(tasks[0], 'Review and clarify requirements');
  });

  it('fallback plan always ends with verify step', async () => {
    const tasks = await planPhase('Create a dashboard component', { _llmCaller: async () => '' });
    const lastTask = tasks[tasks.length - 1]!;
    assert.strictEqual(lastTask, 'Verify all acceptance criteria are met');
  });

  it('multi-sentence requirements expand to more tasks in fallback path', async () => {
    const single = await planPhase('Add login', { _llmCaller: async () => '' });
    const multi = await planPhase('Add login. Add signup. Add logout. Add profile.', { _llmCaller: async () => '' });
    assert.ok(multi.length > single.length, `multi (${multi.length}) should have more tasks than single (${single.length})`);
  });
});

describe('planPhase — _llmCaller injection (LLM path)', () => {
  it('uses _llmCaller response when it returns a numbered list', async () => {
    const llmResponse = '1. Set up project\n2. Write the API\n3. Add tests';
    const tasks = await planPhase('Build something', { _llmCaller: async () => llmResponse });
    assert.deepStrictEqual(tasks, ['Set up project', 'Write the API', 'Add tests']);
  });

  it('falls back to buildFallbackPlan when _llmCaller returns empty', async () => {
    const tasks = await planPhase('Add a button', { _llmCaller: async () => '' });
    assert.strictEqual(tasks[0], 'Review and clarify requirements');
    assert.ok(tasks.length >= 3);
  });

  it('falls back when _llmCaller throws', async () => {
    const tasks = await planPhase('Add a button', {
      _llmCaller: async () => { throw new Error('LLM unreachable'); },
    });
    assert.strictEqual(tasks[0], 'Review and clarify requirements');
  });

  it('returns LLM tasks when _llmCaller returns multiple numbered items', async () => {
    const llmResponse = '1. Task alpha\n2. Task beta\n3. Task gamma\n4. Task delta';
    const tasks = await planPhase('Complex requirements', { _llmCaller: async () => llmResponse });
    assert.strictEqual(tasks.length, 4);
    assert.strictEqual(tasks[0], 'Task alpha');
    assert.strictEqual(tasks[3], 'Task delta');
  });

  it('falls back when _llmCaller returns non-numbered prose', async () => {
    const tasks = await planPhase('Requirements', { _llmCaller: async () => 'Here is a plan: do stuff and things.' });
    assert.strictEqual(tasks[0], 'Review and clarify requirements');
  });
});
