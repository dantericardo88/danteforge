// git-helpers.ts — CLI-facing wrappers for git-integration functions
import { loadState } from '../../core/state.js';
import {
  stageAndCommit,
  createTaskBranch,
  openPullRequest,
} from '../../core/git-integration.js';
import type { SimpleGitLike } from '../../core/git-integration.js';

export interface GitCommitOptions {
  message?: string;
  push?: boolean;
  cwd?: string;
  _stageAndCommit?: typeof stageAndCommit;
  _stdout?: (line: string) => void;
}

export interface GitBranchOptions {
  name?: string;
  cwd?: string;
  _createBranch?: typeof createTaskBranch;
  _stdout?: (line: string) => void;
}

export interface GitPROptions {
  draft?: boolean;
  base?: string;
  title?: string;
  cwd?: string;
  _openPR?: typeof openPullRequest;
  _stdout?: (line: string) => void;
}

export async function gitCommit(options?: GitCommitOptions): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const print = options?._stdout ?? ((l: string) => console.log(l));
  const state = await loadState({ cwd });
  const fn = options?._stageAndCommit ?? stageAndCommit;

  // Allow message override by injecting a custom git implementation
  const result = await fn(state, { cwd });

  if (result.committed) {
    print(`Committed ${result.filesStaged} file(s): ${result.message}`);
  } else {
    print(`Commit failed: ${result.message}`);
  }
}

export async function gitBranch(options?: GitBranchOptions): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const print = options?._stdout ?? ((l: string) => console.log(l));
  const state = await loadState({ cwd });
  const fn = options?._createBranch ?? createTaskBranch;

  // If caller wants a specific name, inject a _git that uses it
  let result: Awaited<ReturnType<typeof createTaskBranch>>;
  if (options?.name) {
    const nameFn: typeof createTaskBranch = async (_s, opts) => {
      const g = opts?._git;
      if (!g) {
        const { simpleGit } = await import('simple-git');
        const git = simpleGit({ baseDir: cwd }) as unknown as SimpleGitLike;
        try {
          await git.checkoutLocalBranch(options.name!);
          return { created: true, branchName: options.name! };
        } catch {
          return { created: false, branchName: options.name! };
        }
      }
      try {
        await g.checkoutLocalBranch(options.name!);
        return { created: true, branchName: options.name! };
      } catch {
        return { created: false, branchName: options.name! };
      }
    };
    result = await nameFn(state, { cwd });
  } else {
    result = await fn(state, { cwd });
  }

  if (result.created) {
    print(`Created branch: ${result.branchName}`);
  } else {
    print(`Branch creation failed for: ${result.branchName}`);
  }
}

export async function gitPR(options?: GitPROptions): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const print = options?._stdout ?? ((l: string) => console.log(l));
  const state = await loadState({ cwd });
  const fn = options?._openPR ?? openPullRequest;

  const result = await fn(state, {
    cwd,
    draft: options?.draft,
    baseBranch: options?.base,
  });

  if (result.url === 'not-created') {
    print('PR creation failed or gh CLI not available');
  } else {
    print(`PR created: ${result.url} (#${result.prNumber})`);
  }
}
