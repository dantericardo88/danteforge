import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';

describe('magic preset docs', () => {
  it('documents the new preset table and usage rule in AGENTS and README', async () => {
    const agents = await fs.readFile('AGENTS.md', 'utf8');
    const readme = await fs.readFile('README.md', 'utf8');

    for (const cmd of ['spark', 'ember', 'magic', 'blaze', 'inferno']) {
      assert.match(agents, new RegExp(`danteforge ${cmd}`));
      assert.match(readme, new RegExp(`danteforge ${cmd}`));
    }

    assert.match(readme, /First-time new matrix dimension \+ fresh OSS discovery.*\/inferno/i);
    assert.match(readme, /follow-up PRD gap closing.*\/magic/i);
    assert.match(readme, /Balanced \(Default\)/);
  });

  it('publishes MAGIC-LEVELS guidance and helper text for the full preset system', async () => {
    const levels = await fs.readFile('.danteforge/MAGIC-LEVELS.md', 'utf8');
    const helpSrc = await fs.readFile('src/cli/commands/help.ts', 'utf8');
    const hook = await fs.readFile('hooks/session-start.mjs', 'utf8');
    const cursor = await fs.readFile('.cursor/rules/danteforge.mdc', 'utf8');

    assert.match(levels, /# Magic Levels/i);
    assert.match(levels, /\/spark/);
    assert.match(levels, /\/ember/);
    assert.match(levels, /\/magic/);
    assert.match(levels, /\/blaze/);
    assert.match(levels, /\/inferno/);
    assert.match(levels, /First-time new matrix dimension \+ fresh OSS discovery.*\/inferno/i);
    assert.match(levels, /follow-up PRD gap closing.*\/magic/i);

    assert.match(helpSrc, /spark:/);
    assert.match(helpSrc, /ember:/);
    assert.match(helpSrc, /blaze:/);
    assert.match(helpSrc, /inferno:/);

    assert.match(hook, /\/spark/);
    assert.match(hook, /\/ember/);
    assert.match(hook, /\/blaze/);
    assert.match(hook, /\/inferno/);

    assert.match(cursor, /danteforge spark/);
    assert.match(cursor, /danteforge ember/);
    assert.match(cursor, /danteforge blaze/);
    assert.match(cursor, /danteforge inferno/);
  });
});
