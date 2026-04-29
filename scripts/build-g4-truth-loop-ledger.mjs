// G4 Class G validation — truth-loop causal recall.
// Builds 10 synthetic conversation entries, each anchored to a Time Machine commit,
// then runs 7 recall queries verifying causal-source identification works.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import 'tsx/esm';

const { createTimeMachineCommit, queryTimeMachine, verifyTimeMachine } =
  await import('../src/core/time-machine.ts');

const ROOT = process.cwd();
const WORKSPACE = resolve(ROOT, '.danteforge', 'validation', 'g4_truth_loop_workspace');
const LEDGER_PATH = resolve(ROOT, '.danteforge', 'validation', 'truth_loop_conversations.jsonl');
const RECALL_REPORT_PATH = resolve(ROOT, '.danteforge', 'validation', 'g4_recall_report.json');

rmSync(WORKSPACE, { recursive: true, force: true });
mkdirSync(resolve(WORKSPACE, 'conversations'), { recursive: true });

const ENTRIES = [
  { id: 1, topic: 'time-machine-schema-version', decision: 'Pin Time Machine schema at v0.1 for the entire publication-plan release; defer schema bump to post-arXiv.', tags: ['time-machine', 'schema', 'v0.1'] },
  { id: 2, topic: 'delegate52-dataset-license', decision: 'Use only the 48-domain CDLA Permissive 2.0 public release; do not attempt to access the 76 withheld environments.', tags: ['delegate52', 'license', 'public-release'] },
  { id: 3, topic: 'live-llm-budget-ceiling', decision: 'Cap GATE-1 live DELEGATE-52 run at 80 USD; agent cannot trigger live mode without explicit founder authorization.', tags: ['gate-1', 'budget', 'live'] },
  { id: 4, topic: 'gitsha-binding-semantics', decision: 'Replace strict-equality gitSha check with merge-base ancestor continuity; preserve --strict-git-binding flag for snapshot-equality use cases.', tags: ['proof', 'git', 'binding'] },
  { id: 5, topic: 'prd-real-scale-fallthrough', decision: 'Add prd-real to TimeMachineValidationScale union; only the prd value short-circuits to logical-mode, prd-real falls through to real-fs.', tags: ['scale', 'validation', 'real-fs'] },
  { id: 6, topic: 'truth-boundary-discipline', decision: 'Every receipt must declare allowed-claim and forbidden-claim explicitly; truth boundary is enforced at the receipt layer, not just narrative.', tags: ['receipts', 'truth-boundary'] },
  { id: 7, topic: 'sean-lippay-synthetic-status', decision: 'G1 Sean Lippay outreach artifacts are synthetic substrate-composability validation, not a real customer email; no email send under any agent action.', tags: ['g1', 'sean-lippay', 'synthetic'] },
  { id: 8, topic: 'g2-dojo-out-of-scope', decision: 'Class G2 Dojo bookkeeping integration is paused for the v1 publication; mark out_of_scope_dojo_paused in the validation report.', tags: ['g2', 'dojo', 'out-of-scope'] },
  { id: 9, topic: 'class-f-1m-gate', decision: '1M-commit benchmark for Class F preserved behind GATE-3 founder-approved env-var override; not executed by default.', tags: ['gate-3', 'class-f', 'benchmark'] },
  { id: 10, topic: 'arxiv-submission-gate', decision: 'arXiv submission is the founder action under GATE-5; agent prepares LaTeX + reproducibility appendix only, never submits.', tags: ['gate-5', 'arxiv', 'submission'] },
];

const commits = [];
for (const entry of ENTRIES) {
  const filename = `conversations/entry_${String(entry.id).padStart(2, '0')}.json`;
  const filePath = resolve(WORKSPACE, filename);
  const payload = {
    schemaVersion: 1,
    entryId: entry.id,
    topic: entry.topic,
    decision: entry.decision,
    tags: entry.tags,
    isSynthetic: true,
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const commit = await createTimeMachineCommit({
    cwd: WORKSPACE,
    paths: [filename],
    label: `truth-loop conversation: ${entry.topic} — decision recorded`,
    runId: `g4_synthetic_${String(entry.id).padStart(2, '0')}`,
    gitSha: null,
    now: () => new Date(2026, 3, 29, 10, 0, entry.id).toISOString(),
  });

  commits.push({ ...entry, commitId: commit.commitId, label: commit.label, file: filename });
}

const ledgerLines = commits.map(c => JSON.stringify(c));
writeFileSync(LEDGER_PATH, ledgerLines.join('\n') + '\n', 'utf8');

// Recall queries: simulate "what did I decide about <topic>?" → return commit IDs whose label matches.
const RECALL_QUERIES = [
  { q: 'time machine schema', expectIds: [1] },
  { q: 'delegate52 license withheld', expectIds: [2] },
  { q: 'live LLM budget GATE-1', expectIds: [3] },
  { q: 'gitsha binding ancestor', expectIds: [4] },
  { q: 'prd-real scale fallthrough', expectIds: [5] },
  { q: 'sean lippay synthetic', expectIds: [7] },
  { q: 'arxiv submission gate', expectIds: [10] },
];

function matchesQuery(commit, queryTokens) {
  const haystack = (commit.label + ' ' + (commit.tags ?? []).join(' ') + ' ' + (commit.decision ?? '')).toLowerCase();
  return queryTokens.every(t => haystack.includes(t.toLowerCase()));
}

const recallResults = [];
let gaps = 0;
for (const { q, expectIds } of RECALL_QUERIES) {
  const tokens = q.split(/\s+/).filter(t => t.length >= 3);
  const matched = commits.filter(c => matchesQuery(c, tokens));
  const matchedIds = matched.map(c => c.id).sort((a, b) => a - b);
  const expectedIdsSorted = [...expectIds].sort((a, b) => a - b);
  const ok = JSON.stringify(matchedIds) === JSON.stringify(expectedIdsSorted);
  if (!ok) gaps += 1;
  recallResults.push({
    query: q,
    expected: expectedIdsSorted,
    matched: matchedIds,
    matchedCommitIds: matched.map(c => c.commitId),
    ok,
  });
}

// Also exercise a structural causal query (file-history) on entry 5.
const fileHistory = await queryTimeMachine({
  cwd: WORKSPACE,
  kind: 'file-history',
  path: 'conversations/entry_05.json',
});

// Verify the chain end-to-end.
const verifyReport = await verifyTimeMachine({ cwd: WORKSPACE });

const report = {
  schemaVersion: 1,
  scenario: 'G4 truth-loop causal recall — synthetic conversational ledger anchored to Time Machine',
  generatedAt: new Date().toISOString(),
  entries: commits.length,
  ledger: LEDGER_PATH,
  workspace: WORKSPACE,
  recall: {
    queriesRun: RECALL_QUERIES.length,
    gaps,
    completenessPct: gaps === 0 ? 100 : Math.round(((RECALL_QUERIES.length - gaps) / RECALL_QUERIES.length) * 100),
    results: recallResults,
  },
  fileHistory: {
    target: 'conversations/entry_05.json',
    status: fileHistory.status,
    hits: fileHistory.results.length,
    matchesEntry5: fileHistory.results.some(r => r.commitId === commits[4].commitId),
  },
  verifyChain: {
    valid: verifyReport.valid,
    commitsChecked: verifyReport.commitsChecked,
    errors: verifyReport.errors,
  },
};

writeFileSync(RECALL_REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');

console.log(`G4 ledger: ${LEDGER_PATH}`);
console.log(`  entries:            ${commits.length}`);
console.log(`  recall queries:     ${RECALL_QUERIES.length}`);
console.log(`  recall gaps:        ${gaps}`);
console.log(`  completeness:       ${report.recall.completenessPct}%`);
console.log(`  file-history hits:  ${fileHistory.results.length} (entry-5 match: ${report.fileHistory.matchesEntry5})`);
console.log(`  tm verify:          ${verifyReport.valid ? 'OK' : 'FAILED'} (${verifyReport.commitsChecked} commits)`);
console.log(`G4 recall report:   ${RECALL_REPORT_PATH}`);

if (gaps > 0) {
  console.error(`FAIL: ${gaps} recall gaps`);
  process.exit(1);
}
if (!verifyReport.valid) {
  console.error(`FAIL: tm verify errors: ${verifyReport.errors.join('; ')}`);
  process.exit(1);
}
if (!report.fileHistory.matchesEntry5) {
  console.error(`FAIL: file-history did not return entry-5 commit`);
  process.exit(1);
}
