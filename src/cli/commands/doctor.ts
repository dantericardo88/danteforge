import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import type { LogLevel } from '../../core/logger.js';
import { loadState, saveState, type DanteState, type VerifyEvidence } from '../../core/state.js';
import { loadConfig } from '../../core/config.js';
import { isLLMAvailable, probeLLMProvider } from '../../core/llm.js';
import { discoverSkills } from '../../core/skills.js';
import { detectHost, detectMCPCapabilities } from '../../core/mcp.js';
import { resolveTier, testMCPConnection } from '../../core/mcp-adapter.js';
import { installAssistantSkills } from '../../core/assistant-installer.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

const ANTIGRAVITY_BUNDLES_URL = process.env.ANTIGRAVITY_BUNDLES_URL ?? 'https://raw.githubusercontent.com/sickn33/antigravity-awesome-skills/main/docs/BUNDLES.md';
const LIVE_PROVIDER_VALUES = ['openai', 'claude', 'gemini', 'grok', 'ollama'];

interface DiagnosticResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

interface LiveConfigResult {
  providers: string[];
  missing: string[];
  error?: string;
}

function formatShortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : 'no-git';
}

function buildVerifyReceiptMessage(verifyEvidence: VerifyEvidence): string {
  const base = `${verifyEvidence.status} receipt from ${verifyEvidence.timestamp} @ ${formatShortSha(verifyEvidence.gitSha)}`;
  if (verifyEvidence.status === 'pass' && verifyEvidence.fresh) {
    return `Fresh ${base}.`;
  }

  if (verifyEvidence.status === 'pass' && !verifyEvidence.fresh) {
    const reasons: string[] = [];
    if (!verifyEvidence.currentHead) reasons.push('HEAD changed');
    if (verifyEvidence.dirtyWorktree) reasons.push('working tree is dirty');
    if (!verifyEvidence.currentStateFresh) reasons.push('workflow state changed');
    const suffix = reasons.length > 0 ? ` (${reasons.join(', ')})` : '';
    return `Stale pass receipt from ${verifyEvidence.timestamp} @ ${formatShortSha(verifyEvidence.gitSha)}${suffix}.`;
  }

  return `${base}.`;
}

function buildVerifyDiagnostic(state?: Pick<DanteState, 'lastVerifyStatus' | 'verifyEvidence'>): DiagnosticResult {
  if (!state) {
    return {
      name: 'Verify receipt',
      status: 'warn',
      message: 'No verify receipt found yet.',
      fix: 'Run: npm run verify',
    };
  }

  if (state.verifyEvidence) {
    const message = buildVerifyReceiptMessage(state.verifyEvidence);
    const status =
      state.verifyEvidence.status === 'pass' && state.verifyEvidence.fresh
        ? 'ok'
        : state.verifyEvidence.status === 'fail'
          ? 'fail'
          : 'warn';
    return {
      name: 'Verify receipt',
      status,
      message,
      fix: status === 'ok' ? undefined : 'Run: npm run verify',
    };
  }

  if (!state.lastVerifyStatus || state.lastVerifyStatus === 'unknown') {
    return {
      name: 'Verify receipt',
      status: 'warn',
      message: 'No verify receipt found yet.',
      fix: 'Run: npm run verify',
    };
  }

  if (state.lastVerifyStatus === 'pass') {
    return {
      name: 'Verify receipt',
      status: 'warn',
      message: 'STATE.yaml says pass, but no verify receipt was found to prove freshness.',
      fix: 'Run: npm run verify',
    };
  }

  return {
    name: 'Verify receipt',
    status: state.lastVerifyStatus === 'fail' ? 'fail' : 'warn',
    message: `Latest verify status is ${state.lastVerifyStatus}, but no verify receipt was found to inspect details.`,
    fix: 'Run: npm run verify',
  };
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function checkAssistantRegistries(homeDir: string, strict = false): Promise<DiagnosticResult> {
  const targets = [
    path.join(homeDir, '.claude', 'skills', 'test-driven-development', 'SKILL.md'),
    path.join(homeDir, '.codex', 'skills', 'test-driven-development', 'SKILL.md'),
    path.join(homeDir, '.gemini', 'antigravity', 'skills', 'test-driven-development', 'SKILL.md'),
    path.join(
      process.platform === 'win32'
        ? path.join(homeDir, '.config')
        : process.env.XDG_CONFIG_HOME ?? path.join(homeDir, '.config'),
      'opencode',
      'skills',
      'test-driven-development',
      'SKILL.md',
    ),
  ];

  const missing: string[] = [];
  for (const target of targets) {
    if (!(await exists(target))) {
      missing.push(target);
    }
  }

  if (missing.length === 0) {
    return {
      name: 'Assistant registries',
      status: 'ok',
      message: 'Claude, Codex, Antigravity, and OpenCode skill registries are populated.',
    };
  }

  return {
    name: 'Assistant registries',
    status: strict ? 'fail' : 'warn',
    message: `Missing registry entries: ${missing.length}`,
    fix: 'Run: danteforge setup assistants',
  };
}

async function checkCodexBootstrap(homeDir: string, strict = false): Promise<DiagnosticResult> {
  const target = path.join(homeDir, '.codex', 'AGENTS.md');
  if (await exists(target)) {
    return {
      name: 'Codex bootstrap',
      status: 'ok',
      message: `Global Codex bootstrap present at ${target}`,
    };
  }

  return {
    name: 'Codex bootstrap',
    status: strict ? 'fail' : 'warn',
    message: 'Codex global bootstrap instructions are missing.',
    fix: 'Run: danteforge setup assistants --assistants codex',
  };
}

async function checkCodexCommandFiles(homeDir: string, strict = false): Promise<DiagnosticResult> {
  const commandsDir = path.join(homeDir, '.codex', 'commands');
  const expectedFiles = [
    'autoforge.md',
    'spark.md',
    'ember.md',
    'canvas.md',
    'magic.md',
    'blaze.md',
    'nova.md',
    'inferno.md',
    'verify.md',
    'local-harvest.md',
  ];
  const missing: string[] = [];

  for (const file of expectedFiles) {
    if (!await exists(path.join(commandsDir, file))) {
      missing.push(file);
    }
  }

  if (missing.length === 0) {
    return {
      name: 'Codex native commands',
      status: 'ok',
      message: `Native Codex command files are present in ${commandsDir}`,
    };
  }

  return {
    name: 'Codex native commands',
    status: strict ? 'fail' : 'warn',
    message: `Missing Codex command files: ${missing.join(', ')}`,
    fix: 'Run: danteforge setup assistants --assistants codex',
  };
}

async function checkCodexCliFallbackSkill(homeDir: string, strict = false): Promise<DiagnosticResult> {
  const target = path.join(homeDir, '.codex', 'skills', 'danteforge-cli', 'SKILL.md');
  if (await exists(target)) {
    return {
      name: 'Codex CLI fallback',
      status: 'ok',
      message: `Explicit DanteForge CLI fallback skill present at ${target}`,
    };
  }

  return {
    name: 'Codex CLI fallback',
    status: strict ? 'fail' : 'warn',
    message: 'Codex is missing the bundled danteforge-cli fallback skill.',
    fix: 'Run: danteforge setup assistants --assistants codex',
  };
}

async function checkCodexUtilityAliases(homeDir: string, strict = false): Promise<DiagnosticResult> {
  const target = path.join(homeDir, '.codex', 'config.toml');
  if (!await exists(target)) {
    return {
      name: 'Codex utility aliases',
      status: strict ? 'fail' : 'warn',
      message: 'Codex global config.toml is missing.',
      fix: 'Run: danteforge setup assistants --assistants codex',
    };
  }

  const content = await fs.readFile(target, 'utf8');
  const expectedAliases = [
    /setup-assistants = "npx danteforge setup assistants --assistants codex"/,
    /doctor-live = "npx danteforge doctor --live"/,
    /df-verify = "npx danteforge verify"/,
  ];
  const missing = expectedAliases.filter((pattern) => !pattern.test(content));
  const hijacksNativeWorkflow = /^autoforge\s*=/m.test(content) || /^magic\s*=/m.test(content);

  if (missing.length === 0 && !hijacksNativeWorkflow) {
    return {
      name: 'Codex utility aliases',
      status: 'ok',
      message: `Non-colliding Codex utility aliases are present in ${target}`,
    };
  }

  const detailParts: string[] = [];
  if (missing.length > 0) detailParts.push(`missing ${missing.length} expected alias${missing.length === 1 ? '' : 'es'}`);
  if (hijacksNativeWorkflow) detailParts.push('native workflow slash commands are being shadowed');

  return {
    name: 'Codex utility aliases',
    status: strict ? 'fail' : 'warn',
    message: `Codex config needs repair: ${detailParts.join('; ')}.`,
    fix: 'Run: danteforge setup assistants --assistants codex',
  };
}

async function checkCursorBootstrap(cwd: string): Promise<DiagnosticResult> {
  const target = path.join(cwd, '.cursor', 'rules', 'danteforge.mdc');
  if (await exists(target)) {
    return {
      name: 'Cursor bootstrap',
      status: 'ok',
      message: `Project bootstrap rule present at ${target}`,
    };
  }

  return {
    name: 'Cursor bootstrap',
    status: 'warn',
    message: 'Cursor project bootstrap rule is not present in this workspace.',
    fix: 'Run: danteforge setup assistants --assistants cursor',
  };
}

async function checkAntigravityUpstream(): Promise<DiagnosticResult> {
  try {
    const response = await fetch(ANTIGRAVITY_BUNDLES_URL, {
      method: 'GET',
      headers: {
        'user-agent': 'danteforge-doctor',
      },
    });
    const body = await response.text();
    if (!response.ok) {
      return {
        name: 'Antigravity upstream',
        status: 'fail',
        message: `Bundle index returned ${response.status}`,
      };
    }
    if (!/BUNDLES|docs\/users\/bundles\.md|skills/i.test(body)) {
      return {
        name: 'Antigravity upstream',
        status: 'fail',
        message: 'Bundle index responded, but the payload shape was unexpected.',
      };
    }
    return {
      name: 'Antigravity upstream',
      status: 'ok',
      message: 'Bundle index is reachable.',
    };
  } catch (err) {
    return {
      name: 'Antigravity upstream',
      status: 'fail',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function validateLiveReleaseConfig(env = process.env): LiveConfigResult {
  const rawProviders = env.DANTEFORGE_LIVE_PROVIDERS?.trim();
  if (!rawProviders) {
    return {
      providers: [],
      missing: [],
      error: 'Set DANTEFORGE_LIVE_PROVIDERS to a comma-separated list such as "openai,claude,gemini,grok,ollama".',
    };
  }

  const providers = [...new Set(
    rawProviders
      .split(',')
      .map(provider => provider.trim().toLowerCase())
      .filter(Boolean),
  )];

  if (providers.length === 0) {
    return {
      providers: [],
      missing: [],
      error: 'DANTEFORGE_LIVE_PROVIDERS did not contain any providers.',
    };
  }

  const unknown = providers.find(provider => !LIVE_PROVIDER_VALUES.includes(provider));
  if (unknown) {
    return {
      providers: [],
      missing: [],
      error: `Unknown live provider "${unknown}". Valid values: ${LIVE_PROVIDER_VALUES.join(', ')}`,
    };
  }

  const missing: string[] = [];
  if (providers.includes('openai') && !env.OPENAI_API_KEY?.trim()) {
    missing.push('OPENAI_API_KEY is required for openai live verification.');
  }
  if (providers.includes('claude') && !env.ANTHROPIC_API_KEY?.trim()) {
    missing.push('ANTHROPIC_API_KEY is required for claude live verification.');
  }
  if (providers.includes('gemini') && !env.GEMINI_API_KEY?.trim()) {
    missing.push('GEMINI_API_KEY is required for gemini live verification.');
  }
  if (providers.includes('grok') && !env.XAI_API_KEY?.trim()) {
    missing.push('XAI_API_KEY is required for grok live verification.');
  }
  if (providers.includes('ollama') && !env.OLLAMA_MODEL?.trim()) {
    missing.push('OLLAMA_MODEL is required for ollama live verification.');
  }

  return { providers, missing };
}

function formatLiveReleaseConfig(result: LiveConfigResult): string {
  const lines = [
    result.error ?? 'Live verification environment is incomplete.',
    'Live verification configuration:',
    '- DANTEFORGE_LIVE_PROVIDERS=openai,claude,gemini,grok,ollama',
    '- openai: OPENAI_API_KEY',
    '- claude: ANTHROPIC_API_KEY',
    '- gemini: GEMINI_API_KEY',
    '- grok: XAI_API_KEY',
    '- ollama: OLLAMA_MODEL (required), OLLAMA_BASE_URL (optional, defaults to http://127.0.0.1:11434)',
    '- Optional upstream override: ANTIGRAVITY_BUNDLES_URL',
    '- Optional Figma override: FIGMA_MCP_URL',
    '- Optional timeout override: DANTEFORGE_LIVE_TIMEOUT_MS (all providers), OLLAMA_TIMEOUT_MS (Ollama only)',
  ];

  if (result.missing.length > 0) {
    lines.push('Missing items:');
    for (const missing of result.missing) {
      lines.push(`- ${missing}`);
    }
  }

  return lines.join('\n');
}

async function checkLiveReleaseConfig(): Promise<DiagnosticResult> {
  const result = validateLiveReleaseConfig();
  if (result.error || result.missing.length > 0) {
    return {
      name: 'Live release config',
      status: 'fail',
      message: formatLiveReleaseConfig(result),
      fix: 'Export the variables above, then rerun: npm run verify:live',
    };
  }

  return {
    name: 'Live release config',
    status: 'ok',
    message: `Selected providers: ${result.providers.join(', ')}`,
  };
}

async function runRepairs(): Promise<DiagnosticResult> {
  const state = await loadState();
  await saveState(state);

  const homeDir = process.env.DANTEFORGE_HOME;
  const installResult = await installAssistantSkills({
    homeDir,
    assistants: ['claude', 'codex', 'antigravity', 'opencode'],
  });
  const installed = installResult.assistants.map(entry => `${entry.assistant}:${entry.installedSkills.length}`).join(', ');

  return {
    name: 'Repairs',
    status: 'ok',
    message: `State initialized and user-level assistant registries synced (${installed}).`,
  };
}

export async function doctor(options: {
  fix?: boolean;
  live?: boolean;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
  _isLLMAvailable?: typeof isLLMAvailable;
} = {}) {
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;
  void loadFn; void saveFn; // seams available for test injection
  return withErrorBoundary('doctor', async () => {
  logger.success('DanteForge Doctor - System Health Check');
  logger.info('');

  const results: DiagnosticResult[] = [];

  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  if (major >= 18) {
    results.push({ name: 'Node.js', status: 'ok', message: `${nodeVersion} (ES2022 compatible)` });
  } else {
    results.push({
      name: 'Node.js',
      status: 'fail',
      message: `${nodeVersion} - requires Node 18+`,
      fix: 'Install Node.js 18 or later: https://nodejs.org',
    });
  }

  if (options.fix) {
    try {
      results.push(await runRepairs());
    } catch (err) {
      results.push({
        name: 'Repairs',
        status: 'fail',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let state;
  try {
    state = await loadState();
    results.push({
      name: 'State file',
      status: 'ok',
      message: `Project: ${state.project}, Workflow stage: ${state.workflowStage}, Phase: ${state.currentPhase}`,
    });
    results.push(buildVerifyDiagnostic(state));
  } catch {
    results.push({
      name: 'State file',
      status: 'warn',
      message: 'No state file found',
      fix: 'Run: danteforge review',
    });
    results.push(buildVerifyDiagnostic());
  }

  try {
    const config = await loadConfig();
    const provider = config.defaultProvider;
    const hasKey = config.providers[provider]?.apiKey ? 'yes' : 'no';
    results.push({ name: 'Config', status: 'ok', message: `Provider: ${provider}, API key: ${hasKey}` });
  } catch {
    results.push({
      name: 'Config',
      status: 'warn',
      message: 'No config found',
      fix: 'Run: danteforge config --set-key "openai:<key>"',
    });
  }

  const llmReady = await isLLMAvailable();
  const llmProbe = await probeLLMProvider();
  results.push({
    name: 'LLM availability',
    status: llmReady ? 'ok' : 'warn',
    message: llmReady
      ? `Configured provider is verified for direct calls (${llmProbe.message})`
      : `No verified live provider path is currently available. ${llmProbe.message}`,
    fix: llmReady ? undefined : 'Configure a provider with working model access or start Ollama with the configured model before direct execution commands.',
  });

  try {
    const skills = await discoverSkills();
    results.push({ name: 'Skills', status: 'ok', message: `${skills.length} skills discovered` });
  } catch (err) {
    results.push({
      name: 'Skills',
      status: 'warn',
      message: err instanceof Error ? err.message : 'Could not discover skills',
      fix: 'Ensure packaged skills exist under src/harvested/dante-agents/skills',
    });
  }

  const homeDir = process.env.DANTEFORGE_HOME ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (homeDir) {
    results.push(await checkAssistantRegistries(homeDir, Boolean(options.live)));
    results.push(await checkCodexBootstrap(homeDir, Boolean(options.live)));
    results.push(await checkCodexCommandFiles(homeDir, Boolean(options.live)));
    results.push(await checkCodexCliFallbackSkill(homeDir, Boolean(options.live)));
    results.push(await checkCodexUtilityAliases(homeDir, Boolean(options.live)));
  }
  results.push(await checkCursorBootstrap(process.cwd()));

  const host = detectHost();
  const capabilities = await detectMCPCapabilities(host);
  const tier = resolveTier(host, capabilities.hasFigmaMCP);
  if (capabilities.hasFigmaMCP) {
    results.push({
      name: 'Figma MCP config',
      status: 'ok',
      message: `Host: ${host}, Tier: ${tier}, Server: ${capabilities.figmaServerName ?? 'figma'}`,
    });
  } else if (capabilities.hasMCP) {
    results.push({
      name: 'Figma MCP config',
      status: 'warn',
      message: `MCP detected (host: ${host}) but no Figma server is configured.`,
      fix: 'Run: danteforge setup figma',
    });
  } else {
    results.push({
      name: 'Figma MCP config',
      status: 'warn',
      message: `No MCP configuration detected for host: ${host}.`,
      fix: 'Run: danteforge setup figma',
    });
  }

  if (await exists(path.join('dist', 'index.js'))) {
    results.push({ name: 'Build', status: 'ok', message: 'dist/index.js exists' });
  } else {
    results.push({
      name: 'Build',
      status: 'warn',
      message: 'No CLI build artifact found',
      fix: 'Run: npm run build',
    });
  }

  const validLevels: LogLevel[] = ['silent', 'error', 'warn', 'info', 'verbose'];
  const currentLevel = logger.getLevel();
  results.push(
    validLevels.includes(currentLevel)
      ? { name: 'Logger', status: 'ok', message: `Level: ${currentLevel}` }
      : { name: 'Logger', status: 'warn', message: `Unexpected level: ${currentLevel}` },
  );

  const artifacts = ['CURRENT_STATE.md', 'CONSTITUTION.md', 'SPEC.md', 'CLARIFY.md', 'PLAN.md', 'TASKS.md', 'UPR.md'];
  const foundArtifacts: string[] = [];
  for (const artifact of artifacts) {
    if (await exists(path.join('.danteforge', artifact))) {
      foundArtifacts.push(artifact);
    }
  }
  results.push({
    name: 'Artifacts',
    status: foundArtifacts.length > 0 ? 'ok' : 'warn',
    message: foundArtifacts.length > 0 ? `Found: ${foundArtifacts.join(', ')}` : 'No workflow artifacts yet',
    fix: foundArtifacts.length > 0 ? undefined : 'Run: danteforge review',
  });

  if (options.live) {
    results.push(await checkLiveReleaseConfig());
    results.push(await checkAntigravityUpstream());

    const mcp = await testMCPConnection();
    results.push({
      name: 'Figma MCP endpoint',
      status: mcp.ok ? 'ok' : 'fail',
      message: mcp.message,
      fix: mcp.ok ? undefined : 'Check internet access to https://mcp.figma.com/mcp',
    });
  }

  logger.info('');
  let failCount = 0;
  let warnCount = 0;
  for (const result of results) {
    const icon = result.status === 'ok' ? '[OK]  ' : result.status === 'warn' ? '[WARN]' : '[FAIL]';
    const level = result.status === 'ok' ? 'success' : result.status === 'warn' ? 'warn' : 'error';
    logger[level](`${icon} ${result.name}: ${result.message}`);
    if (result.fix) {
      logger.info(`         Fix: ${result.fix}`);
    }
    if (result.status === 'fail') failCount++;
    if (result.status === 'warn') warnCount++;
  }

  logger.info('');
  const total = results.length;
  const ok = total - failCount - warnCount;
  if (failCount > 0) {
    logger.error(`Health check: ${ok}/${total} passed, ${failCount} failed, ${warnCount} warnings`);
  } else if (warnCount > 0) {
    logger.warn(`Health check: ${ok}/${total} passed, ${warnCount} warnings`);
  } else {
    logger.success(`Health check: ${total}/${total} passed`);
  }

  try {
    const auditState = await loadState();
    auditState.auditLog.push(`${new Date().toISOString()} | doctor: ${ok}/${total} ok, ${failCount} fail, ${warnCount} warn${options.live ? ', live' : ''}${options.fix ? ', fix' : ''}`);
    await saveState(auditState);
  } catch {
    // Doctor should still complete even if state persistence is unavailable.
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }
  });
}
