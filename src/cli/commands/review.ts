// Review command - scan existing repo, generate CURRENT_STATE.md
// Three modes: local (default), --prompt (copy-paste), or auto-API (when keys configured)
import fs from 'fs/promises';
import path from 'path';
import { simpleGit } from 'simple-git';
import { loadState, saveState } from '../../core/state.js';
import { logger } from '../../core/logger.js';
import { handoff } from '../../core/handoff.js';
import { buildReviewPrompt, savePrompt, displayPrompt } from '../../core/prompt-builder.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { estimateTokens, chunkText } from '../../core/token-estimator.js';

const STATE_DIR = '.danteforge';

// === AGGRESSIVE FILTERS - save tokens, skip junk ===

const IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.output',
  'target', '__pycache__', '.parcel-cache', '.webpack',
  'vendor', 'bower_components',
  '.cache', '.eslintcache', '.tsbuildinfo',
  'coverage', '.nyc_output',
  '.git', '.danteforge', '.vscode', '.idea', '.vs',
]);

const IGNORED_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  '.DS_Store', 'Thumbs.db', '.gitattributes',
]);

const IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.log', '.tmp', '.temp', '.bak', '.swp',
  '.lock', '.lockb',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.md', '.yaml', '.yml', '.json',
  '.css', '.scss', '.less', '.sass',
  '.html', '.vue', '.svelte', '.astro',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.sh', '.bash', '.zsh',
  '.sql', '.graphql', '.gql',
  '.toml', '.ini', '.cfg',
]);

const MAX_FILES_FOR_API = 500;

async function getFilteredFileTree(dir: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    if (IGNORED_FILES.has(entry.name)) continue;

    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      results.push(`${relPath}/`);
      const children = await getFilteredFileTree(path.join(dir, entry.name), relPath);
      results.push(...children);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (!IGNORED_EXTENSIONS.has(ext)) {
        results.push(relPath);
      }
    }
  }

  return results;
}

function filterSourceFiles(files: string[]): string[] {
  return files.filter(f => {
    if (f.endsWith('/')) return false;
    const ext = path.extname(f).toLowerCase();
    return SOURCE_EXTENSIONS.has(ext);
  }).slice(0, MAX_FILES_FOR_API);
}

async function readPackageJson(): Promise<{ name?: string; version?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null> {
  try {
    const content = await fs.readFile('package.json', 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function getExistingDocs(): Promise<{ name: string; content: string }[]> {
  const docs: { name: string; content: string }[] = [];
  try {
    const files = await fs.readdir(STATE_DIR);
    for (const file of files) {
      if (file.endsWith('.md') || file.endsWith('.yaml')) {
        if (file === 'CURRENT_STATE.md' || file === 'UPR.md' || file === 'REFINED_UPR.md') continue;
        const content = await fs.readFile(path.join(STATE_DIR, file), 'utf8');
        docs.push({ name: file, content });
      }
    }
  } catch {
    // .danteforge/ may not exist yet
  }
  return docs;
}

function resetExecutionStateForReview<T extends {
  currentPhase: number;
  tasks: Record<number, unknown>;
  lastVerifiedAt?: string;
}>(state: T): T {
  state.currentPhase = 0;
  state.tasks = {};
  state.lastVerifiedAt = undefined;
  return state;
}

export async function review(options: { prompt?: boolean } = {}) {
  logger.success('Reviewing existing project state...');

  const git = simpleGit();
  let recentCommits: string[] = [];
  let isGitRepo = false;

  try {
    const log = await git.log({ maxCount: 10 });
    recentCommits = log.all.map((c: { hash: string; message: string; date: string }) => `- \`${c.hash.slice(0, 7)}\` ${c.message} (${c.date})`);
    isGitRepo = true;
  } catch {
    logger.warn('Not a Git repo or no commits yet - skipping Git history');
  }

  const pkg = await readPackageJson();
  const fullFileTree = await getFilteredFileTree(process.cwd());
  const sourceFiles = filterSourceFiles(fullFileTree);
  const existingDocs = await getExistingDocs();

  const projectName = pkg?.name ?? path.basename(process.cwd());
  const timestamp = new Date().toISOString();

  if (sourceFiles.length < fullFileTree.length) {
    logger.info(`Filtered: ${fullFileTree.length} total files -> ${sourceFiles.length} source files for review`);
  }

  // --prompt mode: generate a copy-paste prompt for Claude Code / ChatGPT
  if (options.prompt) {
    const state = await loadState();
    const prompt = buildReviewPrompt({
      projectName,
      constitution: state.constitution,
      fileTree: sourceFiles,
      recentCommits,
      dependencies: pkg?.dependencies ?? null,
      existingDocs,
    });

    // Token estimation for prompt mode
    const tokens = estimateTokens(prompt);
    logger.info(`Estimated tokens: ~${tokens.toLocaleString()}`);

    const savedPath = await savePrompt('review', prompt);
    displayPrompt(prompt, [
      'Steps:',
      '1. Copy the prompt above',
      '2. Paste into Claude Code, ChatGPT, or any LLM',
      '3. Copy the generated markdown output',
      `4. Save it as .danteforge/CURRENT_STATE.md (or run: danteforge import <file> --as CURRENT_STATE.md)`,
      '5. Run "danteforge constitution" to establish project principles',
      '6. Run "danteforge specify <goal>" to continue the pipeline',
      '',
      `Prompt also saved to: ${savedPath}`,
    ].join('\n'));

    state.auditLog.push(`${timestamp} | review: LLM prompt generated (${sourceFiles.length} source files, ${recentCommits.length} commits)`);
    await saveState(state);
    return;
  }

  // Auto-API mode: if an API key is configured, send directly to LLM
  const llmAvailable = await isLLMAvailable();
  if (llmAvailable) {
    const state = await loadState();
    logger.info('LLM provider available - sending to LLM for deep review...');

    const prompt = buildReviewPrompt({
      projectName,
      constitution: state.constitution,
      fileTree: sourceFiles,
      recentCommits,
      dependencies: pkg?.dependencies ?? null,
      existingDocs,
    });

    // Auto-chunking for very large reviews
    const tokens = estimateTokens(prompt);
    if (tokens > 120000) {
      logger.warn(`Large review detected (~${tokens.toLocaleString()} tokens). Auto-chunking into sections...`);
      const chunks = chunkText(prompt, 100000);

      try {
        const chunkResults: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          logger.info(`Processing chunk ${i + 1}/${chunks.length}...`);
          const chunkPrompt = i === 0
            ? chunks[i]!
            : `Continue the project review. This is part ${i + 1} of ${chunks.length}.\n\n${chunks[i]}`;
          const result = await callLLM(chunkPrompt, undefined, { enrichContext: true });
          chunkResults.push(result);
        }

        const stateMd = chunkResults.join('\n\n---\n\n');
        await fs.mkdir(STATE_DIR, { recursive: true });
        await fs.writeFile(path.join(STATE_DIR, 'CURRENT_STATE.md'), stateMd);

        resetExecutionStateForReview(state);
        state.auditLog.push(`${timestamp} | review: CURRENT_STATE.md generated via API (${chunks.length} chunks, ${sourceFiles.length} source files)`);
        await saveState(state);
        await handoff('review', { stateFile: 'CURRENT_STATE.md' });

        logger.success(`CURRENT_STATE.md generated via LLM (${chunks.length} chunks, ${sourceFiles.length} source files reviewed)`);
        logger.info('Run "danteforge constitution" next, then "danteforge specify <goal>" to continue the pipeline');
        return;
      } catch (err) {
        logger.warn(`Chunked API call failed: ${err instanceof Error ? err.message : String(err)}`);
        logger.info('Falling back to local review...');
      }
    } else {
      try {
        const stateMd = await callLLM(prompt, undefined, { enrichContext: true });

        await fs.mkdir(STATE_DIR, { recursive: true });
        await fs.writeFile(path.join(STATE_DIR, 'CURRENT_STATE.md'), stateMd);

        resetExecutionStateForReview(state);
        state.auditLog.push(`${timestamp} | review: CURRENT_STATE.md generated via API (${sourceFiles.length} source files)`);
        await saveState(state);
        await handoff('review', { stateFile: 'CURRENT_STATE.md' });

        logger.success(`CURRENT_STATE.md generated via LLM (${sourceFiles.length} source files reviewed)`);
        logger.info('Run "danteforge constitution" next, then "danteforge specify <goal>" to continue the pipeline');
        return;
      } catch (err) {
        logger.warn(`API call failed: ${err instanceof Error ? err.message : String(err)}`);
        logger.info('Falling back to local review...');
      }
    }
  }

  // Local mode: build CURRENT_STATE.md from raw data (no LLM)
  const sections: string[] = [];

  sections.push(`# CURRENT_STATE.md`);
  sections.push(`> Generated by DanteForge on ${timestamp}`);
  sections.push('');

  sections.push('## Project Overview');
  sections.push(`- **Name**: ${projectName}`);
  if (pkg?.version) sections.push(`- **Version**: ${pkg.version}`);
  sections.push(`- **Git**: ${isGitRepo ? 'Yes' : 'No'}`);
  sections.push(`- **Working Directory**: ${process.cwd()}`);
  sections.push(`- **Source files**: ${sourceFiles.length} (of ${fullFileTree.length} total)`);
  sections.push('');

  if (pkg?.dependencies || pkg?.devDependencies) {
    sections.push('## Dependencies');
    if (pkg.dependencies) {
      sections.push('### Runtime');
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        sections.push(`- \`${name}\`: ${version}`);
      }
    }
    if (pkg.devDependencies) {
      sections.push('### Dev');
      for (const [name, version] of Object.entries(pkg.devDependencies)) {
        sections.push(`- \`${name}\`: ${version}`);
      }
    }
    sections.push('');
  }

  if (recentCommits.length > 0) {
    sections.push('## Recent Changes (Last 10 Commits)');
    sections.push(...recentCommits);
    sections.push('');
  }

  sections.push('## File Structure');
  sections.push('```');
  sections.push(...fullFileTree);
  sections.push('```');
  sections.push('');

  if (existingDocs.length > 0) {
    sections.push('## Existing Planning Documents');
    for (const doc of existingDocs) {
      sections.push(`### ${doc.name}`);
      sections.push('');
      const preview = doc.content.split('\n').slice(0, 20).join('\n');
      sections.push(preview);
      if (doc.content.split('\n').length > 20) {
        sections.push(`\n_(${doc.content.split('\n').length - 20} more lines...)_`);
      }
      sections.push('');
    }
  }

  sections.push('## DanteForge Pipeline');
  sections.push('');
  sections.push('### Specification Refinement');
  sections.push('- Zero-ambiguity templates for constitution, specs, plans, and tasks');
  sections.push('- Clarification engine for detecting gaps and inconsistencies');
  sections.push('- Constitution enforcement on every phase transition');
  sections.push('');
  sections.push('### Execution Waves');
  sections.push('- Atomic wave execution with structured prompts');
  sections.push('- Phase-based task sequencing with verification loops');
  sections.push('- Profile-adaptive: quality | balanced | budget');
  sections.push('');
  sections.push('### Multi-Agent Orchestration');
  sections.push('- PM, Architect, Dev, UX, Scrum Master agent roles');
  sections.push('- Party Mode for scale-adaptive multi-agent collaboration');
  sections.push('- Parallel execution with git worktree isolation');
  sections.push('');

  sections.push('## Recommended Next Steps');
  sections.push('1. Run `danteforge constitution` to establish project principles and enforcement rules');
  sections.push('2. Run `danteforge specify "<goal>"` to create spec artifacts from this review');
  sections.push('3. Run `danteforge clarify` to identify gaps in the spec');
  sections.push('4. Run `danteforge plan` to generate a detailed execution plan');
  sections.push('5. Run `danteforge tasks` to break the plan into executable work');
  sections.push('6. Run `danteforge forge 1 --profile quality` to execute the first wave');
  sections.push('7. Run `danteforge verify` to confirm the workflow and release state');
  sections.push('8. Run `danteforge synthesize` to generate the Ultimate Planning Resource (UPR.md)');

  const stateMd = sections.join('\n');

  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(path.join(STATE_DIR, 'CURRENT_STATE.md'), stateMd);

  const state = await loadState();
  resetExecutionStateForReview(state);
  state.auditLog.push(`${timestamp} | review: CURRENT_STATE.md generated locally (${sourceFiles.length} source files)`);
  await saveState(state);

  await handoff('review', { stateFile: 'CURRENT_STATE.md' });

  logger.success(`CURRENT_STATE.md generated (${sourceFiles.length} source files indexed, ${recentCommits.length} commits captured)`);
  if (!llmAvailable) {
    logger.info('Tip: Set up an API key for LLM-powered deep reviews: danteforge config --set-key "grok:<key>"');
  }
  logger.info('Run "danteforge constitution" next, then "danteforge specify <goal>" to continue the pipeline');
}
