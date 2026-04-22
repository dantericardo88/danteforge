// Shell completion script generator for DanteForge CLI
// Supports bash, zsh, and fish. Usage: eval "$(danteforge completion bash)"

/**
 * Discover commands dynamically from the CLI's Commander program.
 * Falls back to the static COMPLETION_COMMANDS list if discovery fails.
 */
export async function discoverCommands(): Promise<string[]> {
  try {
    const { readdirSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const commandsDir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(commandsDir);
    const commands = files
      .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
      .filter(f => f !== 'index.ts' && f !== 'index.js' && f !== 'completion.ts' && f !== 'completion.js')
      .map(f => f.replace(/\.(ts|js)$/, ''))
      .filter(f => !f.startsWith('_'));
    return commands.length > 0 ? commands : [...COMPLETION_COMMANDS];
  } catch {
    return [...COMPLETION_COMMANDS];
  }
}

export const COMPLETION_COMMANDS = [
  // Pipeline
  'init', 'constitution', 'specify', 'clarify', 'plan', 'tasks', 'design',
  'ux-refine', 'forge', 'verify', 'synthesize',
  // Presets
  'spark', 'ember', 'canvas', 'magic', 'blaze', 'nova', 'inferno',
  // Automation
  'autoforge', 'autoresearch', 'party', 'resume',
  // Intelligence
  'review', 'tech-decide', 'debug', 'lessons', 'oss', 'local-harvest', 'harvest',
  'retro', 'profile', 'maturity', 'assess', 'self-improve', 'define-done',
  // Design & QA
  'browse', 'qa', 'awesome-scan', 'universe',
  // Setup & Health
  'setup', 'doctor', 'config', 'dashboard', 'mcp-server', 'sync-context',
  'publish-check', 'audit-export', 'premium', 'workspace',
  // Git Integration
  'commit', 'branch', 'pr',
  // Tools
  'compact', 'import', 'skills', 'feedback', 'update-mcp', 'docs',
  'ship', 'pack', 'ci-setup', 'proof', 'benchmark', 'benchmark-llm',
  'explain', 'quickstart', 'plugin', 'demo',
  // Meta
  'help', 'workflow', 'wiki-ingest', 'wiki-lint', 'wiki-query',
  'wiki-status', 'wiki-export',
] as const;

export type DanteForgeCommand = (typeof COMPLETION_COMMANDS)[number];

// ── Bash completion ───────────────────────────────────────────────────────────

export function generateBashCompletion(): string {
  const cmds = COMPLETION_COMMANDS.join(' ');
  return `# DanteForge bash completion
# Add to ~/.bashrc: eval "$(danteforge completion bash)"
_danteforge_completions() {
  local cur prev words
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local commands="${cmds}"
  local global_flags="--help --version --quiet --verbose --profile"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( \$(compgen -W "\${commands} \${global_flags}" -- "\${cur}") )
    return 0
  fi

  # Per-command flag completions
  case "\${prev}" in
    specify|debug|autoresearch|harvest|quickstart)
      # These take a free-form argument — no completions
      return 0
      ;;
    forge)
      COMPREPLY=( \$(compgen -W "1 2 3 4 5 --parallel --prompt --light --profile --worktree" -- "\${cur}") )
      return 0
      ;;
    spark|ember|canvas|magic|blaze|nova|inferno)
      COMPREPLY=( \$(compgen -W "--prompt --profile --worktree --isolation --with-design" -- "\${cur}") )
      return 0
      ;;
    autoforge)
      COMPREPLY=( \$(compgen -W "--dry-run --prompt --max-waves --profile --parallel --auto" -- "\${cur}") )
      return 0
      ;;
    setup)
      COMPREPLY=( \$(compgen -W "assistants figma ollama" -- "\${cur}") )
      return 0
      ;;
    config)
      COMPREPLY=( \$(compgen -W "--set-key --show" -- "\${cur}") )
      return 0
      ;;
    --profile)
      COMPREPLY=( \$(compgen -W "quality balanced budget" -- "\${cur}") )
      return 0
      ;;
    completion)
      COMPREPLY=( \$(compgen -W "bash zsh fish" -- "\${cur}") )
      return 0
      ;;
  esac

  COMPREPLY=( \$(compgen -W "--help --prompt --light --verbose" -- "\${cur}") )
  return 0
}

complete -F _danteforge_completions danteforge
complete -F _danteforge_completions df
`;
}

// ── Zsh completion ────────────────────────────────────────────────────────────

export function generateZshCompletion(): string {
  const cmdEntries = [
    ['init', 'Set up a new DanteForge project'],
    ['constitution', 'Establish project principles'],
    ['specify', 'Transform idea into full spec'],
    ['clarify', 'Find gaps in your spec'],
    ['plan', 'Generate execution plan'],
    ['tasks', 'Break plan into atomic tasks'],
    ['design', 'Generate .op design artifacts'],
    ['ux-refine', 'Refine UI/UX after forge'],
    ['forge', 'Execute development waves'],
    ['verify', 'Check project state and artifacts'],
    ['synthesize', 'Merge artifacts into UPR.md'],
    ['spark', 'Zero-token planning preset'],
    ['ember', 'Very low-token preset'],
    ['canvas', 'Design-first frontend preset'],
    ['magic', 'Balanced default preset'],
    ['blaze', 'High-power preset'],
    ['nova', 'Very-high-power preset'],
    ['inferno', 'Maximum-power preset'],
    ['autoforge', 'Autonomous pipeline execution'],
    ['autoresearch', 'Metric-driven optimization loop'],
    ['party', 'Multi-agent collaboration mode'],
    ['resume', 'Resume paused autoforge'],
    ['review', 'Scan repo and generate CURRENT_STATE.md'],
    ['tech-decide', 'Choose tech stack interactively'],
    ['debug', 'Systematic 4-phase debugging'],
    ['lessons', 'Capture corrections as persistent rules'],
    ['oss', 'OSS pattern harvesting pipeline'],
    ['local-harvest', 'Harvest patterns from local repos'],
    ['harvest', 'Titan Harvest V2 constitutional harvest'],
    ['retro', 'Sprint retrospective'],
    ['profile', 'Manage quality profiles'],
    ['maturity', 'Analyze code maturity level'],
    ['assess', 'Harsh self-assessment scoring'],
    ['self-improve', 'Autonomous self-improvement loop'],
    ['define-done', 'Define what 9+ means interactively'],
    ['browse', 'Browser automation'],
    ['qa', 'Structured QA pass'],
    ['awesome-scan', 'Discover and import skills'],
    ['universe', 'View competitive feature universe'],
    ['setup', 'Bootstrap integrations'],
    ['doctor', 'Run diagnostics and repairs'],
    ['config', 'Manage API keys and settings'],
    ['dashboard', 'Project health dashboard'],
    ['mcp-server', 'Start the MCP server'],
    ['sync-context', 'Sync Cursor context'],
    ['publish-check', 'Pre-publish checklist'],
    ['audit-export', 'Export audit log'],
    ['premium', 'Premium features'],
    ['workspace', 'Workspace management'],
    ['commit', 'Smart git commit'],
    ['branch', 'Create git branch'],
    ['pr', 'Open pull request'],
    ['compact', 'Summarize old audit log entries'],
    ['import', 'Import LLM-generated file'],
    ['skills', 'List available skills'],
    ['feedback', 'Generate refinement prompt from UPR.md'],
    ['update-mcp', 'Update MCP configuration'],
    ['docs', 'Generate command reference docs'],
    ['ship', 'Paranoid release guidance'],
    ['pack', 'Pack project for distribution'],
    ['ci-setup', 'Set up CI configuration'],
    ['proof', 'Generate proof of work'],
    ['benchmark', 'Run benchmarks'],
    ['benchmark-llm', 'Benchmark LLM providers'],
    ['explain', 'Explain a term or concept'],
    ['quickstart', 'Guided quickstart flow'],
    ['plugin', 'Manage plugins'],
    ['demo', 'Run interactive demo'],
    ['help', 'Context-aware help'],
    ['workflow', 'Show workflow pipeline'],
    ['wiki-ingest', 'Ingest source files into wiki'],
    ['wiki-lint', 'Run wiki self-evolution scan'],
    ['wiki-query', 'Search wiki entities'],
    ['wiki-status', 'Show wiki health metrics'],
    ['wiki-export', 'Export wiki as Obsidian vault'],
  ] as const;

  const cmdDefs = cmdEntries
    .map(([cmd, desc]) => `    '${cmd}:${desc}'`)
    .join('\n');

  return `#compdef danteforge df
# DanteForge zsh completion
# Add to ~/.zshrc: eval "$(danteforge completion zsh)"
# Or place in a $fpath directory as _danteforge

_danteforge() {
  local state line
  typeset -A opt_args

  _arguments \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-V --version)'{-V,--version}'[Show version]' \\
    '--quiet[Suppress non-error output]' \\
    '--verbose[Show debug output]' \\
    '--profile[Quality profile]:profile:(quality balanced budget)' \\
    '1: :_danteforge_commands' \\
    '*:: :->args'

  case $state in
    args)
      case $words[1] in
        completion)
          _arguments '1:shell:(bash zsh fish)'
          ;;
        forge)
          _arguments \\
            '1:phase:(1 2 3 4 5)' \\
            '--parallel[Run tasks in parallel]' \\
            '--prompt[Generate copy-paste prompt]' \\
            '--light[Skip hard gates]' \\
            '--worktree[Run in isolated git worktree]' \\
            '--profile[Quality profile]:profile:(quality balanced budget)'
          ;;
        spark|ember|canvas|magic|blaze|nova|inferno)
          _arguments \\
            '1:goal:' \\
            '--prompt[Generate copy-paste prompt]' \\
            '--worktree[Run in isolated git worktree]' \\
            '--isolation[Enable agent isolation]' \\
            '--with-design[Include design step]' \\
            '--profile[Quality profile]:profile:(quality balanced budget)'
          ;;
        autoforge)
          _arguments \\
            '1:goal:' \\
            '--dry-run[Show commands without executing]' \\
            '--prompt[Generate copy-paste prompt]' \\
            '--max-waves[Maximum execution waves]:n:' \\
            '--auto[Enable autonomous execution]' \\
            '--profile[Quality profile]:profile:(quality balanced budget)'
          ;;
        setup)
          _arguments '1:subcommand:(assistants figma ollama)'
          ;;
        config)
          _arguments \\
            '--set-key[Set API key]:provider\\:key:' \\
            '--show[Show current configuration]'
          ;;
        *)
          _arguments \\
            '--help[Show help]' \\
            '--prompt[Generate copy-paste prompt]' \\
            '--light[Skip hard gates]' \\
            '--verbose[Show debug output]'
          ;;
      esac
  esac
}

_danteforge_commands() {
  local commands
  commands=(
${cmdDefs}
  )
  _describe 'command' commands
}

_danteforge
`;
}

// ── Fish completion ───────────────────────────────────────────────────────────

export function generateFishCompletion(): string {
  const cmds = COMPLETION_COMMANDS.map((cmd) => `complete -c danteforge -f -n '__fish_use_subcommand' -a '${cmd}'`).join('\n');

  return `# DanteForge fish completion
# Add to ~/.config/fish/completions/danteforge.fish or:
# danteforge completion fish > ~/.config/fish/completions/danteforge.fish

function __fish_danteforge_no_subcommand
  for i in (commandline -opc)
    if contains -- $i ${COMPLETION_COMMANDS.join(' ')}
      return 1
    end
  end
  return 0
end

# Global flags
complete -c danteforge -n '__fish_danteforge_no_subcommand' -l help -s h -d 'Show help'
complete -c danteforge -n '__fish_danteforge_no_subcommand' -l version -s V -d 'Show version'
complete -c danteforge -n '__fish_danteforge_no_subcommand' -l quiet -d 'Suppress non-error output'
complete -c danteforge -n '__fish_danteforge_no_subcommand' -l verbose -d 'Show debug output'
complete -c danteforge -n '__fish_danteforge_no_subcommand' -l profile -d 'Quality profile' -r -a 'quality balanced budget'

# Commands
${cmds}

# completion subcommand
complete -c danteforge -f -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish' -d 'Target shell'

# --profile flag for all commands
complete -c danteforge -l profile -d 'Quality profile' -r -a 'quality balanced budget'

# --prompt flag
complete -c danteforge -l prompt -d 'Generate copy-paste prompt instead of executing'

# --light flag
complete -c danteforge -l light -d 'Skip hard gates (constitution, spec, plan, tests)'

# --worktree flag
complete -c danteforge -l worktree -d 'Run in isolated git worktree'

# --dry-run flag
complete -c danteforge -l dry-run -d 'Show commands without executing'

# forge phase completions
complete -c danteforge -f -n '__fish_seen_subcommand_from forge' -a '1 2 3 4 5' -d 'Execution phase'

# setup subcommand completions
complete -c danteforge -f -n '__fish_seen_subcommand_from setup' -a 'assistants figma ollama' -d 'Setup target'
`;
}

// ── CLI entry point ────────────────────────────────────────────────────────────

export async function completionCmd(shell?: string, options: {
  _stdout?: (output: string) => void;
  _stderr?: (output: string) => void;
} = {}): Promise<void> {
  const emit = options._stdout ?? ((s) => process.stdout.write(s));
  const emitErr = options._stderr ?? ((s) => process.stderr.write(s));

  const target = (shell ?? 'bash').toLowerCase();

  switch (target) {
    case 'bash':
      emit(generateBashCompletion());
      break;
    case 'zsh':
      emit(generateZshCompletion());
      break;
    case 'fish':
      emit(generateFishCompletion());
      break;
    default:
      emitErr(`Unknown shell: ${target}\nSupported: bash, zsh, fish\n`);
      process.exit(1);
  }
}
