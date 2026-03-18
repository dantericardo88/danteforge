import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('tech-decide command', () => {
  it('exports techDecide function', async () => {
    const { techDecide } = await import('../src/cli/commands/tech-decide.js');
    assert.strictEqual(typeof techDecide, 'function');
  });

  it('tech-decide skill exists and is discoverable', async () => {
    const { resolveSkill } = await import('../src/core/skills.js');
    const skill = await resolveSkill('tech-decide');
    assert.ok(skill !== null, 'tech-decide skill should exist');
    assert.strictEqual(skill!.name, 'tech-decide');
    assert.ok(skill!.description.includes('tech stack'));
    assert.ok(skill!.content.includes('Category Analysis'));
  });
});

describe('update-mcp command', () => {
  it('exports updateMcp function', async () => {
    const { updateMcp } = await import('../src/cli/commands/update-mcp.js');
    assert.strictEqual(typeof updateMcp, 'function');
  });
});
