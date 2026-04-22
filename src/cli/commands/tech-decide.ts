// Tech Decide — guided tech stack selection with options, pros/cons, and user choice
// Analyzes the SPEC (if available) and generates 3-5 tailored options per category.
// Presents interactive-style output. Saves selection to TECH_STACK.md.

import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { savePrompt, displayPrompt } from '../../core/prompt-builder.js';
import { resolveSkill } from '../../core/skills.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import fs from 'fs/promises';
import path from 'path';

interface TechOption {
  name: string;
  pros: string[];
  cons: string[];
  recommended: boolean;
}

interface TechCategory {
  category: string;
  options: TechOption[];
}

/**
 * Parse LLM output into structured tech options.
 * Falls back to raw text if parsing fails.
 */
function parseTechOptions(raw: string): TechCategory[] {
  const categories: TechCategory[] = [];
  // Split by category headers (## Category Name)
  const sections = raw.split(/^## /m).filter(Boolean);

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const categoryName = lines[0]?.trim() ?? 'Unknown';
    const options: TechOption[] = [];

    let currentOption: TechOption | null = null;
    let collectingPros = false;
    let collectingCons = false;

    for (const line of lines.slice(1)) {
      const trimmed = line.trim();

      // Option header: ### 1. React or **1. React** or 1. **React**
      const optionMatch = trimmed.match(/^(?:###\s*)?(?:\*\*)?(\d+)\.\s*(?:\*\*)?(.+?)(?:\*\*)?(?:\s*\(recommended\))?$/i);
      if (optionMatch) {
        if (currentOption) options.push(currentOption);
        currentOption = {
          name: optionMatch[2]!.replace(/\*\*/g, '').trim(),
          pros: [],
          cons: [],
          recommended: /recommended/i.test(trimmed),
        };
        collectingPros = false;
        collectingCons = false;
        continue;
      }

      if (/^(?:\*\*)?pros/i.test(trimmed)) {
        collectingPros = true;
        collectingCons = false;
        continue;
      }
      if (/^(?:\*\*)?cons/i.test(trimmed)) {
        collectingPros = false;
        collectingCons = true;
        continue;
      }

      if (currentOption && trimmed.startsWith('- ')) {
        const item = trimmed.slice(2).trim();
        if (collectingPros) currentOption.pros.push(item);
        else if (collectingCons) currentOption.cons.push(item);
      }
    }
    if (currentOption) options.push(currentOption);

    if (options.length > 0) {
      categories.push({ category: categoryName, options });
    }
  }

  return categories;
}

/**
 * Format tech categories for display.
 */
function formatTechDecision(categories: TechCategory[]): string {
  const lines: string[] = ['# Tech Stack Decision\n'];

  for (const cat of categories) {
    lines.push(`## ${cat.category}\n`);
    for (let i = 0; i < cat.options.length; i++) {
      const opt = cat.options[i]!;
      const tag = opt.recommended ? ' (RECOMMENDED)' : '';
      lines.push(`### ${i + 1}. ${opt.name}${tag}\n`);
      if (opt.pros.length > 0) {
        lines.push('**Pros:**');
        for (const p of opt.pros) lines.push(`- ${p}`);
        lines.push('');
      }
      if (opt.cons.length > 0) {
        lines.push('**Cons:**');
        for (const c of opt.cons) lines.push(`- ${c}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

export async function techDecide(options: {
  prompt?: boolean;
  auto?: boolean;
  _llmCaller?: typeof callLLM;
  _isLLMAvailable?: typeof isLLMAvailable;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
} = {}) {
  const llmFn = options._llmCaller ?? callLLM;
  const llmAvailFn = options._isLLMAvailable ?? isLLMAvailable;
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;

  return withErrorBoundary('tech-decide', async () => {
  logger.success('DanteForge Tech Decide — Guided Tech Stack Selection');
  logger.info('');

  const state = await loadFn();
  const skill = await resolveSkill('brainstorming');

  // Load SPEC if available
  let specContent = '';
  try {
    specContent = await fs.readFile(path.join('.danteforge', 'SPEC.md'), 'utf8');
    logger.info('Found SPEC.md — analyzing for tech stack recommendations');
  } catch {
    logger.info('No SPEC.md found — generating general tech stack options');
  }

  // Load existing CURRENT_STATE.md for project context
  let projectContext = '';
  try {
    projectContext = await fs.readFile(path.join('.danteforge', 'CURRENT_STATE.md'), 'utf8');
  } catch { /* no state review yet */ }

  // Load lessons for naming convention history (self-improvement feedback loop)
  let lessonsContext = '';
  try {
    const lessonsContent = await fs.readFile(path.join('.danteforge', 'lessons.md'), 'utf8');
    // Extract naming-related lessons
    const namingLessons = lessonsContent
      .split(/^## /m)
      .filter(s => /\[naming\]/i.test(s) || /\[style\]/i.test(s) || /case/i.test(s))
      .map(s => '## ' + s.trim())
      .join('\n\n');
    if (namingLessons) {
      lessonsContext = namingLessons;
      logger.info('Found naming/style lessons — incorporating into analysis');
    }
  } catch { /* no lessons yet */ }

  // Build the analysis prompt
  const prompt = `You are a senior software architect helping a developer choose their tech stack. Analyze the project context and generate EXACTLY 3-5 tailored options per category with pros/cons.

${state.constitution ? `## Project Principles\n${state.constitution}\n` : ''}
${specContent ? `## Project Spec\n${specContent.slice(0, 3000)}\n` : '## No spec yet — provide general-purpose options for a modern application.\n'}
${projectContext ? `## Current State\n${projectContext.slice(0, 2000)}\n` : ''}
${lessonsContext ? `## Lessons Learned (Naming/Style History)\nThe team has recorded these naming and style preferences from past corrections:\n${lessonsContext.slice(0, 1500)}\nFactor these lessons into your Naming/Style recommendations.\n` : ''}
## Instructions

Generate tech stack options for these categories:
1. **Language/Runtime** — e.g., TypeScript/Node, Python, Go, Rust, etc.
2. **Framework** — e.g., Next.js, Express, FastAPI, Gin, etc.
3. **Database** — e.g., PostgreSQL, SQLite, MongoDB, Supabase, etc.
4. **Deployment** — e.g., Vercel, Railway, Docker/K8s, AWS Lambda, etc.
5. **Naming/Style** — e.g., camelCase, snake_case, kebab-case conventions — include detailed pros/cons of each naming convention (readability, tooling support, language ecosystem norms, team consistency)

For EACH category:
- Provide 3-5 options (not more, not fewer)
- Mark ONE as "(Recommended)" based on the project context
- For each option list **Pros** and **Cons** (2-4 bullet points each)
- Tailor to the project — don't give generic lists

## Output Format

Use this exact format for each category:

## Category Name

### 1. Option Name (Recommended)
**Pros:**
- Pro 1
- Pro 2

**Cons:**
- Con 1
- Con 2

### 2. Option Name
**Pros:**
- Pro 1

**Cons:**
- Con 1

(repeat for all options)

End with:
## Summary
Default recommendation: [list the recommended option from each category]`;

  // Mode 1: --prompt (copy-paste)
  if (options.prompt) {
    const savedPath = await savePrompt('tech-decide', prompt);
    displayPrompt(prompt, [
      'Paste into your LLM to get tech stack recommendations.',
      'Save the result to .danteforge/TECH_STACK.md',
      `Prompt saved to: ${savedPath}`,
    ].join('\n'));

    state.auditLog.push(`${new Date().toISOString()} | tech-decide: prompt generated`);
    await saveFn(state);
    return;
  }

  // Mode 2: LLM API mode
  const llmAvailable = await llmAvailFn();
  if (llmAvailable) {
    logger.info('Analyzing project for tech stack recommendations...');
    logger.info('');

    try {
      const result = await llmFn(prompt, undefined, { enrichContext: true });

      // Parse and format
      const categories = parseTechOptions(result);
      const formatted = categories.length > 0 ? formatTechDecision(categories) : result;

      // Save to TECH_STACK.md
      const outputPath = path.join('.danteforge', 'TECH_STACK.md');
      await fs.mkdir('.danteforge', { recursive: true });
      const output = `# Tech Stack Decision\n\n_Generated: ${new Date().toISOString()}_\n_Profile: ${state.profile}_\n\n${result}`;
      await fs.writeFile(outputPath, output);

      // Display
      process.stdout.write('\n' + (categories.length > 0 ? formatted : result) + '\n');

      logger.info('');
      logger.success(`Tech stack analysis saved to: ${outputPath}`);
      logger.info('');

      if (options.auto) {
        // Auto mode: pick recommended options
        const recommended = categories
          .map(c => {
            const rec = c.options.find(o => o.recommended);
            return rec ? `${c.category}: ${rec.name}` : null;
          })
          .filter(Boolean);

        if (recommended.length > 0) {
          logger.success('Auto-selected recommended options:');
          for (const r of recommended) {
            logger.info(`  ${r}`);
          }
        }
      } else {
        logger.info('Review the options above and edit .danteforge/TECH_STACK.md');
        logger.info('Or use --auto to accept all recommended defaults');
      }

      logger.info('');
      logger.info('Next steps:');
      logger.info('  danteforge plan    — uses TECH_STACK.md in planning');
      logger.info('  danteforge forge   — builds with selected stack');

      state.auditLog.push(`${new Date().toISOString()} | tech-decide: ${categories.length} categories analyzed, saved to TECH_STACK.md`);
      await saveFn(state);
      return;
    } catch (err) {
      logger.warn(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Mode 3: Fallback — display skill content or guidance
  if (skill) {
    logger.success('Tech Stack Decision Framework:');
    process.stdout.write(skill.content + '\n');
  }

  logger.info('');
  logger.info('Manual tech stack selection:');
  logger.info('  1. Consider your team skills and project requirements');
  logger.info('  2. Create .danteforge/TECH_STACK.md with your choices');
  logger.info('  3. Include: Language, Framework, Database, Deployment, Style');
  logger.info('  4. Run: danteforge plan (will incorporate your selections)');

  state.auditLog.push(`${new Date().toISOString()} | tech-decide: manual guidance displayed`);
  await saveFn(state);
  });
}
