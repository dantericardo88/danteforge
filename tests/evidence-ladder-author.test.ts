import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorEvidenceLadder } from '../src/core/evidence-ladder-author.js';

// The by-construction guards refuse thin/laundered evidence BEFORE any I/O (council 2026-06-23: substance,
// not three wrappers around one script). These are the anti-fabrication contract.
const rung = (command: string) => ({ command, artifact: 'out/x.json', description: 'demonstrates a capability' });
const base = { dimId: 'demo', callsite: 'src/core/frontier-spec.ts' };

test('refuses fewer than 3 rungs — a T7 ladder needs >=3 distinct demonstrations', async () => {
  const r = await authorEvidenceLadder({ ...base, rungs: [rung('node dist/index.js a'), rung('node dist/index.js b')] });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', />=3/);
  assert.equal(r.authored, 0); // refused before authoring anything
});

test('refuses cloned commands — a cloned command is one receipt, not multi-receipt consensus', async () => {
  const r = await authorEvidenceLadder({ ...base, rungs: [rung('node dist/index.js a'), rung('node dist/index.js a'), rung('node dist/index.js a')] });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /DISTINCT/);
});

test('refuses test-suite commands — they are capped at T4 and can never anchor T5+', async () => {
  const r = await authorEvidenceLadder({ ...base, rungs: [rung('npx tsx --test tests/a.test.ts'), rung('node dist/index.js b'), rung('node dist/index.js c')] });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /test-suite/);
});

test('passes input validation for 3 distinct product runs (then proceeds to real execution)', async () => {
  // 3 distinct product commands clear the by-construction guards; the call then proceeds to real authoring,
  // which will fail in this no-CLI test env — but NOT at the input-validation stage. We assert the refusal,
  // if any, is NOT one of the by-construction guards (i.e. the guards accepted the shape).
  const r = await authorEvidenceLadder({ ...base, rungs: [rung('node dist/index.js gap a'), rung('node dist/index.js outcomes'), rung('node dist/index.js status')] });
  assert.doesNotMatch(r.reason ?? '', />=3|DISTINCT|test-suite|not a recognizable product run/);
});
