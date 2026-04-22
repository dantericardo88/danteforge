import fs from 'fs/promises';
import type { PackOptions, PackFormat, PackResult } from '../../core/workspace-packer.js';

export interface PackCommandOptions {
  output?: string;
  format?: PackFormat;
  include?: string[];
  exclude?: string[];
  tokenCount?: boolean;
  gitignore?: boolean;
  cwd?: string;
  _packWorkspace?: (opts: PackOptions) => Promise<PackResult>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _stdout?: (line: string) => void;
}

export async function pack(options?: PackCommandOptions): Promise<void> {
  const { packWorkspace } = await import('../../core/workspace-packer.js');

  const packFn = options?._packWorkspace ?? packWorkspace;
  const writeFn = options?._writeFile ?? ((p: string, content: string) => fs.writeFile(p, content, 'utf8'));
  const stdoutFn = options?._stdout ?? ((line: string) => process.stdout.write(line + '\n'));

  const packOpts: PackOptions = {
    format: options?.format,
    include: options?.include,
    exclude: options?.exclude,
    respectGitignore: options?.gitignore !== false,
    cwd: options?.cwd,
  };

  const result = await packFn(packOpts);

  if (options?.tokenCount) {
    stdoutFn(`Files: ${result.totalFiles} | Total tokens: ${result.totalTokens} | Ignored: ${result.ignoredFiles}`);
    for (const file of result.files) {
      stdoutFn(`  ${file.relativePath} — ${file.language} — ${file.tokens} tokens`);
    }
    return;
  }

  if (options?.output) {
    await writeFn(options.output, result.output);
    return;
  }

  stdoutFn(result.output);
}
