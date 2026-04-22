import {
  inspectDanteForgeInstallation,
  type DanteForgeInstallation,
} from './cli-discovery.js';
import { buildSpecifySubcommand, sanitizeShellInput } from './shell-safety.js';
import { DanteForgeTreeProvider as _DanteForgeTreeProvider } from './tree-provider.js';
import { buildDiagnostics as _buildDiagnostics, scoresToDiagnostics as _scoresToDiagnostics, formatDiagnosticMessage as _formatDiagnosticMessage, type DiagnosticItemLike } from './diagnostics.js';

export interface DisposableLike {
  dispose(): void;
}

export interface TerminalLike {
  name: string;
  show(): void;
  sendText(text: string): void;
}

export interface WorkspaceFolderLike {
  uri: {
    fsPath: string;
  };
}

export interface StatusBarItemLike {
  text: string;
  tooltip: string | object | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface VscodeLike {
  workspace: {
    workspaceFolders?: readonly WorkspaceFolderLike[];
  };
  window: {
    terminals: readonly TerminalLike[];
    createTerminal(name: string): TerminalLike;
    showErrorMessage(message: string): unknown;
    showInformationMessage(message: string): unknown;
    showWarningMessage(message: string): unknown;
    showInputBox?(options: {
      prompt: string;
      placeHolder: string;
    }): PromiseLike<string | undefined>;
    createStatusBarItem?(idOrAlignment?: string | number, priority?: number): StatusBarItemLike;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createTreeView?(viewId: string, options: { treeDataProvider: any }): TreeViewLike;
  };
  commands: {
    registerCommand(name: string, handler: () => unknown | Promise<unknown>): DisposableLike;
  };
  languages?: {
    createDiagnosticCollection?(name: string): DiagnosticCollectionLike;
  };
}

export type InstallationInspector = (workspaceRoot?: string) => DanteForgeInstallation;
export type RuntimeReadFileFn = (filePath: string) => Promise<string>;

export function getWorkspaceRoot(vscodeApi: VscodeLike): string | undefined {
  return vscodeApi.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getOrCreateTerminal(vscodeApi: VscodeLike): TerminalLike {
  return (
    vscodeApi.window.terminals.find(terminalInstance => terminalInstance.name === 'DanteForge') ??
    vscodeApi.window.createTerminal('DanteForge')
  );
}

export function getSetupMessage(installation: DanteForgeInstallation): string {
  if (installation.status === 'workspace') {
    return `DanteForge is ready in this workspace. Using ${installation.command}.`;
  }

  if (installation.status === 'global') {
    return 'DanteForge is installed globally and available on PATH.';
  }

  return installation.installHint;
}

export async function showSetupGuidance(
  vscodeApi: VscodeLike,
  inspector: InstallationInspector = inspectDanteForgeInstallation,
): Promise<void> {
  const installation = inspector(getWorkspaceRoot(vscodeApi));
  void vscodeApi.window.showInformationMessage(getSetupMessage(installation));
}

export async function runDanteForgeSubcommand(
  vscodeApi: VscodeLike,
  subcommand: string,
  inspector: InstallationInspector = inspectDanteForgeInstallation,
): Promise<void> {
  const installation = inspector(getWorkspaceRoot(vscodeApi));
  if (installation.status === 'missing') {
    void vscodeApi.window.showErrorMessage(installation.installHint);
    return;
  }

  const terminal = getOrCreateTerminal(vscodeApi);
  terminal.show();
  terminal.sendText(`${installation.command} ${subcommand}`);

  if (installation.status === 'global') {
    void vscodeApi.window.showInformationMessage('Using globally installed DanteForge binary from PATH.');
  }
}

export interface TreeViewLike {
  dispose(): void;
}

export interface TreeViewProviderLike {
  getChildren(element?: unknown): unknown[] | Promise<unknown[]>;
  getTreeItem(element: unknown): unknown;
  refresh?(): Promise<void>;
}

export interface DiagnosticCollectionLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(...args: any[]): void;
  clear(): void;
  dispose(): void;
}

export interface FileSystemWatcherLike {
  onDidChange(cb: () => void): DisposableLike;
  onDidCreate(cb: () => void): DisposableLike;
  dispose(): void;
}

export interface RegisterCommandsOptions {
  _readFile?: RuntimeReadFileFn;
  _setInterval?: (fn: () => void, ms: number) => unknown;
  _treeProvider?: TreeViewProviderLike;
  _diagnosticCollection?: DiagnosticCollectionLike;
  _createWatcher?: (pattern: string) => FileSystemWatcherLike;
}

export function registerDanteForgeCommands(
  vscodeApi: VscodeLike,
  inspector: InstallationInspector = inspectDanteForgeInstallation,
  opts?: RegisterCommandsOptions,
): DisposableLike[] {
  const disposables: DisposableLike[] = [];

  // ── Polling setup (shared by status bar, tree view, diagnostics) ────────────
  const workspaceRoot = getWorkspaceRoot(vscodeApi);
  const readFile = opts?._readFile ?? defaultReadFile;
  const setIntervalFn = opts?._setInterval ?? setInterval;

  // ── Status bar: polls .danteforge/latest-pdse.json every 5s ─────────────────
  const statusBar = vscodeApi.window.createStatusBarItem?.(1, 100);
  const pollSnapshot = async () => {
    if (!statusBar) return;
    if (!workspaceRoot) { statusBar.hide(); return; }
    try {
      const snapshotPath = `${workspaceRoot}/.danteforge/latest-pdse.json`;
      const raw = await readFile(snapshotPath);
      const snapshot = JSON.parse(raw) as { avgScore: number };
      statusBar.text = `$(check) DF: ${snapshot.avgScore}`;
      statusBar.tooltip = `DanteForge avg PDSE score: ${snapshot.avgScore}`;
      statusBar.show();
    } catch {
      statusBar.hide();
    }
  };
  if (statusBar) {
    void pollSnapshot();
    disposables.push(statusBar);
  }

  // ── Tree view: shows project state + PDSE scores in Explorer panel ───────────
  let treeProvider: TreeViewProviderLike | undefined;
  if (vscodeApi.window.createTreeView && workspaceRoot) {
    treeProvider = opts?._treeProvider ?? new _DanteForgeTreeProvider({ workspaceRoot, _readFile: readFile });
    const treeView = vscodeApi.window.createTreeView('danteforge.projectState', {
      treeDataProvider: treeProvider,
    });
    disposables.push(treeView);
  }

  // ── Diagnostics: maps low-scoring artifacts to warnings/errors ───────────────
  let diagnosticCollection: DiagnosticCollectionLike | undefined;
  if (vscodeApi.languages?.createDiagnosticCollection && workspaceRoot) {
    diagnosticCollection = opts?._diagnosticCollection
      ?? vscodeApi.languages.createDiagnosticCollection('danteforge');
    disposables.push(diagnosticCollection);
  }

  // ── Shared refresh helpers ────────────────────────────────────────────────
  const refreshDiagnosticsAndTree = async () => {
    if (treeProvider?.refresh) {
      try { await treeProvider.refresh(); } catch { /* best-effort */ }
    }
    if (diagnosticCollection && workspaceRoot) {
      try {
        const items = await _buildDiagnostics({ workspaceRoot, _readFile: readFile });
        diagnosticCollection.set([[workspaceRoot, items]]);
      } catch { /* best-effort */ }
    }
  };

  const updateStatusBar = async () => {
    await pollSnapshot();
  };

  const pollAll = async () => {
    await updateStatusBar();
    await refreshDiagnosticsAndTree();
  };

  void pollAll();

  // ── FileSystemWatcher for live refresh (replaces 5s polling) ─────────────
  const createWatcher = opts?._createWatcher;
  if (workspaceRoot && createWatcher) {
    // Watch STATE.yaml for live tree refresh
    const stateWatcher = createWatcher(`${workspaceRoot}/.danteforge/STATE.yaml`);
    stateWatcher.onDidChange(() => { void refreshDiagnosticsAndTree(); });
    stateWatcher.onDidCreate(() => { void refreshDiagnosticsAndTree(); });
    disposables.push(stateWatcher);

    // Watch latest-pdse.json for score bar updates
    const pdseWatcher = createWatcher(`${workspaceRoot}/.danteforge/latest-pdse.json`);
    pdseWatcher.onDidChange(() => { void updateStatusBar(); });
    disposables.push(pdseWatcher);
  }

  // Keep 30s fallback interval (was 5s) for initial load and edge cases
  const fallbackInterval = setIntervalFn(() => { void pollAll(); }, 30000);
  disposables.push({ dispose: () => clearInterval(fallbackInterval as ReturnType<typeof setInterval>) });

  // ── Original 9 commands ─────────────────────────────────────────────────────
  disposables.push(
    vscodeApi.commands.registerCommand('danteforge.setup', () =>
      showSetupGuidance(vscodeApi, inspector),
    ),
    vscodeApi.commands.registerCommand('danteforge.constitution', () =>
      runDanteForgeSubcommand(vscodeApi, 'constitution', inspector),
    ),
    vscodeApi.commands.registerCommand('danteforge.specify', async () => {
      const idea = await vscodeApi.window.showInputBox?.({
        prompt: 'What do you want to specify?',
        placeHolder: 'e.g. Build trustworthy local release workflows',
      });
      if (!idea) {
        return;
      }

      try {
        const command = buildSpecifySubcommand(idea);
        const sanitizedIdea = sanitizeShellInput(idea);
        if (sanitizedIdea !== idea.trim()) {
          void vscodeApi.window.showWarningMessage(
            'Some unsupported shell characters were removed from your idea for safety.',
          );
        }
        await runDanteForgeSubcommand(vscodeApi, command, inspector);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid idea text.';
        void vscodeApi.window.showErrorMessage(message);
      }
    }),
    vscodeApi.commands.registerCommand('danteforge.review', () =>
      runDanteForgeSubcommand(vscodeApi, 'review', inspector),
    ),
    vscodeApi.commands.registerCommand('danteforge.verify', () =>
      runDanteForgeSubcommand(vscodeApi, 'verify', inspector),
    ),
    vscodeApi.commands.registerCommand('danteforge.doctor', () =>
      runDanteForgeSubcommand(vscodeApi, 'doctor', inspector),
    ),
    vscodeApi.commands.registerCommand('danteforge.forge', () =>
      runDanteForgeSubcommand(vscodeApi, 'forge 1 --profile quality', inspector),
    ),
    vscodeApi.commands.registerCommand('danteforge.party', () =>
      runDanteForgeSubcommand(vscodeApi, 'party', inspector),
    ),
    vscodeApi.commands.registerCommand('danteforge.magic', async () => {
      const idea = await vscodeApi.window.showInputBox?.({
        prompt: 'What do you want DanteForge to build?',
        placeHolder: 'e.g. Build and release a trustworthy multi-agent CLI',
      });
      if (!idea) {
        return;
      }

      const sanitizedIdea = sanitizeShellInput(idea);
      if (!sanitizedIdea) {
        void vscodeApi.window.showErrorMessage('Please enter an idea with letters or numbers.');
        return;
      }

      await runDanteForgeSubcommand(vscodeApi, `magic "${sanitizedIdea}"`, inspector);
    }),
  );

  // ── 5 new Wave 6 commands ───────────────────────────────────────────────────
  disposables.push(
    vscodeApi.commands.registerCommand('danteforge.wikiQuery', async () => {
      const topic = await vscodeApi.window.showInputBox?.({
        prompt: 'Wiki query topic',
        placeHolder: 'e.g. PDSE scoring, autoforge loop, federation',
      });
      if (!topic) return;
      const sanitized = sanitizeShellInput(topic);
      if (!sanitized) {
        void vscodeApi.window.showErrorMessage('Please enter a valid search topic.');
        return;
      }
      await runDanteForgeSubcommand(vscodeApi, `wiki-query "${sanitized}"`, inspector);
    }),
    vscodeApi.commands.registerCommand('danteforge.wikiStatus', () =>
      runDanteForgeSubcommand(vscodeApi, 'wiki-status', inspector),
    ),
    vscodeApi.commands.registerCommand('danteforge.pdseScore', () =>
      runDanteForgeSubcommand(vscodeApi, 'autoforge --score-only', inspector),
    ),
    vscodeApi.commands.registerCommand('danteforge.resume', () =>
      runDanteForgeSubcommand(vscodeApi, 'resume', inspector),
    ),
    vscodeApi.commands.registerCommand('danteforge.pauseAt', async () => {
      const scoreStr = await vscodeApi.window.showInputBox?.({
        prompt: 'Pause autoforge when average PDSE score reaches:',
        placeHolder: 'e.g. 80',
      });
      if (!scoreStr) return;
      const score = parseInt(scoreStr, 10);
      if (isNaN(score) || score < 0 || score > 100) {
        void vscodeApi.window.showErrorMessage('Score must be a number between 0 and 100.');
        return;
      }
      await runDanteForgeSubcommand(vscodeApi, `autoforge --auto --pause-at ${score}`, inspector);
    }),
  );

  // ── 2 new Wave 4 commands ───────────────────────────────────────────────────
  disposables.push(
    vscodeApi.commands.registerCommand('danteforge.refreshTree', async () => {
      if (treeProvider?.refresh) {
        try { await treeProvider.refresh(); } catch { /* best-effort */ }
      }
    }),
    vscodeApi.commands.registerCommand('danteforge.showDiagnostics', () =>
      runDanteForgeSubcommand(vscodeApi, 'autoforge --score-only', inspector),
    ),
  );

  return disposables;
}

async function defaultReadFile(filePath: string): Promise<string> {
  const { readFile } = await import('fs/promises');
  return readFile(filePath, 'utf8');
}

// Direct const exports so tests can import from runtime.js as a single entry
// point. Using `export const X = _X` compiles to `exports.X = _X` (direct
// assignment) which is statically analysable by Node.js cjs-module-lexer —
// unlike `export { X } from '...'` which emits Object.defineProperty getters.
export type { TreeItemLike, TreeDataProviderLike, ProjectStateNode, DanteForgeTreeProviderOptions } from './tree-provider.js';
export type { DanteForgeHoverOptions } from './diagnostics.js';
export const DanteForgeTreeProvider = _DanteForgeTreeProvider;
export const scoresToDiagnostics = _scoresToDiagnostics;
export const formatDiagnosticMessage = _formatDiagnosticMessage;
export const buildDiagnostics = _buildDiagnostics;
