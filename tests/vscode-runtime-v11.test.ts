import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  VscodeLike,
  DisposableLike,
  StatusBarItemLike,
  RegisterCommandsOptions,
} from '../vscode-extension/src/runtime.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStatusBar(): StatusBarItemLike & { _shown: boolean; _hidden: boolean } {
  return {
    text: '',
    tooltip: '',
    _shown: false,
    _hidden: false,
    show() { this._shown = true; },
    hide() { this._hidden = true; },
    dispose() {},
  };
}

type ExtendedVscode = VscodeLike & {
  _commands: Map<string, () => unknown>;
  _statusBar: StatusBarItemLike & { _shown: boolean; _hidden: boolean };
};

function makeVscode(overrides: Partial<VscodeLike['window']> = {}): ExtendedVscode {
  const commands = new Map<string, () => unknown>();
  const statusBar = makeStatusBar();
  const vscode: ExtendedVscode = {
    _commands: commands,
    _statusBar: statusBar,
    workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }] },
    window: {
      terminals: [],
      createTerminal: (name: string) => ({ name, show() {}, sendText() {} }),
      showErrorMessage: () => undefined,
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
      showInputBox: () => Promise.resolve(undefined),
      createStatusBarItem: () => statusBar,
      ...overrides,
    },
    commands: {
      registerCommand(name: string, handler: () => unknown) {
        commands.set(name, handler);
        return { dispose() {} };
      },
    },
  };
  return vscode;
}

function makeInspector(status: 'workspace' | 'global' | 'missing' = 'workspace') {
  return () => ({
    status,
    command: 'danteforge',
    installHint: 'Install DanteForge',
  });
}

// ── registerDanteForgeCommands — 14 total commands ───────────────────────────

describe('registerDanteForgeCommands — 14 commands', () => {
  it('registers all 14 commands (9 original + 5 new)', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const vscode = makeVscode();
    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error('no file'); },
      _setInterval: () => 0,
    });

    const commandNames = [...vscode._commands.keys()];
    const expected = [
      'danteforge.setup', 'danteforge.constitution', 'danteforge.specify',
      'danteforge.review', 'danteforge.verify', 'danteforge.doctor',
      'danteforge.forge', 'danteforge.party', 'danteforge.magic',
      'danteforge.wikiQuery', 'danteforge.wikiStatus', 'danteforge.pdseScore',
      'danteforge.resume', 'danteforge.pauseAt',
    ];

    for (const cmd of expected) {
      assert.ok(commandNames.includes(cmd), `Missing command: ${cmd}`);
    }
    assert.ok(commandNames.length >= 14);
  });
});

// ── Status bar ────────────────────────────────────────────────────────────────

describe('status bar', () => {
  it('creates status bar when createStatusBarItem is available', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    let created = false;
    const vscode = makeVscode();
    const overrideVscode: ExtendedVscode = {
      ...vscode,
      window: {
        ...vscode.window,
        createStatusBarItem: () => { created = true; return makeStatusBar(); },
      },
    };

    registerDanteForgeCommands(overrideVscode, makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
    });

    assert.ok(created);
  });

  it('shows score text when snapshot file exists', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const snapshot = JSON.stringify({ avgScore: 87, scores: {}, timestamp: new Date().toISOString() });
    const statusBar = makeStatusBar();
    const vscode = makeVscode({ createStatusBarItem: () => statusBar });

    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => snapshot,
      _setInterval: () => 0,
    });

    // Wait for initial async poll to complete
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.ok(statusBar.text.includes('87'));
    assert.ok(statusBar._shown);
  });

  it('hides status bar when snapshot file absent', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const statusBar = makeStatusBar();
    const vscode = makeVscode({ createStatusBarItem: () => statusBar });

    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error('ENOENT'); },
      _setInterval: () => 0,
    });

    // Wait for initial poll
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.ok(statusBar._hidden);
  });

  it('fallback interval is 30000ms (not 5000ms)', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const intervals: number[] = [];
    const vscode = makeVscode();

    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: (_, ms) => { intervals.push(ms); return 0; },
    });

    assert.ok(intervals.includes(30000), `Expected 30000ms fallback interval, got: ${intervals}`);
    assert.ok(!intervals.includes(5000), 'Should not have 5000ms interval anymore');
  });

  it('works without createStatusBarItem (graceful degradation)', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const vscode = makeVscode();
    const overrideVscode: VscodeLike = {
      ...vscode,
      window: { ...vscode.window, createStatusBarItem: undefined },
    };

    assert.doesNotThrow(() => {
      registerDanteForgeCommands(overrideVscode, makeInspector(), {
        _readFile: async () => { throw new Error(); },
        _setInterval: () => 0,
      });
    });
  });
});

// ── New Wave 6 commands ───────────────────────────────────────────────────────

describe('danteforge.wikiQuery', () => {
  it('runs wiki-query with sanitized input', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const sent: string[] = [];
    const vscode = makeVscode({
      showInputBox: () => Promise.resolve('PDSE scoring'),
      createTerminal: (name: string) => ({
        name, show() {}, sendText(t: string) { sent.push(t); },
      }),
    });

    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
    });

    await vscode._commands.get('danteforge.wikiQuery')?.();
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.ok(sent.some(t => t.includes('wiki-query')));
  });

  it('does nothing if input box is cancelled', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const sent: string[] = [];
    const vscode = makeVscode({
      showInputBox: () => Promise.resolve(undefined),
      createTerminal: (name: string) => ({
        name, show() {}, sendText(t: string) { sent.push(t); },
      }),
    });

    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
    });

    await vscode._commands.get('danteforge.wikiQuery')?.();
    assert.ok(!sent.some(t => t.includes('wiki-query')));
  });
});

describe('danteforge.wikiStatus', () => {
  it('runs wiki-status command', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const sent: string[] = [];
    const vscode = makeVscode({
      createTerminal: (name: string) => ({
        name, show() {}, sendText(t: string) { sent.push(t); },
      }),
    });

    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
    });

    await vscode._commands.get('danteforge.wikiStatus')?.();
    assert.ok(sent.some(t => t.includes('wiki-status')));
  });
});

describe('danteforge.pdseScore', () => {
  it('runs autoforge --score-only', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const sent: string[] = [];
    const vscode = makeVscode({
      createTerminal: (name: string) => ({
        name, show() {}, sendText(t: string) { sent.push(t); },
      }),
    });

    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
    });

    await vscode._commands.get('danteforge.pdseScore')?.();
    assert.ok(sent.some(t => t.includes('--score-only')));
  });
});

describe('danteforge.resume', () => {
  it('runs the resume command', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const sent: string[] = [];
    const vscode = makeVscode({
      createTerminal: (name: string) => ({
        name, show() {}, sendText(t: string) { sent.push(t); },
      }),
    });

    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
    });

    await vscode._commands.get('danteforge.resume')?.();
    assert.ok(sent.some(t => t.includes('resume')));
  });
});

describe('danteforge.pauseAt', () => {
  it('runs autoforge --auto --pause-at <score>', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const sent: string[] = [];
    const vscode = makeVscode({
      showInputBox: () => Promise.resolve('80'),
      createTerminal: (name: string) => ({
        name, show() {}, sendText(t: string) { sent.push(t); },
      }),
    });

    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
    });

    await vscode._commands.get('danteforge.pauseAt')?.();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(sent.some(t => t.includes('--pause-at 80')));
  });

  it('does nothing when input box cancelled', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const sent: string[] = [];
    const vscode = makeVscode({
      showInputBox: () => Promise.resolve(undefined),
      createTerminal: (name: string) => ({
        name, show() {}, sendText(t: string) { sent.push(t); },
      }),
    });

    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
    });

    await vscode._commands.get('danteforge.pauseAt')?.();
    assert.ok(!sent.some(t => t.includes('pause-at')));
  });

  it('shows error for invalid score input', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const errors: string[] = [];
    const vscode = makeVscode({
      showInputBox: () => Promise.resolve('notanumber'),
      showErrorMessage: (m: string) => { errors.push(m); return undefined; },
    });

    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
    });

    await vscode._commands.get('danteforge.pauseAt')?.();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(errors.length > 0);
  });
});

// ── Disposables ───────────────────────────────────────────────────────────────

describe('registerDanteForgeCommands return value', () => {
  it('returns an array of disposables with dispose() methods', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const vscode = makeVscode();
    const disposables = registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
    });

    assert.ok(Array.isArray(disposables));
    assert.ok(disposables.length >= 14);
    for (const d of disposables) {
      assert.ok(typeof (d as DisposableLike).dispose === 'function');
    }
  });
});

// ── FileSystemWatcher tests ───────────────────────────────────────────────────

function makeWatcher() {
  const changeCallbacks: Array<() => void> = [];
  const createCallbacks: Array<() => void> = [];
  return {
    watcher: {
      onDidChange(cb: () => void) { changeCallbacks.push(cb); return { dispose() {} }; },
      onDidCreate(cb: () => void) { createCallbacks.push(cb); return { dispose() {} }; },
      dispose() {},
    },
    triggerChange() { changeCallbacks.forEach(cb => cb()); },
    triggerCreate() { createCallbacks.forEach(cb => cb()); },
  };
}

describe('FileSystemWatcher integration', () => {
  it('creates FileSystemWatcher for .danteforge/STATE.yaml', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const watchedPatterns: string[] = [];
    const { watcher } = makeWatcher();

    registerDanteForgeCommands(makeVscode(), makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
      _createWatcher: (pattern) => { watchedPatterns.push(pattern); return watcher; },
    });

    assert.ok(
      watchedPatterns.some(p => p.includes('STATE.yaml')),
      `Expected STATE.yaml watcher, got: ${watchedPatterns}`,
    );
  });

  it('onDidChange on STATE.yaml triggers refreshDiagnosticsAndTree', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const stateWatcherMock = makeWatcher();
    const pdseWatcherMock = makeWatcher();
    let watcherCallIndex = 0;
    const watchers = [stateWatcherMock, pdseWatcherMock];
    let refreshCalled = 0;

    const treeProvider = {
      getChildren: () => [],
      getTreeItem: (e: unknown) => e,
      refresh: async () => { refreshCalled++; },
    };

    // createTreeView is required so treeProvider is wired into refreshDiagnosticsAndTree
    const vscode = makeVscode({
      createTreeView: () => ({ dispose() {} }),
    });

    registerDanteForgeCommands(vscode, makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
      _treeProvider: treeProvider,
      _createWatcher: () => watchers[watcherCallIndex++]?.watcher ?? makeWatcher().watcher,
    });

    // Wait for initial poll to settle
    await new Promise(resolve => setTimeout(resolve, 10));
    const baseCount = refreshCalled;

    stateWatcherMock.triggerChange();
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.ok(refreshCalled > baseCount, 'refresh should have been called on STATE.yaml change');
  });

  it('creates FileSystemWatcher for .danteforge/latest-pdse.json', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const watchedPatterns: string[] = [];
    const { watcher } = makeWatcher();

    registerDanteForgeCommands(makeVscode(), makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: () => 0,
      _createWatcher: (pattern) => { watchedPatterns.push(pattern); return watcher; },
    });

    assert.ok(
      watchedPatterns.some(p => p.includes('latest-pdse.json')),
      `Expected latest-pdse.json watcher, got: ${watchedPatterns}`,
    );
  });

  it('fallback interval is 30000ms not 5000ms (watcher variant)', async () => {
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');
    const intervals: number[] = [];
    const { watcher } = makeWatcher();

    registerDanteForgeCommands(makeVscode(), makeInspector(), {
      _readFile: async () => { throw new Error(); },
      _setInterval: (_, ms) => { intervals.push(ms); return 0; },
      _createWatcher: () => watcher,
    });

    assert.ok(intervals.includes(30000), `Expected 30000ms fallback, got: ${intervals}`);
    assert.ok(!intervals.includes(5000), 'Should not poll at 5000ms');
  });
});
