// Phase E — score the per-skill function comparison docs against the
// addendum-001 mandated 3-axis rubric: completeness, attribution accuracy,
// constitutional coherence. Each axis is 0-10; composite is the average.
//
// Output: .danteforge/evidence/comparison-doc-scores.json

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const docs = [
  '.danteforge/OSS_HARVEST/dante_to_prd_function_comparison.md',
  '.danteforge/OSS_HARVEST/dante_grill_me_function_comparison.md',
  '.danteforge/OSS_HARVEST/dante_tdd_function_comparison.md',
  '.danteforge/OSS_HARVEST/dante_triage_issue_function_comparison.md',
  '.danteforge/OSS_HARVEST/dante_design_an_interface_function_comparison.md'
];

function scoreDoc(content) {
  // Completeness — every function-row should have a Decision (mandatory) and at least one of
  // Rationale / Attribution / Source citation (supporting). We exclude source-path headings
  // that aren't actual function-rows (e.g. "### mattpocock/skills/engineering/tdd/SKILL.md").
  const allHeadings = content.match(/^###\s+[^#]+$/gm) ?? [];
  const functionHeadings = allHeadings.filter(h => !/\/SKILL\.md|\/AGENTS\.md|\/scripts\/|\/openspec\//.test(h)).length;
  const decisionLines = (content.match(/\*\*Decision[^*]*\*\*/g) ?? []).length;
  const rationaleLines = (content.match(/\*\*Rationale[^*]*\*\*/g) ?? []).length;
  const attributionLines = (content.match(/\*\*Attribution[^*]*\*\*/g) ?? []).length;
  const sourceMentions = (content.match(/\*\*Source [ABCD]\b|\*\*REAL SOURCE/g) ?? []).length;

  // Completeness: each function should have a Decision; bonus if also has Rationale OR Attribution.
  const decisionsCovered = Math.min(1, decisionLines / Math.max(1, functionHeadings));
  const supportingCovered = Math.min(1, (rationaleLines + attributionLines + sourceMentions) / Math.max(1, functionHeadings));
  const completeness = (decisionsCovered * 0.6 + supportingCovered * 0.4) * 10;

  // Attribution accuracy: presence of REAL SOURCE markers + cached file references
  const realSourceMarkers = (content.match(/REAL SOURCE/gi) ?? []).length;
  const cacheReferences = (content.match(/raw\/(superpowers|mattpocock|openspec|claude_council)/gi) ?? []).length;
  const attribution = Math.min(10, 4 + realSourceMarkers * 1.0 + cacheReferences * 0.5 + (attributionLines + sourceMentions) * 0.3);

  // Constitutional coherence — the "Constitutional additions (Dante-specific)" section names ≥3
  // Dante-specific elements. Walk lines to extract section between this heading and next H2.
  const lines = content.split(/\r?\n/);
  const startIdx = lines.findIndex(l => /^## Constitutional additions/.test(l));
  let constitutionalSection = '';
  if (startIdx !== -1) {
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) { endIdx = i; break; }
    }
    constitutionalSection = lines.slice(startIdx, endIdx).join('\n');
  }
  const numbered = (constitutionalSection.match(/^\d+\./gm) ?? []).length;
  const bulleted = (constitutionalSection.match(/^[-*]\s+/gm) ?? []).length;
  const constitutionalItems = numbered + bulleted;
  const coherence = Math.min(10, 5 + constitutionalItems * 1.0);

  const composite = (completeness + attribution + coherence) / 3;
  return {
    functionHeadings,
    decisionLines,
    rationaleLines,
    realSourceMarkers,
    cacheReferences,
    constitutionalItems,
    completeness: Number(completeness.toFixed(2)),
    attribution: Number(attribution.toFixed(2)),
    coherence: Number(coherence.toFixed(2)),
    composite: Number(composite.toFixed(2))
  };
}

const results = docs.map(rel => {
  const full = resolve(cwd, rel);
  const content = readFileSync(full, 'utf-8');
  return { doc: rel, ...scoreDoc(content) };
});

const summary = {
  scoredAt: new Date().toISOString(),
  rubric: 'addendum-001 §Three-way gate before implementation',
  axes: ['completeness', 'attribution', 'coherence'],
  threshold: 9.0,
  docs: results,
  overall: Number((results.reduce((s, d) => s + d.composite, 0) / results.length).toFixed(2)),
  allMeetThreshold: results.every(d => d.composite >= 9.0),
  shortfalls: results.filter(d => d.composite < 9.0).map(d => ({ doc: d.doc, composite: d.composite }))
};

const evidenceDir = resolve(cwd, '.danteforge', 'evidence');
mkdirSync(evidenceDir, { recursive: true });
const out = resolve(evidenceDir, 'comparison-doc-scores.json');
writeFileSync(out, JSON.stringify(summary, null, 2) + '\n', 'utf-8');

console.log('Comparison doc scores (3-axis rubric):');
for (const r of results) {
  const flag = r.composite >= 9.0 ? 'GREEN' : 'BELOW';
  console.log(`  ${r.doc.replace('.danteforge/OSS_HARVEST/', '')}: comp=${r.completeness} attr=${r.attribution} coh=${r.coherence} → ${r.composite} [${flag}]`);
}
console.log(`Overall: ${summary.overall}/10`);
console.log(`All ≥9.0: ${summary.allMeetThreshold}`);
console.log(`Written to ${out}`);
