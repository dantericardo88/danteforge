// Spatial Decomposer — Breaks complex UI prompts into concurrent spatial sub-tasks
// Enables parallel agent execution for different regions of the UI.

/**
 * A spatial sub-task representing a region of the UI to be generated.
 */
export interface SpatialTask {
  region: string;
  prompt: string;
  dependencies: string[];
  priority: number;
}

/**
 * Common UI regions and their typical characteristics.
 */
const REGION_PATTERNS: Record<string, { keywords: string[]; priority: number; dependencies: string[] }> = {
  header: {
    keywords: ['header', 'nav', 'navigation', 'navbar', 'topbar', 'app bar', 'toolbar'],
    priority: 1,
    dependencies: [],
  },
  sidebar: {
    keywords: ['sidebar', 'side nav', 'side panel', 'drawer', 'menu'],
    priority: 2,
    dependencies: ['header'],
  },
  content: {
    keywords: ['content', 'main', 'body', 'page', 'dashboard', 'table', 'list', 'grid', 'cards', 'form', 'login', 'signup', 'profile', 'settings'],
    priority: 3,
    dependencies: ['header'],
  },
  modal: {
    keywords: ['modal', 'dialog', 'popup', 'overlay', 'confirm', 'alert'],
    priority: 4,
    dependencies: ['content'],
  },
  footer: {
    keywords: ['footer', 'bottom bar', 'copyright', 'links'],
    priority: 5,
    dependencies: ['content'],
  },
};

/**
 * Decompose a UI prompt into spatial sub-tasks for parallel generation.
 * Returns an ordered list of tasks respecting dependencies.
 */
export function decomposeUI(prompt: string, constitution?: string): SpatialTask[] {
  const lowerPrompt = prompt.toLowerCase();
  const tasks: SpatialTask[] = [];
  const detectedRegions = new Set<string>();

  // Detect which regions are mentioned or implied
  for (const [region, config] of Object.entries(REGION_PATTERNS)) {
    if (config.keywords.some(kw => lowerPrompt.includes(kw))) {
      detectedRegions.add(region);
    }
  }

  // If no specific regions detected, infer a standard page layout
  if (detectedRegions.size === 0) {
    detectedRegions.add('header');
    detectedRegions.add('content');
    detectedRegions.add('footer');
  }

  // If content is detected but header isn't, add header for completeness
  if (detectedRegions.has('content') && !detectedRegions.has('header')) {
    detectedRegions.add('header');
  }

  // Build tasks for each detected region
  for (const region of detectedRegions) {
    const config = REGION_PATTERNS[region];
    if (!config) continue;

    const regionDeps = config.dependencies.filter(d => detectedRegions.has(d));
    const regionPrompt = buildRegionPrompt(region, prompt, constitution);

    tasks.push({
      region,
      prompt: regionPrompt,
      dependencies: regionDeps,
      priority: config.priority,
    });
  }

  // Sort by priority (lower = higher priority)
  tasks.sort((a, b) => a.priority - b.priority);

  return tasks;
}

/**
 * Build a focused prompt for a specific UI region.
 */
function buildRegionPrompt(region: string, fullPrompt: string, constitution?: string): string {
  const regionDescriptions: Record<string, string> = {
    header: 'Generate the header/navigation bar section. Include: logo, navigation links, and any user controls (profile, settings, logout).',
    sidebar: 'Generate the sidebar/navigation panel. Include: menu items, sections, and collapse/expand behavior indicators.',
    content: 'Generate the main content area. This is the primary functional region of the page.',
    modal: 'Generate a modal/dialog overlay. Include: title, content area, action buttons (confirm/cancel), and close button.',
    footer: 'Generate the footer section. Include: copyright, links, and any secondary navigation.',
  };

  const description = regionDescriptions[region] ?? `Generate the ${region} section of the UI.`;

  return `## Region: ${region.toUpperCase()}
${description}

## Full Context
${fullPrompt}
${constitution ? `\n## Project Principles\n${constitution}` : ''}

Generate the .op JSON nodes ONLY for this region. Use semantic naming (e.g., "${region}-container", "${region}-title").`;
}

/**
 * Get the execution order for tasks respecting dependencies.
 * Returns arrays of tasks that can run in parallel at each level.
 */
export function getExecutionLevels(tasks: SpatialTask[]): SpatialTask[][] {
  const levels: SpatialTask[][] = [];
  const completed = new Set<string>();
  let remaining = [...tasks];

  while (remaining.length > 0) {
    const currentLevel: SpatialTask[] = [];

    for (const task of remaining) {
      const depsReady = task.dependencies.every(d => completed.has(d));
      if (depsReady) {
        currentLevel.push(task);
      }
    }

    if (currentLevel.length === 0) {
      // Circular dependency or unresolvable — just add all remaining
      levels.push(remaining);
      break;
    }

    levels.push(currentLevel);
    for (const task of currentLevel) {
      completed.add(task.region);
    }
    remaining = remaining.filter(t => !completed.has(t.region));
  }

  return levels;
}
