import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyErrorMessage, structuredError, toStructuredError } from '../src/core/mcp-error.js';
import { errorResult } from '../src/core/mcp-server.js';

test('classifyErrorMessage maps legacy messages to stable codes (+ the offending param)', () => {
  assert.deepEqual(classifyErrorMessage('Missing required parameter: artifact'), { code: 'missing_parameter', param: 'artifact' });
  assert.equal(classifyErrorMessage('value must be one of: a, b').code, 'invalid_parameter');
  assert.equal(classifyErrorMessage('Unknown gate: foo. Valid gates: x').code, 'not_found');
  assert.equal(classifyErrorMessage('Artifact not found: SPEC.md').code, 'not_found');
  assert.equal(classifyErrorMessage('constitution gate requires a constitution').code, 'gate_blocked');
  assert.equal(classifyErrorMessage('rate limit exceeded').code, 'rate_limited');
  assert.equal(classifyErrorMessage('boom: ENOENT something broke').code, 'internal');
});

test('structuredError attaches an actionable hint + a correct retriable flag per code', () => {
  const rl = structuredError('rate_limited', 'too many');
  assert.equal(rl.retriable, true);
  assert.ok(rl.hint.length > 0);
  assert.equal(structuredError('missing_parameter', 'x').retriable, false);
  assert.equal(structuredError('internal', 'x').retriable, true);
});

test('toStructuredError upgrades a string and passes a structured error through unchanged', () => {
  const up = toStructuredError('Missing required parameter: gate');
  assert.equal(up.code, 'missing_parameter');
  assert.equal(up.param, 'gate');
  const already = structuredError('not_found', 'x');
  assert.equal(toStructuredError(already), already);
});

test('errorResult is BACKWARD-COMPATIBLE (error stays a string) AND structured (code/param/hint/retriable)', () => {
  const r = errorResult('Missing required parameter: artifact');
  assert.equal(r.isError, true);
  const payload = JSON.parse(r.content[0]!.text as string);
  assert.equal(typeof payload.error, 'string');                  // existing callers do result.error.includes(...)
  assert.match(payload.error, /Missing required parameter/);
  assert.equal(payload.code, 'missing_parameter');               // new: machine-readable category
  assert.equal(payload.param, 'artifact');
  assert.equal(payload.retriable, false);
  assert.ok(payload.hint.length > 0);
});

test('errorResult accepts an explicit structured error (a gate block)', () => {
  const r = errorResult(structuredError('gate_blocked', 'spec gate: SPEC.md must exist', { param: 'SPEC.md' }));
  const payload = JSON.parse(r.content[0]!.text as string);
  assert.equal(payload.code, 'gate_blocked');
  assert.equal(payload.param, 'SPEC.md');
  assert.equal(payload.retriable, false);
});
