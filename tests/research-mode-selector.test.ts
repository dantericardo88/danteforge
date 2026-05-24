// research-mode-selector.test.ts — coverage for the 7 activation criteria
// from PRD section 5 of docs/PRDs/autonomous-frontier-reaching.md.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isResearchActivated, selectCouncil } from '../src/matrix/research/mode-selector.ts';
import {
  CANONICAL_RESEARCH_ROLES,
  DEFAULT_RESEARCH_MODE_CONFIG,
  type ActivationInput,
  type ResearchStatus,
} from '../src/matrix/research/types.js';

function baseInput(overrides: Partial<ActivationInput> = {}): ActivationInput {
  return {
    dimensionId: 'testing',
    projectComposite: 8.0,
    dimDerivedScore: 7.0,
    achievedTier: 'T2',
    declaredCeiling: 'T4',
    hasActiveDispensation: false,
    researchStatus: {
      research_waves_completed: 0,
      consecutive_stuck_waves: 3,
      last_wave_outcome: null,
    } as ResearchStatus,
    ...overrides,
  };
}

describe('isResearchActivated — happy path', () => {
  it('activates when all 7 criteria pass', () => {
    const r = isResearchActivated(baseInput());
    assert.equal(r.shouldActivate, true);
    assert.ok(r.council && r.council.length > 0);
  });
});

describe('isResearchActivated — blocking criteria', () => {
  it('blocks when project composite below threshold', () => {
    const r = isResearchActivated(baseInput({ projectComposite: 7.0 }));
    assert.equal(r.shouldActivate, false);
    assert.match(r.blockingReason!, /composite/);
  });

  it('blocks when dim score below per_dim_score_range', () => {
    const r = isResearchActivated(baseInput({ dimDerivedScore: 5.0 }));
    assert.equal(r.shouldActivate, false);
    assert.match(r.blockingReason!, /outside research range/);
  });

  it('blocks when dim score above per_dim_score_range', () => {
    const r = isResearchActivated(baseInput({ dimDerivedScore: 9.0 }));
    assert.equal(r.shouldActivate, false);
    assert.match(r.blockingReason!, /outside research range/);
  });

  it('blocks when stuck_waves below threshold', () => {
    const r = isResearchActivated(baseInput({
      researchStatus: {
        research_waves_completed: 0,
        consecutive_stuck_waves: 1,
        last_wave_outcome: null,
      },
    }));
    assert.equal(r.shouldActivate, false);
    assert.match(r.blockingReason!, /stuck for only/);
  });

  it('blocks when achieved tier == declared ceiling (no room to grow)', () => {
    const r = isResearchActivated(baseInput({ achievedTier: 'T4', declaredCeiling: 'T4' }));
    assert.equal(r.shouldActivate, false);
    assert.match(r.blockingReason!, /declared_ceiling/);
  });

  it('blocks when an active dispensation is present', () => {
    const r = isResearchActivated(baseInput({ hasActiveDispensation: true }));
    assert.equal(r.shouldActivate, false);
    assert.match(r.blockingReason!, /dispensation/);
  });

  it('blocks when human_review_pending is true', () => {
    const r = isResearchActivated(baseInput({
      researchStatus: {
        research_waves_completed: 1,
        consecutive_stuck_waves: 3,
        human_review_pending: true,
        last_wave_outcome: 'conflict',
      },
    }));
    assert.equal(r.shouldActivate, false);
    assert.match(r.blockingReason!, /conflict/);
  });

  it('blocks when structural_cap_reason is set', () => {
    const r = isResearchActivated(baseInput({
      researchStatus: {
        research_waves_completed: 1,
        consecutive_stuck_waves: 3,
        structural_cap_reason: 'requires exchange-licensed data feeds',
        last_wave_outcome: 'cap',
      },
    }));
    assert.equal(r.shouldActivate, false);
    assert.match(r.blockingReason!, /capped/);
  });
});

describe('isResearchActivated — force override', () => {
  it('force=true skips all criteria', () => {
    const r = isResearchActivated(baseInput({
      projectComposite: 5.0,  // would fail
      hasActiveDispensation: true,  // would fail
      force: true,
    }));
    assert.equal(r.shouldActivate, true);
    assert.ok(r.council && r.council.length > 0);
  });
});

describe('selectCouncil — composition', () => {
  it('always includes benchmark-designer (first) and hybrid-synthesizer (last)', () => {
    const council = selectCouncil(baseInput(), DEFAULT_RESEARCH_MODE_CONFIG);
    assert.equal(council[0]!.id, 'benchmark-designer');
    assert.equal(council[council.length - 1]!.id, 'hybrid-synthesizer');
  });

  it('respects default_agent_count', () => {
    const council = selectCouncil(baseInput(), {
      ...DEFAULT_RESEARCH_MODE_CONFIG,
      default_agent_count: 4,
    });
    assert.equal(council.length, 4);
  });

  it('caps council size at max_agent_count', () => {
    const council = selectCouncil(baseInput(), {
      ...DEFAULT_RESEARCH_MODE_CONFIG,
      default_agent_count: 100,
      max_agent_count: 5,
    });
    assert.equal(council.length, 5);
  });

  it('canonical roles include all 10 from the PRD', () => {
    assert.equal(CANONICAL_RESEARCH_ROLES.length, 10);
    const ids = CANONICAL_RESEARCH_ROLES.map(r => r.id);
    for (const expected of [
      'benchmark-designer', 'literature-scout', 'frontier-reverse-engineer',
      'adversarial-critic', 'alternative-architect', 'cost-complexity-analyzer',
      'constitutional-reviewer', 'sovereignty-auditor', 'wiring-validator',
      'hybrid-synthesizer',
    ]) {
      assert.ok(ids.includes(expected), `missing canonical role: ${expected}`);
    }
  });
});
