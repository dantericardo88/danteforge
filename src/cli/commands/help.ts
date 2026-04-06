// Context-aware help engine - guides users to the right command.
import { logger } from '../../core/logger.js';
import { listSkills } from '../../core/skills.js';
import { loadState, type WorkflowStage } from '../../core/state.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

const COMMAND_HELP: Record<string, string> = {
  spark: 'Zero-token planning preset.\n  Usage: danteforge spark [goal] [--prompt] [--skip-tech-decide]\n  Runs review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks without jumping into execution.',
  ember: 'Very low-token preset for quick features and prototypes.\n  Usage: danteforge ember [goal] [--profile budget|balanced|quality] [--prompt]\n  Uses budget-focused autoforge with light checkpoints and basic loop detection.',
  canvas: 'Design-first frontend preset.\n  Usage: danteforge canvas [goal] [--profile budget|balanced|quality] [--prompt] [--design-prompt "<text>"]\n  Runs design -> autoforge -> ux-refine -> verify for frontend-heavy work.',
  constitution: 'Establish project principles and constraints.\n  Usage: danteforge constitution\n  Run this first to set the foundation for your project.',
  specify: 'Transform a high-level idea into full spec artifacts.\n  Usage: danteforge specify <idea> [--prompt] [--light]\n  Example: danteforge specify "Build a real-time chat app with WebSocket support"',
  clarify: 'Find gaps, ambiguities, and inconsistencies in your spec.\n  Usage: danteforge clarify [--prompt]\n  Generates Q&A to refine your specification.',
  plan: 'Generate a detailed execution plan from your spec.\n  Usage: danteforge plan [--prompt] [--light]\n  Outputs PLAN.md with phases, tech decisions, and risk mitigations.',
  tasks: 'Break the plan into atomic, executable tasks.\n  Usage: danteforge tasks [--prompt] [--light]\n  Outputs TASKS.md with parallel flags [P] and effort estimates.',
  forge: 'Execute development waves with agent orchestration.\n  Usage: danteforge forge [phase] [--parallel] [--profile quality|balanced|budget] [--prompt] [--light] [--worktree]\n  Example: danteforge forge 1 --parallel --profile quality',
  party: 'Launch multi-agent collaboration mode.\n  Usage: danteforge party [--worktree] [--isolation]\n  Requires a verified live LLM provider and fails closed when none is available.',
  review: 'Scan an existing repo and generate CURRENT_STATE.md.\n  Usage: danteforge review [--prompt]\n  Analyzes file tree, dependencies, git history, and existing docs.',
  verify: 'Check project state and artifact consistency.\n  Usage: danteforge verify [--release]\n  Validates the required workflow artifacts and can include release checks.',
  synthesize: 'Merge all artifacts into a single UPR.md (Ultimate Planning Resource).\n  Usage: danteforge synthesize',
  debug: 'Systematic 4-phase debugging framework.\n  Usage: danteforge debug <issue> [--prompt]\n  Phases: Root Cause -> Pattern Analysis -> Hypothesis Testing -> Implementation',
  feedback: 'Generate a refinement prompt from UPR.md.\n  Usage: danteforge feedback [--auto]\n  Default mode writes a manual prompt. --auto requires a verified live provider and fails closed if unavailable.',
  config: 'Manage API keys and LLM provider settings.\n  Usage: danteforge config --set-key <provider:key>\n  Providers: grok, claude, openai, gemini, ollama',
  setup: 'Bootstrap assistant registries and integrations.\n  Usage: danteforge setup assistants [--assistants claude,codex,gemini,opencode]\n  Cursor is project-local and must be requested explicitly with --assistants cursor.\n  Also supports: danteforge setup figma',
  doctor: 'Run offline diagnostics, optional repairs, and live validation.\n  Usage: danteforge doctor [--fix] [--live]\n  --fix repairs state plus user-level assistant registries. Use setup assistants --assistants cursor for project-local Cursor files. --live validates secret-backed providers and MCP reachability.',
  autoforge: 'Plan or execute the deterministic DanteForge pipeline.\n  Usage: danteforge autoforge [goal] [--dry-run] [--prompt] [--max-waves <n>] [--profile <type>] [--parallel]\n  Goal is advisory context only; the execution graph remains deterministic.',
  blaze: 'High-power preset for big feature pushes.\n  Usage: danteforge blaze [goal] [--worktree] [--isolation] [--prompt] [--with-design]\n  Adds full party mode on top of strong autoforge execution, synthesis, and retro.',
  nova: 'Very-high-power preset for major feature sprints.\n  Usage: danteforge nova [goal] [--worktree] [--isolation] [--prompt] [--tech-decide] [--with-design]\n  Adds a planning prefix before deep execution and polish without OSS discovery.',
  inferno: 'Maximum-power preset for first attacks on new dimensions.\n  Usage: danteforge inferno [goal] [--worktree] [--isolation] [--max-repos <n>] [--prompt]\n  Adds OSS mining, full party orchestration, verification, synthesis, and retro.',
  'awesome-scan': 'Discover, classify, and optionally import skills.\n  Usage: danteforge awesome-scan [--source <path>] [--domain <type>] [--install]',
  compact: 'Summarize old audit log entries to save context.\n  Usage: danteforge compact',
  import: 'Import an LLM-generated file into .danteforge/.\n  Usage: danteforge import <file> [--as <name>]',
  init: 'Set up a new DanteForge project with health checks and guidance.\n  Usage: danteforge init\n  Detects project type, checks system health, shows recommended workflow.',
  docs: 'Generate or update the command reference documentation.\n  Usage: danteforge docs\n  Outputs docs/COMMAND_REFERENCE.md from Commander.js metadata.',
  autoresearch: 'Autonomous metric-driven optimization loop.\n  Usage: danteforge autoresearch <goal> --metric "<metric>" [--time <budget>] [--prompt] [--dry-run]\n  Example: danteforge autoresearch "reduce bundle size" --metric "bundle size KB"',
  oss: 'Autonomous OSS pattern harvesting pipeline.\n  Usage: danteforge oss [--prompt] [--dry-run] [--max-repos <n>]\n  Detects project, searches OSS, clones with license gate, extracts patterns, implements.',
  'local-harvest': 'Harvest patterns from local private repos, folders, and zip archives.\n  Usage: danteforge local-harvest [paths...] [--config <path>] [--depth shallow|medium|full] [--dry-run]\n  Creates LOCAL_HARVEST_REPORT.md and recommended OSS queries from private project sources.',
  harvest: 'Titan Harvest V2 - constitutional harvest of OSS patterns.\n  Usage: danteforge harvest <system> [--prompt] [--lite]\n  Runs the 5-step track (or SEP-LITE) and produces summary.json plus a sha256 hash.',
};

const STAGE_SUGGESTIONS: Record<WorkflowStage, string> = {
  initialized: 'Run "danteforge review" to scan an existing project, or "danteforge constitution" to start a new one.',
  review: 'Run "danteforge constitution" to establish the project rules before specifying scope.',
  constitution: 'Run "danteforge specify <idea>" to generate the working spec.',
  specify: 'Run "danteforge clarify" to resolve gaps before planning.',
  clarify: 'Run "danteforge plan" to turn the clarified spec into an execution plan.',
  plan: 'Run "danteforge tasks" to break the plan into executable work.',
  tasks: 'Run "danteforge forge 1" to execute the first wave, or use "--prompt" for manual execution planning.',
  design: 'Run "danteforge ux-refine --openpencil" to extract artifacts, or continue into implementation with "danteforge forge 1".',
  forge: 'Run "danteforge verify" to confirm the executed workflow before synthesis.',
  'ux-refine': 'Run "danteforge verify" to confirm UX artifacts and workflow consistency.',
  verify: 'Run "danteforge synthesize" to produce UPR.md from the verified workflow.',
  synthesize: 'Run "danteforge feedback" for manual refinement or "danteforge feedback --auto" with a verified live provider.',
};

export async function helpCmd(query?: string) {
  return withErrorBoundary('help', async () => {
  if (query) {
    const key = query.toLowerCase().replace('danteforge ', '');

    if (COMMAND_HELP[key]) {
      logger.info(`\n${COMMAND_HELP[key]}\n`);
      return;
    }

    const skills = await listSkills();
    const matchedSkill = skills.find((skill) => skill.name.includes(key) || key.includes(skill.name));
    if (matchedSkill) {
      logger.info(`Skill: ${matchedSkill.name}`);
      logger.info(matchedSkill.description);
      return;
    }

    logger.info(`No specific help for "${query}".`);
    logger.info('Try: danteforge help <command-name>');
    logger.info(`Available commands: ${Object.keys(COMMAND_HELP).join(', ')}`);
    return;
  }

  logger.info('DanteForge - Agentic Development CLI');
  logger.info('');
  logger.info('Pipeline: review -> constitution -> specify -> clarify -> plan -> tasks -> forge -> verify -> synthesize');
  logger.info('Preset ladder: spark -> ember -> canvas -> magic -> blaze -> nova -> inferno');
  logger.info('');

  try {
    const state = await loadState();
    const suggestion = STAGE_SUGGESTIONS[state.workflowStage] ?? STAGE_SUGGESTIONS.initialized;
    logger.info(`Current workflow stage: ${state.workflowStage}`);
    logger.info(`Current execution wave: ${state.currentPhase}`);
    logger.success(`Suggested next step: ${suggestion}`);

    if (state.workflowStage === 'initialized') {
      logger.info('');
      logger.info('Getting Started:');
      logger.info('  danteforge init           - set up a new project (recommended first step)');
      logger.info('  danteforge spark <goal>   - zero-token planning for a new idea');
      logger.info('  danteforge canvas <goal>  - design-first frontend execution');
      logger.info('  danteforge magic [goal]   - default follow-up gap-closing preset');
      logger.info('  danteforge nova <goal>    - planned sprint with deep execution, no OSS');
      logger.info('  danteforge inferno <goal> - first big attack with OSS discovery');
      logger.info('  danteforge constitution   - start the step-by-step workflow');
      logger.info('');
      logger.info('Usage rule: /canvas for design-first frontend work, /inferno for first-time new matrix dimensions, /magic for follow-up PRD gap closing.');
      logger.info('');
      logger.info('Use "danteforge --help" for the full command list with categories.');
    }
  } catch {
    logger.info('');
    logger.info('No project detected. Run "danteforge init" to get started.');
  }

  logger.info('');
  logger.info('Run "danteforge help <command>" for detailed help on any command.');
  logger.info('Run "danteforge <command> --help" for usage options.');
  });
}
