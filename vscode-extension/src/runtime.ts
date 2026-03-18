import {
  inspectDanteForgeInstallation,
  type DanteForgeInstallation,
} from './cli-discovery.js';
import { buildSpecifySubcommand, sanitizeShellInput } from './shell-safety.js';

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
  };
  commands: {
    registerCommand(name: string, handler: () => unknown | Promise<unknown>): DisposableLike;
  };
}

export type InstallationInspector = (workspaceRoot?: string) => DanteForgeInstallation;

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

export function registerDanteForgeCommands(
  vscodeApi: VscodeLike,
  inspector: InstallationInspector = inspectDanteForgeInstallation,
): DisposableLike[] {
  return [
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
  ];
}
