// Tests for PreToolUse adapter (PRD-26 / Article XIV)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decidePendingCommand,
  filterOutput,
} from '../src/core/context-economy/pretool-adapter.js';
import { CommandFilterRegistry } from '../src/core/context-economy/command-filter-registry.js';
import type { LedgerRecord } from '../src/core/context-economy/economy-ledger.js';

const noopLedger = async (_r: LedgerRecord, _cwd: string) => {};

// ── decidePendingCommand ──────────────────────────────────────────────────────

describe('decidePendingCommand', () => {
  it('returns filter for known git command', () => {
    const decision = decidePendingCommand('git status');
    assert.equal(decision.action, 'filter');
    assert.equal(decision.filterId, 'git');
  });

  it('returns passthrough for unknown command', () => {
    const decision = decidePendingCommand('kubectl get pods');
    assert.equal(decision.action, 'passthrough');
  });

  it('returns passthrough for heredoc (unsafe shell form)', () => {
    const decision = decidePendingCommand('cat <<EOF\nhello\nEOF');
    assert.equal(decision.action, 'passthrough');
    assert.ok(decision.reason?.includes('unsafe'));
  });

  it('returns passthrough for pipe with process substitution', () => {
    const decision = decidePendingCommand('git diff $(cat ref.txt)');
    assert.equal(decision.action, 'passthrough');
  });

  it('returns filter for npm ci', () => {
    const decision = decidePendingCommand('npm ci');
    assert.equal(decision.action, 'filter');
    assert.equal(decision.filterId, 'npm');
  });

  it('returns filter for cargo build', () => {
    const decision = decidePendingCommand('cargo build');
    assert.equal(decision.action, 'filter');
    assert.equal(decision.filterId, 'cargo');
  });
});

// ── filterOutput ─────────────────────────────────────────────────────────────

describe('filterOutput', () => {
  it('filters git status output and strips hint lines', async () => {
    const output = 'hint: Use --set-upstream next time\nOn branch main\nnothing to commit';
    const result = await filterOutput('git status', output, { writeLedger: false });
    assert.ok(!result.output.includes('hint:'));
  });

  it('returns passthrough for unknown command with input unchanged', async () => {
    const output = 'some arbitrary output from unknown tool';
    const result = await filterOutput('kubectl get pods', output, { writeLedger: false });
    assert.equal(result.status, 'passthrough');
    assert.equal(result.output, output);
  });

  it('fail-closed: returns raw output on filter exception', async () => {
    // 'mytoolx' has no built-in filter, so the crash filter is reached first.
    const badRegistry = new CommandFilterRegistry([{
      filterId: 'boom',
      detect: (cmd) => cmd === 'mytoolx',
      filter: () => { throw new Error('simulated crash'); },
    }]);
    const output = 'mytoolx output data';
    const result = await filterOutput('mytoolx', output, {
      writeLedger: false,
      _registry: badRegistry,
    });
    assert.equal(result.status, 'filter-failed');
    assert.equal(result.output, output);
  });

  it('writes ledger record when writeLedger is true', async () => {
    const records: LedgerRecord[] = [];
    const captureLedger = async (r: LedgerRecord) => { records.push(r); };
    const output = 'hint: stale message\nOn branch main\nnothing to commit';
    await filterOutput('git status', output, {
      writeLedger: true,
      _ledgerWriter: captureLedger,
    });
    assert.equal(records.length, 1);
    assert.equal(records[0].filterId, 'git');
  });

  it('does not write ledger when writeLedger is false', async () => {
    const records: LedgerRecord[] = [];
    const captureLedger = async (r: LedgerRecord) => { records.push(r); };
    await filterOutput('git status', 'some output', {
      writeLedger: false,
      _ledgerWriter: captureLedger,
    });
    assert.equal(records.length, 0);
  });

  it('sacred-bypass status preserved when output has errors', async () => {
    const output = 'error: failed to push refs to origin\n fatal: repository not found';
    const result = await filterOutput('git push', output, { writeLedger: false });
    assert.equal(result.status, 'sacred-bypass');
    assert.ok(result.output.includes('error'));
  });
});

// suppress unused import warning
void noopLedger;
