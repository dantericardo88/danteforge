import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';

describe('release metadata', () => {
  it('keeps the root package and VS Code extension versions in sync and valid', async () => {
    const rootPkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version?: string };
    const vscodePkg = JSON.parse(await fs.readFile('vscode-extension/package.json', 'utf8')) as { version?: string };

    // Both versions must be truthy semver strings
    assert.ok(rootPkg.version, 'root package.json must have a version');
    assert.ok(vscodePkg.version, 'vscode-extension package.json must have a version');
    assert.ok(rootPkg.version.includes('.'), 'root version must be a valid semver string');
    assert.ok(vscodePkg.version.includes('.'), 'vscode version must be a valid semver string');

    // They must match each other
    assert.strictEqual(rootPkg.version, vscodePkg.version, 'root and vscode-extension versions must match');
  });

  it('keeps root and VS Code lockfiles aligned with the current package versions', async () => {
    const rootPkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version: string };
    const vscodePkg = JSON.parse(await fs.readFile('vscode-extension/package.json', 'utf8')) as { version: string };
    const rootLock = JSON.parse(await fs.readFile('package-lock.json', 'utf8')) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };
    const vscodeLock = JSON.parse(await fs.readFile('vscode-extension/package-lock.json', 'utf8')) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };

    assert.strictEqual(rootLock.version, rootPkg.version, 'package-lock.json top-level version must match package.json');
    assert.strictEqual(rootLock.packages?.['']?.version, rootPkg.version, 'package-lock.json root package entry must match package.json');
    assert.strictEqual(vscodeLock.version, vscodePkg.version, 'vscode-extension/package-lock.json top-level version must match vscode-extension/package.json');
    assert.strictEqual(vscodeLock.packages?.['']?.version, vscodePkg.version, 'vscode-extension/package-lock.json root package entry must match vscode-extension/package.json');
  });

  it('stamps generated artifacts with the current package version', async () => {
    const rootPkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version: string };
    const version = rootPkg.version;

    const promptBuilder = await fs.readFile('src/core/prompt-builder.ts', 'utf8');
    const codec = await fs.readFile('src/harvested/openpencil/op-codec.ts', 'utf8');
    const renderer = await fs.readFile('src/harvested/openpencil/headless-renderer.ts', 'utf8');

    const versionEscaped = version.replace(/\./g, '\\.');
    assert.match(promptBuilder, new RegExp(`danteforge/${versionEscaped}`));
    assert.match(codec, new RegExp(`danteforge/${versionEscaped}`));
    assert.match(renderer, new RegExp(`DanteForge v${versionEscaped}`));
  });

  it('uses the current package version in operator-facing runtime surfaces', async () => {
    const rootPkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version: string };
    const version = rootPkg.version;
    const versionEscaped = version.replace(/\./g, '\\.');

    const mcpServer = await fs.readFile('src/core/mcp-server.ts', 'utf8');
    const autoforgeCommand = await fs.readFile('src/cli/commands/autoforge.ts', 'utf8');
    const certifyCommand = await fs.readFile('src/cli/commands/certify.ts', 'utf8');

    assert.match(mcpServer, new RegExp(`version: '${versionEscaped}'`));
    assert.match(autoforgeCommand, new RegExp(`DanteForge v${versionEscaped}`));
    assert.match(certifyCommand, /from '\.\.\/\.\.\/core\/version\.js'/);
    assert.doesNotMatch(certifyCommand, /const DANTEFORGE_VERSION = '/);
  });

  it('stamps generated markdown reports with the current package version', async () => {
    const rootPkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version: string };
    const version = rootPkg.version;
    const versionEscaped = version.replace(/\./g, '\\.');

    const { buildCaseStudyMarkdown } = await import('../src/cli/commands/showcase.js');
    const { buildImprovementReport } = await import('../src/cli/commands/self-improve.js');

    const caseStudy = buildCaseStudyMarkdown(
      'todo-app',
      'examples/todo-app',
      {
        rawScore: 80,
        harshScore: 80,
        displayScore: 8,
        dimensions: {} as Record<string, number>,
        displayDimensions: {
          functionality: 8,
          testing: 8,
          errorHandling: 8,
          security: 8,
          uxPolish: 8,
          documentation: 8,
          performance: 8,
          maintainability: 8,
          developerExperience: 8,
          autonomy: 8,
          planningQuality: 8,
          selfImprovement: 8,
          specDrivenPipeline: 8,
          convergenceSelfHealing: 8,
          tokenEconomy: 8,
          ecosystemMcp: 8,
          enterpriseReadiness: 8,
          communityAdoption: 8,
        },
        penalties: [],
        stubsDetected: [],
        fakeCompletionRisk: 'low',
        verdict: 'acceptable',
        maturityAssessment: { level: 4, label: 'beta', score: 80, dimensions: {} },
        timestamp: '2026-04-15T00:00:00.000Z',
      } as any,
    );

    const improvementReport = buildImprovementReport(
      [
        { cycle: 0, score: 7.2, timestamp: '2026-04-15T00:00:00.000Z' },
        { cycle: 1, score: 8.4, timestamp: '2026-04-15T00:05:00.000Z' },
      ],
      7.2,
      8.4,
      'max-cycles',
      'Improve quality',
      9.0,
    );

    assert.match(caseStudy, new RegExp(`v${versionEscaped}`));
    assert.match(improvementReport, new RegExp(`v${versionEscaped}`));
  });

  it('advertises autoforge and awesome-scan in the session-start hook', async () => {
    const hook = await fs.readFile('hooks/session-start.mjs', 'utf8');
    assert.match(hook, /\/autoforge/);
    assert.match(hook, /\/awesome-scan/);
  });
});
