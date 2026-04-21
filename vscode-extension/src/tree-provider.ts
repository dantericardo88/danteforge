// DanteForge VS Code tree view provider
// All interfaces are injectable — no real vscode imports.

export interface TreeItemLike {
  label: string;
  description?: string;
  tooltip?: string;
  collapsibleState: 0 | 1 | 2;  // None=0, Collapsed=1, Expanded=2
  iconPath?: string;
}

export interface TreeDataProviderLike<T> {
  getTreeItem(element: T): TreeItemLike;
  getChildren(element?: T): T[] | Promise<T[]>;
}

export interface ProjectStateNode {
  kind: 'root' | 'stage' | 'phase' | 'pdse' | 'artifact' | 'task';
  label: string;
  description?: string;
  tooltip?: string;
  children?: ProjectStateNode[];
}

export interface DanteForgeTreeProviderOptions {
  _readFile?: (p: string) => Promise<string>;
  workspaceRoot?: string;
}

type SnapshotData = {
  avgScore: number;
  scores: Record<string, { score: number; decision: string }>;
} | null;

type VerifyStatus = 'pass' | 'warn' | 'fail' | 'unknown';

type StateData = {
  workflowStage?: string;
  currentPhase?: number;
  lastVerifyStatus?: VerifyStatus;
  verifyMessage?: string;
  nextAction?: string;
  tasks?: Record<number, Array<{ name: string }>>;
} | null;

function parseTaskNames(raw: string): Array<{ name: string }> {
  const matches = raw.matchAll(/^\s*-\s+name:\s*(.+)\s*$/gm);
  return [...matches].map(match => ({ name: match[1]!.trim().replace(/^['"]|['"]$/g, '') }));
}

function parseStateData(raw: string): StateData {
  const stageMatch = raw.match(/workflowStage:\s*(.+)/);
  const phaseMatch = raw.match(/currentPhase:\s*(\d+)/);
  const verifyMatch = raw.match(/lastVerifyStatus:\s*(.+)/);
  const taskNames = parseTaskNames(raw);
  const lastVerifyStatus = verifyMatch?.[1]?.trim() as VerifyStatus | undefined;

  return {
    workflowStage: stageMatch?.[1]?.trim(),
    currentPhase: phaseMatch ? parseInt(phaseMatch[1], 10) : undefined,
    lastVerifyStatus,
    verifyMessage: lastVerifyStatus === 'pass'
      ? 'Latest verify passed.'
      : lastVerifyStatus === 'fail'
        ? 'Latest verify failed.'
        : lastVerifyStatus === 'warn'
          ? 'Verify needs refresh.'
          : undefined,
    nextAction: lastVerifyStatus && lastVerifyStatus !== 'pass' ? 'npm run verify' : undefined,
    tasks: taskNames.length > 0 ? { 1: taskNames } : undefined,
  };
}

export class DanteForgeTreeProvider implements TreeDataProviderLike<ProjectStateNode> {
  private _root: ProjectStateNode[] = [];

  constructor(private opts: DanteForgeTreeProviderOptions = {}) {}

  async refresh(): Promise<void> {
    const workspaceRoot = this.opts.workspaceRoot;
    if (!workspaceRoot) {
      this._root = DanteForgeTreeProvider.buildTree(null, null);
      return;
    }

    const readFile = this.opts._readFile ?? (async (p: string) => {
      const { readFile: fsRead } = await import('fs/promises');
      return fsRead(p, 'utf8');
    });

    let snapshot: SnapshotData = null;
    let state: StateData = null;

    try {
      const raw = await readFile(`${workspaceRoot}/.danteforge/latest-pdse.json`);
      snapshot = JSON.parse(raw) as SnapshotData;
    } catch { /* file absent — leave null */ }

    try {
      const raw = await readFile(`${workspaceRoot}/.danteforge/STATE.yaml`);
      state = parseStateData(raw);
    } catch { /* state file absent — leave null */ }

    this._root = DanteForgeTreeProvider.buildTree(snapshot, state);
  }

  getTreeItem(element: ProjectStateNode): TreeItemLike {
    const hasChildren = element.children && element.children.length > 0;
    return {
      label: element.label,
      description: element.description,
      tooltip: element.tooltip,
      collapsibleState: hasChildren ? 1 : 0,
    };
  }

  getChildren(element?: ProjectStateNode): ProjectStateNode[] {
    if (!element) return this._root;
    return element.children ?? [];
  }

  /**
   * Pure function — builds the tree data from snapshot and state.
   * Exposed for testing without file I/O.
   */
  static buildTree(snapshot: SnapshotData, state: StateData): ProjectStateNode[] {
    const root: ProjectStateNode = {
      kind: 'root',
      label: 'DanteForge',
      children: [],
    };

    // State section
    if (state) {
      const stateNode: ProjectStateNode = {
        kind: 'stage',
        label: 'State',
        children: [],
      };
      if (state.workflowStage) {
        stateNode.children!.push({
          kind: 'stage',
          label: `Stage: ${state.workflowStage}`,
        });
      }
      if (state.currentPhase !== undefined) {
        stateNode.children!.push({
          kind: 'phase',
          label: `Phase: ${state.currentPhase}`,
        });
      }
      if (stateNode.children!.length > 0) {
        root.children!.push(stateNode);
      }
    }

    if (state?.lastVerifyStatus) {
      const verifyNode: ProjectStateNode = {
        kind: 'stage',
        label: `Verify: ${state.lastVerifyStatus}`,
        description: state.verifyMessage,
        tooltip: state.verifyMessage,
        children: [],
      };
      if (state.nextAction) {
        verifyNode.children!.push({
          kind: 'stage',
          label: `Next: ${state.nextAction}`,
        });
      }
      root.children!.push(verifyNode);
    }

    // PDSE Score section
    if (snapshot) {
      const pdseNode: ProjectStateNode = {
        kind: 'pdse',
        label: `PDSE Score: ${snapshot.avgScore}`,
        description: `avg: ${snapshot.avgScore}/100`,
        children: [],
      };

      for (const [artifact, data] of Object.entries(snapshot.scores)) {
        pdseNode.children!.push({
          kind: 'artifact',
          label: `${artifact}: ${data.score}`,
          description: data.decision,
          tooltip: `${artifact} score: ${data.score}/100 (${data.decision})`,
        });
      }

      root.children!.push(pdseNode);
    }

    // Tasks section
    if (state?.tasks) {
      const allTasks: Array<{ name: string }> = Object.values(state.tasks).flat();
      if (allTasks.length > 0) {
        const tasksNode: ProjectStateNode = {
          kind: 'task',
          label: `Tasks (${allTasks.length})`,
          children: allTasks.map((t) => ({
            kind: 'task' as const,
            label: t.name,
          })),
        };
        root.children!.push(tasksNode);
      }
    }

    return [root];
  }
}
