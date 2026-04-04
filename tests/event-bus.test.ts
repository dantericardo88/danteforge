// Event Bus — tests for subscribe/emit/unsubscribe lifecycle,
// multiple subscribers, SSE formatting, and convenience emitters.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventBus,
  formatSSEEvent,
  emitWaveStart,
  emitTaskStart,
  emitTaskComplete,
  emitLLMCall,
  emitScoreUpdate,
  emitCycleComplete,
  emitPhaseComplete,
  type ProgressEvent,
} from '../src/core/event-bus.js';

beforeEach(() => eventBus.clear());

// ── emit / on ─────────────────────────────────────────────────────────────────

describe('eventBus.emit / on', () => {
  it('handler receives emitted event', () => {
    const received: ProgressEvent[] = [];
    eventBus.on((e) => received.push(e));
    eventBus.emit({ type: 'task-start', timestamp: 'ts', taskName: 'test' });
    assert.equal(received.length, 1);
    assert.equal(received[0]!.type, 'task-start');
    assert.equal(received[0]!.taskName, 'test');
  });

  it('multiple subscribers all receive the event', () => {
    const calls: number[] = [];
    eventBus.on(() => calls.push(1));
    eventBus.on(() => calls.push(2));
    eventBus.on(() => calls.push(3));
    eventBus.emit({ type: 'llm-call', timestamp: 'ts', provider: 'claude' });
    assert.deepEqual(calls.sort(), [1, 2, 3]);
  });

  it('subscriberCount increases with each on()', () => {
    assert.equal(eventBus.subscriberCount, 0);
    eventBus.on(() => {});
    assert.equal(eventBus.subscriberCount, 1);
    eventBus.on(() => {});
    assert.equal(eventBus.subscriberCount, 2);
  });
});

// ── unsubscribe ───────────────────────────────────────────────────────────────

describe('unsubscribe', () => {
  it('unsubscribe function prevents further delivery', () => {
    const received: ProgressEvent[] = [];
    const unsub = eventBus.on((e) => received.push(e));

    eventBus.emit({ type: 'task-start', timestamp: 'ts' });
    assert.equal(received.length, 1);

    unsub(); // unsubscribe
    eventBus.emit({ type: 'task-start', timestamp: 'ts' });
    assert.equal(received.length, 1, 'Should not receive after unsubscribe');
  });

  it('subscriberCount decreases after unsubscribe', () => {
    const unsub = eventBus.on(() => {});
    assert.equal(eventBus.subscriberCount, 1);
    unsub();
    assert.equal(eventBus.subscriberCount, 0);
  });
});

// ── clear ─────────────────────────────────────────────────────────────────────

describe('eventBus.clear', () => {
  it('removes all subscribers', () => {
    eventBus.on(() => {});
    eventBus.on(() => {});
    assert.equal(eventBus.subscriberCount, 2);
    eventBus.clear();
    assert.equal(eventBus.subscriberCount, 0);
  });
});

// ── error isolation ───────────────────────────────────────────────────────────

describe('error isolation', () => {
  it('failing handler does not prevent other handlers from running', () => {
    let secondHandlerCalled = false;
    eventBus.on(() => { throw new Error('handler error'); });
    eventBus.on(() => { secondHandlerCalled = true; });

    // Should not throw
    eventBus.emit({ type: 'phase-complete', timestamp: 'ts', phase: 'forge' });
    assert.equal(secondHandlerCalled, true, 'Second handler should still run');
  });
});

// ── formatSSEEvent ────────────────────────────────────────────────────────────

describe('formatSSEEvent', () => {
  it('produces text/event-stream format with data: prefix', () => {
    const event: ProgressEvent = { type: 'cycle-complete', timestamp: '2026-04-04T00:00:00Z', cycle: 3, score: 8.5 };
    const formatted = formatSSEEvent(event);
    assert.ok(formatted.startsWith('data: '), 'Must start with data: prefix');
    assert.ok(formatted.endsWith('\n\n'), 'Must end with double newline');
  });

  it('event content is valid JSON', () => {
    const event: ProgressEvent = { type: 'wave-start', timestamp: 'ts', wave: 1, total: 5 };
    const formatted = formatSSEEvent(event);
    const jsonPart = formatted.slice('data: '.length).trim();
    const parsed = JSON.parse(jsonPart) as ProgressEvent;
    assert.equal(parsed.type, 'wave-start');
    assert.equal(parsed.wave, 1);
  });
});

// ── convenience emitters ──────────────────────────────────────────────────────

describe('convenience emitters', () => {
  it('emitWaveStart produces wave-start event', () => {
    const events: ProgressEvent[] = [];
    eventBus.on((e) => events.push(e));
    emitWaveStart(2, 10);
    assert.equal(events[0]!.type, 'wave-start');
    assert.equal(events[0]!.wave, 2);
    assert.equal(events[0]!.total, 10);
  });

  it('emitTaskStart produces task-start event', () => {
    const events: ProgressEvent[] = [];
    eventBus.on((e) => events.push(e));
    emitTaskStart('Build auth module');
    assert.equal(events[0]!.type, 'task-start');
    assert.equal(events[0]!.taskName, 'Build auth module');
  });

  it('emitTaskComplete produces task-complete event with optional score', () => {
    const events: ProgressEvent[] = [];
    eventBus.on((e) => events.push(e));
    emitTaskComplete('Deploy', 9.2);
    assert.equal(events[0]!.type, 'task-complete');
    assert.equal(events[0]!.score, 9.2);
  });

  it('emitLLMCall produces llm-call event', () => {
    const events: ProgressEvent[] = [];
    eventBus.on((e) => events.push(e));
    emitLLMCall('claude');
    assert.equal(events[0]!.type, 'llm-call');
    assert.equal(events[0]!.provider, 'claude');
  });

  it('emitScoreUpdate produces score-update event', () => {
    const events: ProgressEvent[] = [];
    eventBus.on((e) => events.push(e));
    emitScoreUpdate('testing', 8.5);
    assert.equal(events[0]!.type, 'score-update');
    assert.equal(events[0]!.dimension, 'testing');
    assert.equal(events[0]!.score, 8.5);
  });

  it('emitCycleComplete produces cycle-complete event', () => {
    const events: ProgressEvent[] = [];
    eventBus.on((e) => events.push(e));
    emitCycleComplete(5, 9.1);
    assert.equal(events[0]!.type, 'cycle-complete');
    assert.equal(events[0]!.cycle, 5);
    assert.equal(events[0]!.score, 9.1);
  });

  it('emitPhaseComplete produces phase-complete event', () => {
    const events: ProgressEvent[] = [];
    eventBus.on((e) => events.push(e));
    emitPhaseComplete('verify');
    assert.equal(events[0]!.type, 'phase-complete');
    assert.equal(events[0]!.phase, 'verify');
  });

  it('each emitter includes a timestamp', () => {
    const events: ProgressEvent[] = [];
    eventBus.on((e) => events.push(e));
    emitWaveStart(1, 3);
    assert.ok(events[0]!.timestamp.length > 0);
  });
});
