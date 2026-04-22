// Tests for wiki-schema constants and type guards
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WIKI_DIR,
  RAW_DIR,
  CONSTITUTION_DIR,
  AUDIT_LOG_FILE,
  RAW_MANIFEST_FILE,
  PDSE_HISTORY_FILE,
  WIKI_INDEX_FILE,
  CONSTITUTION_HASH_FILE,
  LINT_REPORT_FILE,
  ANOMALY_THRESHOLD,
  STALENESS_DAYS,
  LINT_INTERVAL_CYCLES,
  WIKI_TIER0_TOKEN_BUDGET,
  PDSE_HISTORY_WINDOW,
  FUZZY_MATCH_THRESHOLD,
} from '../src/core/wiki-schema.js';

describe('wiki-schema constants', () => {
  it('WIKI_DIR is nested under .danteforge', () => {
    assert.ok(WIKI_DIR.startsWith('.danteforge/'));
    assert.equal(WIKI_DIR, '.danteforge/wiki');
  });

  it('RAW_DIR is nested under .danteforge', () => {
    assert.equal(RAW_DIR, '.danteforge/raw');
  });

  it('CONSTITUTION_DIR is nested under .danteforge', () => {
    assert.equal(CONSTITUTION_DIR, '.danteforge/constitution');
  });

  it('AUDIT_LOG_FILE is inside wiki dir and ends in .jsonl', () => {
    assert.ok(AUDIT_LOG_FILE.includes('wiki'));
    assert.ok(AUDIT_LOG_FILE.endsWith('.jsonl'));
  });

  it('RAW_MANIFEST_FILE is inside raw dir', () => {
    assert.ok(RAW_MANIFEST_FILE.includes('raw'));
    assert.ok(RAW_MANIFEST_FILE.endsWith('.json'));
  });

  it('PDSE_HISTORY_FILE is inside wiki dir', () => {
    assert.ok(PDSE_HISTORY_FILE.includes('wiki'));
    assert.ok(PDSE_HISTORY_FILE.endsWith('.md'));
  });

  it('WIKI_INDEX_FILE is inside wiki dir', () => {
    assert.ok(WIKI_INDEX_FILE.includes('wiki'));
    assert.ok(WIKI_INDEX_FILE.endsWith('.md'));
  });

  it('CONSTITUTION_HASH_FILE is inside constitution dir', () => {
    assert.ok(CONSTITUTION_HASH_FILE.includes('constitution'));
    assert.ok(CONSTITUTION_HASH_FILE.endsWith('.json'));
  });

  it('LINT_REPORT_FILE is inside wiki dir', () => {
    assert.ok(LINT_REPORT_FILE.includes('wiki'));
    assert.ok(LINT_REPORT_FILE.endsWith('.md'));
  });

  it('ANOMALY_THRESHOLD is 15', () => {
    assert.equal(ANOMALY_THRESHOLD, 15);
  });

  it('STALENESS_DAYS is 30', () => {
    assert.equal(STALENESS_DAYS, 30);
  });

  it('LINT_INTERVAL_CYCLES is 5', () => {
    assert.equal(LINT_INTERVAL_CYCLES, 5);
  });

  it('WIKI_TIER0_TOKEN_BUDGET is 2000', () => {
    assert.equal(WIKI_TIER0_TOKEN_BUDGET, 2000);
  });

  it('PDSE_HISTORY_WINDOW is 5', () => {
    assert.equal(PDSE_HISTORY_WINDOW, 5);
  });

  it('FUZZY_MATCH_THRESHOLD is between 0 and 1', () => {
    assert.ok(FUZZY_MATCH_THRESHOLD > 0);
    assert.ok(FUZZY_MATCH_THRESHOLD < 1);
  });
});
