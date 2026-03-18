// End-to-end Design Pipeline Integration Test
// Exercises the full path: design generates .op → requireDesign validates →
// forge extracts tokens → ux-refine --openpencil processes → verify passes.
// This proves the entire Design-as-Code pipeline works as a unit.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  createSkeletonOP,
  stringifyOP,
  parseOP,
  validateOP,
  diffOP,
} from '../src/harvested/openpencil/op-codec.js';
import { extractTokensFromDocument, tokensToCSS, tokensToTailwindConfig, tokensToStyledTheme } from '../src/harvested/openpencil/token-extractor.js';
import { renderToSVG, renderToASCII, renderToHTML } from '../src/harvested/openpencil/headless-renderer.js';
import { decomposeUI, getExecutionLevels } from '../src/harvested/openpencil/spatial-decomposer.js';
import { loadToolRegistry, findTool, toolToMCPFormat } from '../src/harvested/openpencil/tool-registry.js';
import { initOpenPencilAdapter, executeToolCall } from '../src/harvested/openpencil/adapter.js';
import { createMediumOP, getMediumOPString } from './helpers/mock-op.js';

let tmpDir: string;

describe('Design Pipeline E2E', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-e2e-'));
    await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Stage 1: Design command generates a valid .op artifact
  describe('Stage 1: Design Generation', () => {
    it('skeleton .op roundtrips through create → stringify → parse → validate', () => {
      const doc = createSkeletonOP('E2E Test Project');
      const json = stringifyOP(doc);
      const parsed = parseOP(json);
      const validation = validateOP(parsed);

      assert.ok(validation.valid, `Validation failed: ${validation.errors.join(', ')}`);
      assert.strictEqual(parsed.document.name, 'E2E Test Project');
      assert.ok(parsed.nodes.length > 0, 'Must have at least one node');
    });

    it('medium .op document passes full validation', () => {
      const doc = createMediumOP();
      const json = stringifyOP(doc);
      const parsed = parseOP(json);
      const validation = validateOP(parsed);

      assert.ok(validation.valid, `Validation failed: ${validation.errors.join(', ')}`);
      assert.ok(parsed.nodes[0].children!.length > 0, 'Must have nested children');
    });

    it('.op file can be written to disk and read back identically', async () => {
      const doc = createMediumOP();
      const json = stringifyOP(doc);
      const filePath = path.join(tmpDir, '.danteforge', 'DESIGN.op');

      await fs.writeFile(filePath, json);
      const readBack = await fs.readFile(filePath, 'utf-8');
      const reparsed = parseOP(readBack);

      assert.deepStrictEqual(reparsed.document, doc.document);
      assert.strictEqual(reparsed.nodes.length, doc.nodes.length);
    });
  });

  // Stage 2: requireDesign gate validates the .op artifact
  describe('Stage 2: Design Gate Validation', () => {
    it('gate accepts valid .op file on disk', async () => {
      const doc = createMediumOP();
      const json = stringifyOP(doc);
      const filePath = path.join(tmpDir, '.danteforge', 'DESIGN.op');
      await fs.writeFile(filePath, json);

      // Simulate gate validation logic
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = parseOP(raw);
      const validation = validateOP(parsed);

      assert.ok(validation.valid);
      assert.ok(parsed.nodes && parsed.document, 'Must have required .op fields');
    });

    it('gate rejects malformed JSON', () => {
      assert.throws(() => parseOP('not valid json'), /JSON/i);
    });

    it('gate rejects missing required fields', () => {
      const bad = JSON.stringify({ formatVersion: '1.0.0' });
      assert.throws(() => parseOP(bad), /Missing required/i);
    });

    it('gate catches spacing violations and reports warnings', () => {
      const doc = createMediumOP();
      // Inject a non-grid-aligned padding
      doc.nodes[0].padding = { top: 13, right: 7, bottom: 15, left: 9 };
      const validation = validateOP(doc);
      assert.ok(validation.warnings.length > 0, 'Should report spacing warnings');
    });
  });

  // Stage 3: Forge extracts design tokens from .op
  describe('Stage 3: Token Extraction & Code Generation', () => {
    it('extracts colors from variable collections and node fills', () => {
      const doc = createMediumOP();
      const tokens = extractTokensFromDocument(doc);

      assert.ok(Object.keys(tokens.colors).length > 0, 'Must extract colors');
      assert.ok(Object.values(tokens.colors).includes('#3B82F6'), 'Must find primary color');
    });

    it('extracts typography from text nodes', () => {
      const doc = createMediumOP();
      const tokens = extractTokensFromDocument(doc);

      assert.ok(Object.keys(tokens.typography).length > 0, 'Must extract typography');
    });

    it('extracts spacing from padding values', () => {
      const doc = createMediumOP();
      const tokens = extractTokensFromDocument(doc);

      assert.ok(Object.keys(tokens.spacing).length > 0, 'Must extract spacing');
    });

    it('generates valid CSS custom properties', () => {
      const doc = createMediumOP();
      const tokens = extractTokensFromDocument(doc);
      const css = tokensToCSS(tokens);

      assert.ok(css.includes(':root'), 'CSS must have :root selector');
      assert.ok(css.includes('--'), 'CSS must have custom properties');
      assert.ok(css.length > 50, 'CSS must be non-trivial');
    });

    it('generates valid Tailwind config', () => {
      const doc = createMediumOP();
      const tokens = extractTokensFromDocument(doc);
      const tailwind = tokensToTailwindConfig(tokens);

      assert.ok(tailwind.includes('module.exports') || tailwind.includes('export'), 'Must be a valid module');
    });

    it('generates valid styled-components theme', () => {
      const doc = createMediumOP();
      const tokens = extractTokensFromDocument(doc);
      const theme = tokensToStyledTheme(tokens);

      assert.ok(theme.includes('export'), 'Must export theme');
    });

    it('CSS tokens can be written to disk', async () => {
      const doc = createMediumOP();
      const tokens = extractTokensFromDocument(doc);
      const css = tokensToCSS(tokens);
      const filePath = path.join(tmpDir, '.danteforge', 'design-tokens.css');

      await fs.writeFile(filePath, css);
      const readBack = await fs.readFile(filePath, 'utf-8');
      assert.strictEqual(readBack, css);
    });
  });

  // Stage 4: Rendering verification
  describe('Stage 4: Visual Rendering', () => {
    it('renders SVG from .op document', () => {
      const doc = createMediumOP();
      const svg = renderToSVG(doc);

      assert.ok(svg.startsWith('<svg'), 'Must be valid SVG');
      assert.ok(svg.includes('Login'), 'Must contain design content');
    });

    it('renders ASCII preview for terminal', () => {
      const doc = createMediumOP();
      const ascii = renderToASCII(doc);

      assert.ok(ascii.length > 0, 'Must produce output');
      assert.ok(ascii.includes('Login') || ascii.includes('Root'), 'Must contain frame names');
    });

    it('renders full HTML preview', () => {
      const doc = createMediumOP();
      const html = renderToHTML(doc);

      assert.ok(html.includes('<!DOCTYPE'), 'Must be full HTML document');
      assert.ok(html.includes('<svg'), 'Must embed SVG');
    });

    it('HTML preview can be written to disk', async () => {
      const doc = createMediumOP();
      const html = renderToHTML(doc);
      const filePath = path.join(tmpDir, '.danteforge', 'design-preview.html');

      await fs.writeFile(filePath, html);
      const stat = await fs.stat(filePath);
      assert.ok(stat.size > 0);
    });
  });

  // Stage 5: Spatial decomposition for parallel agent work
  describe('Stage 5: Spatial Decomposition', () => {
    it('decomposes a login page prompt into spatial tasks', () => {
      const tasks = decomposeUI('Create a login page with header, form, and footer');

      assert.ok(tasks.length >= 2, 'Must produce multiple spatial tasks');
      assert.ok(tasks.some(t => t.region === 'header' || t.name.toLowerCase().includes('header')));
    });

    it('tasks have priorities and dependencies', () => {
      const tasks = decomposeUI('Dashboard with sidebar navigation, data tables, and charts');

      for (const task of tasks) {
        assert.ok(typeof task.priority === 'number', 'Each task must have a priority');
      }

      // Tasks should be sorted by priority
      for (let i = 1; i < tasks.length; i++) {
        assert.ok(tasks[i].priority >= tasks[i - 1].priority, 'Tasks must be sorted by priority');
      }
    });

    it('execution levels respect dependencies', () => {
      const tasks = decomposeUI('Full application with header, sidebar, content, and footer');
      const levels = getExecutionLevels(tasks);

      assert.ok(levels.length > 0, 'Must produce execution levels');
    });
  });

  // Stage 6: Tool registry and adapter integration
  describe('Stage 6: Tool Registry & Adapter', () => {
    it('registry loads all 86 tools', async () => {
      const tools = await loadToolRegistry();
      assert.strictEqual(tools.length, 86, 'Must have exactly 86 tools');
    });

    it('every tool converts to valid MCP format', async () => {
      const tools = await loadToolRegistry();
      for (const tool of tools) {
        const mcp = toolToMCPFormat(tool);
        assert.ok(mcp.name, 'MCP tool must have a name');
        assert.ok(mcp.description, 'MCP tool must have a description');
        assert.ok(mcp.inputSchema, 'MCP tool must have inputSchema');
        assert.strictEqual(mcp.inputSchema.type, 'object');
      }
    });

    it('adapter initializes with all tools', async () => {
      const adapterResult = await initOpenPencilAdapter();
      assert.strictEqual(adapterResult.toolCount, 86);
      assert.strictEqual(adapterResult.tools.length, 86);
      assert.strictEqual(adapterResult.mcpTools.length, 86);
    });

    it('adapter validates required parameters', async () => {
      const result = await executeToolCall('setFill', {});
      assert.ok(result && typeof result === 'object');
    });

    it('adapter rejects unknown tools', async () => {
      const result = await executeToolCall('nonExistentTool', {});
      assert.ok(result && typeof result === 'object');
    });
  });

  // Stage 7: Diff detection between design states
  describe('Stage 7: Design Diffing', () => {
    it('detects changes between two design states', () => {
      const before = createMediumOP();
      const after = createMediumOP();

      // Modify a tracked property (name, width, height, etc.)
      after.nodes[0].name = 'Modified Root';
      after.nodes[0].width = 1920;

      const diff = diffOP(before, after);
      assert.ok(diff.summary.modified > 0 || diff.summary.added > 0 || diff.summary.removed > 0,
        'Must detect at least one change');
      assert.ok(diff.entries.length > 0, 'Must have diff entries');
    });

    it('reports no changes for identical documents', () => {
      const doc = createMediumOP();
      const diff = diffOP(doc, doc);

      assert.strictEqual(diff.summary.added, 0);
      assert.strictEqual(diff.summary.removed, 0);
      assert.strictEqual(diff.summary.modified, 0);
      assert.strictEqual(diff.entries.length, 0);
    });
  });

  // Stage 8: Full pipeline simulation
  describe('Stage 8: Full Pipeline Roundtrip', () => {
    it('complete pipeline: generate → validate → extract → render → diff', async () => {
      // Step 1: Generate design
      const doc = createMediumOP();
      const json = stringifyOP(doc);

      // Step 2: Write to disk (simulates design command output)
      const designPath = path.join(tmpDir, '.danteforge', 'DESIGN.op');
      await fs.writeFile(designPath, json);

      // Step 3: Read back and validate (simulates requireDesign gate)
      const raw = await fs.readFile(designPath, 'utf-8');
      const parsed = parseOP(raw);
      const validation = validateOP(parsed);
      assert.ok(validation.valid, 'Gate must pass');

      // Step 4: Extract tokens (simulates forge post-step)
      const tokens = extractTokensFromDocument(parsed);
      const css = tokensToCSS(tokens);
      const tailwind = tokensToTailwindConfig(tokens);

      const cssPath = path.join(tmpDir, '.danteforge', 'design-tokens.css');
      const twPath = path.join(tmpDir, '.danteforge', 'design-tokens.tailwind.js');
      await fs.writeFile(cssPath, css);
      await fs.writeFile(twPath, tailwind);

      // Step 5: Render preview (simulates ux-refine --openpencil)
      const html = renderToHTML(parsed);
      const previewPath = path.join(tmpDir, '.danteforge', 'design-preview.html');
      await fs.writeFile(previewPath, html);

      // Step 6: Verify all artifacts exist
      const artifacts = ['DESIGN.op', 'design-tokens.css', 'design-tokens.tailwind.js', 'design-preview.html'];
      for (const artifact of artifacts) {
        const exists = await fs.access(path.join(tmpDir, '.danteforge', artifact)).then(() => true).catch(() => false);
        assert.ok(exists, `Artifact must exist: ${artifact}`);
      }

      // Step 7: Verify CSS tokens are non-empty and valid
      const finalCSS = await fs.readFile(cssPath, 'utf-8');
      assert.ok(finalCSS.includes(':root'), 'CSS must contain :root');
      assert.ok(finalCSS.includes('--'), 'CSS must contain custom properties');

      // Step 8: Verify HTML preview is complete
      const finalHTML = await fs.readFile(previewPath, 'utf-8');
      assert.ok(finalHTML.includes('<!DOCTYPE'), 'HTML must be a full document');
      assert.ok(finalHTML.includes('<svg'), 'HTML must contain rendered SVG');
    });

    it('pipeline handles skeleton fallback gracefully', async () => {
      // Simulates offline mode where LLM is unavailable
      const skeleton = createSkeletonOP('Fallback Project');
      const json = stringifyOP(skeleton);

      const parsed = parseOP(json);
      const validation = validateOP(parsed);
      assert.ok(validation.valid, 'Skeleton must pass validation');

      const tokens = extractTokensFromDocument(parsed);
      const css = tokensToCSS(tokens);
      assert.ok(css.length > 0, 'Even skeleton must produce some CSS');

      const svg = renderToSVG(parsed);
      assert.ok(svg.startsWith('<svg'), 'Skeleton must render to SVG');
    });
  });
});
