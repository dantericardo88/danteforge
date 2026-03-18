import assert from 'node:assert';
import { describe, it } from 'node:test';

type InstallationStatus = 'workspace' | 'global' | 'missing';

interface FakeTerminal {
  name: string;
  sent: string[];
  shown: boolean;
  show(): void;
  sendText(text: string): void;
}

function createFakeTerminal(name: string): FakeTerminal {
  return {
    name,
    sent: [],
    shown: false,
    show() {
      this.shown = true;
    },
    sendText(text: string) {
      this.sent.push(text);
    },
  };
}

function createFakeVscode() {
  const terminals: FakeTerminal[] = [];
  const infoMessages: string[] = [];
  const errorMessages: string[] = [];
  const warningMessages: string[] = [];
  const handlers = new Map<string, () => unknown | Promise<unknown>>();

  return {
    api: {
      workspace: {
        workspaceFolders: [{ uri: { fsPath: 'C:\\Workspace Root' } }],
      },
      window: {
        terminals,
        createTerminal(name: string) {
          const terminal = createFakeTerminal(name);
          terminals.push(terminal);
          return terminal;
        },
        showErrorMessage(message: string) {
          errorMessages.push(message);
          return Promise.resolve(undefined);
        },
        showInformationMessage(message: string) {
          infoMessages.push(message);
          return Promise.resolve(undefined);
        },
        showWarningMessage(message: string) {
          warningMessages.push(message);
          return Promise.resolve(undefined);
        },
      },
      commands: {
        registerCommand(name: string, handler: () => unknown | Promise<unknown>) {
          handlers.set(name, handler);
          return {
            dispose() {
              handlers.delete(name);
            },
          };
        },
      },
    },
    handlers,
    terminals,
    infoMessages,
    errorMessages,
    warningMessages,
  };
}

function createInspector(status: InstallationStatus, command: string, installHint: string) {
  return () => ({ status, command, installHint });
}

describe('VS Code extension runtime', () => {
  it('does not open a terminal when DanteForge is missing', async () => {
    const fake = createFakeVscode();
    const { runDanteForgeSubcommand } = await import('../vscode-extension/src/runtime.js');

    await runDanteForgeSubcommand(
      fake.api,
      'verify',
      createInspector('missing', 'danteforge', 'Install DanteForge with npm link.'),
    );

    assert.strictEqual(fake.terminals.length, 0);
    assert.deepStrictEqual(fake.errorMessages, ['Install DanteForge with npm link.']);
  });

  it('sends the resolved command to the DanteForge terminal', async () => {
    const fake = createFakeVscode();
    const { runDanteForgeSubcommand } = await import('../vscode-extension/src/runtime.js');

    await runDanteForgeSubcommand(
      fake.api,
      'verify',
      createInspector(
        'workspace',
        '"C:\\Workspace Root\\node_modules\\.bin\\danteforge.cmd"',
        'Workspace-local DanteForge binary found.',
      ),
    );

    assert.strictEqual(fake.terminals.length, 1);
    assert.strictEqual(fake.terminals[0]?.name, 'DanteForge');
    assert.strictEqual(fake.terminals[0]?.shown, true);
    assert.deepStrictEqual(fake.terminals[0]?.sent, [
      '"C:\\Workspace Root\\node_modules\\.bin\\danteforge.cmd" verify',
    ]);
  });

  it('registers a setup command and shows install guidance when invoked', async () => {
    const fake = createFakeVscode();
    const { registerDanteForgeCommands } = await import('../vscode-extension/src/runtime.js');

    const disposables = registerDanteForgeCommands(
      fake.api,
      createInspector('missing', 'danteforge', 'Install DanteForge first with npm ci && npm link.'),
    );

    assert.ok(fake.handlers.has('danteforge.setup'));

    const setupCommand = fake.handlers.get('danteforge.setup');
    await setupCommand?.();

    assert.deepStrictEqual(fake.infoMessages, ['Install DanteForge first with npm ci && npm link.']);

    for (const disposable of disposables) {
      disposable.dispose();
    }
  });
});
