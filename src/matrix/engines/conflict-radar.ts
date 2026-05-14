// Matrix Kernel — Conflict Radar (Phase 6 of PRD)
//
// Detects 7 high-impact conflict types BEFORE agent launch, DURING execution
// (via changed-file diff), and BEFORE merge.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkPacket } from '../types/work-graph.js';
import type { AgentLease } from '../types/lease.js';
import type { OwnershipMap } from '../types/ownership.js';
import type {
  ConflictRecord,
  ConflictReport,
  ConflictLevel,
  ConflictType,
  RecommendedAction,
} from '../types/conflict.js';
import { isPathFrozen, pathOwner } from './ownership-map.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface ScanConflictsOptions {
  workPackets: WorkPacket[];
  leases?: AgentLease[];
  ownershipMap: OwnershipMap;
  /** When provided, also runs symbol-overlap detection per packet using the file contents. */
  fileContents?: Map<string, string>;
  _now?: () => string;
}

/**
 * Run the full Conflict Radar scan. Returns a ConflictReport with per-level
 * summary counts.
 */
export function scanConflicts(options: ScanConflictsOptions): ConflictReport {
  const now = options._now ?? (() => new Date().toISOString());
  const conflicts: ConflictRecord[] = [];

  // Type 1: file_overlap (two packets write same file)
  conflicts.push(...detectFileOverlap(options.workPackets, now));

  // Type 2: path_overlap (glob-level intersection)
  conflicts.push(...detectPathOverlap(options.workPackets, now));

  // Type 3: protected_path_violation (packet's ownedPaths include a frozen path)
  conflicts.push(...detectProtectedPathViolations(options.workPackets, options.ownershipMap, now));

  // Type 4: ownership_violation (packet writes outside its claimed workstream)
  conflicts.push(...detectOwnershipViolations(options.workPackets, options.ownershipMap, now));

  // Type 5: symbol_overlap (two packets would export the same top-level symbol)
  if (options.fileContents) {
    conflicts.push(...detectSymbolOverlap(options.workPackets, options.fileContents, now));
  }

  // Type 6: test_overlap (two packets edit the same test file)
  conflicts.push(...detectTestOverlap(options.workPackets, now));

  // Type 7: duplicate_subsystem (two packets create siblings with the same stem suffix)
  conflicts.push(...detectDuplicateSubsystem(options.workPackets, now));

  return {
    generatedAt: now(),
    conflicts,
    summary: summarize(conflicts),
  };
}

export async function writeConflictReport(
  report: ConflictReport,
  cwd?: string,
): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.conflicts);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
  return outPath;
}

export function isBlockingConflict(c: ConflictRecord): boolean {
  return c.level === 'HIGH' || c.level === 'CRITICAL';
}

// ── Detectors (one function per conflict type) ─────────────────────────────

function detectFileOverlap(packets: WorkPacket[], now: () => string): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];
  for (const [i, a] of packets.entries()) {
    for (const b of packets.slice(i + 1)) {
      const aSet = new Set(a.paths.ownedPaths);
      const overlap = b.paths.ownedPaths.filter(p => aSet.has(p));
      // Exact-match overlap only here; glob overlap handled by detectPathOverlap
      const exact = overlap.filter(p => !p.includes('*'));
      if (exact.length > 0) {
        conflicts.push(makeConflict({
          type: 'file_overlap',
          level: 'HIGH',
          action: 'sequence_merge',
          packetIds: [a.id, b.id],
          description: `${a.id} and ${b.id} both write to ${exact.length} file(s): ${exact.slice(0, 3).join(', ')}`,
          affectedPaths: exact,
          now,
        }));
      }
    }
  }
  return conflicts;
}

function detectPathOverlap(packets: WorkPacket[], now: () => string): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];
  for (const [i, a] of packets.entries()) {
    for (const b of packets.slice(i + 1)) {
      const overlap = globIntersect(a.paths.ownedPaths, b.paths.ownedPaths);
      if (overlap.length > 0) {
        conflicts.push(makeConflict({
          type: 'path_overlap',
          level: 'MEDIUM',
          action: 'sequence_merge',
          packetIds: [a.id, b.id],
          description: `${a.id} and ${b.id} have overlapping owned globs`,
          affectedPaths: overlap,
          now,
        }));
      }
    }
  }
  return conflicts;
}

function detectProtectedPathViolations(
  packets: WorkPacket[],
  ownership: OwnershipMap,
  now: () => string,
): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];
  for (const p of packets) {
    const violating = p.paths.ownedPaths.filter(pp => isPathFrozen(ownership, pp));
    if (violating.length > 0) {
      conflicts.push(makeConflict({
        type: 'protected_path_violation',
        level: 'CRITICAL',
        action: 'block_immediately',
        packetIds: [p.id],
        description: `${p.id} claims ownership of frozen path(s): ${violating.join(', ')}`,
        affectedPaths: violating,
        now,
      }));
    }
  }
  return conflicts;
}

function detectOwnershipViolations(
  packets: WorkPacket[],
  ownership: OwnershipMap,
  now: () => string,
): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];
  for (const p of packets) {
    const offenders: string[] = [];
    for (const ownedPath of p.paths.ownedPaths) {
      const owner = pathOwner(ownership, ownedPath);
      // If a workstream owns this path, and the packet's dimension doesn't match
      // the workstream name, that's an ownership violation.
      if (owner && !p.dimensionId.includes(owner)) {
        // Only flag if packet does NOT also live inside the owning workstream's paths
        offenders.push(`${ownedPath} (owned by ${owner})`);
      }
    }
    if (offenders.length > 0) {
      conflicts.push(makeConflict({
        type: 'ownership_violation',
        level: 'HIGH',
        action: 'require_human_approval',
        packetIds: [p.id],
        description: `${p.id} owns paths claimed by another workstream`,
        affectedPaths: offenders,
        now,
      }));
    }
  }
  return conflicts;
}

function detectSymbolOverlap(
  packets: WorkPacket[],
  fileContents: Map<string, string>,
  now: () => string,
): ConflictRecord[] {
  // Each packet's exported symbols come from its ownedPaths files (if present).
  const packetSymbols = new Map<string, { packet: WorkPacket; symbols: Set<string> }>();
  for (const p of packets) {
    const symbols = new Set<string>();
    for (const filePath of p.paths.ownedPaths) {
      const content = fileContents.get(filePath);
      if (!content) continue;
      for (const sym of extractTopLevelExports(content)) symbols.add(sym);
    }
    packetSymbols.set(p.id, { packet: p, symbols });
  }

  const conflicts: ConflictRecord[] = [];
  const entries = Array.from(packetSymbols.values());
  for (const [i, aData] of entries.entries()) {
    for (const bData of entries.slice(i + 1)) {
      const intersection: string[] = [];
      for (const sym of aData.symbols) if (bData.symbols.has(sym)) intersection.push(sym);
      if (intersection.length > 0) {
        conflicts.push(makeConflict({
          type: 'symbol_overlap',
          level: 'HIGH',
          action: 'sequence_merge',
          packetIds: [aData.packet.id, bData.packet.id],
          description: `Packets export the same top-level symbol(s): ${intersection.join(', ')}`,
          affectedSymbols: intersection,
          now,
        }));
      }
    }
  }
  return conflicts;
}

function detectTestOverlap(packets: WorkPacket[], now: () => string): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];
  for (const [i, a] of packets.entries()) {
    for (const b of packets.slice(i + 1)) {
      const aTests = a.paths.ownedPaths.filter(isTestFile);
      const bTests = b.paths.ownedPaths.filter(isTestFile);
      const aSet = new Set(aTests);
      const overlap = bTests.filter(t => aSet.has(t));
      if (overlap.length > 0) {
        conflicts.push(makeConflict({
          type: 'test_overlap',
          level: 'MEDIUM',
          action: 'sequence_merge',
          packetIds: [a.id, b.id],
          description: `Packets edit the same test file(s)`,
          affectedPaths: overlap,
          now,
        }));
      }
    }
  }
  return conflicts;
}

function detectDuplicateSubsystem(packets: WorkPacket[], now: () => string): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];
  // Detect: two packets each propose a new file with the same `-types.ts` / `-utils.ts` stem
  const stemSuffixes = ['-types.ts', '-utils.ts', '-helpers.ts', '-config.ts'];
  const stemMap = new Map<string, string[]>();  // stem → packet IDs
  for (const p of packets) {
    for (const ownedPath of p.paths.ownedPaths) {
      for (const suffix of stemSuffixes) {
        if (ownedPath.endsWith(suffix)) {
          const stem = ownedPath.slice(0, -suffix.length);
          const list = stemMap.get(`${stem}${suffix}`) ?? [];
          list.push(p.id);
          stemMap.set(`${stem}${suffix}`, list);
        }
      }
    }
  }
  for (const [stem, packetIds] of stemMap) {
    if (packetIds.length > 1) {
      conflicts.push(makeConflict({
        type: 'duplicate_subsystem',
        level: 'HIGH',
        action: 'require_human_approval',
        packetIds,
        description: `Multiple packets propose the same subsystem file: ${stem}`,
        affectedPaths: [stem],
        now,
      }));
    }
  }
  return conflicts;
}

// ── Internal helpers ────────────────────────────────────────────────────────

interface MakeConflictArgs {
  type: ConflictType;
  level: ConflictLevel;
  action: RecommendedAction;
  packetIds: string[];
  description: string;
  affectedPaths?: string[];
  affectedSymbols?: string[];
  now: () => string;
}

function makeConflict(args: MakeConflictArgs): ConflictRecord {
  return {
    conflictId: `conflict.${args.type}.${stamp(args.now())}.${Math.floor(Math.random() * 9999)}`,
    level: args.level,
    type: args.type,
    detectedAt: args.now(),
    workPacketIds: args.packetIds,
    description: args.description,
    recommendedAction: args.action,
    affectedPaths: args.affectedPaths,
    affectedSymbols: args.affectedSymbols,
  };
}

function summarize(conflicts: ConflictRecord[]): ConflictReport['summary'] {
  const summary = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const c of conflicts) {
    if (c.level === 'LOW') summary.low++;
    else if (c.level === 'MEDIUM') summary.medium++;
    else if (c.level === 'HIGH') summary.high++;
    else if (c.level === 'CRITICAL') summary.critical++;
  }
  return summary;
}

function globIntersect(a: string[], b: string[]): string[] {
  const results = new Set<string>();
  for (const ga of a) {
    for (const gb of b) {
      if (ga === gb) { results.add(ga); continue; }
      // Glob-prefix overlap: if one is prefix of the other (e.g. "src/**" and "src/foo/**")
      const baseA = ga.replace(/\*\*?$/, '').replace(/\/$/, '');
      const baseB = gb.replace(/\*\*?$/, '').replace(/\/$/, '');
      if (baseA && baseB && (baseA.startsWith(baseB) || baseB.startsWith(baseA))) {
        results.add(ga.length < gb.length ? ga : gb);
      }
    }
  }
  return Array.from(results);
}

function isTestFile(p: string): boolean {
  return p.endsWith('.test.ts') || p.endsWith('.spec.ts') || p.includes('/tests/');
}

function extractTopLevelExports(content: string): string[] {
  const results = new Set<string>();
  const exportRegex = /^export\s+(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+(\w+)/gm;
  let match: RegExpExecArray | null;
  while ((match = exportRegex.exec(content)) !== null) {
    results.add(match[1]!);
  }
  return Array.from(results);
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}
