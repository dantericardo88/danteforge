import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildLocalSpec } from '../src/core/local-artifacts.js';

describe('local artifact generation', () => {
  it('prefers repo-grounded paths from current state over placeholder files', () => {
    const currentState = [
      '# CURRENT_STATE.md',
      '',
      'src/cli/index.ts',
      'src/core/state.ts',
      'tests/cli-release-readiness.test.ts',
    ].join('\n');

    const spec = buildLocalSpec('Ship DanteForge GA', '# Constitution', currentState);

    assert.ok(spec.tasks[0]?.files?.includes('src/cli/index.ts'));
    assert.ok(spec.tasks[1]?.files?.includes('tests/cli-release-readiness.test.ts'));
    assert.doesNotMatch(spec.markdown, /src\/main\.ts/);
  });

  it('prefers concrete source files over coarse top-level directories', () => {
    const currentState = [
      '# CURRENT_STATE.md',
      '',
      'agents/',
      'commands/',
      'src/cli/index.ts',
      'tests/cli-release-readiness.test.ts',
    ].join('\n');

    const spec = buildLocalSpec('Ship DanteForge GA', '# Constitution', currentState);

    assert.deepStrictEqual(spec.tasks[0]?.files, ['src/cli/index.ts']);
  });

  it('falls back to truthful source and test roots when no current state exists', () => {
    const spec = buildLocalSpec('Ship DanteForge GA', '# Constitution');

    assert.deepStrictEqual(spec.tasks[0]?.files, ['src/']);
    assert.deepStrictEqual(spec.tasks[1]?.files, ['tests/']);
    assert.doesNotMatch(spec.markdown, /src\/main\.ts/);
  });
});
