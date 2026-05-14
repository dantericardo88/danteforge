// audit-aggregator.test.ts — Tests for src/core/audit-aggregator.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAuditLog,
  computeAuditSummary,
  formatAuditSummary,
  filterByActor,
  filterByTimeRange,
  type AuditEvent,
} from '../src/core/audit-aggregator.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    timestamp: '2026-05-14T10:00:00Z',
    action: 'forge',
    actor: 'system',
    result: 'success',
    ...overrides,
  };
}

// ── parseAuditLog ──────────────────────────────────────────────────────────────

describe('parseAuditLog', () => {
  it('handles empty array', () => {
    const result = parseAuditLog([]);
    assert.deepEqual(result, []);
  });

  it('handles non-array input gracefully', () => {
    // @ts-expect-error — intentional bad input
    const result = parseAuditLog(null);
    assert.deepEqual(result, []);
  });

  it('parses object-form entries', () => {
    const raw = [
      {
        timestamp: '2026-05-14T10:00:00Z',
        action: 'verify',
        actor: 'ci',
        result: 'success',
      },
    ];
    const [event] = parseAuditLog(raw);
    assert.ok(event);
    assert.strictEqual(event.action, 'verify');
    assert.strictEqual(event.actor, 'ci');
    assert.strictEqual(event.result, 'success');
  });

  it('parses pipe-delimited string entries', () => {
    const raw = ['2026-05-14T10:00:00Z | alice | forge: success'];
    const [event] = parseAuditLog(raw);
    assert.ok(event);
    assert.strictEqual(event.actor, 'alice');
    assert.strictEqual(event.action, 'forge');
  });

  it('parses dash-delimited legacy string entries', () => {
    const raw = ['2026-05-14T10:00:00Z — verify: pass'];
    const [event] = parseAuditLog(raw);
    assert.ok(event);
    assert.strictEqual(event.action, 'verify');
  });

  it('drops null and undefined entries silently', () => {
    const raw = [null, undefined, makeEvent()];
    const result = parseAuditLog(raw);
    assert.strictEqual(result.length, 1);
  });

  it('normalises "fail" result to "failure"', () => {
    const raw = [{ timestamp: '2026-05-14T00:00:00Z', action: 'test', actor: 'ci', result: 'fail' }];
    const [event] = parseAuditLog(raw);
    assert.strictEqual(event?.result, 'failure');
  });

  it('normalises "warn" result to "warning"', () => {
    const raw = [{ timestamp: '2026-05-14T00:00:00Z', action: 'lint', actor: 'ci', result: 'warn' }];
    const [event] = parseAuditLog(raw);
    assert.strictEqual(event?.result, 'warning');
  });
});

// ── computeAuditSummary ────────────────────────────────────────────────────────

describe('computeAuditSummary', () => {
  it('returns zeroed summary for empty events array', () => {
    const summary = computeAuditSummary([]);
    assert.strictEqual(summary.totalEvents, 0);
    assert.strictEqual(summary.successRate, 0);
    assert.deepEqual(summary.topActions, []);
    assert.deepEqual(summary.recentFailures, []);
    assert.strictEqual(summary.timeRange, null);
  });

  it('calculates successRate correctly — all successes', () => {
    const events = [
      makeEvent({ result: 'success' }),
      makeEvent({ result: 'success' }),
    ];
    const { successRate } = computeAuditSummary(events);
    assert.strictEqual(successRate, 100);
  });

  it('calculates successRate correctly — mixed', () => {
    const events = [
      makeEvent({ result: 'success' }),
      makeEvent({ result: 'failure' }),
      makeEvent({ result: 'success' }),
      makeEvent({ result: 'failure' }),
    ];
    const { successRate } = computeAuditSummary(events);
    assert.strictEqual(successRate, 50);
  });

  it('topActions are sorted by count descending', () => {
    const events: AuditEvent[] = [
      makeEvent({ action: 'forge' }),
      makeEvent({ action: 'forge' }),
      makeEvent({ action: 'verify' }),
      makeEvent({ action: 'forge' }),
      makeEvent({ action: 'verify' }),
      makeEvent({ action: 'lint' }),
    ];
    const { topActions } = computeAuditSummary(events);
    assert.strictEqual(topActions[0]!.action, 'forge');
    assert.strictEqual(topActions[0]!.count, 3);
    assert.strictEqual(topActions[1]!.action, 'verify');
    assert.strictEqual(topActions[1]!.count, 2);
  });

  it('recentFailures includes only failure events', () => {
    const events: AuditEvent[] = [
      makeEvent({ result: 'success', timestamp: '2026-05-14T10:00:00Z' }),
      makeEvent({ result: 'failure', timestamp: '2026-05-14T11:00:00Z', action: 'build' }),
      makeEvent({ result: 'failure', timestamp: '2026-05-14T12:00:00Z', action: 'test' }),
    ];
    const { recentFailures } = computeAuditSummary(events);
    assert.strictEqual(recentFailures.length, 2);
    assert.ok(recentFailures.every(e => e.result === 'failure'));
  });

  it('timeRange covers the full chronological span', () => {
    const events: AuditEvent[] = [
      makeEvent({ timestamp: '2026-05-14T12:00:00Z' }),
      makeEvent({ timestamp: '2026-05-14T08:00:00Z' }),
      makeEvent({ timestamp: '2026-05-14T20:00:00Z' }),
    ];
    const { timeRange } = computeAuditSummary(events);
    assert.ok(timeRange !== null);
    assert.strictEqual(timeRange.from, '2026-05-14T08:00:00Z');
    assert.strictEqual(timeRange.to, '2026-05-14T20:00:00Z');
  });

  it('totalEvents matches input length', () => {
    const events = [makeEvent(), makeEvent(), makeEvent()];
    const { totalEvents } = computeAuditSummary(events);
    assert.strictEqual(totalEvents, 3);
  });
});

// ── filterByActor ──────────────────────────────────────────────────────────────

describe('filterByActor', () => {
  const events: AuditEvent[] = [
    makeEvent({ actor: 'alice' }),
    makeEvent({ actor: 'bob' }),
    makeEvent({ actor: 'Alice' }), // same actor, different case
  ];

  it('filters correctly by actor (case-insensitive)', () => {
    const result = filterByActor(events, 'alice');
    assert.strictEqual(result.length, 2);
  });

  it('returns empty array when actor has no events', () => {
    const result = filterByActor(events, 'carol');
    assert.strictEqual(result.length, 0);
  });

  it('is case-insensitive', () => {
    const result = filterByActor(events, 'BOB');
    assert.strictEqual(result.length, 1);
  });
});

// ── filterByTimeRange ──────────────────────────────────────────────────────────

describe('filterByTimeRange', () => {
  const events: AuditEvent[] = [
    makeEvent({ timestamp: '2026-05-14T08:00:00Z', action: 'early' }),
    makeEvent({ timestamp: '2026-05-14T12:00:00Z', action: 'noon' }),
    makeEvent({ timestamp: '2026-05-14T20:00:00Z', action: 'late' }),
  ];

  it('returns events within the range (inclusive bounds)', () => {
    const result = filterByTimeRange(events, '2026-05-14T08:00:00Z', '2026-05-14T12:00:00Z');
    assert.strictEqual(result.length, 2);
    assert.ok(result.some(e => e.action === 'early'));
    assert.ok(result.some(e => e.action === 'noon'));
  });

  it('excludes events outside the range', () => {
    const result = filterByTimeRange(events, '2026-05-14T09:00:00Z', '2026-05-14T15:00:00Z');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.action, 'noon');
  });

  it('returns empty array when range matches nothing', () => {
    const result = filterByTimeRange(events, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    assert.strictEqual(result.length, 0);
  });

  it('returns empty array for invalid from/to strings', () => {
    const result = filterByTimeRange(events, 'not-a-date', '2026-05-14T20:00:00Z');
    assert.deepEqual(result, []);
  });

  it('returns all events when range spans entire set', () => {
    const result = filterByTimeRange(events, '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z');
    assert.strictEqual(result.length, events.length);
  });
});

// ── formatAuditSummary ─────────────────────────────────────────────────────────

describe('formatAuditSummary', () => {
  it('returns a non-empty markdown string', () => {
    const events = [makeEvent(), makeEvent({ result: 'failure', action: 'test' })];
    const summary = computeAuditSummary(events);
    const md = formatAuditSummary(summary);
    assert.ok(typeof md === 'string' && md.length > 0);
    assert.ok(md.includes('## Audit Summary'));
  });

  it('includes "No audit events" message for empty summary', () => {
    const md = formatAuditSummary(computeAuditSummary([]));
    assert.ok(md.includes('No audit events'));
  });
});
