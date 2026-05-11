// DanteSanitize — AST-based boundary selection (Phase 1)
// Builds a symbol-reference graph, runs PageRank-style ranking,
// returns a SplitPlan derived deterministically from the code structure.
//
// This is the cheap, free, offline alternative to LLM analysis.
// Sprint 2 of the v2 plan.
import path from 'path';
import { createRequire } from 'module';
import type { SplitPlan, SymbolGraph, SymbolNode, SymbolKind } from './sanitize-types.js';

const require_ = createRequire(import.meta.url);

// ── Build symbol graph from TypeScript AST ──────────────────────────────────

export function buildSymbolGraph(content: string, filePath: string): SymbolGraph {
  let ts: typeof import('typescript');
  try {
    ts = require_('typescript');
  } catch {
    return { filePath, totalLoc: 0, nodes: new Map() };
  }

  const sf = ts.createSourceFile(
    path.basename(filePath),
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const nodes = new Map<string, SymbolNode>();
  const lineMap = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  // First pass: collect top-level declarations
  for (const stmt of sf.statements) {
    const exported = hasExportModifier(ts, stmt);

    if (ts.isInterfaceDeclaration(stmt)) {
      addNode(nodes, stmt.name.text, 'interface', lineMap(stmt.pos), lineMap(stmt.end), exported);
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      addNode(nodes, stmt.name.text, 'type', lineMap(stmt.pos), lineMap(stmt.end), exported);
    } else if (ts.isEnumDeclaration(stmt)) {
      addNode(nodes, stmt.name.text, 'enum', lineMap(stmt.pos), lineMap(stmt.end), exported);
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      addNode(nodes, stmt.name.text, 'class', lineMap(stmt.pos), lineMap(stmt.end), exported);
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      addNode(nodes, stmt.name.text, 'function', lineMap(stmt.pos), lineMap(stmt.end), exported);
    } else if (ts.isVariableStatement(stmt)) {
      const flags = stmt.declarationList.flags;
      const kind: SymbolKind = (flags & ts.NodeFlags.Const) ? 'const'
        : (flags & ts.NodeFlags.Let) ? 'let' : 'var';
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          addNode(nodes, decl.name.text, kind, lineMap(stmt.pos), lineMap(stmt.end), exported);
        }
      }
    }
  }

  // Second pass: walk each top-level statement, collect references to OTHER top-level symbols
  for (const stmt of sf.statements) {
    const ownerName = extractDeclName(ts, stmt);
    if (!ownerName || !nodes.has(ownerName)) continue;
    const owner = nodes.get(ownerName)!;
    visitIdentifiers(ts, stmt, (idText) => {
      if (idText !== ownerName && nodes.has(idText)) {
        owner.references.add(idText);
      }
    });
  }

  return {
    filePath,
    totalLoc: content.split(/\r?\n/).length,
    nodes,
  };
}

function hasExportModifier(ts: typeof import('typescript'), stmt: import('typescript').Statement): boolean {
  const modifiers = (stmt as { modifiers?: readonly import('typescript').Modifier[] }).modifiers;
  return modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function extractDeclName(ts: typeof import('typescript'), stmt: import('typescript').Statement): string | null {
  if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
    return stmt.name.text;
  }
  if (ts.isClassDeclaration(stmt) && stmt.name) return stmt.name.text;
  if (ts.isFunctionDeclaration(stmt) && stmt.name) return stmt.name.text;
  if (ts.isVariableStatement(stmt)) {
    const first = stmt.declarationList.declarations[0];
    if (first && ts.isIdentifier(first.name)) return first.name.text;
  }
  return null;
}

function visitIdentifiers(
  ts: typeof import('typescript'),
  node: import('typescript').Node,
  cb: (idText: string) => void,
): void {
  if (ts.isIdentifier(node)) cb(node.text);
  ts.forEachChild(node, (child) => visitIdentifiers(ts, child, cb));
}

function addNode(
  nodes: Map<string, SymbolNode>,
  id: string,
  kind: SymbolKind,
  startLine: number,
  endLine: number,
  exported: boolean,
): void {
  if (nodes.has(id)) return;
  nodes.set(id, {
    id, kind, startLine, endLine,
    loc: Math.max(1, endLine - startLine + 1),
    references: new Set(),
    exported,
  });
}

// ── PageRank ────────────────────────────────────────────────────────────────

export interface PageRankOptions {
  iterations?: number;   // default 50
  dampening?: number;    // default 0.85
  tolerance?: number;    // convergence threshold; default 1e-4
}

export function runPageRank(
  graph: SymbolGraph,
  options: PageRankOptions = {},
): Map<string, number> {
  const N = graph.nodes.size;
  if (N === 0) return new Map();

  const d = options.dampening ?? 0.85;
  const maxIter = options.iterations ?? 50;
  const tol = options.tolerance ?? 1e-4;

  // Build reverse adjacency: for each node, who references it
  const inbound = new Map<string, string[]>();
  for (const id of graph.nodes.keys()) inbound.set(id, []);
  for (const [srcId, srcNode] of graph.nodes) {
    for (const ref of srcNode.references) {
      if (graph.nodes.has(ref)) {
        inbound.get(ref)!.push(srcId);
      }
    }
  }

  let rank = new Map<string, number>();
  for (const id of graph.nodes.keys()) rank.set(id, 1 / N);

  for (let i = 0; i < maxIter; i++) {
    // Compute dangling rank (nodes with no outbound edges — their rank leaks)
    let danglingSum = 0;
    for (const [id, node] of graph.nodes) {
      if (node.references.size === 0) danglingSum += rank.get(id) ?? 0;
    }
    const danglingContribution = (d * danglingSum) / N;

    const newRank = new Map<string, number>();
    let delta = 0;
    for (const id of graph.nodes.keys()) {
      const incoming = inbound.get(id) ?? [];
      let sum = 0;
      for (const srcId of incoming) {
        const srcNode = graph.nodes.get(srcId)!;
        const outDeg = srcNode.references.size;  // dangling already redistributed above
        if (outDeg > 0) sum += (rank.get(srcId) ?? 0) / outDeg;
      }
      const r = (1 - d) / N + danglingContribution + d * sum;
      newRank.set(id, r);
      delta += Math.abs(r - (rank.get(id) ?? 0));
    }
    rank = newRank;
    if (delta < tol) break;
  }

  return rank;
}

// ── Boundary selection ──────────────────────────────────────────────────────

export interface BoundarySelectorOptions {
  targetMaxLoc?: number;       // each new file aims for under this (default 500)
  minSymbolsPerFile?: number;  // don't create files with fewer than N symbols (default 3)
  minLocPerFile?: number;      // don't create files with fewer than N LOC (default 30)
}

export function selectSplitBoundaries(
  graph: SymbolGraph,
  ranks: Map<string, number>,
  options: BoundarySelectorOptions = {},
): SplitPlan {
  const targetMax = options.targetMaxLoc ?? 500;
  const minSymbols = options.minSymbolsPerFile ?? 3;
  const minLoc = options.minLocPerFile ?? 30;

  const stem = path.basename(graph.filePath, path.extname(graph.filePath));

  // Group symbols by category
  const types: SymbolNode[] = [];      // interface, type, enum
  const consts: SymbolNode[] = [];     // top-level const without function bodies
  const utils: SymbolNode[] = [];      // pure functions: small, not referenced by main
  const hubs: SymbolNode[] = [];       // high-ranked nodes (likely primary exports)

  // Sort by rank desc to identify hubs
  // Type-only declarations (interface/type/enum) are NEVER hubs — they're always candidates for extraction
  const hubCandidates = [...graph.nodes.values()]
    .filter(n => n.kind !== 'interface' && n.kind !== 'type' && n.kind !== 'enum')
    .sort((a, b) => (ranks.get(b.id) ?? 0) - (ranks.get(a.id) ?? 0));
  const hubCount = Math.max(1, Math.min(3, Math.ceil(hubCandidates.length * 0.1)));
  const hubIds = new Set(hubCandidates.slice(0, hubCount).map(n => n.id));

  for (const node of graph.nodes.values()) {
    if (hubIds.has(node.id)) {
      hubs.push(node);
      continue;
    }
    if (node.kind === 'interface' || node.kind === 'type' || node.kind === 'enum') {
      types.push(node);
    } else if (node.kind === 'const' && node.loc < 10 && node.references.size === 0) {
      consts.push(node);
    } else if (node.kind === 'function' && node.loc < 30) {
      utils.push(node);
    }
  }

  const newFiles: SplitPlan['newFiles'] = [];
  const tryEmit = (
    suffix: string,
    purpose: string,
    candidates: SymbolNode[],
  ) => {
    if (candidates.length < minSymbols) return;
    const totalLoc = candidates.reduce((sum, n) => sum + n.loc, 0);
    if (totalLoc < minLoc) return;
    if (totalLoc > targetMax) {
      // Too big — fall back to LLM-driven boundary; signal valid:false later
      return;
    }
    newFiles.push({
      name: `${stem}-${suffix}.ts`,
      purpose,
      exports: candidates.map(n => n.id),
    });
  };

  tryEmit('types', 'Extracted interfaces, types, and enums', types);
  tryEmit('utils', 'Extracted pure utility functions', utils);
  tryEmit('config', 'Extracted constants and configuration', consts);

  const retainInOriginal = hubs.map(h => h.id);

  if (newFiles.length === 0) {
    return {
      valid: false,
      newFiles: [],
      retainInOriginal,
      reason: 'No deterministic extraction found — file is too coupled or too small for AST split. LLM fallback recommended.',
    };
  }

  return { valid: true, newFiles, retainInOriginal };
}

// ── One-shot helper ─────────────────────────────────────────────────────────

export function analyzeBoundariesAst(
  content: string,
  filePath: string,
  options?: BoundarySelectorOptions,
): SplitPlan {
  const graph = buildSymbolGraph(content, filePath);
  if (graph.nodes.size === 0) {
    return { valid: false, newFiles: [], retainInOriginal: [], reason: 'AST parse returned no symbols' };
  }
  const ranks = runPageRank(graph);
  return selectSplitBoundaries(graph, ranks, options);
}
