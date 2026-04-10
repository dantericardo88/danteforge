// Context-aware help engine - guides users to the right command.
import { logger } from '../../core/logger.js';
import { listSkills } from '../../core/skills.js';
import { loadState, type WorkflowStage } from '../../core/state.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

export const COMMAND_HELP: Record<string, string> = {
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
  config: 'Manage API keys and LLM provider settings.\n  Usage: danteforge config --set-key <provider:key>\n  Native host slash commands use the host model; direct DanteForge CLI uses this shared local/cloud config.\n  Providers: grok, claude, openai, gemini, ollama',
  setup: 'Bootstrap assistant registries and integrations.\n  Usage: danteforge setup assistants [--assistants claude,codex,gemini,opencode,goose] [--pull]\n  Cursor is project-local and must be requested explicitly with --assistants cursor.\n  Use danteforge setup ollama --pull to make direct CLI execution local-first and cheaper.\n  Also supports: danteforge setup figma, danteforge setup ollama',
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
  resume: 'Resume a paused autoforge loop from the last checkpoint.\n  Usage: danteforge resume\n  Reads .danteforge/AUTOFORGE_PAUSED and continues from saved state.',
  magic: 'Balanced default preset for follow-up gap closing.\n  Usage: danteforge magic [goal] [--prompt] [--profile quality|balanced|budget] [--worktree]\n  Token-efficient follow-up after an initial inferno or nova run.',
  design: 'Generate .op design artifacts from natural language.\n  Usage: danteforge design <prompt> [--prompt] [--light]\n  Creates OpenPencil design artifacts in .danteforge/design/.',
  'ux-refine': 'Refine UI/UX after forge using OpenPencil.\n  Usage: danteforge ux-refine [--openpencil] [--prompt]\n  Extracts design tokens, pushes to Figma, or generates UX refinement prompts.',
  'tech-decide': 'Choose tech stack interactively or via LLM.\n  Usage: danteforge tech-decide [--prompt] [--light]\n  Outputs TECH_DECISIONS.md with rationale, trade-offs, and migration notes.',
  retro: 'Generate a sprint retrospective from state and audit log.\n  Usage: danteforge retro [--prompt]\n  Outputs RETRO.md with what worked, what did not, and action items.',
  maturity: 'Analyze current code maturity level.\n  Usage: danteforge maturity [--prompt]\n  Maps codebase to 6 maturity levels (Sketch → Enterprise-Grade) across 8 dimensions.',
  assess: 'Harsh self-assessment scoring across all 12 dimensions.\n  Usage: danteforge assess [--prompt]\n  Benchmarks against OSS peers and produces gap analysis with improvement priorities.',
  'self-improve': 'Autonomous self-improvement loop.\n  Usage: danteforge self-improve [goal] [--prompt] [--max-waves <n>]\n  Runs assess → forge gaps → verify in a loop until target maturity is reached.',
  'define-done': 'Interactive Q&A to define what 9+ means for your project.\n  Usage: danteforge define-done\n  Sets acceptance criteria in STATE.yaml for autoforge convergence targets.',
  universe: 'View the competitive feature universe.\n  Usage: danteforge universe [--prompt]\n  Shows all unique capabilities found across comparable OSS tools after an oss/harvest run.',
  browse: 'Browser automation — navigate, screenshot, inspect live apps.\n  Usage: danteforge browse <subcommand> [args...]\n  Subcommands: screenshot, navigate, inspect. Requires a browser backend.',
  qa: 'Structured QA pass with health score and regression comparison.\n  Usage: danteforge qa [--prompt] [--baseline]\n  Runs automated quality checks and compares against a stored baseline.',
  ship: 'Paranoid release guidance — review, version bump plan, changelog.\n  Usage: danteforge ship\n  Checks all release gates before recommending version strategy.',
  pack: 'Pack project for distribution.\n  Usage: danteforge pack [output] [--format tar|zip]\n  Bundles source, config, and artifacts into a distributable archive.',
  'ci-setup': 'Generate CI/CD configuration for your project.\n  Usage: danteforge ci-setup [--provider github|gitlab|circleci]\n  Outputs workflow files configured for DanteForge pipeline checks.',
  proof: 'Generate a proof-of-work artifact from the current state.\n  Usage: danteforge proof [--prompt]\n  Creates a signed summary of what was built, verified, and shipped.',
  'sync-context': 'Sync Cursor IDE context with current DanteForge state.\n  Usage: danteforge sync-context [--target cursor]\n  Updates .cursor/rules from CONSTITUTION.md and CURRENT_STATE.md.',
  demo: 'Run an interactive demo of DanteForge capabilities.\n  Usage: danteforge demo\n  Walks through a simulated project lifecycle without touching real files.',
  'benchmark': 'Run performance benchmarks on the project.\n  Usage: danteforge benchmark [--prompt]\n  Measures build times, test run times, and outputs a benchmark report.',
  'benchmark-llm': 'Benchmark LLM providers for speed and quality.\n  Usage: danteforge benchmark-llm [--providers <list>]\n  Runs identical prompts across configured providers and compares results.',
  explain: 'Explain a DanteForge term, concept, or command in plain English.\n  Usage: danteforge explain [term]\n  Example: danteforge explain "PDSE" or danteforge explain "forge wave"',
  quickstart: 'Guided quickstart flow for new projects.\n  Usage: danteforge quickstart [idea]\n  Detects project type, asks a few questions, and runs the right preset automatically.',
  plugin: 'Manage DanteForge plugins.\n  Usage: danteforge plugin <subcommand> [args...]\n  Subcommands: install <name>, remove <name>, list. Plugins extend CLI commands and skills.',
  workflow: 'Show the full DanteForge workflow pipeline.\n  Usage: danteforge workflow\n  Displays the canonical pipeline diagram with stage transitions and preset shortcuts.',
  'update-mcp': 'Update the MCP (Model Context Protocol) configuration.\n  Usage: danteforge update-mcp\n  Regenerates .mcp.json with current tool definitions for Claude Code integration.',
  'audit-export': 'Export the audit log to a readable format.\n  Usage: danteforge audit-export [--format json|markdown] [--output <path>]\n  Extracts the full STATE.yaml audit log to a standalone file.',
  premium: 'Access premium DanteForge features.\n  Usage: danteforge premium [subcommand]\n  Subcommands: status, activate. Requires a valid license key.',
  'publish-check': 'Pre-publish checklist before releasing to npm or a package registry.\n  Usage: danteforge publish-check\n  Validates package.json, build output, and required fields before any publish.',
  workspace: 'Manage multiple project workspaces.\n  Usage: danteforge workspace <subcommand> [args...]\n  Subcommands: list, add <path>, remove <name>, switch <name>.',
  'mcp-server': 'Start the DanteForge MCP server for Claude Code integration.\n  Usage: danteforge mcp-server [--port <n>]\n  Exposes DanteForge tools as MCP resources consumable by any MCP-compatible client.',
  'wiki-ingest': 'Ingest raw source files into compiled wiki entity pages.\n  Usage: danteforge wiki-ingest [--bootstrap] [--cwd <path>]\n  --bootstrap seeds the wiki from existing .danteforge/ artifacts.',
  'wiki-lint': 'Run self-evolution scan: contradictions, staleness, link integrity, pattern synthesis.\n  Usage: danteforge wiki-lint [--heuristic-only] [--cwd <path>]\n  --heuristic-only skips LLM calls for zero-cost structural checks.',
  'wiki-query': 'Search the wiki for entity pages, decisions, and patterns.\n  Usage: danteforge wiki-query <topic> [--cwd <path>]\n  Returns relevant wiki pages and cross-linked entities for the given topic.',
  'wiki-status': 'Display wiki health metrics: page count, link density, orphan pages.\n  Usage: danteforge wiki-status [--cwd <path>]\n  Shows a summary of wiki coverage and identifies improvement opportunities.',
  'wiki-export': 'Export the compiled wiki as an Obsidian-compatible vault.\n  Usage: danteforge wiki-export [--format obsidian|markdown] [--output <path>]\n  Converts wiki entity pages to interlinked Markdown files.',
  commit: 'Stage changed files and commit with a task-derived message.\n  Usage: danteforge commit [--message <msg>] [--push]\n  Generates a commit message from the current task state and staged files.',
  branch: 'Create a git branch from current task state.\n  Usage: danteforge branch [--name <name>]\n  Derives a branch name from the active task or goal if --name is not provided.',
  pr: 'Generate PR body from spec and plan, then open via gh CLI.\n  Usage: danteforge pr [--draft] [--base <branch>] [--title <title>]\n  Requires the gh CLI to be installed and authenticated.',
  dashboard: 'Show project health dashboard.\n  Usage: danteforge dashboard\n  Displays scores, completion tracker, active tasks, and recent audit log entries.',
  completion: 'Output shell completion script.\n  Usage: danteforge completion [bash|zsh|fish]\n  Add to shell: eval "$(danteforge completion bash)"\n  Supports bash, zsh, and fish.',
  lessons: 'Capture corrections and failures as persistent self-improvement rules.\n  Usage: danteforge lessons [correction]\n  With no argument, shows existing lessons. With text, appends a new lesson.',
  help: 'Context-aware help with stage-specific suggestions.\n  Usage: danteforge help [command]\n  Without a command, shows current workflow stage and next recommended step.',
  profile: 'Manage and switch quality profiles.\n  Usage: danteforge profile [subcommand] [name]\n  Subcommands: list, set <name>, show. Profiles control token budget and quality thresholds.',
  skills: 'List all available skills and their descriptions.\n  Usage: danteforge skills\n  Shows built-in and discovered YAML-defined skills with usage hints.',
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
