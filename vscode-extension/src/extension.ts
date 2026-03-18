import * as vscode from 'vscode';
import { registerDanteForgeCommands } from './runtime.js';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(...registerDanteForgeCommands(vscode));
}

export function deactivate() {}
