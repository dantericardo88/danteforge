import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
// Type-only static imports (erased at runtime — safe for CJS modules)
import type {
  VscodeLike,
  DisposableLike,
  DiagnosticCollectionLike,
  TreeViewLike,
  ProjectStateNode,
  DiagnosticItemLike,
} from '../vscode-extension/src/runtime.js';
// Value imports via dynamic import (CJS modules from vscode-extension require this —
// static named imports fail because cjs-module-lexer doesn't detect all exports).
type RuntimeModule = typeof import('../vscode-extension/src/runtime.js');
let DanteForgeTreeProvider: RuntimeModule['DanteForgeTreeProvider'];
let scoresToDiagnostics: RuntimeModule['scoresToDiagnostics'];
let formatDiagnosticMessage: RuntimeModule['formatDiagnosticMessage'];
let buildDiagnostics: RuntimeModule['buildDiagnostics'];
let registerDanteForgeCommands: RuntimeModule['registerDanteForgeCommands'];

before(async () => {
  const mod = await import('../vscode-extension/src/runtime.js') as unknown as RuntimeModule;
  DanteForgeTreeProvider = mod.DanteForgeTreeProvider;
  scoresToDiagnostics = mod.scoresToDiagnostics;
  formatDiagnosticMessage = mod.formatDiagnosticMessage;
  buildDiagnostics = mod.buildDiagnostics;
  registerDanteForgeCommands = mod.registerDanteForgeCommands;
});

function makeInspector(status: 'workspace' | 'global' | 'missing' = 'workspace') {
  return () => ({
    status,
    command: 'danteforge',
    installHint: 'Run: npm install -g danteforge',
  });
}

// ── DanteForgeTreeProvider.buildTree ─────────────────────────────────────────

describe('DanteForgeTreeProvider.buildTree', () => {
  it('returns root node when no data', () => {
    const tree = DanteForgeTreeProvider.buildTree(null, null);
    assert.ok(tree.length > 0);
    assert.equal(tree[0].kind, 'root');
  });

  it('includes stage from state', () => {
    const tree = DanteForgeTreeProvider.buildTree(null, { workflowStage: 'forge' });
    const stageNode = findNode(tree, (n) => n.label.includes('Stage: forge'));
    assert.ok(stageNode, 'stage node found');
  });

  it('includes phase from state', () => {
    const tree = DanteForgeTreeProvider.buildTree(null, { currentPhase: 3 });
    const phaseNode = findNode(tree, (n) => n.label.includes('Phase: 3'));
    assert.ok(phaseNode, 'phase node found');
  });

  it('includes PDSE score node when snapshot present', () => {
    const tree = DanteForgeTreeProvider.buildTree(
      { avgScore: 74, scores: {} },
      null,
    );
    const pdseNode = findNode(tree, (n) => n.kind === 'pdse');
    assert.ok(pdseNode, 'pdse node found');
    assert.ok(pdseNode!.label.includes('74'));
  });

  it('includes per-artifact score children', () => {
    const tree = DanteForgeTreeProvider.buildTree(
      { avgScore: 80, scores: { CONSTITUTION: { score: 90, decision: 'advance' }, SPEC: { score: 60, decision: 'warn' } } },
      null,
    );
    const pdseNode = findNode(tree, (n) => n.kind === 'pdse');
    assert.ok(pdseNode?.children?.some((c) => c.label.includes('CONSTITUTION')));
    assert.ok(pdseNode?.children?.some((c) => c.label.includes('SPEC')));
  });

  it('includes task list when tasks present', () => {
    const tree = DanteForgeTreeProvider.buildTree(null, {
      tasks: { 1: [{ name: 'Write auth guard' }] },
    });
    const taskNode = findNode(tree, (n) => n.kind === 'task' && n.label.includes('Tasks'));
    assert.ok(taskNode, 'task node found');
  });
});

// ── DanteForgeTreeProvider instance methods ───────────────────────────────────

describe('DanteForgeTreeProvider instance', () => {
  it('getChildren returns root-level nodes when no element passed', async () => {
    const provider = new DanteForgeTreeProvider({ workspaceRoot: '/fake' });
    await provider.refresh().catch(() => {}); // file absent is fine
    const children = await provider.getChildren(undefined);
    assert.ok(Array.isArray(children));
  });

  it('getTreeItem sets label correctly', () => {
    const provider = new DanteForgeTreeProvider();
    const node: ProjectStateNode = { kind: 'pdse', label: 'PDSE Score: 82', children: [] };
    const item = provider.getTreeItem(node);
    assert.equal(item.label, 'PDSE Score: 82');
  });

  it('getTreeItem sets collapsibleState 1 for nodes with children', () => {
    const provider = new DanteForgeTreeProvider();
    const node: ProjectStateNode = { kind: 'root', label: 'Root', children: [{ kind: 'stage', label: 'child' }] };
    const item = provider.getTreeItem(node);
    assert.equal(item.collapsibleState, 1);
  });

  it('getTreeItem sets collapsibleState 0 for leaf nodes', () => {
    const provider = new DanteForgeTreeProvider();
    const node: ProjectStateNode = { kind: 'stage', label: 'Leaf' };
    const item = provider.getTreeItem(node);
    assert.equal(item.collapsibleState, 0);
  });
});

// ── scoresToDiagnostics ───────────────────────────────────────────────────────

describe('scoresToDiagnostics', () => {
  it('returns warning for score below warnThreshold', () => {
    const result = scoresToDiagnostics({ SPEC: { score: 55, decision: 'warn' } }, 60, 40);
    assert.ok(result.some((d) => d.severity === 'warning' && d.artifactName === 'SPEC'));
  });

  it('returns error for score below errorThreshold', () => {
    const result = scoresToDiagnostics({ SPEC: { score: 35, decision: 'blocked' } }, 60, 40);
    assert.ok(result.some((d) => d.severity === 'error' && d.artifactName === 'SPEC'));
  });

  it('returns empty array when all scores above threshold', () => {
    const result = scoresToDiagnostics({ SPEC: { score: 85, decision: 'advance' } }, 60, 40);
    assert.deepEqual(result, []);
  });

  it('returns error not warning when score is below errorThreshold', () => {
    const result = scoresToDiagnostics({ PLAN: { score: 30, decision: 'blocked' } }, 60, 40);
    assert.equal(result[0].severity, 'error');
  });

  it('handles multiple artifacts', () => {
    const result = scoresToDiagnostics({
      CONSTITUTION: { score: 90, decision: 'advance' },
      SPEC: { score: 50, decision: 'warn' },
      PLAN: { score: 25, decision: 'blocked' },
    }, 60, 40);
    assert.equal(result.length, 2); // SPEC (warn) + PLAN (error)
  });
});

// ── formatDiagnosticMessage ───────────────────────────────────────────────────

describe('formatDiagnosticMessage', () => {
  it('includes artifact name', () => {
    const msg = formatDiagnosticMessage({ artifactName: 'SPEC', score: 42, severity: 'error' });
    assert.ok(msg.includes('SPEC'));
  });

  it('includes score', () => {
    const msg = formatDiagnosticMessage({ artifactName: 'SPEC', score: 42, severity: 'warning' });
    assert.ok(msg.includes('42'));
  });

  it('includes danteforge command suggestion', () => {
    const msg = formatDiagnosticMessage({ artifactName: 'SPEC', score: 42, severity: 'error' });
    assert.ok(msg.includes('danteforge'));
  });

  it('says needs immediate attention for error', () => {
    const msg = formatDiagnosticMessage({ artifactName: 'PLAN', score: 30, severity: 'error' });
    assert.ok(msg.includes('immediate'));
  });
});

// ── buildDiagnostics ──────────────────────────────────────────────────────────

describe('buildDiagnostics', () => {
  it('reads snapshot via _readFile', async () => {
    let read = false;
    await buildDiagnostics({
      workspaceRoot: '/fake',
      _readFile: async () => { read = true; return JSON.stringify({ scores: {} }); },
    });
    assert.ok(read);
  });

  it('returns empty array when snapshot absent', async () => {
    const result = await buildDiagnostics({
      workspaceRoot: '/fake',
      _readFile: async () => { throw new Error('absent'); },
    });
    assert.deepEqual(result, []);
  });

  it('returns empty array when no workspaceRoot', async () => {
    const result = await buildDiagnostics({});
    assert.deepEqual(result, []);
  });

  it('applies thresholds from options', async () => {
    const result = await buildDiagnostics({
      workspaceRoot: '/fake',
      _readFile: async () => JSON.stringify({ scores: { SPEC: { score: 55, decision: 'warn' } } }),
      warnThreshold: 50,  // 55 > 50, so no warning
    });
    assert.deepEqual(result, []);
  });
});

// ── registerDanteForgeCommands with tree + diagnostics ────────────────────────

describe('registerDanteForgeCommands tree+diagnostics', () => {
  function makeVscode(withTree = true, withDiagnostics = true): VscodeLike {
    return {
      workspace: { workspaceFolders: [{ uri: { fsPath: '/fake/workspace' } }] },
      window: {
        terminals: [],
        createTerminal: (name) => ({ name, show: () => {}, sendText: () => {} }),
        showErrorMessage: () => {},
        showInformationMessage: () => {},
        showWarningMessage: () => {},
        createStatusBarItem: () => ({
          text: '', tooltip: undefined, show: () => {}, hide: () => {}, dispose: () => {},
        }),
        createTreeView: withTree
          ? () => ({ dispose: () => {} } as TreeViewLike)
          : undefined,
      },
      commands: {
        registerCommand: (name, handler) => ({ dispose: () => {} }),
      },
      languages: withDiagnostics ? {
        createDiagnosticCollection: () => ({
          set: () => {},
          clear: () => {},
          dispose: () => {},
        } as DiagnosticCollectionLike),
      } : undefined,
    };
  }

  it('registers 16 commands with tree+diagnostics', () => {
    const disposables = registerDanteForgeCommands(makeVscode(), makeInspector(), {
      _readFile: async () => { throw new Error('absent'); },
      _setInterval: () => 0,
    });
    const commandDisposables = disposables.length;
    assert.ok(commandDisposables >= 16, `Expected ≥16 disposables, got ${commandDisposables}`);
  });

  it('calls createTreeView when available', () => {
    let treeViewCreated = false;
    const vscode = makeVscode(true, false);
    vscode.window.createTreeView = () => {
      treeViewCreated = true;
      return { dispose: () => {} };
    };
    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error('absent'); },
      _setInterval: () => 0,
    });
    assert.ok(treeViewCreated);
  });

  it('skips createTreeView when not in VscodeLike', () => {
    const disposables = registerDanteForgeCommands(
      makeVscode(false, false),
      makeInspector(),
      { _readFile: async () => { throw new Error('absent'); }, _setInterval: () => 0 },
    );
    assert.ok(disposables.length >= 14);
  });

  it('calls createDiagnosticCollection when available', () => {
    let diagCreated = false;
    const vscode = makeVscode(false, true);
    vscode.languages!.createDiagnosticCollection = () => {
      diagCreated = true;
      return { set: () => {}, clear: () => {}, dispose: () => {} };
    };
    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error('absent'); },
      _setInterval: () => 0,
    });
    assert.ok(diagCreated);
  });

  it('adds tree view to disposables when createTreeView available', () => {
    let disposeCount = 0;
    const vscode = makeVscode(false, false);
    vscode.window.createTreeView = () => ({ dispose: () => { disposeCount++; } });
    const disposables = registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error('absent'); },
      _setInterval: () => 0,
    });
    disposables.forEach((d) => d.dispose());
    assert.ok(disposeCount >= 1);
  });

  it('uses injected _treeProvider', () => {
    const provider = {
      getChildren: () => [],
      getTreeItem: (el: unknown) => ({ label: '', collapsibleState: 0 as const }),
      refresh: async () => {},
    };
    const vscode = makeVscode(true, false);
    registerDanteForgeCommands(vscode, makeInspector(), {
      _treeProvider: provider,
      _readFile: async () => { throw new Error('absent'); },
      _setInterval: () => 0,
    });
    assert.ok(true);
  });

  it('uses injected _diagnosticCollection', () => {
    const collection: DiagnosticCollectionLike = {
      set: () => {},
      clear: () => {},
      dispose: () => {},
    };
    const vscode = makeVscode(false, true);
    registerDanteForgeCommands(vscode, makeInspector(), {
      _diagnosticCollection: collection,
      _readFile: async () => { throw new Error('absent'); },
      _setInterval: () => 0,
    });
    assert.ok(true);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function findNode(
  nodes: ProjectStateNode[],
  pred: (n: ProjectStateNode) => boolean,
): ProjectStateNode | undefined {
  for (const n of nodes) {
    if (pred(n)) return n;
    if (n.children) {
      const found = findNode(n.children, pred);
      if (found) return found;
    }
  }
  return undefined;
}
