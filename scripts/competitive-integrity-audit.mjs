import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const MATRIX_PATH = '.danteforge/compete/matrix.json';
const EVIDENCE_DIR = '.danteforge/outcome-evidence';
const AUDIT_JSON_PATH = '.danteforge/compete/evidence-integrity-audit.json';
const AUDIT_MD_PATH = '.danteforge/compete/evidence-integrity-audit.md';

const MARKER_RE = /\b(TODO|FIXME|stub|placeholder|mock|fake|dummy|sample|hardcoded|temporary|not implemented|coming soon|describe\.skip|test\.skip|xit\(|\.skip\()\b/i;

const SCORE_OVERRIDES = {
  testing: {
    score: 7.0,
    status: 'Partially verified capability',
    cap: '7 cap: targeted runtime tests passed, but full npm test did not complete in this session and no complete repo-wide E2E proof is current.',
    e2e: 'Partially: golden/runtime runner tests execute, but full suite completion is unverified.',
    works: 'Runtime test runner, CLI smoke runner, and matrix golden-flow tests have recent pass receipts.',
    doesNot: 'No current complete full-suite receipt; prior npm run verify timed out during npm test.',
    unverified: 'Coverage depth, skipped-test absence across the full suite, and large-suite repeatability.',
    next: 'Make npm test finish reliably and use it as the capability_test instead of a narrow subset.',
  },
  developer_experience: {
    score: 7.0,
    status: 'Partially verified capability',
    cap: '7 cap: CLI help and DX command tests run, but no realistic user onboarding flow was exercised end-to-end.',
    e2e: 'Partially: CLI --help smoke is real; guided product workflow is not fully exercised.',
    works: 'CLI help responds and DX-related tests pass.',
    doesNot: 'No verified full new-user workflow from install to successful assisted build.',
    unverified: 'Slash-command picker parity across every supported host and cross-tool setup success.',
    next: 'Add an install-to-first-success E2E test using a fresh temp project and real CLI commands.',
  },
  ux_polish: {
    score: 6.5,
    status: 'Partially verified capability',
    cap: '6.5 cap: error-formatting tests pass, but UX/onboarding is not proven as a complete user-facing flow.',
    e2e: 'No complete UX E2E; only CLI help and error-boundary surfaces are exercised.',
    works: 'Actionable error and formatted error tests pass.',
    doesNot: 'No visual/UI/onboarding walkthrough, accessibility audit, or multi-command polish verification.',
    unverified: 'Actual first-run ergonomics and cross-terminal rendering quality.',
    next: 'Create a golden first-run transcript test that verifies prompts, errors, recovery, and next-step guidance.',
  },
  functionality: {
    score: 7.0,
    status: 'Partially verified capability',
    cap: '7 cap: core smoke/functionality tests pass, but the full product workflow is not proven with realistic inputs.',
    e2e: 'Partially: CLI smoke is real; full spec-to-ship workflow is not current-proofed here.',
    works: 'CLI help/smoke and core functionality test receipts exist.',
    doesNot: 'No fresh end-to-end build-from-idea-to-verified-artifact run completed in this audit.',
    unverified: 'Real LLM provider path and generated artifact correctness across the complete workflow.',
    next: 'Run a cold temp-project spec-to-ship workflow with a live provider or explicit host-native execution receipt.',
  },
  autonomy: {
    score: 6.5,
    status: 'Partially verified capability',
    cap: '6.5 cap: autonomy rules and dry-run paths are tested, but real autonomous completion is not demonstrated.',
    e2e: 'No: tests cover rules/dry runs more than real self-directed execution.',
    works: 'Frontier/crusade autonomy rules and harden-crusade tests execute.',
    doesNot: 'No proof of an unattended loop closing a real dimension from failing to passing.',
    unverified: 'Live agent/provider integration and autonomous recovery from real failures.',
    next: 'Capture one full autonomous dimension loop with starting failure, code changes, validation, harden, and score merge.',
  },
  security: {
    score: 7.5,
    status: 'Partially verified capability',
    cap: '7.5 cap: anti-stub/security checks run, but no dynamic adversarial security test or external audit exists.',
    e2e: 'Partially: security scans and anti-stub gates run in the product path.',
    works: 'Anti-stub scan and security tests pass; hardener invokes scanner surfaces.',
    doesNot: 'No penetration-style runtime scenario or hostile-input E2E proof.',
    unverified: 'External integration attack surfaces and supply-chain edge cases.',
    next: 'Add adversarial CLI/MCP input tests and dependency/supply-chain receipts to the security dimension.',
  },
  error_handling: {
    score: 7.0,
    status: 'Partially verified capability',
    cap: '7 cap: error handling has real tests, but coverage is not proven across every command path.',
    e2e: 'Partially: CLI error-boundary and formatting tests execute.',
    works: 'Actionable error, boundary coverage, and formatting tests pass.',
    doesNot: 'No all-command failure matrix or realistic external provider failure simulation.',
    unverified: 'Recovery behavior for network, provider, filesystem, and partially-written state failures.',
    next: 'Add command-level failure matrix tests for the highest-risk workflows.',
  },
  performance: {
    score: 7.0,
    status: 'Partially verified capability',
    cap: '7 cap: build and perf-related tests run, but no production load/scale benchmark is current.',
    e2e: 'Partially: build succeeds and performance monitor tests execute.',
    works: 'Build, token economy, estimator, and performance monitor tests have receipts.',
    doesNot: 'No large-repo benchmark, memory ceiling proof, or sustained-loop throughput measurement.',
    unverified: 'Behavior on 100k-file repos and long-running matrix loops.',
    next: 'Create repeatable benchmark fixtures for large repos, OSS harvest, and matrix loop throughput.',
  },
  documentation: {
    score: 7.0,
    status: 'Partially verified capability',
    cap: '7 cap: docs commands/tests run, but documentation accuracy is not validated against all current behavior.',
    e2e: 'Partially: documentation command tests execute.',
    works: 'Docs command and documentation tests pass.',
    doesNot: 'No doc-to-CLI parity audit across the full command surface.',
    unverified: 'Freshness and correctness of every command page after recent command additions.',
    next: 'Add generated command-reference parity checks against Commander registration.',
  },
  convergence_self_healing: {
    score: 6.5,
    status: 'Partially verified capability',
    cap: '6.5 cap: convergence tests run, but recovery is not proven against a real broken project.',
    e2e: 'Partially: convergence runtime tests exist; realistic failure repair is not proven.',
    works: 'Loop detector, reflection gates, and convergence tests pass.',
    doesNot: 'No fresh run that detects, patches, verifies, and records recovery on a real defect.',
    unverified: 'Whether self-healing improves a real project without operator intervention.',
    next: 'Seed a known failing temp project and require convergence to repair it end-to-end.',
  },
  spec_driven_pipeline: {
    score: 6.5,
    status: 'Partially verified capability',
    cap: '6.5 cap: named E2E test uses injection seams/fake paths; it validates scoring logic, not a fully real pipeline.',
    e2e: 'Partially at best: inspected test declares zero real LLM calls and fake filesystem seams.',
    works: 'Workflow enforcer, clarify, and pipeline scoring tests pass.',
    doesNot: 'No complete real constitution -> spec -> clarify -> plan -> tasks -> forge -> verify run in this audit.',
    unverified: 'Real provider generation quality and artifact handoff under normal operator use.',
    next: 'Replace scoring-only E2E with a temp-project pipeline execution that writes and verifies real artifacts.',
  },
  planning_quality: {
    score: 6.5,
    status: 'Partially verified capability',
    cap: '6.5 cap: planner/task tests pass, but plan quality is not validated on realistic ambiguous work.',
    e2e: 'No complete realistic planning E2E.',
    works: 'Planner, sprint-plan, task-router, and tasks-command tests pass.',
    doesNot: 'No adversarial product brief or competitor-derived planning challenge was executed.',
    unverified: 'Plan usefulness on complex, ambiguous requirements.',
    next: 'Add benchmark planning prompts with expected constraints, tasks, risks, and acceptance criteria.',
  },
  maintainability: {
    score: 7.5,
    status: 'Partially verified capability',
    cap: '7.5 cap: file-size and anti-stub gates pass, but maintainability is not fully measured by runtime behavior.',
    e2e: 'Partially: repo hygiene gates execute.',
    works: 'File-size check, maintainability tests, shared-options tests, and anti-stub tests pass.',
    doesNot: 'Warnings remain for files above the ideal size; no complexity trend report is enforced.',
    unverified: 'Long-term modularity under repeated matrix-agent edits.',
    next: 'Add complexity thresholds and ownership-change regression reports to maintainability scoring.',
  },
  token_economy: {
    score: 7.0,
    status: 'Partially verified capability',
    cap: '7 cap: token accounting tests pass, but real model/provider billing behavior is not exercised.',
    e2e: 'Partially: token estimator/ledger/ROI tests execute.',
    works: 'Token economy, estimator, ROI, and workspace token tests pass.',
    doesNot: 'No live provider usage reconciliation or cost ledger validation with real calls.',
    unverified: 'Provider-specific pricing drift and budget enforcement under real workloads.',
    next: 'Add a real or recorded provider call receipt that reconciles estimated vs observed token use.',
  },
  self_improvement: {
    score: 6.5,
    status: 'Partially verified capability',
    cap: '6.5 cap: self-improvement surfaces are tested, but not proven to improve a real capability end-to-end.',
    e2e: 'No: tests verify loop/report/lessons behavior, not a full self-improvement success cycle.',
    works: 'Self-improve loop/report and lessons tests pass.',
    doesNot: 'No before/after failing-to-passing proof for a real dimension.',
    unverified: 'Autonomous selection, patching, verification, and score merge without manual steering.',
    next: 'Use a seeded regression and require self-improve to repair it, emit lessons, and pass validation.',
  },
  ecosystem_mcp: {
    score: 7.0,
    status: 'Partially verified capability',
    cap: '7 cap: MCP server/tool tests run locally, but external host interoperability is not proven.',
    e2e: 'Partially: local MCP server and command tests execute.',
    works: 'MCP server, SDK, command, and tool handler tests pass.',
    doesNot: 'No live Claude/Codex/Cursor MCP client round-trip receipt.',
    unverified: 'Cross-client compatibility and stdio behavior under real host sessions.',
    next: 'Run a generic MCP client plus one host integration round-trip against the packaged server.',
  },
  enterprise_readiness: {
    score: 6.0,
    status: 'Structural implementation',
    cap: '6 cap: reports and controls exist, but enterprise claims are not validated by real compliance, tenancy, or operational audits.',
    e2e: 'No production-real enterprise workflow; tests mainly inspect generated readiness reports.',
    works: 'Enterprise readiness report generation and config/security-control tests pass.',
    doesNot: 'No SOC2/GDPR audit, RBAC/multi-tenant workflow, incident drill, or deployment hardening proof.',
    unverified: 'Real enterprise deployment posture.',
    next: 'Define enterprise readiness as concrete runtime controls and add deployment/compliance evidence receipts.',
  },
  community_adoption: {
    score: 1.0,
    status: 'Excluded dimension',
    cap: 'Excluded from weighted scoring and priority. Adoption is not penalized for a pre-release optimizer/skillset layer.',
    e2e: 'Not applicable.',
    works: 'Dimension is excluded by matrix.excludedDimensions and weight 0.',
    doesNot: 'No adoption capability should drive crusade priority.',
    unverified: 'Market adoption metrics are intentionally not used.',
    next: 'Keep excluded; use only as reference context after release.',
  },
  agent_activity_provenance: {
    score: 7.5,
    status: 'Partially verified capability',
    cap: '7.5 cap: Time Machine/provenance tests pass, but real multi-session replay is not proven.',
    e2e: 'Partially: outcome-runner and Time Machine integration tests execute with injection seams.',
    works: 'Time Machine SDK loads; provenance summary and outcome integration tests pass.',
    doesNot: 'No real host edit session replay or cross-repo causal restoration receipt.',
    unverified: 'Full operator-facing restore/replay under live agent edits.',
    next: 'Run a live temp repo edit session with pre/post evidence, restore, and replay verification.',
  },
  spec_workflow_enforcement: {
    score: 7.5,
    status: 'Partially verified capability',
    cap: '7.5 cap: gates and workflow command tests execute, but full real workflow enforcement is not proven across all commands.',
    e2e: 'Partially: spec pipeline and workflow command tests execute.',
    works: 'Constitution/spec/plan/test gate tests and workflow enforcer tests pass.',
    doesNot: 'No matrix of every command attempting to bypass gates.',
    unverified: 'Host-native slash-command parity and bypass resistance across all tool adapters.',
    next: 'Add a command-surface bypass test suite that attempts invalid transitions through every public entry point.',
  },
  outcome_verification: {
    score: 7.5,
    status: 'Partially verified capability',
    cap: '7.5 cap: outcome runner and quality gates are tested, but some tests use injected process/file seams.',
    e2e: 'Partially: e2e-workflow-runner and outcome-quality tests execute.',
    works: 'Derived score, outcome quality, and E2E workflow runner tests pass.',
    doesNot: 'No independent audit that each dimension outcome maps to real user capability.',
    unverified: 'Semantic correctness of outcome definitions for every dimension.',
    next: 'Add an outcome lint that rejects structural/readFile outcomes above T4 and flags fixture-only tests.',
  },
  constitutional_governance: {
    score: 7.5,
    status: 'Partially verified capability',
    cap: '7.5 cap: hard gates are tested, but policy enforcement is not proven in every write/merge path.',
    e2e: 'Partially: hardener, agent-guard, protected-line, and policy-gate tests execute.',
    works: 'Hardener and governance tests pass.',
    doesNot: 'No complete malicious-agent merge attempt from claim to blocked merge is current-proofed.',
    unverified: 'Coverage across all score-writing and protected-line mutation paths.',
    next: 'Run a hostile matrix worker scenario that tries forbidden score writes and protected-line changes.',
  },
  multi_agent_orchestration: {
    score: 6.5,
    status: 'Partially verified capability',
    cap: '6.5 cap: orchestration tests use fake/offline dispatch seams; no real parallel multi-agent execution is proven.',
    e2e: 'No production-real multi-agent E2E; matrix-kernel status smoke is real but not orchestration.',
    works: 'Matrix engine, score-write guards, agent DAG, and party-agent tests pass.',
    doesNot: 'No concurrent real agents executing disjoint work packets and merging via courts.',
    unverified: 'Real Claude/Codex/adapter subprocess behavior and conflict handling.',
    next: 'Run embedded or real-adapter wave with two independent leases, mailbox messages, verify court, and merge receipts.',
  },
  depth_doctrine: {
    score: 7.5,
    status: 'Partially verified capability',
    cap: '7.5 cap: doctrine and scoring gates run, but full wave cadence is not proven on a real project improvement loop.',
    e2e: 'Partially: depth doctrine and outcome-quality tests execute.',
    works: 'Depth doctrine E2E, derived scoring, and quality gate tests pass.',
    doesNot: 'No live multi-wave improvement receipt showing depth doctrine changing agent behavior.',
    unverified: 'Sustained cadence across a full crusade/harden-crusade cycle.',
    next: 'Require a live crusade cycle to emit doctrine receipts per wave and reject shallow passes.',
  },
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function gitSha() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function latestEvidence() {
  const entries = new Map();
  if (!fs.existsSync(EVIDENCE_DIR)) return entries;
  for (const file of fs.readdirSync(EVIDENCE_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const fullPath = path.join(EVIDENCE_DIR, file);
      const entry = readJson(fullPath);
      if (!entry.dimensionId || !entry.outcomeId) continue;
      const key = `${entry.dimensionId}::${entry.outcomeId}`;
      const time = new Date(entry.finishedAt || entry.ranAt || 0).getTime();
      const existing = entries.get(key);
      if (!existing || time > existing.time) {
        entries.set(key, { entry, time, path: fullPath.replaceAll('\\', '/') });
      }
    } catch {
      // Ignore malformed stale receipts.
    }
  }
  return entries;
}

function testFilesFromCommand(command = '') {
  return [...command.matchAll(/tests[\\/][^\s"']+?\.test\.ts/g)].map(match => match[0].replaceAll('\\', '/'));
}

function markerFindings(files) {
  const findings = [];
  for (const file of [...new Set(files)]) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (MARKER_RE.test(line)) {
        findings.push({ file, line: index + 1, text: line.trim().slice(0, 180) });
      }
    });
  }
  return findings.slice(0, 8);
}

function competitorLeader(dim, competitors) {
  let leader = null;
  let score = -Infinity;
  for (const name of competitors) {
    const value = Number(dim.scores?.[name]);
    if (Number.isFinite(value) && value > score) {
      leader = name;
      score = value;
    }
  }
  return { leader: leader ?? 'none', score: score === -Infinity ? 0 : score };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

const matrix = readJson(MATRIX_PATH);
const evidence = latestEvidence();
const auditStartedAt = new Date().toISOString();
const actualCompetitors = [
  ...(matrix.competitors_closed_source ?? []),
  ...(matrix.competitors_oss ?? []),
];
const records = [];

let totalWeight = 0;
let totalScore = 0;

for (const dim of matrix.dimensions ?? []) {
  const override = SCORE_OVERRIDES[dim.id] ?? {
    score: 4.0,
    status: 'Structural implementation',
    cap: '4 cap: no dimension-specific audit rule exists; code may exist but the capability is not proven.',
    e2e: 'No.',
    works: 'Some matrix outcomes may exist.',
    doesNot: 'No verified capability-specific E2E record.',
    unverified: 'Actual user-facing behavior.',
    next: 'Add dimension-specific executable outcomes and rerun the integrity audit.',
  };

  const latestByOutcome = (dim.outcomes ?? []).map(outcome => {
    const current = evidence.get(`${dim.id}::${outcome.id}`);
    return {
      outcomeId: outcome.id,
      tier: outcome.tier,
      kind: outcome.kind ?? 'shell',
      command: outcome.command ?? (outcome.cli_args ? `node dist/index.js ${outcome.cli_args.join(' ')}` : null),
      evidencePath: current?.path ?? null,
      passed: current?.entry?.passed ?? null,
      exitCode: current?.entry?.exitCode ?? null,
      durationMs: current?.entry?.durationMs ?? null,
      failureReason: current?.entry?.failureReason ?? null,
    };
  });

  const commands = [
    dim.capability_test?.command,
    ...latestByOutcome.map(item => item.command),
  ].filter(Boolean);
  const tests = commands.filter(command => command.includes('tsx --test'));
  const testFiles = tests.flatMap(testFilesFromCommand);
  const findings = markerFindings(testFiles);
  const leader = competitorLeader(dim, actualCompetitors);
  const closed = competitorLeader(dim, matrix.competitors_closed_source ?? []);
  const oss = competitorLeader(dim, matrix.competitors_oss ?? []);
  const previousSelf = Number(dim.scores?.self ?? 0);
  const auditedScore = override.score;
  const gap = round1(Math.max(0, leader.score - auditedScore));
  const closedGap = round1(Math.max(0, closed.score - auditedScore));
  const ossGap = round1(Math.max(0, oss.score - auditedScore));

  if (!dim.scores) dim.scores = {};
  dim.scores.self = auditedScore;
  dim.gap_to_leader = gap;
  dim.leader = leader.leader;
  dim.gap_to_closed_source_leader = closedGap;
  dim.closed_source_leader = closed.leader;
  dim.gap_to_oss_leader = ossGap;
  dim.oss_leader = oss.leader;
  dim.status = dim.weight === 0 ? 'excluded' : override.status.toLowerCase().replaceAll(' ', '-');
  dim.evidence_integrity = {
    auditedAt: auditStartedAt,
    previousSelfScore: previousSelf,
    auditedSelfScore: auditedScore,
    status: override.status,
    scoreCapApplied: override.cap,
    endToEndWorkflowVerified: override.e2e,
    auditPath: AUDIT_JSON_PATH,
  };

  if (dim.weight > 0) {
    totalWeight += dim.weight;
    totalScore += auditedScore * dim.weight;
  }

  records.push({
    Dimension: `${dim.id} - ${dim.label}`,
    Claimed_capability: dim.label,
    Actual_competitor_leader: leader.leader,
    Our_score: auditedScore,
    Leader_score: leader.score,
    Gap_to_leader: gap,
    Score_cap_applied_if_any: override.cap,
    Evidence_inspected: latestByOutcome,
    Commands_run: commands,
    Tests_run: tests,
    End_to_end_workflow_verified: override.e2e,
    Mock_stub_TODO_findings: findings,
    What_works: override.works,
    What_does_not_work: override.doesNot,
    What_is_unverified: override.unverified,
    Reason_for_score: `${override.status}. The existing scorer reported ${previousSelf}/10, but this audit applies the user's cap rules to the actual evidence quality instead of tier labels alone.`,
    Highest_impact_next_action: override.next,
  });
}

matrix.overallSelfScore = round1(totalScore / totalWeight);
matrix.lastUpdated = auditStartedAt;
matrix.lastIntegrityAuditAt = auditStartedAt;
matrix.integrityAudit = {
  auditPath: AUDIT_JSON_PATH,
  markdownPath: AUDIT_MD_PATH,
  gitSha: gitSha(),
  scoringScriptRun: 'node scripts/evidence-rescore.mjs',
  scoringScriptVerdict: 'Evidence input, not authority: it maps latest passed outcomes to tier scores, but does not prove realism, absence of mocks, or user-path E2E execution.',
  rule: 'Scores above 8 require real end-to-end capability; scores above 7 require no material mocks/fakes in the critical path.',
};

const audit = {
  project: matrix.project,
  auditedAt: auditStartedAt,
  gitSha: matrix.integrityAudit.gitSha,
  overallSelfScore: matrix.overallSelfScore,
  activeDimensions: matrix.dimensions.filter(d => d.weight > 0).length,
  excludedDimensions: matrix.excludedDimensions ?? [],
  actualCompetitors,
  referenceCompetitorsExcludedFromGap: matrix.competitors_reference ?? [],
  scoringScriptAssessment: matrix.integrityAudit.scoringScriptVerdict,
  records,
};

const summaryRows = records.map(record => {
  const id = record.Dimension.split(' - ')[0];
  return `| ${id} | ${record.Our_score.toFixed(1)} | ${record.Actual_competitor_leader} | ${record.Leader_score.toFixed(1)} | ${record.Gap_to_leader.toFixed(1)} | ${record.Reason_for_score.split('.')[0]} |`;
});

const md = [
  '# Competitive Evidence Integrity Audit',
  '',
  `Audited at: ${auditStartedAt}`,
  `Git SHA: ${audit.gitSha ?? 'unknown'}`,
  `Overall audited score: ${audit.overallSelfScore}/10`,
  '',
  'The existing evidence rescore script was run, but treated as evidence input rather than authority. This audit downgrades claims where receipts are targeted tests, injection seams, fake workspaces, dry-runs, structural checks, or incomplete end-to-end workflows.',
  '',
  '| Dimension | Score | Leader | Leader Score | Gap | Evidence Class |',
  '| --- | ---: | --- | ---: | ---: | --- |',
  ...summaryRows,
  '',
  `Full per-dimension records are in ${AUDIT_JSON_PATH}.`,
  '',
].join('\n');

writeJson(MATRIX_PATH, matrix);
writeJson(AUDIT_JSON_PATH, audit);
fs.writeFileSync(AUDIT_MD_PATH, md);

console.log(`Audited overall score: ${matrix.overallSelfScore}/10`);
console.log(`Updated ${MATRIX_PATH}`);
console.log(`Wrote ${AUDIT_JSON_PATH}`);
console.log(`Wrote ${AUDIT_MD_PATH}`);
