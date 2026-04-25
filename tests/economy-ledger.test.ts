// Tests for economy-ledger (PRD-26 / Article XIV)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildLedgerRecord,
  appendLedgerRecord,
  loadLedgerRecords,
  loadAllLedgerRecords,
  summarizeLedger,
  formatLedgerReport,
} from '../src/core/context-economy/economy-ledger.js';
import type { LedgerRecord } from '../src/core/context-economy/economy-ledger.js';

// ── buildLedgerRecord ────────────────────────────────────────────────────────

describe('buildLedgerRecord', () => {
  it('computes savedTokens as inputTokens - outputTokens', () => {
    const r = buildLedgerRecord('forge', 'git status', 'git', 200, 80, 0, 'filtered');
    assert.equal(r.savedTokens, 120);
  });

  it('computes savingsPercent correctly', () => {
    const r = buildLedgerRecord('forge', 'npm install', 'npm', 100, 40, 0, 'filtered');
    assert.equal(r.savingsPercent, 60);
  });

  it('clamps savedTokens to 0 when output exceeds input', () => {
    const r = buildLedgerRecord('forge', 'find .', 'find', 50, 100, 0, 'low-yield');
    assert.equal(r.savedTokens, 0);
  });

  it('sets ruleSource to built-in', () => {
    const r = buildLedgerRecord('forge', 'git log', 'git', 100, 60, 0, 'filtered');
    assert.equal(r.ruleSource, 'built-in');
  });

  it('sets status from argument', () => {
    const r = buildLedgerRecord('forge', 'cargo build', 'cargo', 100, 100, 2, 'sacred-bypass');
    assert.equal(r.status, 'sacred-bypass');
  });

  it('sets timestamp as ISO string', () => {
    const r = buildLedgerRecord('forge', 'git status', 'git', 50, 30, 0, 'filtered');
    assert.ok(!isNaN(Date.parse(r.timestamp)));
  });

  it('includes rawEvidenceHash when rawContent provided', () => {
    const r = buildLedgerRecord('forge', 'git diff', 'git', 100, 50, 0, 'filtered', 'raw content here');
    assert.ok(typeof r.rawEvidenceHash === 'string');
    assert.ok(r.rawEvidenceHash!.length > 0);
  });
});

// ── appendLedgerRecord / loadLedgerRecords ────────────────────────────────────

describe('appendLedgerRecord + loadLedgerRecords', () => {
  let tmpDir: string;

  before(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-test-')); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('round-trips a record through append + load', async () => {
    const record = buildLedgerRecord('forge', 'git status', 'git', 200, 80, 0, 'filtered');
    await appendLedgerRecord(record, tmpDir);
    const loaded = await loadLedgerRecords(tmpDir);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].command, 'git status');
    assert.equal(loaded[0].filterId, 'git');
    assert.equal(loaded[0].savedTokens, 120);
  });

  it('appends multiple records to the same file', async () => {
    const tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-multi-'));
    try {
      await appendLedgerRecord(buildLedgerRecord('forge', 'npm ci', 'npm', 300, 100, 0, 'filtered'), tmpDir2);
      await appendLedgerRecord(buildLedgerRecord('forge', 'git log', 'git', 150, 90, 0, 'filtered'), tmpDir2);
      const loaded = await loadLedgerRecords(tmpDir2);
      assert.equal(loaded.length, 2);
    } finally {
      await fs.rm(tmpDir2, { recursive: true, force: true });
    }
  });

  it('returns empty array when ledger file does not exist', async () => {
    const empty = await loadLedgerRecords(tmpDir, '1900-01-01');
    assert.equal(empty.length, 0);
  });
});

// ── loadAllLedgerRecords ──────────────────────────────────────────────────────

describe('loadAllLedgerRecords', () => {
  let tmpDir: string;

  before(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-all-')); });
  after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('returns empty array from empty dir', async () => {
    const records = await loadAllLedgerRecords(tmpDir);
    assert.equal(records.length, 0);
  });

  it('loads records across multiple day files', async () => {
    await appendLedgerRecord(buildLedgerRecord('forge', 'git status', 'git', 100, 50, 0, 'filtered'), tmpDir);
    const records = await loadAllLedgerRecords(tmpDir);
    assert.ok(records.length >= 1);
  });
});

// ── summarizeLedger ───────────────────────────────────────────────────────────

describe('summarizeLedger', () => {
  const makeRecord = (status: LedgerRecord['status'], savedTokens: number): LedgerRecord => ({
    timestamp: new Date().toISOString(),
    organ: 'forge',
    command: 'git status',
    filterId: 'git',
    inputTokens: 100,
    outputTokens: 100 - savedTokens,
    savedTokens,
    savingsPercent: savedTokens,
    sacredSpanCount: 0,
    status,
    ruleSource: 'built-in',
  });

  it('counts statuses correctly', () => {
    const records = [
      makeRecord('filtered', 60),
      makeRecord('passthrough', 0),
      makeRecord('sacred-bypass', 0),
      makeRecord('filter-failed', 0),
      makeRecord('low-yield', 5),
    ];
    const summary = summarizeLedger(records);
    assert.equal(summary.filtered, 1);
    assert.equal(summary.passthrough, 1);
    assert.equal(summary.sacredBypass, 1);
    assert.equal(summary.filterFailed, 1);
    assert.equal(summary.lowYield, 1);
  });

  it('computes averageSavingsPercent correctly', () => {
    const records = [makeRecord('filtered', 60), makeRecord('filtered', 40)];
    const summary = summarizeLedger(records);
    assert.equal(summary.averageSavingsPercent, 50);
  });

  it('returns empty summary for zero records', () => {
    const summary = summarizeLedger([]);
    assert.equal(summary.totalRecords, 0);
    assert.equal(summary.averageSavingsPercent, 0);
  });
});

// ── formatLedgerReport ────────────────────────────────────────────────────────

describe('formatLedgerReport', () => {
  it('returns valid JSON in json mode', () => {
    const summary = summarizeLedger([]);
    const report = formatLedgerReport(summary, true);
    assert.doesNotThrow(() => JSON.parse(report));
  });

  it('human mode includes token savings line', () => {
    const records = [{
      timestamp: new Date().toISOString(), organ: 'forge', command: 'git status',
      filterId: 'git', inputTokens: 200, outputTokens: 80, savedTokens: 120,
      savingsPercent: 60, sacredSpanCount: 0, status: 'filtered' as const, ruleSource: 'built-in' as const,
    }];
    const summary = summarizeLedger(records);
    const report = formatLedgerReport(summary);
    assert.ok(report.includes('Tokens saved'));
    assert.ok(report.includes('120'));
  });
});
