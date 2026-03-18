// Context rot detection — warns and mitigates when LLM context is getting too large
import { logger } from '../../../core/logger.js';

export const CONTEXT_WARN_THRESHOLD = 120_000;
export const CONTEXT_CRITICAL_THRESHOLD = 180_000;
export const CONTEXT_TRUNCATE_TARGET = 100_000;

export interface ContextRotResult {
  level: 'ok' | 'warning' | 'critical';
  contextSize: number;
  recommendation: string;
  shouldTruncate: boolean;
  truncateTarget?: number;
}

export function checkContextRot(currentContextSize: number): ContextRotResult {
  if (currentContextSize > CONTEXT_CRITICAL_THRESHOLD) {
    logger.warn('CONTEXT ROT DETECTED — auto-truncating before next LLM call');
    return {
      level: 'critical',
      contextSize: currentContextSize,
      recommendation: 'Fresh context recommended — auto-truncating to preserve signal',
      shouldTruncate: true,
      truncateTarget: CONTEXT_TRUNCATE_TARGET,
    };
  }
  if (currentContextSize > CONTEXT_WARN_THRESHOLD) {
    logger.warn('Context getting large — consider wrapping up current wave');
    return {
      level: 'warning',
      contextSize: currentContextSize,
      recommendation: 'Consider wrapping up current wave to avoid context degradation',
      shouldTruncate: false,
    };
  }
  return {
    level: 'ok',
    contextSize: currentContextSize,
    recommendation: 'Context size is healthy',
    shouldTruncate: false,
  };
}

export function truncateContext(content: string, targetChars: number): string {
  if (content.length <= targetChars) return content;

  const keepStart = Math.floor(targetChars * 0.2);
  const keepEnd = targetChars - keepStart;
  const marker = '\n\n[...context truncated to preserve recent signal...]\n\n';

  return content.slice(0, keepStart) + marker + content.slice(content.length - keepEnd);
}
