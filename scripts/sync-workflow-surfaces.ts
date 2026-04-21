import fs from 'node:fs/promises';

import {
  REPO_PIPELINE_STEPS,
  STATE_MACHINE_STEPS,
  renderWorkflowCodeBlock,
} from '../src/core/workflow-surface.js';

function replaceMarkedBlock(content: string, marker: string, replacement: string): string {
  const pattern = new RegExp(
    `<!-- ${marker}:START -->[\\s\\S]*?<!-- ${marker}:END -->`,
    'm',
  );

  if (!pattern.test(content)) {
    throw new Error(`Marker ${marker} not found`);
  }

  return content.replace(
    pattern,
    `<!-- ${marker}:START -->\n${replacement}\n<!-- ${marker}:END -->`,
  );
}

async function syncFile(filePath: string, updates: Array<{ marker: string; replacement: string }>): Promise<void> {
  let content = await fs.readFile(filePath, 'utf8');
  for (const update of updates) {
    content = replaceMarkedBlock(content, update.marker, update.replacement);
  }
  await fs.writeFile(filePath, content, 'utf8');
}

await syncFile('README.md', [
  {
    marker: 'DANTEFORGE_REPO_PIPELINE',
    replacement: renderWorkflowCodeBlock(REPO_PIPELINE_STEPS),
  },
]);

await syncFile('docs/ARCHITECTURE.md', [
  {
    marker: 'DANTEFORGE_REPO_PIPELINE',
    replacement: renderWorkflowCodeBlock(REPO_PIPELINE_STEPS),
  },
  {
    marker: 'DANTEFORGE_STATE_MACHINE',
    replacement: renderWorkflowCodeBlock(STATE_MACHINE_STEPS, ''),
  },
]);

process.stdout.write('Workflow surfaces synced\n');
