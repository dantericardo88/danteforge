// cross-artifact-analysis.test.ts — coverage + ambiguity + unmapped, unified into one report,
// and persisted as the observable artifact the planning_quality Score Ladder (rung 8) requires.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findAmbiguities, findUnmappedTasks, buildCrossArtifactAnalysis, renderAnalysisMarkdown,
} from '../src/core/cross-artifact-analysis.js';
import { traceability } from '../src/cli/commands/traceability.js';

const SPEC = [
  '# Spec',
  '1. The system MUST authenticate users via OAuth.',
  '2. The system MUST store sessions in Redis cache.',
  'Rate limiting approach is NEEDS CLARIFICATION.',
].join('\n');

// task 1 covers req 1; req 2 is uncovered; the dark-mode task maps to no requirement (hidden scope).
const TASKS = [
  '1. Implement OAuth authenticate login flow for users',
  '2. Add a dark mode toggle to settings',
].join('\n');

describe('findAmbiguities', () => {
  test('counts NEEDS CLARIFICATION / TBD / ??? / FIXME, with line numbers', () => {
    const a = findAmbiguities('intro\nfoo TBD bar\nNEEDS CLARIFICATION here\nq???\nok line\nFIXME this');
    assert.equal(a.length, 4);
    assert.deepEqual(a.map(m => m.marker).sort(), ['???', 'FIXME', 'NEEDS CLARIFICATION', 'TBD']);
    assert.equal(a.find(m => m.marker === 'NEEDS CLARIFICATION')!.line, 3);
  });
  test('does NOT false-match substrings (established / fixmeister)', () => {
    assert.equal(findAmbiguities('this is well established\nfixmeister wrote it').length, 0);
  });
});

describe('findUnmappedTasks — inverts the scorer coverage (one source of truth)', () => {
  test('flags a task that covers no requirement, leaves a covering task alone', () => {
    const unmapped = findUnmappedTasks(SPEC, TASKS);
    assert.equal(unmapped.length, 1);
    assert.match(unmapped[0]!, /dark mode/);
  });
  test('no requirements → no unmapped (vacuously covered)', () => {
    assert.deepEqual(findUnmappedTasks('# notes\njust prose, no numbered reqs', TASKS), []);
  });
});

describe('buildCrossArtifactAnalysis', () => {
  test('unifies coverage + ambiguity + unmapped; clean only when all three pass', () => {
    const a = buildCrossArtifactAnalysis(SPEC, TASKS);
    assert.equal(a.coverage.uncoveredCount, 1, 'req 2 (Redis sessions) is uncovered');
    assert.equal(a.ambiguityCount, 1, 'one NEEDS CLARIFICATION');
    assert.equal(a.unmappedCount, 1, 'the dark-mode task is hidden scope');
    assert.equal(a.clean, false);
  });
  test('a fully consistent spec/plan is clean', () => {
    const spec = '1. The system MUST log every request with a timestamp.';
    const tasks = '1. Add request logging with timestamp for every system call';
    const a = buildCrossArtifactAnalysis(spec, tasks);
    assert.equal(a.coverage.uncoveredCount, 0);
    assert.equal(a.ambiguityCount, 0);
    assert.equal(a.unmappedCount, 0);
    assert.equal(a.clean, true);
  });
});

describe('renderAnalysisMarkdown', () => {
  test('renders coverage %, ambiguity, and unmapped sections', () => {
    const md = renderAnalysisMarkdown(buildCrossArtifactAnalysis(SPEC, TASKS));
    assert.match(md, /Requirement coverage: \*\*50%\*\*/);
    assert.match(md, /Unresolved decisions \(ambiguity\): \*\*1\*\*/);
    assert.match(md, /Unmapped tasks .*: \*\*1\*\*/);
    assert.match(md, /## Unmapped tasks/);
    assert.match(md, /dark mode/);
  });
});

describe('traceability command — persists the observable artifact', () => {
  test('writes .danteforge/traceability.md via the analysis (seamed, no disk)', async () => {
    const writes: Record<string, string> = {};
    await traceability({
      cwd: '/proj',
      _readFile: async (p) => (p.includes('SPEC') ? SPEC : p.includes('TASKS') || p.includes('PLAN') ? TASKS : ''),
      _writeFile: async (p, c) => { writes[p] = c; },
      json: true, // suppress console table noise in the test
    });
    const key = Object.keys(writes).find(k => k.endsWith('traceability.md'));
    assert.ok(key, 'the artifact was written');
    assert.match(writes[key!]!, /Cross-Artifact Analysis/);
    assert.match(writes[key!]!, /coverage: \*\*50%\*\*/i);
  });
});
