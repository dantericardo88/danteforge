/**
 * readme-updater.ts
 *
 * Generates a `## Examples` section for README.md by extracting
 * `.addHelpText('after', ...)` snippets from the CLI registration files.
 *
 * Keeps README examples in sync with the actual CLI help text without
 * requiring manual copy-paste maintenance.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single command example block extracted from the registration source */
export interface CommandExampleBlock {
  /** The command name (derived from `.command('name')` call above the help text) */
  commandName: string;
  /** The raw example text as it appears in addHelpText */
  examples: string;
}

/** Result of updateReadmeExamples */
export interface ReadmeUpdateResult {
  /** Whether the README was modified */
  updated: boolean;
  /** Number of example blocks found */
  blockCount: number;
  /** Error message if update failed, undefined on success */
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Marker that delimits the auto-generated Examples section in README.md */
const SECTION_START = '<!-- danteforge-examples-start -->';
const SECTION_END = '<!-- danteforge-examples-end -->';

/** Fallback heading used when no markers are present */
const FALLBACK_HEADING = '## Examples';

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract all `addHelpText('after', ...)` blocks from a source string.
 *
 * Uses a simple regex approach that handles:
 * - Template literals: `` .addHelpText('after', `...`) ``
 * - Regular strings: `.addHelpText('after', '...')` or `"..."`
 *
 * Pairs each example block with the nearest preceding `.command('name')` call.
 *
 * @param source - Raw TypeScript source code of a registration file.
 * @returns Array of `CommandExampleBlock` objects, one per help text block found.
 */
export function extractHelpTextBlocks(source: string): CommandExampleBlock[] {
  const results: CommandExampleBlock[] = [];

  // Match .addHelpText('after', `...`) with template literals
  const templateLiteralRe = /\.addHelpText\(['"]after['"]\s*,\s*`([\s\S]*?)`\)/g;

  let match: RegExpExecArray | null;
  while ((match = templateLiteralRe.exec(source)) !== null) {
    const exampleText = match[1] ?? '';
    const startIndex = match.index;

    // Find the nearest preceding .command('name') call
    const preceding = source.slice(0, startIndex);
    const commandMatch = preceding.match(/\.command\(['"]([^'"]+)['"]\)(?:\s*\n[\s\S]*)?$/);
    const commandName = commandMatch ? (commandMatch[1] ?? 'unknown') : 'unknown';

    // Only include blocks that look like real examples (contain 'danteforge')
    if (exampleText.includes('danteforge')) {
      results.push({ commandName, examples: exampleText.trim() });
    }
  }

  return results;
}

/**
 * Generate a formatted `## Examples` README section from all command
 * example blocks found in the CLI registration files.
 *
 * Reads `src/cli/register-core-commands.ts` and `src/cli/register-late-commands.ts`
 * and extracts all `addHelpText('after', ...)` snippets.
 *
 * @param cwd       - Project root directory.
 * @param _readFile - Optional injection seam for testing.
 * @returns Formatted Markdown string for the Examples section.
 *
 * @example
 * const section = await generateCommandExamples(process.cwd());
 * console.log(section); // ## Examples\n\n### forge\n\n```\n...
 */
export async function generateCommandExamples(
  cwd: string,
  _readFile?: (p: string, enc: BufferEncoding) => Promise<string>,
): Promise<string> {
  const readFn = _readFile ?? ((p: string, enc: BufferEncoding) => fs.readFile(p, enc));

  const registrationFiles = [
    path.join(cwd, 'src', 'cli', 'register-core-commands.ts'),
    path.join(cwd, 'src', 'cli', 'register-late-commands.ts'),
  ];

  const allBlocks: CommandExampleBlock[] = [];

  for (const filePath of registrationFiles) {
    let source: string;
    try {
      source = await readFn(filePath, 'utf8');
    } catch {
      continue; // Skip files that can't be read
    }
    const blocks = extractHelpTextBlocks(source);
    allBlocks.push(...blocks);
  }

  if (allBlocks.length === 0) {
    return `## Examples\n\n_No command examples found. Add \`.addHelpText('after', \`...\`)\` to commands in register-core-commands.ts._\n`;
  }

  const lines: string[] = [
    '## Examples',
    '',
    `> Auto-generated from CLI help text. ${allBlocks.length} command(s) with examples.`,
    '',
  ];

  for (const block of allBlocks) {
    lines.push(`### \`danteforge ${block.commandName}\``, '');
    lines.push('```');
    lines.push(block.examples);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Update the `## Examples` section in README.md with freshly generated content.
 *
 * Looks for HTML comment markers `<!-- danteforge-examples-start -->` and
 * `<!-- danteforge-examples-end -->`. If markers are found, replaces the
 * content between them. If no markers are found, replaces the `## Examples`
 * heading and its content up to the next `##` heading.
 *
 * When neither markers nor a `## Examples` section is found, the function
 * returns `{ updated: false }` without modifying the file.
 *
 * @param readmePath - Absolute path to the README.md file.
 * @param _readFile  - Optional injection seam for reading files (for testing).
 * @param _writeFile - Optional injection seam for writing files (for testing).
 * @returns `ReadmeUpdateResult` describing whether the file was modified.
 *
 * @example
 * const result = await updateReadmeExamples('/path/to/README.md');
 * if (result.updated) {
 *   console.log(`Updated README with ${result.blockCount} example block(s)`);
 * }
 */
export async function updateReadmeExamples(
  readmePath: string,
  _readFile?: (p: string, enc: BufferEncoding) => Promise<string>,
  _writeFile?: (p: string, data: string) => Promise<void>,
): Promise<ReadmeUpdateResult> {
  const readFn = _readFile ?? ((p: string, enc: BufferEncoding) => fs.readFile(p, enc));
  const writeFn = _writeFile ?? ((p: string, data: string) => fs.writeFile(p, data, 'utf8'));

  let readmeContent: string;
  try {
    readmeContent = await readFn(readmePath, 'utf8');
  } catch (err) {
    return {
      updated: false,
      blockCount: 0,
      error: `Could not read README: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Generate the new examples section
  const cwd = path.dirname(readmePath);
  const examplesSection = await generateCommandExamples(cwd, _readFile);

  // Count blocks
  const blockCount = (examplesSection.match(/^### `/gm) ?? []).length;

  // Try marker-based replacement first
  const startIdx = readmeContent.indexOf(SECTION_START);
  const endIdx = readmeContent.indexOf(SECTION_END);

  let newContent: string;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace content between markers
    const before = readmeContent.slice(0, startIdx + SECTION_START.length);
    const after = readmeContent.slice(endIdx);
    newContent = `${before}\n\n${examplesSection}\n${after}`;
  } else {
    // Try to find and replace the ## Examples section
    const examplesHeadingRe = /^## Examples\s*\n[\s\S]*?(?=^## |\z)/m;
    if (!examplesHeadingRe.test(readmeContent)) {
      return { updated: false, blockCount: 0 };
    }
    newContent = readmeContent.replace(examplesHeadingRe, examplesSection + '\n');
  }

  if (newContent === readmeContent) {
    return { updated: false, blockCount };
  }

  try {
    await writeFn(readmePath, newContent);
    return { updated: true, blockCount };
  } catch (err) {
    return {
      updated: false,
      blockCount,
      error: `Could not write README: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Export the section markers so callers can add them to README.md
// ---------------------------------------------------------------------------

export { SECTION_START as README_EXAMPLES_START, SECTION_END as README_EXAMPLES_END, FALLBACK_HEADING };
