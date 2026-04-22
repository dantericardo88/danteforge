import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { formatCommandReference } from '../src/cli/commands/docs.js';
import { COMMAND_HELP } from '../src/cli/commands/help.js';
import {
  CANVAS_PRESET_TEXT,
  REPO_PIPELINE_STEPS,
  SPARK_PLANNING_TEXT,
  STATE_MACHINE_STEPS,
  renderWorkflowCodeBlock,
} from '../src/core/workflow-surface.js';

async function read(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

function extractMarkedBlock(content: string, marker: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(
    new RegExp(`<!-- ${marker}:START -->\\n([\\s\\S]*?)\\n<!-- ${marker}:END -->`),
  );
  assert.ok(match, `Expected marker block ${marker}`);
  return match[1] ?? '';
}

describe('workflow surfaces', () => {
  it('keeps README and architecture pipeline blocks synced from the canonical source', async () => {
    const readme = await read('README.md');
    const architecture = await read('docs/ARCHITECTURE.md');

    assert.equal(
      extractMarkedBlock(readme, 'DANTEFORGE_REPO_PIPELINE'),
      renderWorkflowCodeBlock(REPO_PIPELINE_STEPS),
    );
    assert.equal(
      extractMarkedBlock(architecture, 'DANTEFORGE_REPO_PIPELINE'),
      renderWorkflowCodeBlock(REPO_PIPELINE_STEPS),
    );
    assert.equal(
      extractMarkedBlock(architecture, 'DANTEFORGE_STATE_MACHINE'),
      renderWorkflowCodeBlock(STATE_MACHINE_STEPS, ''),
    );
  });

  it('uses canonical workflow text in help and generated command reference surfaces', () => {
    assert.match(COMMAND_HELP.spark ?? '', new RegExp(SPARK_PLANNING_TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(COMMAND_HELP.canvas ?? '', new RegExp(CANVAS_PRESET_TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const commandReference = formatCommandReference();
    assert.match(commandReference, new RegExp(SPARK_PLANNING_TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(commandReference, new RegExp(CANVAS_PRESET_TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});
