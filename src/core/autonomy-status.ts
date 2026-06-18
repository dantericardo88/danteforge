// autonomy-status.ts — compute WHERE a matrix sits on the path to maximal honest autonomy, per dimension.
//
// "Out of 100" is the wrong frame (100 = literal full unattended autonomy is impossible — the irreducible
// residue is ~15: ratify-the-yardstick-on-drift + hold-standing + the externality of the trust anchor). So
// this reports the HONEST decomposition instead of a single fake number: each dimension's autonomy POSTURE
// (who must act for it to climb), the machine-autonomous COVERAGE, and the residue checklist the council
// asked for. It classifies from real state (the matrix + which dims carry a passing external receipt), so it
// can't self-flatter.

export type AutonomyPosture =
  | 'machine-grounded'     // carries a passing external-benchmark receipt → the machine grounds + climbs it, zero human/cycle
  | 'ontologically-capped' // market/adoption dim — needs real-world evidence the world hasn't produced yet; never fully autonomous
  | 'self-attested';       // scored from internal evidence only; honest ceiling ~8 until an external anchor grounds it

export interface DimAutonomy {
  id: string;
  posture: AutonomyPosture;
  derived: number;
}

export interface AutonomyReport {
  total: number;
  machineGrounded: number;
  ontologicallyCapped: number;
  selfAttested: number;
  /** Fraction of dims the machine runs autonomously today (grounded / total). This is COVERAGE. */
  machineAutonomousCoverage: number;
  /** Of the dims that COULD become autonomous (not ontologically capped), the fraction already grounded. */
  groundableCoverage: number;
  dims: DimAutonomy[];
}

/** The three meta-dims that cannot be certified above 5.0 without real-world adoption/spend evidence
 *  (CLAUDE.md: permanently market-capped). Mirrors MARKET_CAPPED_DIMS in market-dims.ts. */
const ONTOLOGICALLY_CAPPED = new Set(['community_adoption', 'enterprise_readiness', 'token_economy']);

export function classifyDimAutonomy(
  dim: { id: string; derived: number },
  isMachineGrounded: boolean,
): AutonomyPosture {
  if (isMachineGrounded) return 'machine-grounded';
  if (ONTOLOGICALLY_CAPPED.has(dim.id)) return 'ontologically-capped';
  return 'self-attested';
}

/** Build the autonomy report. `groundedIds` = dims with a PASSING external-benchmark receipt (from
 *  externalGroundingReport / isExternallyGrounded — the same source the grounding command uses). */
export function autonomyReport(
  dims: Array<{ id: string; derived: number }>,
  groundedIds: ReadonlySet<string>,
): AutonomyReport {
  const out: DimAutonomy[] = dims.map(d => ({
    id: d.id,
    derived: d.derived,
    posture: classifyDimAutonomy(d, groundedIds.has(d.id)),
  }));
  const machineGrounded = out.filter(d => d.posture === 'machine-grounded').length;
  const ontologicallyCapped = out.filter(d => d.posture === 'ontologically-capped').length;
  const selfAttested = out.filter(d => d.posture === 'self-attested').length;
  const total = out.length;
  const groundable = total - ontologicallyCapped;
  return {
    total,
    machineGrounded,
    ontologicallyCapped,
    selfAttested,
    machineAutonomousCoverage: total > 0 ? machineGrounded / total : 0,
    groundableCoverage: groundable > 0 ? machineGrounded / groundable : 0,
    dims: out,
  };
}
