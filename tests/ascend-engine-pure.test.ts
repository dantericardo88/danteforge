import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapDimIdToScoringDimension } from '../src/core/ascend-engine.js';

describe('mapDimIdToScoringDimension', () => {
  it('maps camelCase dimension id directly', () => {
    const result = mapDimIdToScoringDimension('functionality');
    assert.equal(result, 'functionality');
  });

  it('converts snake_case to camelCase', () => {
    const result = mapDimIdToScoringDimension('error_handling');
    assert.equal(result, 'errorHandling');
  });

  it('maps testing dimension', () => {
    const result = mapDimIdToScoringDimension('testing');
    assert.equal(result, 'testing');
  });

  it('maps specDrivenPipeline', () => {
    const result = mapDimIdToScoringDimension('spec_driven_pipeline');
    assert.equal(result, 'specDrivenPipeline');
  });

  it('maps autonomy', () => {
    const result = mapDimIdToScoringDimension('autonomy');
    assert.equal(result, 'autonomy');
  });

  it('returns null for unknown dimension', () => {
    const result = mapDimIdToScoringDimension('nonexistent_dim');
    assert.equal(result, null);
  });

  it('returns null for empty string', () => {
    const result = mapDimIdToScoringDimension('');
    assert.equal(result, null);
  });
});
