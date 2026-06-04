// autonomy-cap — autonomous score advancement tops out at 9.0.
//
// 10.0 is defined (Depth Doctrine + council consensus) as human-curated excellence PLUS an external
// benchmark — both structurally non-automatable. A loop that targets 10 optimizes for score theater:
// it will manufacture evidence to clear a bar only a human can legitimately certify. So every
// autonomous command's target funnels through here, and no campaign/crusade/frontier loop can chase a
// score above the autonomous ceiling. (A human promotes the final 9→10 by stamping a benchmark-backed
// evidence package — not a loop.)

import { logger } from './logger.js';

/** The highest score an unattended loop may target. 9.5/10 require human certification. */
export const MAX_AUTONOMOUS_TARGET = 9.0;

/** Clamp a requested target to the autonomous ceiling. Pure — callers warn on a clamp. */
export function clampAutonomousTarget(requested: number): number {
  if (!Number.isFinite(requested)) return MAX_AUTONOMOUS_TARGET;
  return Math.min(requested, MAX_AUTONOMOUS_TARGET);
}

/**
 * Resolve an autonomous command's effective target: apply its default, clamp to the 9.0 ceiling, and
 * warn loudly if the request was clamped. Every autonomous entry point should resolve its target here.
 */
export function resolveAutonomousTarget(requested: number | undefined, fallback: number): number {
  const raw = requested ?? fallback;
  const capped = clampAutonomousTarget(raw);
  if (Number.isFinite(raw) && raw > capped) {
    logger.warn(`[autonomy-cap] target ${raw} exceeds the autonomous ceiling — clamped to ${MAX_AUTONOMOUS_TARGET}. 10.0 is human-certified (external benchmark + taste), never a loop target.`);
  }
  return capped;
}
