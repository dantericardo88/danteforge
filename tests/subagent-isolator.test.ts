// Subagent Isolator tests — context filtering, dual-stage review, flagging behavior
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildSubagentContext,
  getAgentRoles,
  getRoleConstraints,
} from '../src/core/subagent-isolator.js';

describe('buildSubagentContext', () => {
  const fullContext: Record<string, string> = {
    spec: 'Build a login page with email/password auth.',
    plan: '1. Create LoginPage component\n2. Add auth API route',
    fileTree: 'src/\n  pages/\n  components/',
    tasks: 'Task 1: LoginPage\nTask 2: AuthRoute',
    relevantFiles: 'src/pages/login.tsx\nsrc/api/auth.ts',
    design: 'DESIGN.op with login card layout',
    componentList: 'LoginCard, Header, Footer',
    opDocument: '{"nodes": [...]}',
    designTokens: ':root { --primary: #3B82F6 }',
    summaries: 'Sprint 1: Auth complete. Sprint 2: Dashboard WIP.',
  };

  it('filters context for PM role (spec + plan only)', () => {
    const ctx = buildSubagentContext('pm-agent', fullContext, 'pm');
    assert.strictEqual(ctx.role, 'pm');
    assert.ok(ctx.projectContext.includes('spec'));
    assert.ok(ctx.projectContext.includes('plan'));
    assert.ok(!ctx.projectContext.includes('fileTree'));
    assert.ok(!ctx.projectContext.includes('tasks'));
  });

  it('filters context for dev role (plan + tasks + relevantFiles)', () => {
    const ctx = buildSubagentContext('dev-agent', fullContext, 'dev');
    assert.ok(ctx.projectContext.includes('plan'));
    assert.ok(ctx.projectContext.includes('tasks'));
    assert.ok(ctx.projectContext.includes('relevantFiles'));
    assert.ok(!ctx.projectContext.includes('spec'));
  });

  it('filters context for design role (opDocument + designTokens)', () => {
    const ctx = buildSubagentContext('design-agent', fullContext, 'design');
    assert.ok(ctx.projectContext.includes('opDocument'));
    assert.ok(ctx.projectContext.includes('designTokens'));
    assert.ok(!ctx.projectContext.includes('tasks'));
  });

  it('includes two review stages', () => {
    const ctx = buildSubagentContext('pm-agent', fullContext, 'pm');
    assert.strictEqual(ctx.reviewStages.length, 2);
    assert.strictEqual(ctx.reviewStages[0].name, 'spec-compliance');
    assert.strictEqual(ctx.reviewStages[1].name, 'code-quality');
  });

  it('includes role-specific constraints', () => {
    const ctx = buildSubagentContext('pm-agent', fullContext, 'pm');
    assert.ok(ctx.constraints.length > 0);
    assert.ok(ctx.constraints.some(c => c.includes('not write code')));
  });
});

describe('getAgentRoles', () => {
  it('returns all 6 roles', () => {
    const roles = getAgentRoles();
    assert.strictEqual(roles.length, 6);
    assert.ok(roles.includes('pm'));
    assert.ok(roles.includes('dev'));
    assert.ok(roles.includes('design'));
  });
});

describe('getRoleConstraints', () => {
  it('returns constraints for each role', () => {
    for (const role of getAgentRoles()) {
      const constraints = getRoleConstraints(role);
      assert.ok(constraints.length > 0, `${role} should have constraints`);
    }
  });
});
