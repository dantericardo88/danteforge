// explain — glossary of DanteForge terms with plain-English explanations and fuzzy matching

export interface GlossaryEntry {
  term: string;
  plainEnglish: string;
  analogy: string;
  relatedCommands: string[];
  example?: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  constitution: {
    term: 'constitution',
    plainEnglish: 'A plain-text document that defines your project\'s rules, goals, tech stack, and non-negotiables. Every DanteForge command reads it before acting.',
    analogy: 'Like a company\'s founding charter — it sets the laws that all future decisions must follow.',
    relatedCommands: ['constitution', 'init', 'specify'],
    example: 'danteforge constitution',
  },
  pdse: {
    term: 'pdse',
    plainEnglish: 'Project Development Score Engine — an 8-dimension quality score (0-100) that measures how production-ready your code is across functionality, testing, security, UX, and more.',
    analogy: 'Like a car inspection checklist: it grades every major system before you declare it roadworthy.',
    relatedCommands: ['autoforge', 'verify', 'assess'],
    example: 'danteforge autoforge --score-only',
  },
  wave: {
    term: 'wave',
    plainEnglish: 'A single execution batch — a group of related tasks sent to the LLM in one round. Autoforge runs multiple waves until your quality score converges.',
    analogy: 'Like a sprint in agile: a time-boxed unit of focused work.',
    relatedCommands: ['forge', 'autoforge', 'party'],
    example: 'danteforge autoforge --waves 3',
  },
  party: {
    term: 'party',
    plainEnglish: 'Multi-agent collaboration mode where 5 specialized agents (Architect, Developer, Reviewer, QA, Synthesizer) work in parallel on your task.',
    analogy: 'Like assembling a SWAT team — each member has a specific role and they coordinate to hit the objective faster.',
    relatedCommands: ['party', 'nova', 'inferno'],
    example: 'danteforge party "build auth module"',
  },
  autoforge: {
    term: 'autoforge',
    plainEnglish: 'The autonomous improvement loop — scores your project, plans fixes, runs waves of LLM-driven changes, then re-scores until a quality threshold is met.',
    analogy: 'Like a self-driving improvement bot: it keeps running laps until your code passes inspection.',
    relatedCommands: ['autoforge', 'verify', 'forge'],
    example: 'danteforge autoforge --auto',
  },
  spark: {
    term: 'spark',
    plainEnglish: 'The lightest preset — runs just the planning pipeline (constitution → spec → plan → tasks) with zero LLM API calls. Safe to run offline.',
    analogy: 'Like sketching on a napkin before buying materials — you\'re thinking, not building yet.',
    relatedCommands: ['spark', 'magic', 'ember'],
    example: 'danteforge spark "build a todo app"',
  },
  ember: {
    term: 'ember',
    plainEnglish: 'A very low-token preset — runs a quick budget autoforge pass with minimal LLM usage. Good for small improvements on a tight token budget.',
    analogy: 'Like using a lighter instead of a blowtorch — enough heat to get the job done without burning through resources.',
    relatedCommands: ['ember', 'spark', 'magic'],
    example: 'danteforge ember "fix login bug"',
  },
  canvas: {
    term: 'canvas',
    plainEnglish: 'A design-first preset — generates .op design artifacts before writing any code, then runs autoforge and UX refinement. Best for UI-heavy work.',
    analogy: 'Like an architect drawing blueprints before the construction crew arrives.',
    relatedCommands: ['canvas', 'design', 'ux-refine'],
    example: 'danteforge canvas "dashboard redesign"',
  },
  magic: {
    term: 'magic',
    plainEnglish: 'The balanced default preset — runs constitution → plan → autoforge → verify with a sensible token budget. The recommended preset for everyday follow-up work.',
    analogy: 'Like the "recommended" button on an appliance — it handles 80% of use cases correctly without fiddling.',
    relatedCommands: ['magic', 'blaze', 'spark'],
    example: 'danteforge magic "add user settings page"',
  },
  blaze: {
    term: 'blaze',
    plainEnglish: 'A high-power preset — adds party mode and strong autoforge passes with synthesize and retro steps. Good for significant feature work.',
    analogy: 'Like calling in the reinforcements — more agents, more passes, higher confidence in the result.',
    relatedCommands: ['blaze', 'nova', 'party'],
    example: 'danteforge blaze "rebuild API layer"',
  },
  nova: {
    term: 'nova',
    plainEnglish: 'A very-high-power preset — full planning prefix (constitution → plan → tasks) plus 10 autoforge waves, party, verify, synthesize, retro, and lessons-compact. No OSS discovery.',
    analogy: 'Like a professional deep-clean service — thorough, methodical, leaves everything in order.',
    relatedCommands: ['nova', 'blaze', 'inferno'],
    example: 'danteforge nova "launch payment integration"',
  },
  inferno: {
    term: 'inferno',
    plainEnglish: 'Maximum-power preset — adds OSS discovery on top of nova\'s full pipeline. The most thorough and expensive option.',
    analogy: 'Like bringing in a full consulting firm — OSS research, parallel agents, multiple review cycles, documented lessons.',
    relatedCommands: ['inferno', 'nova', 'oss'],
    example: 'danteforge inferno "production-harden the entire stack"',
  },
  forge: {
    term: 'forge',
    plainEnglish: 'The core build command — executes GSD (Get Stuff Done) waves using the Dante agent roles to implement a specific feature or change.',
    analogy: 'Like a blacksmith hammering metal: direct, focused execution of a single task.',
    relatedCommands: ['forge', 'autoforge', 'party'],
    example: 'danteforge forge "implement JWT refresh tokens"',
  },
  verify: {
    term: 'verify',
    plainEnglish: 'Runs validation checks on your project artifacts — tests, lint, type-check, and PDSE scoring. Writes a receipt to .danteforge/evidence/.',
    analogy: 'Like a final QA sign-off before shipping — confirms everything passes before you call it done.',
    relatedCommands: ['verify', 'autoforge', 'doctor'],
    example: 'danteforge verify',
  },
  specify: {
    term: 'specify',
    plainEnglish: 'Transforms a high-level idea into a structured SPEC.md through a clarification dialogue — captures scope, success criteria, and constraints.',
    analogy: 'Like a product discovery session: you talk through the problem until you have a written brief.',
    relatedCommands: ['specify', 'clarify', 'plan'],
    example: 'danteforge specify "build a subscription billing system"',
  },
  harvest: {
    term: 'harvest',
    plainEnglish: 'Runs a Titan Harvest track — scans OSS repos or local codebases to extract architectural patterns, idioms, and lessons that feed into your project.',
    analogy: 'Like gleaning a field after harvest: collecting the best patterns others have already figured out.',
    relatedCommands: ['harvest', 'local-harvest', 'oss'],
    example: 'danteforge harvest',
  },
  maturity: {
    term: 'maturity',
    plainEnglish: 'An 8-dimension quality assessment that maps your project to one of 6 maturity levels: Sketch → Prototype → MVP → Production → Hardened → Enterprise-Grade.',
    analogy: 'Like a startup growth stage model — it tells you exactly where you are on the journey from idea to enterprise.',
    relatedCommands: ['maturity', 'assess', 'verify'],
    example: 'danteforge maturity',
  },
  retro: {
    term: 'retro',
    plainEnglish: 'A retrospective pass — reflects on what worked, what didn\'t, and captures lessons into .danteforge/lessons.md for future runs.',
    analogy: 'Like a post-mortem meeting: honest review of the work that makes the next iteration better.',
    relatedCommands: ['retro', 'lessons', 'synthesize'],
    example: 'danteforge retro',
  },
  synthesize: {
    term: 'synthesize',
    plainEnglish: 'Generates the Ultimate Planning Resource (UPR.md) — a consolidated view of all planning artifacts, decisions, and current state.',
    analogy: 'Like writing the executive summary after a long project: distills everything into one coherent document.',
    relatedCommands: ['synthesize', 'plan', 'specify'],
    example: 'danteforge synthesize',
  },
  quickstart: {
    term: 'quickstart',
    plainEnglish: 'A guided 5-minute onboarding flow: init → constitution → spark → PDSE score. The fastest path from zero to a scored project.',
    analogy: 'Like the setup wizard on a new phone — it walks you through the essentials so you\'re productive in minutes.',
    relatedCommands: ['quickstart', 'init', 'spark'],
    example: 'danteforge quickstart',
  },
  preset: {
    term: 'preset',
    plainEnglish: 'A named configuration bundle that controls which pipeline steps run, how many autoforge waves execute, token routing thresholds, and convergence cycles.',
    analogy: 'Like a recipe: a preset names the ingredients and steps so you don\'t have to configure everything from scratch.',
    relatedCommands: ['magic', 'spark', 'nova', 'blaze', 'inferno'],
    example: 'danteforge magic --level blaze',
  },
  dag: {
    term: 'dag',
    plainEnglish: 'Directed Acyclic Graph — the dependency graph that controls agent execution order in party mode. Tasks that don\'t depend on each other run in parallel.',
    analogy: 'Like a project schedule with task dependencies: some things must wait for others, but independent tasks run simultaneously.',
    relatedCommands: ['party', 'autoforge'],
    example: 'danteforge party --dag',
  },
  subagent: {
    term: 'subagent',
    plainEnglish: 'An isolated child agent spawned by the orchestrator to handle a single task independently, with its own context window and error boundary.',
    analogy: 'Like delegating to a specialist contractor: they get a clear brief, do their job, and report back without interfering with other work.',
    relatedCommands: ['party', 'forge', 'autoforge'],
    example: 'danteforge party "build checkout flow"',
  },
  isolator: {
    term: 'isolator',
    plainEnglish: 'The subagent isolation layer — each subagent runs in a sandboxed context with compressed input, preventing context bleed between parallel agents.',
    analogy: 'Like putting each worker in their own office with only the documents they need — they can\'t see or interfere with each other\'s work.',
    relatedCommands: ['party', 'autoforge'],
    example: 'danteforge party --isolate',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatEntry(entry: GlossaryEntry): string {
  const lines: string[] = [];
  lines.push(`\n  ── ${entry.term.toUpperCase()} ────────────────────`);
  lines.push(`  ${entry.plainEnglish}`);
  lines.push('');
  lines.push(`  Analogy:  ${entry.analogy}`);
  if (entry.example) {
    lines.push(`  Example:  ${entry.example}`);
  }
  lines.push(`  Related:  ${entry.relatedCommands.map((c) => `danteforge ${c}`).join(', ')}`);
  return lines.join('\n');
}

export function findClosestTerm(input: string): GlossaryEntry | undefined {
  const lower = input.toLowerCase();

  // Exact match
  if (GLOSSARY[lower]) return GLOSSARY[lower];

  // Substring: input is substring of term, or term is substring of input
  for (const key of Object.keys(GLOSSARY)) {
    if (key.includes(lower) || lower.includes(key)) {
      return GLOSSARY[key];
    }
  }

  // First 4+ chars match
  if (lower.length >= 4) {
    const prefix = lower.slice(0, 4);
    for (const key of Object.keys(GLOSSARY)) {
      if (key.startsWith(prefix)) {
        return GLOSSARY[key];
      }
    }
  }

  return undefined;
}

// ── Main command ──────────────────────────────────────────────────────────────

export interface ExplainOptions {
  term?: string;
  list?: boolean;
  _output?: (line: string) => void;
}

export function explain(options?: ExplainOptions): void {
  const out = options?._output ?? console.log;

  if (!options || (!options.term && !options.list)) {
    out('');
    out('  danteforge explain <term>       — look up a DanteForge term');
    out('  danteforge explain --list       — see all terms');
    out('');
    out('  Examples:');
    out('    danteforge explain constitution');
    out('    danteforge explain pdse');
    out('    danteforge explain wave');
    out('');
    out(`  ${Object.keys(GLOSSARY).length} terms available. Run 'danteforge explain --list' to see all.`);
    return;
  }

  if (options.list) {
    out('');
    out('  DanteForge Glossary — all terms');
    out('  ─────────────────────────────────────────');
    for (const entry of Object.values(GLOSSARY)) {
      const truncated = entry.plainEnglish.length > 80
        ? entry.plainEnglish.slice(0, 77) + '...'
        : entry.plainEnglish;
      out(`  ${entry.term.padEnd(16)} ${truncated}`);
    }
    out('');
    return;
  }

  if (options.term) {
    const lower = options.term.toLowerCase();
    const exact = GLOSSARY[lower];
    if (exact) {
      out(formatEntry(exact));
      out('');
      return;
    }

    // Fuzzy fallback
    const closest = findClosestTerm(lower);
    if (closest) {
      out('');
      out(`  Did you mean: ${closest.term}?`);
      out(formatEntry(closest));
      out('');
      return;
    }

    out('');
    out(`  Unknown term: "${options.term}". Run 'danteforge explain --list' to see all terms.`);
    out('');
  }
}
