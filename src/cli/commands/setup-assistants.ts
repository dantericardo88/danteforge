import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { installAssistantSkills, type AssistantRegistry } from '../../core/assistant-installer.js';
import { resolveConfigPaths } from '../../core/config.js';

const DEFAULT_ASSISTANTS: AssistantRegistry[] = ['claude', 'codex', 'antigravity', 'opencode'];
const ALL_ASSISTANTS: AssistantRegistry[] = [
  'claude', 'codex', 'antigravity', 'opencode', 'cursor',
  'windsurf', 'aider', 'openhands', 'copilot', 'continue', 'gemini-cli',
];

function normalizeAssistant(value: string): AssistantRegistry | null {
  switch (value.trim().toLowerCase()) {
    case 'claude':
    case 'claude-code':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'antigravity':
    case 'gemini':
    case 'gemini-3.1':
      return 'antigravity';
    case 'opencode':
    case 'open-code':
      return 'opencode';
    case 'cursor':
      return 'cursor';
    case 'windsurf':
    case 'codeium':
      return 'windsurf';
    case 'aider':
      return 'aider';
    case 'openhands':
    case 'open-hands':
    case 'opendevin':
      return 'openhands';
    case 'copilot':
    case 'github-copilot':
      return 'copilot';
    case 'continue':
    case 'continue.dev':
      return 'continue';
    case 'gemini-cli':
      return 'gemini-cli';
    default:
      return null;
  }
}

function parseAssistants(raw: string | undefined): AssistantRegistry[] | undefined {
  if (!raw) {
    return DEFAULT_ASSISTANTS;
  }

  if (raw.trim().toLowerCase() === 'all') {
    return ALL_ASSISTANTS;
  }

  const assistants = raw
    .split(',')
    .map(value => normalizeAssistant(value))
    .filter(Boolean);

  if (assistants.length === 0) {
    throw new Error('Invalid assistant list. Use: claude,codex,cursor,windsurf,aider,openhands,copilot,continue,gemini-cli or "all"');
  }

  return [...new Set(assistants)] as AssistantRegistry[];
}

export async function setupAssistants(options: {
  assistants?: string;
  _installSkills?: typeof installAssistantSkills;
  _resolvePaths?: typeof resolveConfigPaths;
} = {}) {
  const installFn = options._installSkills ?? installAssistantSkills;
  const resolvePathsFn = options._resolvePaths ?? resolveConfigPaths;

  return withErrorBoundary('setup-assistants', async () => {
    const assistants = parseAssistants(options.assistants);
    const result = await installFn({ assistants });
    const paths = resolvePathsFn();

    logger.success('Installed DanteForge skills for local coding assistants');
    for (const entry of result.assistants) {
      const noun = entry.installMode === 'skills' ? 'skills' : 'file(s)';
      logger.info(`${entry.assistant}: ${entry.installedSkills.length} ${noun} -> ${entry.targetDir}`);
    }
    logger.info(`Shared secrets/config: ${paths.configFile}`);
    if (assistants?.includes('codex')) {
      logger.info('Codex install contract: native commands in `~/.codex/commands`, CLI fallback in `~/.codex/skills/danteforge-cli`, bootstrap in `~/.codex/AGENTS.md`, and utility aliases in `~/.codex/config.toml`.');
      logger.info('Codex validation: rerun `danteforge doctor` and see `docs/Codex-Install.md` for npm, tarball, and source install flows on other machines.');
      logger.info('Codex note: local Codex installs are supported; hosted Codex/chat surfaces may ignore user-level `~/.codex/*` files.');
    }
    logger.info('Cursor is project-local and opt-in. Run `danteforge setup assistants --assistants cursor` when you want the `.cursor/rules/danteforge.mdc` bootstrap file.');
    logger.info('Next: run `danteforge config --set-key "openai:..."` and `danteforge doctor --live` on the target machine.');
    logger.info('');
    logger.info('--- Adversarial Scoring: Why It Matters -------------------------------------');
    logger.info('  DanteForge can use a SECOND independent LLM to challenge scores.');
    logger.info('  When the same model that built the code also scores it, scores inflate.');
    logger.info('  NOTE: The better the adversary model, the more honest the signal.');
    logger.info('        Two providers with different training -> the sharpest critique.');
    logger.info('');
    logger.info('  - Ollama auto-detected when running (free, local, zero config)');
    logger.info('  - Configure: danteforge init');
    logger.info('  - Try it:    danteforge score --adversary');
    logger.info('  - In ascend: danteforge ascend --adversarial-gating');
    logger.info('----------------------------------------------------------------------------');
  });
}
