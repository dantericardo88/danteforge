import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TODO_RE } from '../src/core/frontier-spec.js';

// Regression (2026-06-23): TODO_RE = /TODO/i matched "TODO" ANYWHERE, so a legitimate researched frontier bar
// describing what governance BLOCKS — "...blocks merge with stub/TODO, and completion without passing outcomes"
// — was falsely flagged as an unfilled placeholder and the spec could not be frozen. The fix anchors it to the
// START of the field, since every `frontier-spec init` placeholder begins with "TODO" and a real field never does.
test('TODO_RE catches init placeholder sentinels (they all START with TODO)', () => {
  assert.ok(TODO_RE.test('TODO: name the real tracked competitor to match or beat'));
  assert.ok(TODO_RE.test('TODO: the beyond-parity capability that takes this past X'));
  assert.ok(TODO_RE.test('TODO: src/... the production file this run exercises'));
  assert.ok(TODO_RE.test('TODO'));            // observable_artifacts kind sentinel
  assert.ok(TODO_RE.test('  TODO: indented'));// leading whitespace tolerated
});

test('TODO_RE does NOT flag a legitimate bar that mentions TODO in prose', () => {
  assert.equal(TODO_RE.test('...blocks merge with stub/TODO, and completion without passing outcomes'), false);
  assert.equal(TODO_RE.test('Provider-agnostic governance routes score proposals and merge attempts (stub/TODO rejected)'), false);
  assert.equal(TODO_RE.test('a real authored capability description'), false);
});
