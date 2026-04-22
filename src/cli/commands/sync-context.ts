// sync-context.ts — CLI command for syncing project context to IDE/agent config files
import {
  syncContext as syncContextCore,
} from '../../core/context-syncer.js';
import type {
  ContextSyncOptions,
  ContextSyncResult,
  ContextTarget,
} from '../../core/context-syncer.js';

export interface SyncContextCommandOptions {
  target?: ContextTarget;
  cwd?: string;
  _syncContext?: (opts: ContextSyncOptions) => Promise<ContextSyncResult>;
  _stdout?: (line: string) => void;
}

export async function syncContext(options: SyncContextCommandOptions = {}): Promise<void> {
  const print = options._stdout ?? ((line: string) => { process.stdout.write(line + '\n'); });
  const runner = options._syncContext ?? syncContextCore;

  const syncOpts: ContextSyncOptions = {
    target: options.target,
    cwd: options.cwd,
  };

  const result = await runner(syncOpts);

  print(`Synced ${result.synced.length} context files:`);
  for (const file of result.synced) {
    print(`  - ${file.path}`);
  }

  if (result.skipped.length > 0) {
    print(`Skipped: ${result.skipped.join(', ')}`);
  }

  print(`Total tokens: ${result.totalTokens}`);
  print("Run 'danteforge sync-context' after major project milestones to keep AI context fresh.");
}
