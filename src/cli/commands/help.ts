// Context-aware help engine - guides users to the right command.
import { logger } from '../../core/logger.js';
import { listSkills } from '../../core/skills.js';
import { loadState, type WorkflowStage } from '../../core/state.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  CANVAS_PRESET_TEXT,
  REPO_PIPELINE_TEXT,
  SPARK_PLANNING_TEXT,
} from '../../core/workflow-surface.js';

export const COMMAND_HELP: Record<string, string> = {
  spark: `Zero-token planning preset.\n  Usage: danteforge spark [goal] [--prompt] [--skip-tech-decide]\n  Runs ${SPARK_PLANNING_TEXT} without jumping into execution.`,
  ember: 'Very low-token preset for quick features and prototypes.\n  Usage: danteforge ember [goal] [--profile budget|balanced|quality] [--prompt]\n  Uses budget-focused autoforge with light checkpoints and basic loop detection.',
  canvas: `Design-first frontend preset.\n  Usage: danteforge canvas [goal] [--profile budget|balanced|quality] [--prompt] [--design-prompt "<text>"]\n  Runs ${CANVAS_PRESET_TEXT} for frontend-heavy work.`,
  constitution: 'Establish project principles and constraints.\n  Usage: danteforge constitution\n  Run this first to set the foundation for your project.',
  specify: 'Transform a high-level idea into full spec artifacts.\n  Usage: danteforge specify <idea> [--prompt] [--light]\n  Example: danteforge specify "Build a real-time chat app with WebSocket support"',
  clarify: 'Find gaps, ambiguities, and inconsistencies in your spec.\n  Usage: danteforge clarify [--prompt]\n  Generates Q&A to refine your specification.',
  plan: 'Answer "What should we build?" — plan pipeline with optional --level depth.\n  Usage: danteforge plan [goal] [--level light|standard|deep] [--prompt] [--light]\n  light=review+specify, standard=constitution+specify+clarify+plan, deep=+tech-decide+tasks+critique\n  Without --level: danteforge plan [--prompt] generates PLAN.md from current spec.',
  tasks: 'Break the plan into atomic, executable tasks.\n  Usage: danteforge tasks [--prompt] [--light]\n  Outputs TASKS.md with parallel flags [P] and effort estimates.',
  forge: 'Execute development waves with agent orchestration.\n  Usage: danteforge forge [phase] [--parallel] [--profile quality|balanced|budget] [--prompt] [--light] [--worktree]\n  Example: danteforge forge 1 --parallel --profile quality',
  party: 'Launch multi-agent collaboration mode.\n  Usage: danteforge party [--worktree] [--isolation]\n  Requires a verified live LLM provider and fails closed when none is available.',
  review: 'Scan an existing repo and generate CURRENT_STATE.md.\n  Usage: danteforge review [--prompt]\n  Analyzes file tree, dependencies, git history, and existing docs.',
  verify: 'Check project state and artifact consistency.\n  Usage: danteforge verify [--release]\n  Validates the required workflow artifacts and can include release checks.',
  synthesize: 'Merge all artifacts into a single UPR.md (Ultimate Planning Resource).\n  Usage: danteforge synthesize',
  debug: 'Systematic 4-phase debugging framework.\n  Usage: danteforge debug <issue> [--prompt]\n  Phases: Root Cause -> Pattern Analysis -> Hypothesis Testing -> Implementation',
  feedback: 'Generate a refinement prompt from UPR.md.\n  Usage: danteforge feedback [--auto]\n  Default mode writes a manual prompt. --auto requires a verified live provider and fails closed if unavailable.',
  config: 'Manage API keys and LLM provider settings.\n  Usage: danteforge config --set-key <provider:key>\n  Native host slash commands use the host model; direct DanteForge CLI uses this shared local/cloud config.\n  Providers: grok, claude, openai, gemini, ollama',
  setup: 'Bootstrap assistant registries and integrations.\n  Usage: danteforge setup assistants [--assistants claude,codex,gemini,opencode] [--pull]\n  Cursor is project-local and must be requested explicitly with --assistants cursor.\n  Use danteforge setup ollama --pull to make direct CLI execution local-first and cheaper.\n  Also supports: danteforge setup figma, danteforge setup ollama',
  doctor: 'Run offline diagnostics, optional repairs, and live validation.\n  Usage: danteforge doctor [--fix] [--live]\n  --fix repairs state plus user-level assistant registries. Use setup assistants --assistants cursor for project-local Cursor files. --live validates secret-backed providers and MCP reachability.',
  autoforge: 'Plan or execute the deterministic DanteForge pipeline.\n  Usage: danteforge autoforge [goal] [--dry-run] [--prompt] [--max-waves <n>] [--profile <type>] [--parallel]\n  Goal is advisory context only; the execution graph remains deterministic.',
  blaze: 'High-power preset for big feature pushes.\n  Usage: danteforge blaze [goal] [--worktree] [--isolation] [--prompt] [--with-design]\n  Adds full party mode on top of strong autoforge execution, synthesis, and retro.',
  nova: 'Very-high-power preset for major feature sprints.\n  Usage: danteforge nova [goal] [--worktree] [--isolation] [--prompt] [--tech-decide] [--with-design]\n  Adds a planning prefix before deep execution and polish without OSS discovery.',
  inferno: 'Maximum-power preset for first attacks on new dimensions.\n  Usage: danteforge inferno [goal] [--worktree] [--isolation] [--max-repos <n>] [--prompt]\n  Adds OSS mining, full party orchestration, verification, synthesis, and retro.',
  'awesome-scan': 'Discover, classify, and optionally import skills.\n  Usage: danteforge awesome-scan [--source <path>] [--domain <type>] [--install]',
  compact: 'Summarize old audit log entries to save context.\n  Usage: danteforge compact',
  import: 'Import an LLM-generated file into .danteforge/.\n  Usage: danteforge import <file> [--as <name>]',
  init: 'Set up a new DanteForge project with health checks and guidance.\n  Usage: danteforge init\n  Detects project type, checks system health, and points you to the next step.',
  docs: 'Generate or update the command reference documentation.\n  Usage: danteforge docs\n  Outputs docs/COMMAND_REFERENCE.md from Commander.js metadata.',
  autoresearch: 'Autonomous metric-driven optimization loop.\n  Usage: danteforge autoresearch <goal> (--metric "<metric>" | --measurement-command "<command>") [--time <budget>] [--prompt] [--dry-run] [--allow-dirty]\n  Example: danteforge autoresearch "reduce bundle size" --metric "bundle size KB"\n  Execute mode refuses dirty working trees by default so rollback stays safe.',
  oss: 'Autonomous OSS pattern harvesting pipeline.\n  Usage: danteforge oss [--prompt] [--dry-run] [--max-repos <n>]\n  Detects project, searches OSS, clones with license gate, extracts patterns, and implements.',
  'local-harvest': 'Harvest patterns from local private repos, folders, and zip archives.\n  Usage: danteforge local-harvest [paths...] [--config <path>] [--depth shallow|medium|full] [--dry-run]\n  Creates LOCAL_HARVEST_REPORT.md and recommended OSS queries from private project sources.',
  harvest: 'Answer "What can we learn from OSS?" — harvest pipeline with optional --level depth.\n  Usage: danteforge harvest [goal] [--level light|standard|deep] [--source oss|local|mixed] [--prompt] [--lite]\n  light=focused pattern, standard=bounded OSS pass, deep=OSS+local+universe refresh\n  Without --level: danteforge harvest <system> [--prompt] [--lite] runs constitutional harvest.',
  measure: 'Answer "How good is the project?" — measure pipeline with optional --level depth.\n  Usage: danteforge measure [--level light|standard|deep] [--full] [--strict] [--adversary]\n  light=quick score, standard=score+maturity+proof, deep=verify+adversarial+convergence-proof\n  Without --level: fast score — one number + 3 P0 action items in <5 seconds. Alias: score',
  compete: 'Answer "Where do we lag the market?" — compete pipeline with optional --level depth.\n  Usage: danteforge compete [--level light|standard|deep] [--refresh] [--yes]\n  light=harsh self-assessment, standard=assess+universe refresh, deep=full Competitive Harvest Loop\n  Without --level: danteforge compete [--init] [--sprint] [--report] [--auto] full CHL commands.',
  build: 'Answer "How do we make progress?" — build pipeline with optional --level depth.\n  Usage: danteforge build <spec> [--level light|standard|deep] [--profile quality|balanced|budget] [--worktree]\n  light=forge, standard=magic, deep=inferno+OSS harvest\n  Without --level: danteforge build <spec> runs the full spec-to-ship wizard.',
  'frontier-gap': 'Frontier Gap Engine: rank skeptic objections, classify gap types, prescribe smallest proof.\n  Usage: danteforge frontier-gap [dimension] [--raise-ready] [--matrix <path>] [--cwd <path>]\n  Example: danteforge frontier-gap D12  |  danteforge frontier-gap --raise-ready',
  explain: 'Plain-English glossary — explain any DanteForge term or concept.\n  Usage: danteforge explain [term] [--list]\n  Example: danteforge explain magic  |  danteforge explain --list',
  demo: 'Side-by-side demo: raw prompt quality vs DanteForge-structured quality.\n  Usage: danteforge demo [fixture] [--all]\n  Example: danteforge demo  |  danteforge demo task-tracker',
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

export async function helpCmd(query?: string, opts: {
  all?: boolean;
  _loadState?: typeof loadState;
} = {}) {
  const loadFn = opts._loadState ?? loadState;
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

    if (opts.all) {
      logger.info('DanteForge - Full Command Reference');
      logger.info('');
      logger.info(`Pipeline: ${REPO_PIPELINE_TEXT}`);
      logger.info('Preset ladder: spark -> ember -> canvas -> magic -> blaze -> nova -> inferno');
      logger.info('');

      try {
        const state = await loadFn();
        const suggestion = STAGE_SUGGESTIONS[state.workflowStage] ?? STAGE_SUGGESTIONS.initialized;
        logger.info(`Current workflow stage: ${state.workflowStage}`);
        logger.info(`Current execution wave: ${state.currentPhase}`);
        logger.success(`Suggested next step: ${suggestion}`);
      } catch {
        // no state
      }

      logger.info('');
      logger.info('All commands:');
      for (const [cmd, desc] of Object.entries(COMMAND_HELP)) {
        const firstLine = desc.split('\n')[0] ?? desc;
        logger.info(`  danteforge ${cmd.padEnd(20)} ${firstLine}`);
      }
      logger.info('');
      logger.info('Run "danteforge help <command>" for detailed help on any command.');
      return;
    }

    logger.info('');
    logger.info('DanteForge - start with one of the 5 canonical processes');
    logger.info('');
    logger.info('  Canonical processes:');
    logger.info('    danteforge plan [goal]       - what should we build?');
    logger.info('    danteforge build <spec>      - how do we make progress?');
    logger.info('    danteforge measure           - how good is the project?');
    logger.info('    danteforge compete           - where do we lag the market?');
    logger.info('    danteforge harvest [goal]    - what can we learn from OSS?');
    logger.info('');
    logger.info('  Use a shared depth model:');
    logger.info('    --level light                - quick answer or first pass');
    logger.info('    --level standard             - default balanced workflow');
    logger.info('    --level deep                 - maximum rigor and orchestration');
    logger.info('');
    logger.info('  Common starting points:');
    logger.info('    danteforge go               - see current score and top gaps');
    logger.info('    danteforge plan --level light "<idea>"');
    logger.info('    danteforge build --level standard "<goal>"');
    logger.info('    danteforge measure --level light');
    logger.info('');
    logger.info('  Specialist/support commands:');
    logger.info('    danteforge verify|check     - machine-readable quality gate');
    logger.info('    danteforge autoresearch     - metric-driven optimization loop');
    logger.info('    danteforge inferno          - branded deep build preset');
    logger.info('    danteforge explain <term>   - plain-English glossary');
    logger.info('    danteforge init             - first-run wizard');
    logger.info('');

    try {
      const state = await loadState();
      const suggestion = STAGE_SUGGESTIONS[state.workflowStage] ?? STAGE_SUGGESTIONS.initialized;
      logger.info(`  Current workflow stage: ${state.workflowStage}`);
      logger.success(`  Next for your project: ${suggestion}`);
      logger.info('');
    } catch {
      // no state
    }

    logger.info('  See all 100+ commands:  danteforge help --all');
    logger.info('  Command detail:         danteforge help <command>');
    logger.info('  Usage flags:            danteforge <command> --help');
    logger.info('');
  });
}
