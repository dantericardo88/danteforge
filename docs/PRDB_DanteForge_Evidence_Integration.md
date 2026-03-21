# PRD B: DanteForge Evidence Integration — Cryptographic Evidence Spine

## Document Control

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Codename** | Soul Seal — Part B (Proprietary Integration) |
| **Author** | Council of Minds (Claude Opus + Ricky) |
| **License** | PROPRIETARY — DanteForge IP |
| **Depends On** | PRD A (`@dantecode/evidence-chain`) must be complete first |
| **Modified Package** | `@dantecode/debug-trail` |
| **Modified Files** | `CONSTITUTION.md`, root `package.json`, `turbo.json` |
| **Branch** | `feat/dantecode-9plus-complete-matrix` |
| **Estimated LOC** | ~1,200 source + ~800 tests |
| **Estimated Files** | 12 (6 new + 6 modified) |

---

## 1. Purpose

This PRD wires the open-source `@dantecode/evidence-chain` cryptographic primitives into DanteCode's proprietary verification and audit infrastructure. It is the integration layer that makes every DanteForge verification, every tool call, every file mutation, and every agent decision produce cryptographic proof.

**This is the moat.** The primitives in PRD A are public and auditable. The intelligence about *what* to evidence, *when* to create receipts, *how* to classify events, and *how to seal sessions with DanteForge scores* — that is proprietary DanteForge IP. A competitor can fork `evidence-chain` and build Merkle trees. They cannot replicate the integration depth without rebuilding DanteForge from scratch.

---

## 2. Prerequisite

**PRD A must be complete and passing before starting this PRD.**

Verify:
```bash
cd packages/evidence-chain && npx vitest run  # All pass
npx tsc --noEmit                              # Clean
```

The following imports must be available:
```typescript
import {
  HashChain, MerkleTree, MerkleProofStep,
  Receipt, createReceipt, ReceiptChain,
  EvidenceBundleData, createEvidenceBundle, verifyBundle,
  EvidenceSealer, CertificationSeal,
  EvidenceType, sha256, hashDict, stableJSON,
} from "@dantecode/evidence-chain";
```

---

## 3. Architecture: What Changes

```
evidence-chain (open-source, zero deps)      ← PRD A (DONE)
    ↑
debug-trail (proprietary, imports evidence-chain)  ← THIS PRD
    ↑
core, cli, danteforge, vscode (import debug-trail as before — NO changes to these)
```

**Key constraint:** The public API of `debug-trail` does NOT change. All existing consumers (`core`, `cli`, `danteforge`, `vscode`) continue importing `debug-trail` as before. The evidence spine is internal to `debug-trail` — consumers get cryptographic proofs without any code changes.

---

## 4. Phase 1: Wire Evidence Into AuditLogger

### 4.1 — Add dependency

**File:** `packages/debug-trail/package.json`

Add to `dependencies`:
```json
"@dantecode/evidence-chain": "workspace:*"
```

### 4.2 — Modify AuditLogger

**File:** `packages/debug-trail/src/audit-logger.ts`

**Current state:** The `AuditLogger` class has `log()`, `flush()`, and convenience methods (`logToolCall`, `logFileWrite`, etc.). It writes to SQLite via `TrailStore`, buffers events for anomaly detection, and maintains a write queue for ordering.

**What to add — three new private fields initialized in `init()`:**

```typescript
// NEW IMPORTS (add at top)
import {
  HashChain, MerkleTree, ReceiptChain, createReceipt,
  createEvidenceBundle, EvidenceSealer,
  EvidenceType, hashDict,
} from "@dantecode/evidence-chain";
import type {
  EvidenceBundleData, CertificationSeal, Receipt,
} from "@dantecode/evidence-chain";

// NEW PRIVATE FIELDS (add to class body)
private evidenceChain: HashChain<EvidenceBundleData> | null = null;
private receiptChain: ReceiptChain | null = null;
private sessionMerkle: MerkleTree | null = null;
private evidenceSeq = 0;
private lastBundleHash = "0".repeat(64); // genesis link
```

**Initialize in `init()` method (after existing SQLite init, ~line 112):**

```typescript
// ---- Evidence Chain Init (Soul Seal) ----
this.evidenceChain = new HashChain<EvidenceBundleData>(
  createEvidenceBundle({
    runId: this.provenance.runId ?? this.provenance.sessionId,
    seq: 0,
    organ: "audit-logger",
    eventType: EvidenceType.SESSION_STARTED,
    evidence: {
      sessionId: this.provenance.sessionId,
      startedAt: new Date().toISOString(),
    },
    prevHash: "0".repeat(64),
  }),
  { type: "dantecode_session", version: "1.0.0" },
);
this.lastBundleHash = this.evidenceChain.headHash;
this.receiptChain = new ReceiptChain();
this.sessionMerkle = new MerkleTree();
```

### 4.3 — Modify `log()` method

**After the existing SQLite write and index update (~line 200, after `this.onNewEvent?.()`)**, add evidence emission:

```typescript
// ---- Evidence Chain: emit bundle for this event ----
if (this.evidenceChain) {
  this.evidenceSeq++;
  const bundle = createEvidenceBundle({
    runId: this.provenance.runId ?? this.provenance.sessionId,
    seq: this.evidenceSeq,
    organ: actor,
    eventType: this.mapKindToEvidenceType(kind),
    evidence: { kind, actor, summary, ...payload },
    prevHash: this.lastBundleHash,
    metadata: extras?.provenance ? { provenance: extras.provenance } : undefined,
  });
  this.evidenceChain.append(bundle);
  this.lastBundleHash = this.evidenceChain.headHash;
  this.sessionMerkle!.addLeaf(bundle.hash);

  // State-changing events get receipts
  if (this.isStateChanging(kind) && extras?.beforeHash && extras?.afterHash) {
    const receipt = createReceipt({
      correlationId: this.provenance.sessionId,
      actor,
      action: `${kind}:${summary.slice(0, 100)}`,
      beforeState: extras.beforeHash,
      afterState: extras.afterHash,
    });
    this.receiptChain!.append(receipt);
    // Store receipt ID on the event (optional field)
    event.receiptId = receipt.receiptId;
    event.evidenceBundleId = bundle.bundleId;
  } else {
    event.evidenceBundleId = bundle.bundleId;
  }
}
```

**Add two private helper methods to AuditLogger:**

```typescript
/** Map TrailEventKind to EvidenceType. */
private mapKindToEvidenceType(kind: TrailEventKind): EvidenceType {
  const MAP: Record<string, EvidenceType> = {
    "tool_call": EvidenceType.TOOL_CALL,
    "tool_result": EvidenceType.TOOL_RESULT,
    "tool_error": EvidenceType.TOOL_ERROR,
    "file_write": EvidenceType.FILE_WRITE,
    "file_delete": EvidenceType.FILE_DELETE,
    "file_move": EvidenceType.FILE_MOVE,
    "file_restore": EvidenceType.FILE_RESTORE,
    "model_decision": EvidenceType.MODEL_DECISION,
    "verification": EvidenceType.VERIFICATION_STARTED,
    "constitution_check": EvidenceType.CONSTITUTION_CHECK,
    "git_commit": EvidenceType.GIT_COMMIT,
    "anomaly_flag": EvidenceType.ANOMALY_DETECTED,
    "checkpoint": EvidenceType.CHECKPOINT_CREATED,
    "sandbox_exec": EvidenceType.SANDBOX_EXEC_START,
    "session_start": EvidenceType.SESSION_STARTED,
    "session_end": EvidenceType.SESSION_COMPLETED,
  };
  return MAP[kind] ?? EvidenceType.TOOL_CALL;
}

/** Determine if an event kind is state-changing (deserves a receipt). */
private isStateChanging(kind: TrailEventKind): boolean {
  return ["file_write", "file_delete", "file_move", "tool_call", "git_commit"].includes(kind);
}
```

### 4.4 — Modify `flush()` method

**After existing anomaly detection and before `await this.store.flush()` (~line 570)**, add chain integrity verification:

```typescript
// ---- Evidence Chain: verify integrity on flush ----
if (this.evidenceChain) {
  const chainIntact = this.evidenceChain.verifyIntegrity();
  // Log the integrity check as an evidence event
  const verifyBundle = createEvidenceBundle({
    runId: this.provenance.runId ?? this.provenance.sessionId,
    seq: ++this.evidenceSeq,
    organ: "evidence-system",
    eventType: EvidenceType.CHAIN_INTEGRITY_CHECK,
    evidence: {
      chainLength: this.evidenceChain.length,
      merkleRoot: this.sessionMerkle!.root,
      receiptCount: this.receiptChain!.size,
      integrityVerified: chainIntact,
    },
    prevHash: this.lastBundleHash,
  });
  this.evidenceChain.append(verifyBundle);
  this.lastBundleHash = this.evidenceChain.headHash;

  if (!chainIntact) {
    // HARD system error per Constitution Rule 6
    await this.log("anomaly_flag", "evidence-system",
      "CRITICAL: Evidence chain integrity verification FAILED — chain may be tampered",
      { chainLength: this.evidenceChain.length, headHash: this.evidenceChain.headHash });
  }
}
```

### 4.5 — Add new public methods to AuditLogger

```typescript
/** Get the current session's evidence chain statistics. */
getChainStats(): {
  chainLength: number;
  merkleRoot: string;
  receiptCount: number;
  headHash: string;
  integrityVerified: boolean;
} | null {
  if (!this.evidenceChain) return null;
  return {
    chainLength: this.evidenceChain.length,
    merkleRoot: this.sessionMerkle!.root,
    receiptCount: this.receiptChain!.size,
    headHash: this.evidenceChain.headHash,
    integrityVerified: this.evidenceChain.verifyIntegrity(),
  };
}

/** Seal the current session with a CertificationSeal. */
sealSession(
  config: Record<string, unknown>,
  metrics: Record<string, unknown>[],
): CertificationSeal | null {
  if (!this.evidenceChain || !this.sessionMerkle) return null;
  const sealer = new EvidenceSealer();
  const seal = sealer.createSeal({
    sessionId: this.provenance.sessionId,
    evidenceRootHash: this.sessionMerkle.root,
    config,
    metrics,
    eventCount: this.evidenceChain.length,
  });
  // Log the seal creation as the final evidence event
  this.evidenceSeq++;
  const sealBundle = createEvidenceBundle({
    runId: this.provenance.runId ?? this.provenance.sessionId,
    seq: this.evidenceSeq,
    organ: "evidence-sealer",
    eventType: EvidenceType.SESSION_SEAL_CREATED,
    evidence: { sealId: seal.sealId, sealHash: seal.sealHash },
    prevHash: this.lastBundleHash,
  });
  this.evidenceChain.append(sealBundle);
  this.lastBundleHash = this.evidenceChain.headHash;
  return seal;
}

/** Export the evidence chain for external verification. */
exportEvidenceChain(): {
  chain: ReturnType<HashChain<EvidenceBundleData>["exportToJSON"]>;
  receipts: ReturnType<ReceiptChain["exportToJSON"]>;
  merkleRoot: string;
} | null {
  if (!this.evidenceChain) return null;
  return {
    chain: this.evidenceChain.exportToJSON(),
    receipts: this.receiptChain!.exportToJSON(),
    merkleRoot: this.sessionMerkle!.root,
  };
}
```

---

## 5. Phase 2: EvidenceBridge

### 5.1 — New file: `packages/debug-trail/src/integrations/evidence-bridge.ts`

This bridge provides a clean interface for other packages to access the evidence system without directly depending on `evidence-chain`.

```typescript
import type { AuditLogger } from "../audit-logger.js";
import type { CertificationSeal, MerkleProofStep, Receipt } from "@dantecode/evidence-chain";
import { EvidenceSealer } from "@dantecode/evidence-chain";

/**
 * Bridge between the debug-trail audit system and the evidence-chain
 * cryptographic primitives. Provides a stable API for other DanteCode
 * packages to access evidence without direct evidence-chain dependency.
 */
export class EvidenceBridge {
  constructor(private logger: AuditLogger) {}

  /** Get the current session's Merkle root. */
  getSessionMerkleRoot(): string | null {
    return this.logger.getChainStats()?.merkleRoot ?? null;
  }

  /** Verify the current chain integrity. */
  verifyChainIntegrity(): boolean {
    return this.logger.getChainStats()?.integrityVerified ?? false;
  }

  /** Get chain statistics. */
  getChainStats(): {
    chainLength: number;
    merkleRoot: string;
    receiptCount: number;
    headHash: string;
    integrityVerified: boolean;
  } | null {
    return this.logger.getChainStats();
  }

  /** Seal the current session. */
  sealSession(
    config: Record<string, unknown>,
    metrics: Record<string, unknown>[],
  ): CertificationSeal | null {
    return this.logger.sealSession(config, metrics);
  }

  /** Verify a previously created seal. */
  verifySeal(
    seal: CertificationSeal,
    config: Record<string, unknown>,
    metrics: Record<string, unknown>[],
  ): boolean {
    const sealer = new EvidenceSealer();
    return sealer.verifySeal(seal, config, metrics);
  }

  /** Export the full evidence chain for external verification. */
  exportEvidence(): ReturnType<AuditLogger["exportEvidenceChain"]> {
    return this.logger.exportEvidenceChain();
  }
}
```

---

## 6. Phase 3: Export Engine + Replay Verification

### 6.1 — Modify `packages/debug-trail/src/export-engine.ts`

The existing export engine generates forensic reports. Enhance it to include evidence data and seals.

**Add to the export output structure:**
```typescript
// In the exportSession() or equivalent method, add:
const evidenceExport = this.logger.exportEvidenceChain();
if (evidenceExport) {
  report.evidence = {
    chain: evidenceExport.chain,
    receipts: evidenceExport.receipts,
    merkleRoot: evidenceExport.merkleRoot,
  };
}

// If seal is requested:
if (options?.seal && options.config) {
  const seal = this.logger.sealSession(options.config, options.metrics ?? []);
  if (seal) {
    report.seal = seal;
    report.verificationInstructions = [
      "This export includes a CertificationSeal.",
      "To verify: install @dantecode/evidence-chain (MIT, npm)",
      "Use EvidenceSealer.verifySeal(seal, config, metrics) with the original config and metrics.",
      "The seal hash covers: evidence Merkle root + config hash + metrics hash.",
      "Any modification to any event, config value, or metric will fail verification.",
    ];
  }
}
```

### 6.2 — Modify `packages/debug-trail/src/replay-orchestrator.ts`

Add hash-based replay verification method. The existing replay orchestrator replays event sequences. This enhancement adds output hash comparison.

**Add new method:**
```typescript
import { sha256 } from "@dantecode/evidence-chain";
import { readFile } from "node:fs/promises";

export interface ReplayVerification {
  eventId: string;
  action: string;
  originalHash: string;
  replayHash: string;
  matched: boolean;
}

/**
 * Verify replay determinism by comparing output hashes.
 * Ported from DanteLiteV2/core/replay_engine.py pattern.
 */
async verifyReplayDeterminism(sessionId: string): Promise<{
  total: number;
  matched: number;
  diverged: number;
  determinismRate: number;
  results: ReplayVerification[];
}> {
  // Fetch all file_write events for this session from the trail store
  const events = await this.store.queryBySession(sessionId);
  const fileWriteEvents = events.filter(
    e => e.kind === "file_write" && e.afterHash,
  );

  const results: ReplayVerification[] = [];
  let matched = 0;
  let diverged = 0;

  for (const event of fileWriteEvents) {
    const filePath = event.payload?.path as string | undefined;
    if (!filePath || !event.afterHash) continue;

    let currentHash: string;
    try {
      const content = await readFile(filePath, "utf8");
      currentHash = sha256(content);
    } catch {
      currentHash = "file_missing";
    }

    const isMatch = currentHash === event.afterHash;
    results.push({
      eventId: event.id,
      action: `file_write:${filePath}`,
      originalHash: event.afterHash,
      replayHash: currentHash,
      matched: isMatch,
    });

    if (isMatch) matched++;
    else diverged++;
  }

  const total = matched + diverged;
  return {
    total,
    matched,
    diverged,
    determinismRate: total > 0 ? matched / total : 1.0,
    results,
  };
}
```

---

## 7. Phase 4: Types, Exports, Constitution, CLI

### 7.1 — Modify `packages/debug-trail/src/types.ts`

Add two optional fields to `TrailEvent` (additive only, no breaking changes):

```typescript
export interface TrailEvent {
  // ... all existing fields unchanged ...

  /** Evidence bundle ID (from evidence-chain). Added by Soul Seal. */
  evidenceBundleId?: string;
  /** Receipt ID for state-changing events. Added by Soul Seal. */
  receiptId?: string;
}
```

### 7.2 — Modify `packages/debug-trail/src/index.ts`

Add exports for the evidence bridge and re-exported types:

```typescript
// --- Evidence Chain Integration (Soul Seal) ---
export { EvidenceBridge } from "./integrations/evidence-bridge.js";

// Re-export commonly needed evidence types for consumers
export type {
  CertificationSeal,
  EvidenceBundleData,
  Receipt,
  MerkleProofStep,
} from "@dantecode/evidence-chain";
export { EvidenceType } from "@dantecode/evidence-chain";
```

### 7.3 — CONSTITUTION.md Rule 6 Upgrade

**Replace current Rule 6 with:**

> ## 6. Cryptographic Evidence Chain
>
> **HARD RULE — Tamper-evident logging.**
>
> Every decision, gate score, lesson, and action is recorded as a cryptographic evidence bundle.
>
> - Each event is SHA-256 hash-chained to the previous event. Tampering breaks the chain.
> - Each event is a leaf in the session's Merkle tree. One root hash proves everything.
> - State-changing operations (file writes, tool calls) produce cryptographic receipts with before_hash → after_hash provenance.
> - Sessions are sealed on completion with a composite CertificationSeal.
> - `verifyIntegrity()` is called on every flush. A broken chain is a HARD system error.
> - Exports include the full chain, Merkle root, all receipts, and the session seal.
>
> Storage: `.dantecode/debug-trail/` (SQLite + evidence chain).

### 7.4 — CLI Commands

**Add to the existing debug-trail CLI bridge** (or create new slash commands):

- `/evidence stats` — Print chain length, Merkle root, receipt count, integrity status
- `/evidence verify` — Run full chain integrity verification, print result
- `/evidence seal` — Seal current session, print seal hash and sealId
- `/evidence export <path>` — Export full evidence chain + seal to JSON file

These are lightweight wrappers around `EvidenceBridge` methods. Register in the slash command system.

---

## 8. Test Specifications

### 8.1 — `audit-logger.evidence.test.ts` (~8 tests)

1. Log a `file_write` event → evidence chain length increases by 1
2. Log a `file_write` with `beforeHash`/`afterHash` → receipt is created
3. Log 100 events → `verifyIntegrity()` returns true
4. Log 100 events → Merkle root is deterministic (same events → same root across 3 runs)
5. `flush()` verifies chain integrity automatically
6. `getChainStats()` returns correct counts
7. `sealSession()` produces valid seal
8. `exportEvidenceChain()` includes chain + receipts + merkleRoot

### 8.2 — `evidence-bridge.test.ts` (~6 tests)

1. `getSessionMerkleRoot()` returns valid hex string after events logged
2. `verifyChainIntegrity()` returns true on clean session
3. `getChainStats()` matches direct logger stats
4. `sealSession()` → `verifySeal()` roundtrip passes
5. `sealSession()` with modified config → `verifySeal()` returns false
6. `exportEvidence()` returns complete structure

### 8.3 — `export-engine.evidence.test.ts` (~4 tests)

1. Export includes `evidence` section with chain and receipts
2. Export with seal includes `seal` and `verificationInstructions`
3. Sealed export has valid `sealHash`
4. Export without evidence (legacy session) gracefully returns null evidence

### 8.4 — `replay-verifier.test.ts` (~4 tests)

1. Session with file writes → replay matches → determinismRate = 1.0
2. Session with file writes → modify one file → replay detects divergence
3. Session with no file writes → determinismRate = 1.0 (empty set)
4. Session with deleted file → replayHash = "file_missing"

**Total: ~22 tests. Target: 100% coverage on new code, 0 regressions on existing tests.**

---

## 9. File Inventory

### NEW Files

| # | Path | LOC Est. | Description |
|---|---|---|---|
| 1 | `packages/debug-trail/src/integrations/evidence-bridge.ts` | 80 | Bridge class |
| 2 | `packages/debug-trail/src/__tests__/audit-logger.evidence.test.ts` | 250 | Logger + chain integration tests |
| 3 | `packages/debug-trail/src/__tests__/evidence-bridge.test.ts` | 180 | Bridge tests |
| 4 | `packages/debug-trail/src/__tests__/export-engine.evidence.test.ts` | 120 | Export + seal tests |
| 5 | `packages/debug-trail/src/__tests__/replay-verifier.test.ts` | 120 | Replay verification tests |

### MODIFIED Files

| # | Path | Change |
|---|---|---|
| 6 | `packages/debug-trail/package.json` | Add `@dantecode/evidence-chain` dependency |
| 7 | `packages/debug-trail/src/audit-logger.ts` | Add evidence chain fields, modify `log()` and `flush()`, add `getChainStats()`, `sealSession()`, `exportEvidenceChain()` |
| 8 | `packages/debug-trail/src/types.ts` | Add `evidenceBundleId?` and `receiptId?` to TrailEvent |
| 9 | `packages/debug-trail/src/export-engine.ts` | Include evidence + seal in exports |
| 10 | `packages/debug-trail/src/replay-orchestrator.ts` | Add `verifyReplayDeterminism()` |
| 11 | `packages/debug-trail/src/index.ts` | Export EvidenceBridge + re-exported types |
| 12 | `CONSTITUTION.md` | Upgrade Rule 6 |

### Total: 5 new files + 7 modified files, ~1,200 LOC new code

---

## 10. Backwards Compatibility

This is critical. The integration MUST NOT break any existing consumer.

- **No existing SQLite schema changes** — additive optional columns only
- **TrailEvent gains 2 optional fields** — `evidenceBundleId?`, `receiptId?`
- **All existing AuditLogger public methods unchanged** — new methods are additive
- **All existing debug-trail tests pass without modification** — 0 regressions
- **Sessions created before Soul Seal** — evidence chain is `null`, all new methods return `null` or empty. No errors.
- **Performance** — SHA-256 adds < 0.05ms per event. SQLite write (1-5ms) remains the bottleneck.

---

## 11. Claude Code Execution Instructions

**This is a 4-phase build. Each phase must pass GStack before proceeding.**

```
PREREQUISITE: Verify PRD A is complete
  cd packages/evidence-chain && npx vitest run  # Must all pass

Phase 1: Modify AuditLogger (section 4)
  - Add evidence-chain dependency to debug-trail/package.json
  - Add imports, fields, init logic to audit-logger.ts
  - Modify log() to emit evidence bundles + receipts
  - Modify flush() to verify chain integrity
  - Add getChainStats(), sealSession(), exportEvidenceChain()
  - Add helper methods: mapKindToEvidenceType(), isStateChanging()
  - Modify types.ts: add evidenceBundleId?, receiptId?
  Run: cd packages/debug-trail && npx vitest run
  MUST: All existing tests still pass. Zero regressions.

Phase 2: EvidenceBridge + tests (section 5)
  - Create integrations/evidence-bridge.ts
  - Create audit-logger.evidence.test.ts
  - Create evidence-bridge.test.ts
  - Update index.ts with new exports
  Run: cd packages/debug-trail && npx vitest run

Phase 3: Export + Replay (section 6)
  - Modify export-engine.ts
  - Modify replay-orchestrator.ts
  - Create export-engine.evidence.test.ts
  - Create replay-verifier.test.ts
  Run: npx turbo test

Phase 4: Constitution + CLI (section 7)
  - Update CONSTITUTION.md Rule 6
  - Add /evidence slash commands (stats, verify, seal, export)
  Run: npx turbo build && npx turbo test
```

**Rules:**
- KiloCode: every file complete, under 500 LOC, no stubs
- Anti-Stub Absolute: zero TODOs, FIXMEs, `throw new Error("not implemented")`, empty bodies
- TypeScript `strict: true`, no `as any`, no `@ts-ignore`
- PDSE ≥ 85 on all new and modified files
- **ZERO regressions on existing debug-trail tests** — this is the hard constraint
- All new AuditLogger methods must handle `evidenceChain === null` gracefully (pre-Soul Seal sessions)

---

## 12. Success Criteria

| Criteria | Target |
|---|---|
| Chain integrity verified on every flush | 100% |
| All file_write events have receipts (when hashes provided) | 100% |
| Merkle root deterministic (same events → same root) | 100% |
| sealSession → verifySeal roundtrip | 100% |
| Existing debug-trail tests | 0 regressions |
| Evidence overhead per event | < 1ms |
| Anti-stub scanner | 0 violations |
| New code coverage | 80%+ line |

---

## 13. What This Makes Possible (Future — Separate PRDs)

1. **Cross-session chain linkage** — genesis includes previous session's seal hash
2. **Signed seals** — cosign/in-toto integration for cryptographic signatures
3. **Remote attestation** — publish Merkle roots to RFC 3161 timestamping service
4. **Compliance exports** — ISO 27001 / SOC 2 audit trail reports from evidence chain
5. **Multi-agent provenance** — each council lane gets its own sub-chain, council decision links all
6. **DanteForge Cloud** — hosted seal verification, compliance dashboards, team-wide evidence analytics

---

*The primitives are open. The integration is the moat. Build it right.*
