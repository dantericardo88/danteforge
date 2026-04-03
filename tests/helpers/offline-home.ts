import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function configureOfflineHome(tempDirs: string[]): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-offline-home-'));
  tempDirs.push(tempRoot);

  process.env.DANTEFORGE_HOME = tempRoot;
  const configDir = path.join(tempRoot, '.danteforge');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, 'config.yaml'),
    [
      'defaultProvider: openai',
      'ollamaModel: llama3',
      'providers: {}',
      '',
    ].join('\n'),
    'utf8',
  );

  return tempRoot;
}

export function restoreOfflineHome(originalHome: string | undefined): void {
  if (originalHome === undefined) {
    delete process.env.DANTEFORGE_HOME;
    return;
  }

  process.env.DANTEFORGE_HOME = originalHome;
}
