import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';
import { markExperimental, markDeprecated, applyCommandTags } from '../src/cli/command-tags.js';

function isHidden(cmd: Command): boolean {
  return (cmd as unknown as { _hidden?: boolean })._hidden === true;
}

describe('command-tags — non-destructive curation convention', () => {
  test('markExperimental tags the description and hides the command', () => {
    const p = new Command();
    const c = p.command('war-room').description('Live multi-agent war room');
    markExperimental(c, 'Phase 14 — deferred');
    assert.match(c.description(), /^\[experimental\] \(Phase 14 — deferred\)/);
    assert.ok(isHidden(c));
  });

  test('markDeprecated points at the replacement and hides the command', () => {
    const p = new Command();
    const c = p.command('matrix').description('Legacy matrix engine');
    markDeprecated(c, 'matrix-kernel');
    assert.match(c.description(), /^\[deprecated → use `matrix-kernel`\]/);
    assert.ok(isHidden(c));
  });

  test('tagging is idempotent (no double prefix on re-apply)', () => {
    const p = new Command();
    const c = p.command('demo').description('Demo');
    markExperimental(c);
    markExperimental(c);
    assert.equal((c.description().match(/\[experimental\]/g) ?? []).length, 1);
  });

  test('applyCommandTags tags by name centrally and ignores unknown names', () => {
    const p = new Command();
    p.command('war-room').description('war');
    p.command('legacy').description('legacy');
    p.command('keep').description('keep');
    const result = applyCommandTags(
      p,
      new Map([['war-room', 'deferred'], ['nonexistent', undefined]]),
      new Map([['legacy', 'new-thing']]),
    );
    assert.deepEqual(result.experimental, ['war-room']);
    assert.deepEqual(result.deprecated, ['legacy']);
    const keep = p.commands.find(c => c.name() === 'keep')!;
    assert.ok(!isHidden(keep), 'untagged commands are untouched');
    assert.equal(keep.description(), 'keep');
  });
});
