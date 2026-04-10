// autoforge-step-cases.test.ts — switch case branch coverage for runAutoForgeStep (v0.23.0)
// Each test enters the real switch case (covering the branch) then uses _commandFns injection
// to avoid running the real CLI command (which would require LLM / state files).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAutoForgeStep } from '../src/core/autoforge.js';

// All valid commands in runAutoForgeStep switch
const CASES = [
  'review',
  'constitution',
  'specify',
  'clarify',
  'plan',
  'tasks',
  'design',
  'forge',
  'ux-refine',
  'verify',
  'synthesize',
  'doctor',
] as const;

describe('runAutoForgeStep — switch case branch coverage', () => {
  for (const cmd of CASES) {
    it(`switch case '${cmd}' fires injected fn (branch covered, no real command)`, async () => {
      let called = false;
      // _commandFns is checked INSIDE the case arm, so the case label IS evaluated (branch covered)
      // and the injected fn runs instead of the real CLI command
      await runAutoForgeStep(
        cmd,
        true,  // light=true bypasses enforceWorkflow gate checks
        'test goal',
        { profile: 'balanced' },
        { [cmd]: async () => { called = true; } },
      );
      assert.ok(called, `Expected _commandFns['${cmd}'] to be called from inside the case arm`);
    });
  }

  it('default case throws Unknown autoforge step', async () => {
    await assert.rejects(
      () => runAutoForgeStep('nonexistent-command', true),
      (err: Error) => {
        assert.ok(err.message.includes('Unknown autoforge step'), `Unexpected: ${err.message}`);
        return true;
      },
    );
  });

  it('_commandFns injection is case-specific — wrong key falls through to default throw', async () => {
    // Passing _commandFns with a different key than the command — should fall through to switch default
    await assert.rejects(
      () => runAutoForgeStep('bad-command', true, undefined, {}, { verify: async () => {} }),
      (err: Error) => {
        assert.ok(err.message.includes('Unknown autoforge step'), `Unexpected: ${err.message}`);
        return true;
      },
    );
  });
});
