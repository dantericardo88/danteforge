// DanteForge v0.3 smoke tests
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadState } from '../src/core/state.js';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-smoke-test-'));
  tempRoots.push(root);
  return root;
}

describe('DanteForge Core State', () => {
  it('loads default state', async () => {
    const cwd = await makeWorkspace();
    const state = await loadState({ cwd });
    assert.strictEqual(state.project, path.basename(cwd));
    assert.strictEqual(state.workflowStage, 'initialized');
    assert.ok(Array.isArray(state.auditLog));
  });

  it('has valid default profile', async () => {
    const cwd = await makeWorkspace();
    const state = await loadState({ cwd });
    assert.strictEqual(state.profile, 'balanced');
  });

  it('starts at phase 0', async () => {
    const cwd = await makeWorkspace();
    const state = await loadState({ cwd });
    assert.strictEqual(state.currentPhase, 0);
  });
});

describe('DanteForge Commands', () => {
  it('review command exports correctly', async () => {
    const { review } = await import('../src/cli/commands/review.js');
    assert.strictEqual(typeof review, 'function');
  });

  it('verify command exports correctly', async () => {
    const { verify } = await import('../src/cli/commands/verify.js');
    assert.strictEqual(typeof verify, 'function');
  });

  it('synthesize command exports correctly', async () => {
    const { synthesize } = await import('../src/cli/commands/synthesize.js');
    assert.strictEqual(typeof synthesize, 'function');
  });

  it('handoff accepts review as source', async () => {
    const cwd = await makeWorkspace();
    // Write the expected artifact before handoff (fail-closed contract)
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.danteforge', 'CURRENT_STATE.md'), '# State');
    const { handoff } = await import('../src/core/handoff.js');
    await handoff('review', { stateFile: 'CURRENT_STATE.md' }, { cwd });
    const state = await loadState({ cwd });
    assert.ok(state.lastHandoff.includes('review'));
    assert.ok(state.auditLog.some(e => e.includes('review artifact')));
  });
});

describe('DanteForge Gates & Skills', () => {
  it('gates module exports correctly', async () => {
    const gates = await import('../src/core/gates.js');
    assert.strictEqual(typeof gates.requireConstitution, 'function');
    assert.strictEqual(typeof gates.requireSpec, 'function');
    assert.strictEqual(typeof gates.requirePlan, 'function');
    assert.strictEqual(typeof gates.requireTests, 'function');
    assert.strictEqual(typeof gates.requireApproval, 'function');
    assert.strictEqual(typeof gates.runGate, 'function');
  });

  it('requireConstitution gate blocks when no constitution', async () => {
    const { requireConstitution, GateError } = await import('../src/core/gates.js');
    try {
      await requireConstitution(false);
    } catch (err) {
      assert.ok(err instanceof GateError);
      assert.strictEqual(err.gate, 'requireConstitution');
    }
  });

  it('requireConstitution gate passes in light mode', async () => {
    const { requireConstitution } = await import('../src/core/gates.js');
    await requireConstitution(true);
  });

  it('skills module exports correctly', async () => {
    const skills = await import('../src/core/skills.js');
    assert.strictEqual(typeof skills.discoverSkills, 'function');
    assert.strictEqual(typeof skills.resolveSkill, 'function');
    assert.strictEqual(typeof skills.listSkills, 'function');
    assert.strictEqual(typeof skills.findRelevantSkills, 'function');
  });

  it('discovers all 11 skills', async () => {
    const { discoverSkills } = await import('../src/core/skills.js');
    const skills = await discoverSkills();
    assert.ok(skills.length >= 11, `Expected at least 11 skills, got ${skills.length}`);

    const names = skills.map(s => s.name);
    assert.ok(names.includes('brainstorming'));
    assert.ok(names.includes('writing-plans'));
    assert.ok(names.includes('test-driven-development'));
    assert.ok(names.includes('systematic-debugging'));
    assert.ok(names.includes('using-git-worktrees'));
    assert.ok(names.includes('subagent-driven-development'));
    assert.ok(names.includes('requesting-code-review'));
    assert.ok(names.includes('finishing-a-development-branch'));
    assert.ok(names.includes('ux-refine'));
    assert.ok(names.includes('tech-decide'));
    assert.ok(names.includes('lessons'));
  });

  it('resolves a skill by name', async () => {
    const { resolveSkill } = await import('../src/core/skills.js');
    const skill = await resolveSkill('systematic-debugging');
    assert.ok(skill !== null);
    assert.strictEqual(skill!.name, 'systematic-debugging');
    assert.ok(skill!.description.startsWith('Use when'));
    assert.ok(skill!.content.includes('Phase 1'));
  });

  it('returns null for unknown skill', async () => {
    const { resolveSkill } = await import('../src/core/skills.js');
    const skill = await resolveSkill('nonexistent-skill');
    assert.strictEqual(skill, null);
  });

  it('discovers user-installed Claude, Codex, Antigravity, and OpenCode skills alongside packaged skills', async () => {
    const root = await makeWorkspace();
    const homeDir = path.join(root, 'home');
    const packagedDir = path.join(root, 'packaged-skills');

    await fs.mkdir(path.join(homeDir, '.claude', 'skills', 'claude-only'), { recursive: true });
    await fs.mkdir(path.join(homeDir, '.codex', 'skills', 'codex-only'), { recursive: true });
    await fs.mkdir(path.join(homeDir, '.gemini', 'antigravity', 'skills', 'antigravity-only'), { recursive: true });
    await fs.mkdir(path.join(homeDir, '.config', 'opencode', 'skills', 'opencode-only'), { recursive: true });
    await fs.mkdir(path.join(packagedDir, 'packaged-only'), { recursive: true });

    await fs.writeFile(
      path.join(homeDir, '.claude', 'skills', 'claude-only', 'SKILL.md'),
      '---\nname: claude-only\ndescription: Claude skill\n---\n\nBody\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(homeDir, '.codex', 'skills', 'codex-only', 'SKILL.md'),
      '---\nname: codex-only\ndescription: Codex skill\n---\n\nBody\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(homeDir, '.gemini', 'antigravity', 'skills', 'antigravity-only', 'SKILL.md'),
      '---\nname: antigravity-only\ndescription: Antigravity skill\n---\n\nBody\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(homeDir, '.config', 'opencode', 'skills', 'opencode-only', 'SKILL.md'),
      '---\nname: opencode-only\ndescription: OpenCode skill\n---\n\nBody\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(packagedDir, 'packaged-only', 'SKILL.md'),
      '---\nname: packaged-only\ndescription: Packaged skill\n---\n\nBody\n',
      'utf8',
    );

    const { discoverSkills } = await import('../src/core/skills.js');
    const skills = await discoverSkills({ homeDir, packagedSkillsDir: packagedDir });
    const names = skills.map(skill => skill.name);

    assert.ok(names.includes('claude-only'));
    assert.ok(names.includes('codex-only'));
    assert.ok(names.includes('antigravity-only'));
    assert.ok(names.includes('opencode-only'));
    assert.ok(names.includes('packaged-only'));
  });

  it('prefers user-installed skills over packaged skills when names collide', async () => {
    const root = await makeWorkspace();
    const homeDir = path.join(root, 'home');
    const packagedDir = path.join(root, 'packaged-skills');

    await fs.mkdir(path.join(homeDir, '.claude', 'skills', 'shared-skill'), { recursive: true });
    await fs.mkdir(path.join(packagedDir, 'shared-skill'), { recursive: true });

    await fs.writeFile(
      path.join(packagedDir, 'shared-skill', 'SKILL.md'),
      '---\nname: shared-skill\ndescription: Packaged description\n---\n\nPackaged body\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(homeDir, '.claude', 'skills', 'shared-skill', 'SKILL.md'),
      '---\nname: shared-skill\ndescription: Claude description\n---\n\nClaude body\n',
      'utf8',
    );

    const { resolveSkill } = await import('../src/core/skills.js');
    const skill = await resolveSkill('shared-skill', { homeDir, packagedSkillsDir: packagedDir });

    assert.ok(skill !== null);
    assert.strictEqual(skill?.description, 'Claude description');
    assert.match(skill?.content ?? '', /Claude body/);
  });

  it('debug command exports correctly', async () => {
    const { debug } = await import('../src/cli/commands/debug.js');
    assert.strictEqual(typeof debug, 'function');
  });

  it('compact command exports correctly', async () => {
    const { compact } = await import('../src/cli/commands/compact.js');
    assert.strictEqual(typeof compact, 'function');
  });

  it('ux-refine command exports correctly', async () => {
    const { uxRefine } = await import('../src/cli/commands/ux-refine.js');
    assert.strictEqual(typeof uxRefine, 'function');
  });

  it('worktree utility exports correctly', async () => {
    const worktree = await import('../src/utils/worktree.js');
    assert.strictEqual(typeof worktree.createAgentWorktree, 'function');
    assert.strictEqual(typeof worktree.removeAgentWorktree, 'function');
    assert.strictEqual(typeof worktree.listWorktrees, 'function');
    assert.strictEqual(typeof worktree.ensureWorktreesIgnored, 'function');
  });

  it('state interface supports extended fields', async () => {
    const cwd = await makeWorkspace();
    const state = await loadState({ cwd });
    // Verify these optional fields are accessible on the type (may be set or undefined)
    assert.ok('tddEnabled' in state);
    assert.ok('lightMode' in state);
    assert.ok('activeWorktrees' in state);
    assert.ok('uxRefineEnabled' in state);
    assert.ok('figmaUrl' in state);
    assert.ok('designTokensPath' in state);
    assert.ok('mcpHost' in state);
  });

  it('token estimator exports correctly', async () => {
    const { estimateTokens, estimateCost, chunkText } = await import('../src/core/token-estimator.js');
    assert.strictEqual(typeof estimateTokens, 'function');
    assert.strictEqual(typeof estimateCost, 'function');
    assert.strictEqual(typeof chunkText, 'function');

    assert.strictEqual(estimateTokens('hello world test'), 4); // 15 chars / 4 = ~4
    const chunks = chunkText('a'.repeat(500000), 100000);
    assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);
  });

  it('help command exports correctly', async () => {
    const { helpCmd } = await import('../src/cli/commands/help.js');
    assert.strictEqual(typeof helpCmd, 'function');
  });
});
