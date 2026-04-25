// Artifact Compressor — write-time compression for .danteforge/ evidence artifacts (PRD-26).
// Fail-closed: if compression fails, raw content is written unchanged.

import { detectSacredSpans, containsSacredContent, injectSacredSpans } from './sacred-content.js';
import { estimateTokens } from '../token-estimator.js';
import type { ArtifactCompressionRule, CompressionResult } from './types.js';

export type ArtifactType =
  | 'audit-log'
  | 'verify-output'
  | 'prd-spec-plan'
  | 'oss-harvest'
  | 'upr-current-state'
  | 'score-report';

const ARTIFACT_RULES: Record<ArtifactType, ArtifactCompressionRule> = {
  'audit-log': {
    artifactType: 'audit-log',
    maxInjectedBytes: 2048,
    expectedRatio: 0.5,
    sacred: ['failed commands', 'gate failures', 'timestamps', 'actor ids'],
  },
  'verify-output': {
    artifactType: 'verify-output',
    maxInjectedBytes: 4096,
    expectedRatio: 0.6,
    sacred: ['all failures', 'stack traces', 'warnings'],
  },
  'prd-spec-plan': {
    artifactType: 'prd-spec-plan',
    maxInjectedBytes: 8192,
    expectedRatio: 0.4,
    sacred: ['acceptance criteria', 'gates', 'non-goals'],
  },
  'oss-harvest': {
    artifactType: 'oss-harvest',
    maxInjectedBytes: 10240,
    expectedRatio: 0.4,
    sacred: ['license evidence', 'citations', 'excluded claims'],
  },
  'upr-current-state': {
    artifactType: 'upr-current-state',
    maxInjectedBytes: 6144,
    expectedRatio: 0.5,
    sacred: ['top gaps', 'blockers', 'verification status'],
  },
  'score-report': {
    artifactType: 'score-report',
    maxInjectedBytes: 4096,
    expectedRatio: 0.4,
    sacred: ['any score below threshold', 'P0 action items'],
  },
};

export function getArtifactRule(type: ArtifactType): ArtifactCompressionRule {
  return ARTIFACT_RULES[type];
}

function compressLines(content: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes <= maxBytes) return content;

  const lines = content.split('\n');
  const targetLines = Math.floor((lines.length * maxBytes) / bytes);
  if (targetLines >= lines.length) return content;

  const head = lines.slice(0, Math.floor(targetLines * 0.7));
  const tail = lines.slice(-Math.floor(targetLines * 0.3));
  const omitted = lines.length - head.length - tail.length;
  return [
    ...head,
    `... [${omitted} lines omitted — ${Math.round((omitted / lines.length) * 100)}% of content]`,
    ...tail,
  ].join('\n');
}

export function compressArtifact(content: string, type: ArtifactType): CompressionResult {
  const rule = ARTIFACT_RULES[type];
  const originalSize = Buffer.byteLength(content, 'utf8');
  const sacredSpans = detectSacredSpans(content);

  let compressed: string;
  try {
    compressed = compressLines(content, rule.maxInjectedBytes);
  } catch {
    // Fail-closed: return raw content
    return {
      compressed: content,
      originalSize,
      compressedSize: originalSize,
      savingsPercent: 0,
      sacredSpans,
    };
  }

  if (containsSacredContent(content) && sacredSpans.length > 0) {
    compressed = injectSacredSpans(compressed, sacredSpans);
  }

  const compressedSize = Buffer.byteLength(compressed, 'utf8');
  const savedBytes = Math.max(0, originalSize - compressedSize);
  const savingsPercent = originalSize > 0 ? Math.round((savedBytes / originalSize) * 100) : 0;

  return { compressed, originalSize, compressedSize, savingsPercent, sacredSpans };
}

export function estimateCompressionTokenSavings(content: string, type: ArtifactType): number {
  const result = compressArtifact(content, type);
  const inputTokens = estimateTokens(content);
  const outputTokens = estimateTokens(result.compressed);
  return Math.max(0, inputTokens - outputTokens);
}
