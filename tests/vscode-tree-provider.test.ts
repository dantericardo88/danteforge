import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import yaml from 'yaml';

describe('DanteForgeTreeProvider', () => {
  it('buildTree includes verify guidance and task count when state supplies them', async () => {
    const treeProviderModule = await import('../vscode-extension/src/tree-provider.ts');
    const DanteForgeTreeProvider = (treeProviderModule as { DanteForgeTreeProvider: typeof import('../vscode-extension/src/tree-provider.ts').DanteForgeTreeProvider }).DanteForgeTreeProvider;
    const [root] = DanteForgeTreeProvider.buildTree(null, {
      workflowStage: 'forge',
      currentPhase: 2,
      lastVerifyStatus: 'warn',
      verifyMessage: 'Stale pass receipt',
      nextAction: 'npm run verify',
      tasks: {
        1: [{ name: 'Review repo' }],
        2: [{ name: 'Run verify' }],
      },
    } as never);

    const labels = (root?.children ?? []).map(node => node.label);
    assert.ok(labels.includes('Verify: warn'));
    assert.ok(labels.includes('Tasks (2)'));

    const verifyNode = root?.children?.find(node => node.label === 'Verify: warn');
    assert.ok(verifyNode?.children?.some(node => node.label === 'Next: npm run verify'));
  });

  it('refresh parses tasks and verify state from STATE.yaml', async () => {
    const treeProviderModule = await import('../vscode-extension/src/tree-provider.ts');
    const DanteForgeTreeProvider = (treeProviderModule as { DanteForgeTreeProvider: typeof import('../vscode-extension/src/tree-provider.ts').DanteForgeTreeProvider }).DanteForgeTreeProvider;
    const stateYaml = yaml.stringify({
      workflowStage: 'forge',
      currentPhase: 3,
      lastVerifyStatus: 'warn',
      tasks: {
        1: [{ name: 'Review repo' }],
        2: [{ name: 'Run verify' }],
      },
    });

    const provider = new DanteForgeTreeProvider({
      workspaceRoot: '/workspace',
      _readFile: async (filePath: string) => {
        if (filePath.endsWith('/.danteforge/STATE.yaml')) {
          return stateYaml;
        }
        if (filePath.endsWith('/.danteforge/latest-pdse.json')) {
          return JSON.stringify({ avgScore: 84, scores: {} });
        }
        throw new Error(`unexpected path: ${filePath}`);
      },
    });

    await provider.refresh();
    const [root] = provider.getChildren();
    const labels = (root?.children ?? []).map(node => node.label);

    assert.ok(labels.includes('Verify: warn'));
    assert.ok(labels.includes('Tasks (2)'));
  });
});
