import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAddressedActor,
  attributionAligned,
  attributionCeiling,
  ATTRIBUTION_MISMATCH_CEILING,
} from '../src/core/attribution-gate.js';

// --- the two REAL harvested demand texts (the cases that motivated this gate) ---

test('REAL #8797 → addressed actor is HOST (the host ignores server instructions; the host must change)', () => {
  const text = 'MCP Host/Client Ignore MCP Server-level Instructions. If you use Cline with this MCP server, '
    + 'the host will never honor the server-level instruction telling it the top secret must not be revealed.';
  assert.equal(classifyAddressedActor(text), 'host');
});

test('REAL #8087 → addressed actor is SERVER (ephemeral server keys; the server must change)', () => {
  const text = 'MCP tool IDs use ephemeral server keys, breaking routing after reconnect/restart. Tool identity '
    + 'prefix should be stable across reconnects (a configured server key/name) so cached schemas do not break.';
  assert.equal(classifyAddressedActor(text), 'server');
});

// --- classifier behavior ---

test('no actor words → unknown (deferred to the court, never structurally capped)', () => {
  assert.equal(classifyAddressedActor('please make the progress bar update more smoothly'), 'unknown');
  assert.equal(classifyAddressedActor(''), 'unknown');
  assert.equal(classifyAddressedActor(undefined), 'unknown');
});

test('a clear CLI fault classifies as cli', () => {
  assert.equal(classifyAddressedActor('the CLI fails to read image files; the command-line tool cannot view PNGs'), 'cli');
});

test('a true tie returns unknown (conservative — defer to the court)', () => {
  // one server mention, one host mention, neither adjacent to a fault word → tie → unknown
  assert.equal(classifyAddressedActor('the server and the host exchange a handshake'), 'unknown');
});

// --- alignment + the structural ceiling ---

test('the #8797 case (host demand, server artifact) is a MISMATCH → capped at 8.5', () => {
  const addressed = classifyAddressedActor('MCP host ignores server instructions; the host must honor them');
  assert.equal(addressed, 'host');
  const c = attributionCeiling(addressed, 'server');
  assert.equal(c.capped, true);
  assert.equal(c.ceiling, ATTRIBUTION_MISMATCH_CEILING);
  assert.equal(c.ceiling, 8.5);
  assert.match(c.reason, /addressed actor.*host.*artifact actor.*server/i);
});

test('the #8087 case (server demand, server artifact) ALIGNS → no cap, 9.0 reachable', () => {
  assert.equal(attributionAligned('server', 'server'), true);
  const c = attributionCeiling('server', 'server');
  assert.equal(c.capped, false);
  assert.equal(c.ceiling, 9.0);
});

test('unknown on either side aligns (the court still judges; no silent structural cap)', () => {
  assert.equal(attributionAligned('unknown', 'server'), true);
  assert.equal(attributionAligned('host', 'unknown'), true);
  assert.equal(attributionCeiling('unknown', 'server').capped, false);
});

test('every cross-actor pair of KNOWN distinct actors is capped', () => {
  const known = ['host', 'server', 'cli', 'library', 'agent'] as const;
  for (const a of known) {
    for (const b of known) {
      const c = attributionCeiling(a, b);
      if (a === b) assert.equal(c.capped, false, `${a}==${b} should align`);
      else assert.equal(c.capped, true, `${a}!=${b} should cap`);
    }
  }
});
