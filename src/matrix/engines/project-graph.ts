// Matrix Kernel — Project Graph builder (Phase 2 of PRD)
//
// Maps what exists in a target project. Walks source files, extracts
// top-level symbols + imports, tags protected/ownership state, emits a
// canonical ProjectGraph (PRD §9.1).
//
// Reuses (per Phase 0 audit):
//   - file-size-hygiene.ts:inspectSourceFileSizes  (file enumeration + LOC)
//   - sanitize-boundary.ts:buildSymbolGraph        (top-level symbol extraction)
//   - sanitize-locks.ts:loadFrozenFiles            (frozen-path tagging)
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectSourceFileSizes } from '../../core/file-size-hygiene.js';
import { buildSymbolGraph } from '../../core/sanitize-boundary.js';
import { loadFrozenFiles } from '../../core/sanitize-locks.js';
import type {
  ProjectGraph,
  ProjectGraphNode,
  MatrixProject,
  ProjectNodeType,
  RiskLevel,
} from '../types/project-graph.js';
import { MATRIX_REPORT_PATHS, MATRIX_DIR } from '../types/index.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface BuildProjectGraphOptions {
  cwd?: string;
  /** Limit to specific top-level dirs (default: ['src', 'packages']). */
  scanDirs?: string[];
  /** Injection seam: replaces inspectSourceFileSizes (for tests). */
  _inspect?: typeof inspectSourceFileSizes;
  /** Injection seam: replaces fs reads (for tests). */
  _readFile?: (p: string) => Promise<string>;
}

export async function buildProjectGraph(
  options: BuildProjectGraphOptions = {},
): Promise<ProjectGraph> {
  const cwd = options.cwd ?? process.cwd();
  const inspector = options._inspect ?? inspectSourceFileSizes;
  const readFile = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  // 1. enumerate source files
  const report = await inspector(cwd);
  const sourceFiles = report.files;

  // 2. load frozen files for protected-tagging
  const frozenFiles = await loadFrozenFiles({ cwd });

  // 3. load ownership map for ownedBy-tagging
  const ownership = await loadOwnershipMap(cwd);

  // 4. for each file, build a file-level node + extract module info
  const nodesByPath = new Map<string, ProjectGraphNode>();
  for (const sf of sourceFiles) {
    let content = '';
    try { content = await readFile(sf.absolutePath); } catch { /* skip unreadable */ }
    const node = buildFileNode(sf.relativePath, content, frozenFiles, ownership);
    nodesByPath.set(sf.relativePath, node);
  }

  // 5. group files into module-level nodes (one per directory under src/)
  const moduleNodes = groupIntoModules(Array.from(nodesByPath.values()), ownership);

  const allNodes: ProjectGraphNode[] = [
    ...nodesByPath.values(),
    ...moduleNodes,
  ];

  const project: MatrixProject = {
    projectId: path.basename(cwd),
    rootPath: cwd,
    detectedAt: new Date().toISOString(),
    buildCommands: ['npm run build'],
    verifyCommands: ['npm run typecheck', 'npm test'],
    protectedPaths: frozenFiles,
    ownershipPath: '.danteforge/agent-ownership.json',
    evidenceDir: '.danteforge/evidence',
  };

  return {
    project,
    nodes: allNodes,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Persist a ProjectGraph to disk at the canonical PRD §26 path.
 * Returns the absolute path written.
 */
export async function writeProjectGraph(graph: ProjectGraph, cwd?: string): Promise<string> {
  const root = cwd ?? graph.project.rootPath;
  const outPath = path.join(root, MATRIX_REPORT_PATHS.projectGraph);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  // Custom serializer: Sets aren't JSON-natively, but ProjectGraphNode references are plain arrays.
  await fs.writeFile(outPath, JSON.stringify(graph, null, 2), 'utf8');
  return outPath;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface OwnershipMapInternal {
  globalAllowed: string[];
  workstreams: Record<string, { ownedPaths: string[]; sharedPaths?: string[] }>;
}

async function loadOwnershipMap(cwd: string): Promise<OwnershipMapInternal> {
  const filePath = path.join(cwd, '.danteforge/agent-ownership.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as { globalAllowed?: string[]; workstreams?: Record<string, { owned?: string[]; shared?: string[] }> };
    const workstreams: OwnershipMapInternal['workstreams'] = {};
    for (const [name, w] of Object.entries(data.workstreams ?? {})) {
      workstreams[name] = {
        ownedPaths: w.owned ?? [],
        sharedPaths: w.shared,
      };
    }
    return {
      globalAllowed: data.globalAllowed ?? [],
      workstreams,
    };
  } catch {
    return { globalAllowed: [], workstreams: {} };
  }
}

function buildFileNode(
  relativePath: string,
  content: string,
  frozenFiles: string[],
  ownership: OwnershipMapInternal,
): ProjectGraphNode {
  const exports: string[] = [];
  const importsRaw = extractImports(content);

  if (content.length > 0) {
    try {
      const graph = buildSymbolGraph(content, relativePath);
      for (const sym of graph.nodes.values()) {
        if (sym.exported) exports.push(sym.id);
      }
    } catch { /* AST failure — node still emitted with empty exports */ }
  }

  return {
    nodeId: `file.${relativePath.replace(/[\\/]/g, '.')}`,
    type: classifyFileNodeType(relativePath),
    paths: [relativePath],
    exports,
    dependsOn: importsRaw,
    riskLevel: classifyRiskLevel(relativePath, content.length),
    protected: matchesAnyGlob(relativePath, frozenFiles),
    ownedBy: findOwnerWorkstream(relativePath, ownership),
  };
}

function classifyFileNodeType(p: string): ProjectNodeType {
  if (p.endsWith('.test.ts') || p.endsWith('.spec.ts')) return 'test';
  if (p.match(/\.config\.(ts|js|json|yaml|yml)$/)) return 'config';
  if (p.includes('src/cli/commands/')) return 'cli-command';
  return 'file';
}

function classifyRiskLevel(p: string, contentLength: number): RiskLevel {
  // Kernel hot-spots are high risk
  if (p.match(/(autoforge|ascend|matrix|gate|policy|merge|time-machine|crypto)/)) return 'high';
  if (contentLength > 30_000) return 'high';
  if (contentLength > 15_000) return 'medium';
  return 'low';
}

function extractImports(content: string): string[] {
  // Light regex match — full AST parsing is overkill for the dependsOn list
  const results = new Set<string>();
  const importRegex = /^\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/gm;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1]!;
    // Only track relative imports — external packages are not part of this graph
    if (spec.startsWith('./') || spec.startsWith('../')) {
      results.add(`file.${spec.replace(/^\.\.?\//, '').replace(/[\\/]/g, '.').replace(/\.js$/, '.ts')}`);
    }
  }
  return Array.from(results);
}

function groupIntoModules(
  fileNodes: ProjectGraphNode[],
  ownership: OwnershipMapInternal,
): ProjectGraphNode[] {
  const byDir = new Map<string, ProjectGraphNode[]>();
  for (const node of fileNodes) {
    const dir = path.dirname(node.paths[0] ?? '.');
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(node);
  }

  const modules: ProjectGraphNode[] = [];
  for (const [dir, files] of byDir) {
    if (files.length === 0) continue;
    const allExports = files.flatMap(f => f.exports ?? []);
    const allDeps = new Set<string>();
    for (const f of files) for (const d of f.dependsOn ?? []) allDeps.add(d);
    const anyProtected = files.some(f => f.protected);
    const moduleId = `module.${dir.replace(/[\\/]/g, '.')}`;
    modules.push({
      nodeId: moduleId,
      type: 'module',
      paths: [`${dir}/**`],
      exports: Array.from(new Set(allExports)),
      dependsOn: Array.from(allDeps).filter(d => !d.startsWith(moduleId)),
      riskLevel: files.some(f => f.riskLevel === 'high') ? 'high'
        : files.some(f => f.riskLevel === 'medium') ? 'medium' : 'low',
      protected: anyProtected,
      ownedBy: findOwnerWorkstream(dir, ownership),
    });
  }
  return modules;
}

function findOwnerWorkstream(
  filePath: string,
  ownership: OwnershipMapInternal,
): string | undefined {
  for (const [name, claim] of Object.entries(ownership.workstreams)) {
    if (matchesAnyGlob(filePath, claim.ownedPaths)) return name;
  }
  return undefined;
}

function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  for (const g of globs) {
    const re = globToRegex(g.replace(/\\/g, '/'));
    if (re.test(normalized)) return true;
  }
  return false;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*');
  return new RegExp(`^${escaped}$`);
}
