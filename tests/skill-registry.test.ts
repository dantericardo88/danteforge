// Skill Registry tests — domain classification, compatibility, registry build
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyDomain, groupByDomain, type SkillRegistryEntry } from '../src/core/skill-registry.js';

describe('classifyDomain', () => {
  it('classifies security skills', () => {
    assert.strictEqual(classifyDomain('auth-guard', 'Use when implementing authentication and authorization'), 'security');
  });

  it('classifies frontend skills', () => {
    assert.strictEqual(classifyDomain('react-patterns', 'Modern React component patterns and hooks'), 'frontend');
  });

  it('classifies backend skills', () => {
    assert.strictEqual(classifyDomain('api-builder', 'REST API endpoints with Prisma and database queries'), 'backend');
  });

  it('classifies testing skills', () => {
    assert.strictEqual(classifyDomain('tdd-helper', 'Test driven development with unit tests and jest'), 'testing');
  });

  it('classifies devops skills', () => {
    assert.strictEqual(classifyDomain('deploy-config', 'Docker containerization and Kubernetes deployment'), 'devops');
  });

  it('classifies ux skills', () => {
    assert.strictEqual(classifyDomain('design-audit', 'Design system consistency and accessibility audit'), 'ux');
  });

  it('defaults to general for ambiguous skills', () => {
    assert.strictEqual(classifyDomain('misc-helper', 'A general purpose helper tool'), 'general');
  });
});

describe('groupByDomain', () => {
  const entries: SkillRegistryEntry[] = [
    { name: 'auth', description: 'Auth', source: 'packaged', domain: 'security', compatibility: { requiredTools: [], requiredFrameworks: [] }, filePath: '/a' },
    { name: 'react', description: 'React', source: 'packaged', domain: 'frontend', compatibility: { requiredTools: [], requiredFrameworks: [] }, filePath: '/b' },
    { name: 'vue', description: 'Vue', source: 'external', domain: 'frontend', compatibility: { requiredTools: [], requiredFrameworks: [] }, filePath: '/c' },
  ];

  it('groups entries by domain', () => {
    const grouped = groupByDomain(entries);
    assert.strictEqual(grouped.security.length, 1);
    assert.strictEqual(grouped.frontend.length, 2);
    assert.strictEqual(grouped.backend, undefined);
  });
});
