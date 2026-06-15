// demand-to-spec.ts — Phase 6 v2: turn a ranked demand cluster into a spec the pipeline can build, with
// the ACCEPTANCE CRITERION mined from the requesters' OWN words and full external provenance attached.
//
// v1 (demand-harvest) answers "what is wanted?"; this closes intake→build: it converts the top demand
// theme into a `danteforge specify`-ready brief whose success condition is not internally invented but
// quoted from the people asking for it — and stamps the originating issue URLs as `external_demand`
// provenance so the eventual outcome is traceable to a real external request, not a self-chosen rubric.
// Pure + offline (operates on a saved backlog); the outward-facing "reply to the requester" close-the-loop
// step is deliberately NOT here — that publishes, and stays operator-authorized.

import type { DemandCluster, DemandIssue } from './demand-harvest-cluster.js';

export interface AcceptanceCriterion {
  text: string;
  sourceRepo: string;
  sourceIssue: number;
  sourceUrl: string;
}

export interface DemandSpec {
  title: string;
  objective: string;
  acceptanceCriteria: AcceptanceCriterion[];
  /** External-demand provenance — the real requests this spec serves. */
  provenance: {
    demandScore: number;
    askCount: number;
    repos: string[];
    issues: Array<{ repo: string; number: number; title: string; url: string }>;
  };
}

// Lines that read like a concrete success condition the builder can target.
const CRITERION_MARKERS = [/\bexpected\b[:\s]/i, /\bshould\b/i, /\bso that\b/i, /\bmust\b/i, /\bable to\b/i, /^\s*-\s*\[\s?\]/];
// Noise to drop before treating a line as a criterion.
const NOISE = [/^\s*$/, /^#{1,6}\s/, /^\s*<!--/, /^\s*```/, /^\s*>/, /describe the/i, /screenshots?/i];

function cleanLine(line: string): string {
  return line.replace(/^\s*[-*]\s*\[\s?\]\s*/, '').replace(/^\s*[-*]\s+/, '').replace(/\s+/g, ' ').trim();
}

/** Mine acceptance criteria from one issue's body (the requester's own success conditions). */
function criteriaFromIssue(iss: DemandIssue): AcceptanceCriterion[] {
  const out: AcceptanceCriterion[] = [];
  for (const raw of (iss.body ?? '').split('\n')) {
    if (NOISE.some(re => re.test(raw))) continue;
    if (!CRITERION_MARKERS.some(re => re.test(raw))) continue;
    const text = cleanLine(raw);
    if (text.length < 12 || text.length > 240) continue;       // skip fragments + walls of text
    out.push({ text, sourceRepo: iss.repo, sourceIssue: iss.number, sourceUrl: iss.url });
  }
  return out;
}

/**
 * Build a spec from a demand cluster. Acceptance criteria come from the requesters' bodies; if an issue
 * carries none, its title becomes a fallback "Support: <title>" criterion so every ask is represented.
 * `maxCriteria` keeps the brief focused on the strongest asks (cluster issues are already demand-ranked).
 */
export function buildSpecFromCluster(cluster: DemandCluster, maxCriteria = 8): DemandSpec {
  const mined: AcceptanceCriterion[] = [];
  for (const iss of cluster.issues) {
    const fromBody = criteriaFromIssue(iss);
    if (fromBody.length > 0) mined.push(...fromBody);
    else mined.push({ text: `Support: ${iss.title.trim()}`, sourceRepo: iss.repo, sourceIssue: iss.number, sourceUrl: iss.url });
  }
  // Dedup by normalized text; keep first occurrence (cluster order = demand order).
  const seen = new Set<string>();
  const acceptanceCriteria = mined.filter(c => {
    const k = c.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (k.length === 0 || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, maxCriteria);

  const repos = [...new Set(cluster.issues.map(i => i.repo))];
  const exemplar = cluster.issues[0]?.title?.trim() ?? cluster.theme;
  return {
    title: `Demand: ${cluster.theme}`,
    objective:
      `Deliver the capability ${cluster.issues.length} user(s) across ${repos.length} repo(s) are asking for, ` +
      `themed "${cluster.theme}" (demand ${cluster.score.toFixed(1)}/10). Representative ask: "${exemplar.slice(0, 140)}". ` +
      `Done = a real user who filed one of these issues would agree it is delivered.`,
    acceptanceCriteria,
    provenance: {
      demandScore: cluster.score,
      askCount: cluster.issues.length,
      repos,
      issues: cluster.issues.map(i => ({ repo: i.repo, number: i.number, title: i.title, url: i.url })),
    },
  };
}

/** Render the spec as a `danteforge specify`-ready markdown brief with provenance. */
export function formatSpecMarkdown(spec: DemandSpec): string {
  const lines: string[] = [
    `# ${spec.title}`,
    ``,
    `## Objective`,
    spec.objective,
    ``,
    `## Acceptance criteria (from the requesters' own words)`,
  ];
  if (spec.acceptanceCriteria.length === 0) {
    lines.push('_(no explicit criteria found in the issues — author them from the linked asks)_');
  } else {
    for (const c of spec.acceptanceCriteria) {
      lines.push(`- [ ] ${c.text}  _(${c.sourceRepo}#${c.sourceIssue})_`);
    }
  }
  lines.push(
    ``,
    `## External-demand provenance`,
    `- Demand score: **${spec.provenance.demandScore.toFixed(1)}/10**  |  ${spec.provenance.askCount} ask(s)  |  repos: ${spec.provenance.repos.join(', ')}`,
    `- Originating requests (the real-user-path this build serves):`,
    ...spec.provenance.issues.slice(0, 12).map(i => `  - [${i.repo}#${i.number}] ${i.title.slice(0, 110)} — ${i.url}`),
    ``,
    `## Handoff`,
    `Run \`danteforge specify "${spec.title}"\` and paste this brief. When built, attribute the outcome's`,
    `\`input_source\` to **external_demand** with these issue URLs — that is the first genuinely external`,
    `(not self-chosen) grounding the matrix has had. Closing the loop with the requester (a reply confirming`,
    `"yes, that's what I wanted") is the strongest real-user-path receipt — do that step manually.`,
  );
  return lines.join('\n');
}
