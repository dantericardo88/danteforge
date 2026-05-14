// autoforge-issue-context — GitHub issue context enrichment for autoforge prompts
import fs from 'fs/promises';
import path from 'path';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(execCallback);

/** Injectable exec function for testing. */
export type ExecFn = (cmd: string, opts: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;

/**
 * Fetch linked GitHub issue context for the current git repo.
 *
 * Parses git log for issue references (#123), then attempts to read local
 * issue template files for additional context. Returns a context string
 * to prepend to forge prompts, or an empty string if nothing is found.
 *
 * @param cwd - Working directory (defaults to process.cwd())
 * @param _execFn - Injectable exec for testing
 */
export async function fetchLinkedIssueContext(
  cwd: string = process.cwd(),
  _execFn?: ExecFn,
): Promise<string> {
  const runner = _execFn ?? ((cmd: string, opts: { cwd: string }) => execAsync(cmd, opts));
  const parts: string[] = [];

  // 1. Parse recent git log for issue references
  try {
    const { stdout } = await runner('git log --oneline -20', { cwd });
    const issuePattern = /#(\d+)/g;
    const issueNums: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = issuePattern.exec(stdout)) !== null) {
      if (!issueNums.includes(m[1])) issueNums.push(m[1]);
    }
    if (issueNums.length > 0) {
      parts.push(`[Issue refs from recent git history: ${issueNums.map(n => `#${n}`).join(', ')}]`);
    }
  } catch {
    // git may not be available or no commits yet — non-fatal
  }

  // 2. Read local issue template files for project context
  const templateDirs = [
    path.join(cwd, '.github', 'ISSUE_TEMPLATE'),
    path.join(cwd, 'docs', 'issues'),
  ];
  for (const dir of templateDirs) {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries.slice(0, 3)) {
        if (!entry.endsWith('.md') && !entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
        try {
          const content = await fs.readFile(path.join(dir, entry), 'utf8');
          const trimmed = content.slice(0, 500);
          parts.push(`[Issue template "${entry}":\n${trimmed}]`);
        } catch {
          // individual file read failed — skip
        }
      }
    } catch {
      // directory does not exist — skip
    }
  }

  return parts.join('\n\n');
}
