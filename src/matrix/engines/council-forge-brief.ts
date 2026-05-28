// Matrix Kernel — CouncilForgeBrief
//
// A ForgeBrief is a structured, evolving build specification per dimension.
// It is written by the research phase (Codex/Grok) and read by the builder
// (Claude Code) before each forge cycle. After each cycle the verifier (Grok)
// ticks completed checklist items; the confirmer (Codex) finalises the verdict
// and updates the brief with any remaining gaps.
//
// Storage: .danteforge/forge-briefs/<dimId>.json
import path from 'node:path';
import fs from 'node:fs/promises';

export interface OssCapability {
  leader: string;
  capability: string;
  theirImplementation: string;
  ourGap: string;
}

export interface ChecklistItem {
  id: string;
  description: string;
  /** e.g. "src/core/retry.ts:autoRetry" */
  productionCallsite: string;
  /** e.g. "log line '[autoretry] attempt 2/3'" */
  observableOutput: string;
  /** e.g. "npx tsx --test tests/retry.test.ts" */
  testCommand: string;
  effort: 'S' | 'M' | 'L';
  completed: boolean;
}

export interface VerificationRound {
  cycle: number;
  verifiedBy: string;
  confirmedBy: string;
  verdict: 'PASS' | 'FAIL';
  itemsBuilt: string[];
  itemsMissing: string[];
  notes: string;
  timestamp: string;
}

export interface ForgeBrief {
  dimId: string;
  dimName: string;
  currentScore: number;
  targetScore: number;
  researchedBy: string;
  researchedAt: string;
  ossCapabilities: OssCapability[];
  checklist: ChecklistItem[];
  completionState: {
    lastChecked: string;
    itemsComplete: string[];
    itemsMissing: string[];
    projectedScore: number;
  };
  verificationHistory: VerificationRound[];
}

function briefsDir(projectPath: string): string {
  return path.join(projectPath, '.danteforge', 'forge-briefs');
}

function briefPath(projectPath: string, dimId: string): string {
  return path.join(briefsDir(projectPath), `${dimId}.json`);
}

export async function loadForgeBrief(
  projectPath: string,
  dimId: string,
): Promise<ForgeBrief | null> {
  try {
    const raw = await fs.readFile(briefPath(projectPath, dimId), 'utf8');
    return JSON.parse(raw) as ForgeBrief;
  } catch {
    return null;
  }
}

export async function saveForgeBrief(
  projectPath: string,
  brief: ForgeBrief,
): Promise<void> {
  await fs.mkdir(briefsDir(projectPath), { recursive: true });
  await fs.writeFile(briefPath(projectPath, brief.dimId), JSON.stringify(brief, null, 2), 'utf8');
}

function universeDir(projectPath: string): string {
  return path.join(projectPath, '.danteforge', 'compete', 'universe');
}

export async function loadUniverseFile(projectPath: string, dimId: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(universeDir(projectPath), `${dimId}.md`), 'utf8');
  } catch { return null; }
}

export async function saveUniverseFile(projectPath: string, dimId: string, content: string): Promise<void> {
  await fs.mkdir(universeDir(projectPath), { recursive: true });
  await fs.writeFile(path.join(universeDir(projectPath), `${dimId}.md`), content, 'utf8');
}

export async function loadAllBriefs(projectPath: string): Promise<ForgeBrief[]> {
  try {
    const dir = briefsDir(projectPath);
    const files = await fs.readdir(dir);
    const briefs: ForgeBrief[] = [];
    for (const f of files.filter(f => f.endsWith('.json'))) {
      try {
        const raw = await fs.readFile(path.join(dir, f), 'utf8');
        briefs.push(JSON.parse(raw) as ForgeBrief);
      } catch { /* skip malformed */ }
    }
    return briefs;
  } catch {
    return [];
  }
}

/** Mark checklist items as complete (called by verifier). Updates completionState. */
export function tickChecklist(brief: ForgeBrief, completedIds: string[]): ForgeBrief {
  const updatedChecklist = brief.checklist.map(item => ({
    ...item,
    completed: item.completed || completedIds.includes(item.id),
  }));
  const itemsComplete = updatedChecklist.filter(i => i.completed).map(i => i.id);
  const itemsMissing = updatedChecklist.filter(i => !i.completed).map(i => i.id);
  const completionRatio = brief.checklist.length > 0
    ? itemsComplete.length / brief.checklist.length
    : 0;
  const projectedScore = brief.currentScore + (brief.targetScore - brief.currentScore) * completionRatio;
  return {
    ...brief,
    checklist: updatedChecklist,
    completionState: {
      lastChecked: new Date().toISOString(),
      itemsComplete,
      itemsMissing,
      projectedScore: Math.round(projectedScore * 10) / 10,
    },
  };
}

/** Append a verification round and update currentScore if verdict is PASS. */
export function recordVerification(
  brief: ForgeBrief,
  round: Omit<VerificationRound, 'timestamp'>,
  newScore?: number,
): ForgeBrief {
  return {
    ...brief,
    currentScore: newScore ?? brief.currentScore,
    verificationHistory: [
      ...brief.verificationHistory,
      { ...round, timestamp: new Date().toISOString() },
    ],
  };
}

/** Build a builder prompt prefix that injects the forge brief context. */
export function buildBriefPromptPrefix(brief: ForgeBrief, universeContent?: string | null): string {
  const missing = brief.checklist.filter(i => !i.completed);
  if (missing.length === 0) return '';

  const ossLines = brief.ossCapabilities.map(
    c => `  - ${c.leader}: ${c.capability}\n    Their implementation: ${c.theirImplementation}\n    Our gap: ${c.ourGap}`,
  ).join('\n');

  const checklistLines = missing.map(
    (item, i) => [
      `  ${i + 1}. [${item.id}] ${item.description} (effort: ${item.effort})`,
      `     Callsite: ${item.productionCallsite}`,
      `     Observable output: ${item.observableOutput}`,
      `     Test: ${item.testCommand}`,
    ].join('\n'),
  ).join('\n');

  const universeSections = universeContent
    ? extractUniverseSections(universeContent, ['Key techniques that separate 9+ from 7', 'Builder checklist for 9+'])
    : null;

  return [
    `=== FORGE BRIEF: ${brief.dimName} (current: ${brief.currentScore} → target: ${brief.targetScore}) ===`,
    '',
    ...(universeSections ? [
      '## COMPETITIVE UNIVERSE — what 9+ looks like for this dimension',
      universeSections,
      '',
    ] : []),
    'What OSS leaders do that we do not:',
    ossLines || '  (none recorded yet)',
    '',
    `Build checklist — implement ALL ${missing.length} remaining item(s):`,
    checklistLines,
    '',
    'Every item MUST answer:',
    '  1. What production function calls this? (not a test)',
    '  2. What is the observable output artifact?',
    '  3. What breaks silently if this fails?',
    '',
    'No stubs. No mocks. No TODOs. Pre-commit hook enforces this.',
    '=== END FORGE BRIEF ===',
    '',
  ].join('\n');
}

/** Extract named H2 sections from a universe markdown file. */
function extractUniverseSections(content: string, sections: string[]): string {
  const parts: string[] = [];
  for (const section of sections) {
    const regex = new RegExp(`## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)(?=\n## |$)`, 'i');
    const m = regex.exec(content);
    if (m) parts.push(`### ${section}${m[1]!.trimEnd()}`);
  }
  return parts.join('\n\n');
}

/** Build a verifier prompt: "which checklist items were built in this diff?" */
export function buildVerifierPrompt(brief: ForgeBrief, diff: string): string {
  const missing = brief.checklist.filter(i => !i.completed);
  if (missing.length === 0) return 'All checklist items already complete.';

  const checklistLines = missing.map(
    item => `  - [${item.id}] ${item.description} (callsite: ${item.productionCallsite})`,
  ).join('\n');

  return [
    `Verify which checklist items from the FORGE_BRIEF for "${brief.dimName}" were implemented in the diff below.`,
    '',
    'Checklist items to verify:',
    checklistLines,
    '',
    'For each item: answer YES (implemented) or NO (missing) with a one-line justification.',
    'Then list: BUILT: [item-1, item-3, ...] and MISSING: [item-2, ...]',
    '',
    '--- DIFF ---',
    diff.slice(0, 12_000),
    '--- END DIFF ---',
  ].join('\n');
}

/**
 * Build a full scoring prompt for the confirm phase using the dimension rubric.
 * The prompt asks the confirmer to: score the diff (0–10), verify each checklist
 * item (BUILT/PARTIAL/MISSING), issue PASS/FAIL, and name the highest-impact next step.
 */
export function buildScoringPrompt(
  brief: ForgeBrief,
  diff: string,
  passThreshold = 7.0,
  universeContent?: string | null,
): string {
  const ossLeader = brief.ossCapabilities[0]?.leader ?? 'OSS leaders';
  const missing = brief.checklist.filter(i => !i.completed);

  const checklistLines = missing.length > 0
    ? missing.map(item =>
        `  - [${item.id}] ${item.description}\n    Callsite: ${item.productionCallsite}\n    Observable: ${item.observableOutput}`,
      ).join('\n')
    : '  (all checklist items already verified as complete in prior cycles)';

  const universeCriteria = universeContent
    ? extractUniverseSections(universeContent, ['Score Ladder', 'Judge scoring criteria'])
    : null;

  return [
    `You are an independent scoring agent. Your job is to assign an evidence-backed score (0–10)`,
    `to **${brief.dimName}** (dim ID: \`${brief.dimId}\`) based on the diff below, then issue a PASS or FAIL verdict.`,
    ``,
    `The builder started at **${brief.currentScore}/10** and is trying to reach **${brief.targetScore}/10**.`,
    ``,
    `## FORGE_BRIEF checklist — what was supposed to be built`,
    checklistLines,
    ``,
    ...(universeCriteria ? [
      `## Competitive universe criteria (what 9+ means for ${brief.dimName})`,
      universeCriteria,
      ``,
    ] : []),
    `## Scoring scale`,
    `| Score | Meaning |`,
    `|-------|---------|`,
    `| 0–4   | Code exists or partial scaffold only — not proven to run |`,
    `| 5     | Unit tests pass but end-to-end unproven |`,
    `| 6     | Works with mocks/stubs/fake data only |`,
    `| 7     | End-to-end works but with caveats or incomplete coverage |`,
    `| 8     | End-to-end with realistic inputs, no material stubs in critical path |`,
    `| 9     | Production-real, repeatable, wired to real callsite, competitive with ${ossLeader} |`,
    `| 10    | Best-in-class, fully integrated, robust across realistic scenarios |`,
    ``,
    `**Hard caps:** Cannot score 8+ without a real production callsite. Cannot score 7+ if critical path uses mocks, stubs, or TODOs.`,
    ``,
    `## Required output format`,
    `\`\`\``,
    `CHECKLIST_RESULTS:`,
    missing.map(i => `- [${i.id}]: BUILT | PARTIAL | MISSING  — reason`).join('\n'),
    ``,
    `SCORE: X.X`,
    `VERDICT: PASS`,
    `REASON: <2–3 sentences citing specific src/ files or functions from the diff>`,
    `HIGHEST_IMPACT_NEXT: <one specific thing to implement next to raise score by 0.5+>`,
    `\`\`\``,
    ``,
    `VERDICT is PASS if SCORE >= ${passThreshold} AND at least 1 checklist item is BUILT with a real production callsite.`,
    `VERDICT is FAIL if SCORE < ${passThreshold} OR all checklist items are MISSING or PARTIAL.`,
    ``,
    `## Diff`,
    `\`\`\`diff`,
    diff.slice(0, 10_000),
    `\`\`\``,
  ].join('\n');
}

/** Parse the confirmer's structured scoring response. */
export function parseScoringResponse(response: string): {
  score: number;
  verdict: 'PASS' | 'FAIL';
  reason: string;
  highestImpactNext: string;
  checklistResults: Record<string, 'BUILT' | 'PARTIAL' | 'MISSING'>;
} {
  const scoreMatch = response.match(/SCORE:\s*([\d.]+)/i);
  const verdictMatch = response.match(/VERDICT:\s*(PASS|FAIL)/i);
  const reasonMatch = response.match(/REASON:\s*(.+?)(?=\nHIGHEST|$)/is);
  const nextMatch = response.match(/HIGHEST_IMPACT_NEXT:\s*(.+?)(?=\n|$)/i);

  const checklistResults: Record<string, 'BUILT' | 'PARTIAL' | 'MISSING'> = {};
  for (const m of response.matchAll(/- \[(item-\d+)\]:\s*(BUILT|PARTIAL|MISSING)/gi)) {
    checklistResults[m[1]!] = m[2]!.toUpperCase() as 'BUILT' | 'PARTIAL' | 'MISSING';
  }

  return {
    score: scoreMatch ? parseFloat(scoreMatch[1]!) : 0,
    verdict: (verdictMatch?.[1]?.toUpperCase() as 'PASS' | 'FAIL') ?? 'FAIL',
    reason: reasonMatch?.[1]?.trim() ?? '',
    highestImpactNext: nextMatch?.[1]?.trim() ?? '',
    checklistResults,
  };
}

/** Parse verifier response into lists of built/missing item IDs. */
export function parseVerifierResponse(
  response: string,
  checklist: ChecklistItem[],
): { built: string[]; missing: string[] } {
  const builtMatch = response.match(/BUILT:\s*\[([^\]]*)\]/i);
  const missingMatch = response.match(/MISSING:\s*\[([^\]]*)\]/i);

  const parseIds = (m: RegExpMatchArray | null): string[] => {
    if (!m?.[1]?.trim()) return [];
    return m[1].split(',').map(s => s.trim()).filter(Boolean);
  };

  const allIds = checklist.map(i => i.id);
  const builtRaw = parseIds(builtMatch).filter(id => allIds.includes(id));
  const missingRaw = parseIds(missingMatch).filter(id => allIds.includes(id));

  // Any id not explicitly in missing is treated as built if confirmed in BUILT list
  return { built: builtRaw, missing: missingRaw };
}
