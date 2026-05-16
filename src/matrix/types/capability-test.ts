// Matrix Kernel — Capability Test types (Fix A: eliminate self-scoring)
//
// Every dimension must declare a capability_test: a shell command that exits 0
// only when the underlying capability produces real, validated output.
// Dimensions without a passing capability_test are hard-capped at 5.0.

export interface CapabilityTestSpec {
  /** Shell command that probes the real capability. Exit 0 = capability present. */
  command: string;
  /** Human-readable explanation of what this tests. */
  description: string;
  /** Timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
}

export interface CapabilityTestResult {
  dimensionId: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  ranAt: string;
}

/** Dimension marks this flag when no automated capability test is possible. */
export interface NoCapabilityTestMarker {
  no_capability_test: true;
  /** Reason why no capability test is possible (e.g. "requires live API key"). */
  reason: string;
}

export type CapabilityTestEntry = CapabilityTestSpec | NoCapabilityTestMarker;

/** Type guard: is this a "no test possible" marker? */
export function isNoCapabilityTest(v: unknown): v is NoCapabilityTestMarker {
  return typeof v === 'object' && v !== null
    && (v as Record<string, unknown>).no_capability_test === true;
}

/** Type guard: is this a real test spec? */
export function isCapabilityTestSpec(v: unknown): v is CapabilityTestSpec {
  return typeof v === 'object' && v !== null
    && typeof (v as Record<string, unknown>).command === 'string'
    && typeof (v as Record<string, unknown>).description === 'string';
}

/** Max score allowed for a dimension without a passing capability_test. */
export const CAPABILITY_TEST_SCORE_CAP = 5.0;
