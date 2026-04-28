import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { runSkill } from '../../src/spine/skill_runner/runner.js';
import { danteDesignAnInterfaceExecutor } from '../../src/spine/skill_runner/executors/dante-design-an-interface-executor.js';

let workspace: string;

before(() => {
  workspace = mkdtempSync(resolve(tmpdir(), 'dante-design-eval-'));
  mkdirSync(resolve(workspace, '.danteforge'), { recursive: true });
});

test('/dante-design-an-interface: refuses >3 parallel agents (hardware ceiling)', async () => {
  const result = await runSkill(danteDesignAnInterfaceExecutor, {
    skillName: 'dante-design-an-interface',
    repo: workspace,
    inputs: {
      brief: 'Design an API',
      hardConstraints: [],
      successCriteria: [],
      roles: ['a', 'b', 'c', 'd'],
      designs: { a: { content: 'a', tradeoffsAccepted: [] }, b: { content: 'b', tradeoffsAccepted: [] }, c: { content: 'c', tradeoffsAccepted: [] }, d: { content: 'd', tradeoffsAccepted: [] } }
    },
    runId: 'run_20260428_940',
    frontmatter: {
      name: 'dante-design-an-interface',
      description: 'eval',
      requiredDimensions: ['functionality']
    },
    scorer: () => ({ functionality: 9.0 })
  });
  const o = result.output as { selectedRole: string | null; blockingIssues: string[] };
  assert.equal(o.selectedRole, null);
  assert.ok(o.blockingIssues.some(b => /hardware ceiling/i.test(b)));
});

test('/dante-design-an-interface: green path — picks highest-scoring stage-A-passing design', async () => {
  const result = await runSkill(danteDesignAnInterfaceExecutor, {
    skillName: 'dante-design-an-interface',
    repo: workspace,
    inputs: {
      brief: 'Design an outreach email covering capacity, GFSI, pricing',
      hardConstraints: ['capacity', 'GFSI', 'pricing'],
      successCriteria: ['concise', 'next-step', 'rapport'],
      roles: ['persuasive', 'concise', 'technical'],
      designs: {
        persuasive: {
          content: 'Hi Sean, capacity 200kg/hr, GFSI on track, pricing $X. Coffee next-step? rapport from RC Show.',
          tradeoffsAccepted: ['warmer', 'longer']
        },
        concise: {
          content: 'capacity 200kg/hr, GFSI Q3, pricing $X. concise next-step.',
          tradeoffsAccepted: ['terse']
        },
        technical: {
          content: 'capacity (Rational 202G+102G), GFSI audit body Foo, pricing tiered $X-$Y. technical next-step.',
          tradeoffsAccepted: ['dense', 'longest']
        }
      }
    },
    runId: 'run_20260428_941',
    frontmatter: {
      name: 'dante-design-an-interface',
      description: 'eval',
      requiredDimensions: ['functionality', 'maintainability']
    },
    scorer: () => ({ functionality: 9.3, maintainability: 9.1 })
  });
  const o = result.output as { selectedRole: string | null; selectionRationale: string; diversityCheck: string };
  assert.notEqual(o.selectedRole, null);
  assert.equal(o.diversityCheck, 'pass');
  assert.match(o.selectionRationale, /scored/);
});

test('/dante-design-an-interface: blocks when no design passes Stage A spec compliance', async () => {
  const result = await runSkill(danteDesignAnInterfaceExecutor, {
    skillName: 'dante-design-an-interface',
    repo: workspace,
    inputs: {
      brief: 'must mention capacity',
      hardConstraints: ['capacity'],
      successCriteria: [],
      roles: ['a', 'b', 'c'],
      designs: {
        a: { content: 'no mention here', tradeoffsAccepted: ['x'] },
        b: { content: 'also no mention', tradeoffsAccepted: ['y'] },
        c: { content: 'still missing', tradeoffsAccepted: ['z'] }
      }
    },
    runId: 'run_20260428_942',
    frontmatter: {
      name: 'dante-design-an-interface',
      description: 'eval',
      requiredDimensions: ['functionality']
    },
    scorer: () => ({ functionality: 9.0 })
  });
  const o = result.output as { selectedRole: string | null; blockingIssues: string[] };
  assert.equal(o.selectedRole, null);
  assert.ok(o.blockingIssues.some(b => /Stage A/.test(b)));
});

test('/dante-design-an-interface: detects diversity failure (identical tradeoffs across roles)', async () => {
  const result = await runSkill(danteDesignAnInterfaceExecutor, {
    skillName: 'dante-design-an-interface',
    repo: workspace,
    inputs: {
      brief: 'short',
      hardConstraints: [],
      successCriteria: [],
      roles: ['a', 'b', 'c'],
      designs: {
        a: { content: 'option a', tradeoffsAccepted: ['same'] },
        b: { content: 'option b', tradeoffsAccepted: ['same'] },
        c: { content: 'option c', tradeoffsAccepted: ['same'] }
      }
    },
    runId: 'run_20260428_943',
    frontmatter: {
      name: 'dante-design-an-interface',
      description: 'eval',
      requiredDimensions: ['functionality']
    },
    scorer: () => ({ functionality: 9.0 })
  });
  const o = result.output as { diversityCheck: string };
  assert.equal(o.diversityCheck, 'fail');
});
