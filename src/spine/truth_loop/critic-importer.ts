/**
 * External critique parser. Converts a markdown critique file (Codex/Claude/etc.)
 * into Artifact + Claims with type classification per PRD-26 section 5.4.
 */

import { readFileSync } from 'node:fs';
import type { Artifact, ArtifactSource, Claim, ClaimType } from './types.js';
import { newArtifactId, newClaimId, sha256 } from './ids.js';

export interface ImportOptions {
  runId: string;
  source: ArtifactSource;
  filePath: string;
}

export function importCritique(opts: ImportOptions): Artifact {
  const raw = readFileSync(opts.filePath, 'utf-8');
  const claims = extractClaims(raw);
  return {
    artifactId: newArtifactId(),
    runId: opts.runId,
    type: 'external_critique',
    source: opts.source,
    createdAt: new Date().toISOString(),
    uri: `file://${opts.filePath}`,
    hash: sha256(raw),
    label: `critique:${opts.source}`,
    claims
  };
}

const BULLET_RE = /^\s*(?:[-*+]|\d+\.)\s+(.*\S.*)$/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+/;

export function extractClaims(markdown: string): Claim[] {
  const out: Claim[] = [];
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    if (HEADING_RE.test(line)) continue;
    const m = BULLET_RE.exec(line);
    let text: string | null = null;
    if (m) {
      text = (m[1] ?? '').trim();
    } else if (/^[A-Z][^.\n]{8,}\.\s*$/.test(line.trim())) {
      text = line.trim();
    }
    if (!text || text.length < 6) continue;
    out.push({
      claimId: newClaimId(),
      type: classifyClaim(text),
      text
    });
  }
  return out;
}

const MECHANICAL_PATTERNS = [
  /\btests?\s+(pass|fail|are\s+passing|are\s+failing|broken)\b/i,
  /\bbuild\s+(succeeds|fails|works|broken)\b/i,
  /\b(ci|pipeline|coverage)\s+(passes|fails|drops|improves)\b/i,
  /\bexit\s*code\s*\d+/i
];

const REPO_PATTERNS = [
  /\bfile\s+\S+\s+(implements|exports|defines|contains|references)\b/i,
  /\bin\s+`[^`]+`/i,
  /\b(implements|exports|imports|defines)\b/i,
  /\bsrc\/[\w./-]+/i
];

const ARCHITECTURE_PATTERNS = [
  /\b(better|cleaner|more elegant|preferable|sound)\s+(architecture|design|approach)\b/i,
  /\bshould\s+(use|adopt|prefer)\b/i,
  /\b(elegant|brittle|coupled|decoupled|spaghetti)\b/i
];

const PREDICTION_PATTERNS = [
  /\bwill\s+(scale|improve|reduce|grow|break|increase|decrease)\b/i,
  /\b(over|after)\s+time\b/i,
  /\bin\s+the\s+future\b/i
];

const PREFERENCE_PATTERNS = [
  /\b(I|the\s+founder|user)\s+prefers?\b/i,
  /\bprefer(s|red)?\b/i,
  /\bwant(s|ed)?\s+to\b/i
];

const STRATEGIC_PATTERNS = [
  /\b(should\s+be\s+the\s+next|the\s+next\s+product|north\s+star|strategic)\b/i,
  /\b(prioritize|de-prioritize|deprioritize)\b/i,
  /\bbusiness\s+priority\b/i
];

export function classifyClaim(text: string): ClaimType {
  if (MECHANICAL_PATTERNS.some(re => re.test(text))) return 'mechanical';
  if (REPO_PATTERNS.some(re => re.test(text))) return 'repo';
  if (PREDICTION_PATTERNS.some(re => re.test(text))) return 'prediction';
  if (STRATEGIC_PATTERNS.some(re => re.test(text))) return 'strategic';
  if (PREFERENCE_PATTERNS.some(re => re.test(text))) return 'preference';
  if (ARCHITECTURE_PATTERNS.some(re => re.test(text))) return 'architecture';
  return 'architecture';
}
