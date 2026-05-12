// Matrix Kernel — Project Graph types (PRD §9.1)
// "Map what exists."

export type ProjectNodeType =
  | 'package'
  | 'module'
  | 'file'
  | 'directory'
  | 'class'
  | 'function'
  | 'interface'
  | 'type'
  | 'schema'
  | 'cli-command'
  | 'api-route'
  | 'test'
  | 'config'
  | 'event-kind'
  | 'service';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ProjectGraphNode {
  nodeId: string;                // canonical, e.g. "module.matrix.leases"
  type: ProjectNodeType;
  paths: string[];               // glob-style paths covered by this node
  exports?: string[];            // public symbols exposed
  dependsOn?: string[];          // nodeIds this depends on
  dependedOnBy?: string[];       // nodeIds that depend on this
  riskLevel?: RiskLevel;
  protected?: boolean;           // matches .danteforge/agent-guard.json frozenFiles
  ownedBy?: string;              // workstream from agent-ownership.json
  testNodes?: string[];          // related test nodeIds
  metadata?: Record<string, unknown>;
}

export interface MatrixProject {
  projectId: string;             // e.g. "danteforge"
  rootPath: string;              // absolute or cwd-relative
  detectedAt: string;            // ISO timestamp
  buildCommands: string[];       // e.g. ["npm run build"]
  verifyCommands: string[];      // e.g. ["npm run typecheck", "npm test"]
  protectedPaths: string[];      // from agent-guard.json
  ownershipPath: string;         // path to agent-ownership.json
  evidenceDir: string;           // e.g. ".danteforge/evidence"
}

export interface ProjectGraph {
  project: MatrixProject;
  nodes: ProjectGraphNode[];
  generatedAt: string;
}

// ── Validation ──────────────────────────────────────────────────────────────

export function isProjectGraphNode(value: unknown): value is ProjectGraphNode {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.nodeId === 'string'
    && typeof v.type === 'string'
    && Array.isArray(v.paths);
}

export function isMatrixProject(value: unknown): value is MatrixProject {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.projectId === 'string'
    && typeof v.rootPath === 'string'
    && Array.isArray(v.buildCommands)
    && Array.isArray(v.verifyCommands);
}

export function isProjectGraph(value: unknown): value is ProjectGraph {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return isMatrixProject(v.project)
    && Array.isArray(v.nodes)
    && v.nodes.every(isProjectGraphNode);
}
