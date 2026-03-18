import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  decomposeUI,
  getExecutionLevels,
} from '../src/harvested/openpencil/spatial-decomposer.js';

describe('decomposeUI', () => {
  it('returns an array of SpatialTask objects', () => {
    const tasks = decomposeUI('Build a simple landing page');
    assert.ok(Array.isArray(tasks));
    assert.ok(tasks.length > 0);
    for (const task of tasks) {
      assert.strictEqual(typeof task.region, 'string');
      assert.strictEqual(typeof task.prompt, 'string');
      assert.ok(Array.isArray(task.dependencies));
      assert.strictEqual(typeof task.priority, 'number');
    }
  });

  it('detects header keywords', () => {
    const tasks = decomposeUI('Create a page with a navigation bar and header');
    const regions = tasks.map(t => t.region);
    assert.ok(regions.includes('header'));
  });

  it('detects content/form keywords', () => {
    const tasks = decomposeUI('Build a login form with email and password');
    const regions = tasks.map(t => t.region);
    assert.ok(regions.includes('content'));
  });

  it('infers default layout when no keywords match', () => {
    const tasks = decomposeUI('Generate something abstract');
    const regions = tasks.map(t => t.region);
    // Default layout includes header, content, footer
    assert.ok(regions.includes('header'));
    assert.ok(regions.includes('content'));
    assert.ok(regions.includes('footer'));
  });

  it('tasks are sorted by priority', () => {
    const tasks = decomposeUI('Build a dashboard with sidebar, header, footer, and main content');
    for (let i = 1; i < tasks.length; i++) {
      assert.ok(tasks[i].priority >= tasks[i - 1].priority,
        `Task ${tasks[i].region} (priority ${tasks[i].priority}) should come after ${tasks[i - 1].region} (priority ${tasks[i - 1].priority})`);
    }
  });
});

describe('getExecutionLevels', () => {
  it('respects dependencies', () => {
    const tasks = decomposeUI('Build a page with header, sidebar, main content, and footer');
    const levels = getExecutionLevels(tasks);

    assert.ok(levels.length > 0);

    // First level should contain tasks with no dependencies (header)
    const firstLevelRegions = levels[0].map(t => t.region);
    assert.ok(firstLevelRegions.includes('header'));

    // Tasks depending on header should be in later levels
    for (let i = 1; i < levels.length; i++) {
      for (const task of levels[i]) {
        if (task.dependencies.includes('header')) {
          assert.ok(!firstLevelRegions.includes(task.region) || task.region === 'header',
            `${task.region} depends on header and should not be in the first level`);
        }
      }
    }
  });
});
