// OpenPencil Tool Registry — Maps 86 OpenPencil tools into DanteForge's MCP format
// Each tool has a name, description, category, typed parameters, and a real executor
// that operates on the OPDocument JSON structure via ToolContext.

import fs from 'fs/promises';
import path from 'path';
import type { ToolContext } from './tool-context.js';
import { createContext } from './tool-context.js';
import { parseOP, stringifyOP } from './op-codec.js';
import * as readExec from './executors/read-executors.js';
import * as createExec from './executors/create-executors.js';
import * as modifyExec from './executors/modify-executors.js';
import * as structureExec from './executors/structure-executors.js';
import * as variableExec from './executors/variable-executors.js';
import * as vectorExec from './executors/vector-executors.js';
import * as analysisExec from './executors/analysis-executors.js';

/**
 * Parameter definition for an OpenPencil tool.
 */
export interface OPToolParam {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  enum?: string[];
  default?: unknown;
}

/**
 * Executor function type — operates on params + optional ToolContext.
 */
export type ToolExecutor = (params: Record<string, unknown>, ctx?: ToolContext) => Promise<unknown> | unknown;

/**
 * A single OpenPencil tool definition.
 */
export interface OPTool {
  name: string;
  description: string;
  category: 'read' | 'create' | 'modify' | 'structure' | 'variables' | 'vector' | 'analysis';
  parameters: Record<string, OPToolParam>;
  execute: (params: Record<string, unknown>, ctx?: ToolContext) => Promise<unknown>;
}

/**
 * MCP-compatible tool definition for LLM tool-calling.
 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

// Executor registry — maps tool names to their real implementations
const EXECUTOR_MAP: Record<string, (params: Record<string, unknown>, ctx: ToolContext) => unknown> = {
  // Read (11)
  get_selection: readExec.executeGetSelection,
  get_page_tree: readExec.executeGetPageTree,
  get_node: readExec.executeGetNode,
  find_nodes: readExec.executeFindNodes,
  list_fonts: readExec.executeListFonts,
  get_styles: readExec.executeGetStyles,
  get_page_list: readExec.executeGetPageList,
  get_node_css: readExec.executeGetNodeCSS,
  get_node_bounds: readExec.executeGetNodeBounds,
  get_document_info: readExec.executeGetDocumentInfo,
  get_node_children: readExec.executeGetNodeChildren,
  // Create (7)
  createShape: createExec.executeCreateShape,
  createFrame: createExec.executeCreateFrame,
  createText: createExec.executeCreateText,
  createComponent: createExec.executeCreateComponent,
  createInstance: createExec.executeCreateInstance,
  createPage: createExec.executeCreatePage,
  render: createExec.executeRender,
  // Modify (20)
  setFill: modifyExec.executeSetFill,
  setStroke: modifyExec.executeSetStroke,
  setLayout: modifyExec.executeSetLayout,
  setConstraints: modifyExec.executeSetConstraints,
  setText: modifyExec.executeSetText,
  setOpacity: modifyExec.executeSetOpacity,
  setSize: modifyExec.executeSetSize,
  setPosition: modifyExec.executeSetPosition,
  setCornerRadius: modifyExec.executeSetCornerRadius,
  setFontSize: modifyExec.executeSetFontSize,
  setFontFamily: modifyExec.executeSetFontFamily,
  setFontWeight: modifyExec.executeSetFontWeight,
  setLineHeight: modifyExec.executeSetLineHeight,
  setTextAlign: modifyExec.executeSetTextAlign,
  setVisible: modifyExec.executeSetVisible,
  setLocked: modifyExec.executeSetLocked,
  setName: modifyExec.executeSetName,
  setRotation: modifyExec.executeSetRotation,
  setEffect: modifyExec.executeSetEffect,
  setPadding: modifyExec.executeSetPadding,
  // Structure (17)
  deleteNode: structureExec.executeDeleteNode,
  cloneNode: structureExec.executeCloneNode,
  groupNodes: structureExec.executeGroupNodes,
  ungroupNodes: structureExec.executeUngroupNodes,
  reparentNode: structureExec.executeReparentNode,
  flattenNode: structureExec.executeFlattenNode,
  duplicatePage: structureExec.executeDuplicatePage,
  reorderNode: structureExec.executeReorderNode,
  alignNodes: structureExec.executeAlignNodes,
  distributeNodes: structureExec.executeDistributeNodes,
  resizeToFit: structureExec.executeResizeToFit,
  detachInstance: structureExec.executeDetachInstance,
  createComponentSet: structureExec.executeCreateComponentSet,
  swapComponent: structureExec.executeSwapComponent,
  selectNodes: structureExec.executeSelectNodes,
  scrollToNode: structureExec.executeScrollToNode,
  lockAllChildren: structureExec.executeLockAllChildren,
  // Variables (11)
  createVariable: variableExec.executeCreateVariable,
  updateVariable: variableExec.executeUpdateVariable,
  deleteVariable: variableExec.executeDeleteVariable,
  bindVariable: variableExec.executeBindVariable,
  unbindVariable: variableExec.executeUnbindVariable,
  getCollection: variableExec.executeGetCollection,
  listCollections: variableExec.executeListCollections,
  createCollection: variableExec.executeCreateCollection,
  deleteCollection: variableExec.executeDeleteCollection,
  renameCollection: variableExec.executeRenameCollection,
  getVariableBindings: variableExec.executeGetVariableBindings,
  // Vector & Export (14)
  booleanUnion: vectorExec.executeBooleanUnion,
  booleanSubtract: vectorExec.executeBooleanSubtract,
  booleanIntersect: vectorExec.executeBooleanIntersect,
  booleanExclude: vectorExec.executeBooleanExclude,
  pathScale: vectorExec.executePathScale,
  pathSimplify: vectorExec.executePathSimplify,
  viewportZoomToFit: vectorExec.executeViewportZoomToFit,
  viewportZoomToNode: vectorExec.executeViewportZoomToNode,
  exportImage: vectorExec.executeExportImage,
  exportSvg: vectorExec.executeExportSvg,
  exportCSS: vectorExec.executeExportCSS,
  exportJSX: vectorExec.executeExportJSX,
  exportTailwind: vectorExec.executeExportTailwind,
  exportDesignTokens: vectorExec.executeExportDesignTokens,
  // Analysis (6)
  analyzeColors: analysisExec.executeAnalyzeColors,
  analyzeTypography: analysisExec.executeAnalyzeTypography,
  analyzeSpacing: analysisExec.executeAnalyzeSpacing,
  analyzeClusters: analysisExec.executeAnalyzeClusters,
  diffCreate: analysisExec.executeDiffCreate,
  diffShow: analysisExec.executeDiffShow,
};

const DEFAULT_DESIGN_PATH = path.join('.danteforge', 'DESIGN.op');

async function loadDefaultContext(): Promise<ToolContext | null> {
  try {
    const raw = await fs.readFile(DEFAULT_DESIGN_PATH, 'utf8');
    return createContext(parseOP(raw));
  } catch {
    return null;
  }
}

async function saveDefaultContext(ctx: ToolContext): Promise<void> {
  await fs.mkdir(path.dirname(DEFAULT_DESIGN_PATH), { recursive: true });
  await fs.writeFile(DEFAULT_DESIGN_PATH, stringifyOP(ctx.document), 'utf8');
}

/**
 * Create an executor that wraps the real implementation with async + optional context.
 */
function wiredExecutor(toolName: string) {
  return async (params: Record<string, unknown>, ctx?: ToolContext): Promise<unknown> => {
    const executor = EXECUTOR_MAP[toolName];
    if (!executor) {
      return { tool: toolName, status: 'unknown-tool', params, message: `No executor registered for ${toolName}` };
    }

    const localContext = ctx ?? await loadDefaultContext();
    if (!localContext) {
      return { tool: toolName, status: 'no-context', params, message: 'ToolContext required — load a .op document first' };
    }

    const result = await executor(params, localContext);
    if (!ctx && localContext.modified) {
      await saveDefaultContext(localContext);
    }
    return result;
  };
}

/**
 * The full 86-tool registry organized by domain.
 * Categories: read (11), create (7), modify (20), structure (17),
 * variables (11), vector (14), analysis (6) = 86 total
 */
function buildToolDefinitions(): OPTool[] {
  const tools: OPTool[] = [];

  // ── Read Operations (11) ──
  const readTools: [string, string, Record<string, OPToolParam>][] = [
    ['get_selection', 'Get the currently selected nodes', {}],
    ['get_page_tree', 'Get the full node tree for a page', { pageId: { type: 'string', description: 'Page ID to query', required: false } }],
    ['get_node', 'Get a specific node by ID', { nodeId: { type: 'string', description: 'Node ID', required: true } }],
    ['find_nodes', 'Find nodes matching a query', { query: { type: 'string', description: 'Search query (name, type, or property)', required: true }, type: { type: 'string', description: 'Node type filter', required: false } }],
    ['list_fonts', 'List all fonts used in the document', {}],
    ['get_styles', 'Get all shared styles', {}],
    ['get_page_list', 'List all pages in the document', {}],
    ['get_node_css', 'Get CSS representation of a node', { nodeId: { type: 'string', description: 'Node ID', required: true } }],
    ['get_node_bounds', 'Get bounding box of a node', { nodeId: { type: 'string', description: 'Node ID', required: true } }],
    ['get_document_info', 'Get document metadata', {}],
    ['get_node_children', 'List direct children of a node', { nodeId: { type: 'string', description: 'Node ID', required: true } }],
  ];

  for (const [name, description, parameters] of readTools) {
    tools.push({ name, description, category: 'read', parameters, execute: wiredExecutor(name) });
  }

  // ── Creation Engines (7) ──
  const createTools: [string, string, Record<string, OPToolParam>][] = [
    ['createShape', 'Create a new shape node', { type: { type: 'string', description: 'Shape type: rectangle, ellipse, line, vector', required: true, enum: ['rectangle', 'ellipse', 'line', 'vector'] }, parentId: { type: 'string', description: 'Parent node ID', required: false }, name: { type: 'string', description: 'Node name', required: false }, width: { type: 'number', description: 'Width in pixels', required: false }, height: { type: 'number', description: 'Height in pixels', required: false } }],
    ['createFrame', 'Create a new frame (artboard)', { name: { type: 'string', description: 'Frame name', required: false }, width: { type: 'number', description: 'Width', required: false }, height: { type: 'number', description: 'Height', required: false }, parentId: { type: 'string', description: 'Parent ID', required: false } }],
    ['createText', 'Create a text node', { content: { type: 'string', description: 'Text content', required: true }, fontFamily: { type: 'string', description: 'Font family', required: false }, fontSize: { type: 'number', description: 'Font size', required: false }, parentId: { type: 'string', description: 'Parent ID', required: false } }],
    ['createComponent', 'Create a reusable component', { name: { type: 'string', description: 'Component name', required: true }, parentId: { type: 'string', description: 'Parent ID', required: false } }],
    ['createInstance', 'Create an instance of a component', { componentId: { type: 'string', description: 'Source component ID', required: true }, parentId: { type: 'string', description: 'Parent ID', required: false } }],
    ['createPage', 'Create a new page', { name: { type: 'string', description: 'Page name', required: true } }],
    ['render', 'Render the current scene to image', { format: { type: 'string', description: 'Output format: png, svg, pdf', required: false, enum: ['png', 'svg', 'pdf'] }, scale: { type: 'number', description: 'Render scale factor', required: false, default: 1 } }],
  ];

  for (const [name, description, parameters] of createTools) {
    tools.push({ name, description, category: 'create', parameters, execute: wiredExecutor(name) });
  }

  // ── Property Modification (20) ──
  const modifyTools: [string, string, Record<string, OPToolParam>][] = [
    ['setFill', 'Set fill color/gradient of a node', { nodeId: { type: 'string', description: 'Node ID', required: true }, color: { type: 'string', description: 'Hex color', required: true }, opacity: { type: 'number', description: 'Opacity 0-1', required: false } }],
    ['setStroke', 'Set stroke properties', { nodeId: { type: 'string', description: 'Node ID', required: true }, color: { type: 'string', description: 'Hex color', required: true }, weight: { type: 'number', description: 'Stroke weight', required: true } }],
    ['setLayout', 'Set auto-layout properties', { nodeId: { type: 'string', description: 'Node ID', required: true }, mode: { type: 'string', description: 'Layout mode: horizontal, vertical, none', required: true, enum: ['horizontal', 'vertical', 'none'] }, gap: { type: 'number', description: 'Gap between items', required: false }, padding: { type: 'number', description: 'Uniform padding', required: false } }],
    ['setConstraints', 'Set layout constraints', { nodeId: { type: 'string', description: 'Node ID', required: true }, horizontal: { type: 'string', description: 'Horizontal constraint', required: false, enum: ['min', 'center', 'max', 'stretch', 'scale'] }, vertical: { type: 'string', description: 'Vertical constraint', required: false, enum: ['min', 'center', 'max', 'stretch', 'scale'] } }],
    ['setText', 'Set text content', { nodeId: { type: 'string', description: 'Node ID', required: true }, content: { type: 'string', description: 'Text content', required: true } }],
    ['setOpacity', 'Set node opacity', { nodeId: { type: 'string', description: 'Node ID', required: true }, opacity: { type: 'number', description: 'Opacity 0-1', required: true } }],
    ['setSize', 'Resize a node', { nodeId: { type: 'string', description: 'Node ID', required: true }, width: { type: 'number', description: 'Width', required: false }, height: { type: 'number', description: 'Height', required: false } }],
    ['setPosition', 'Move a node', { nodeId: { type: 'string', description: 'Node ID', required: true }, x: { type: 'number', description: 'X position', required: true }, y: { type: 'number', description: 'Y position', required: true } }],
    ['setCornerRadius', 'Set border radius', { nodeId: { type: 'string', description: 'Node ID', required: true }, radius: { type: 'number', description: 'Corner radius', required: true } }],
    ['setFontSize', 'Set text font size', { nodeId: { type: 'string', description: 'Node ID', required: true }, size: { type: 'number', description: 'Font size in px', required: true } }],
    ['setFontFamily', 'Set text font family', { nodeId: { type: 'string', description: 'Node ID', required: true }, family: { type: 'string', description: 'Font family name', required: true } }],
    ['setFontWeight', 'Set text font weight', { nodeId: { type: 'string', description: 'Node ID', required: true }, weight: { type: 'number', description: 'Font weight (100-900)', required: true } }],
    ['setLineHeight', 'Set text line height', { nodeId: { type: 'string', description: 'Node ID', required: true }, lineHeight: { type: 'number', description: 'Line height', required: true } }],
    ['setTextAlign', 'Set text alignment', { nodeId: { type: 'string', description: 'Node ID', required: true }, align: { type: 'string', description: 'Alignment', required: true, enum: ['left', 'center', 'right', 'justify'] } }],
    ['setVisible', 'Toggle node visibility', { nodeId: { type: 'string', description: 'Node ID', required: true }, visible: { type: 'boolean', description: 'Visibility', required: true } }],
    ['setLocked', 'Toggle node lock', { nodeId: { type: 'string', description: 'Node ID', required: true }, locked: { type: 'boolean', description: 'Lock state', required: true } }],
    ['setName', 'Rename a node', { nodeId: { type: 'string', description: 'Node ID', required: true }, name: { type: 'string', description: 'New name', required: true } }],
    ['setRotation', 'Rotate a node', { nodeId: { type: 'string', description: 'Node ID', required: true }, rotation: { type: 'number', description: 'Rotation in degrees', required: true } }],
    ['setEffect', 'Apply an effect', { nodeId: { type: 'string', description: 'Node ID', required: true }, type: { type: 'string', description: 'Effect type', required: true, enum: ['drop-shadow', 'inner-shadow', 'blur', 'background-blur'] }, color: { type: 'string', description: 'Effect color (hex)', required: false }, radius: { type: 'number', description: 'Effect radius', required: false }, offset: { type: 'object', description: 'Offset {x, y}', required: false } }],
    ['setPadding', 'Set padding for auto-layout frames', { nodeId: { type: 'string', description: 'Node ID', required: true }, top: { type: 'number', description: 'Top padding', required: false }, right: { type: 'number', description: 'Right padding', required: false }, bottom: { type: 'number', description: 'Bottom padding', required: false }, left: { type: 'number', description: 'Left padding', required: false } }],
  ];

  for (const [name, description, parameters] of modifyTools) {
    tools.push({ name, description, category: 'modify', parameters, execute: wiredExecutor(name) });
  }

  // ── Structural Logic (17) ──
  const structureTools: [string, string, Record<string, OPToolParam>][] = [
    ['deleteNode', 'Delete a node', { nodeId: { type: 'string', description: 'Node ID', required: true } }],
    ['cloneNode', 'Clone a node', { nodeId: { type: 'string', description: 'Node ID to clone', required: true } }],
    ['groupNodes', 'Group multiple nodes', { nodeIds: { type: 'array', description: 'Array of node IDs to group', required: true }, name: { type: 'string', description: 'Group name', required: false } }],
    ['ungroupNodes', 'Ungroup a group node', { groupId: { type: 'string', description: 'Group ID', required: true } }],
    ['reparentNode', 'Move node to a new parent', { nodeId: { type: 'string', description: 'Node ID', required: true }, newParentId: { type: 'string', description: 'New parent ID', required: true }, index: { type: 'number', description: 'Position in parent', required: false } }],
    ['flattenNode', 'Flatten a group into a single vector', { nodeId: { type: 'string', description: 'Node ID', required: true } }],
    ['duplicatePage', 'Duplicate an entire page', { pageId: { type: 'string', description: 'Page ID', required: true }, newName: { type: 'string', description: 'New page name', required: false } }],
    ['reorderNode', 'Change z-order of a node', { nodeId: { type: 'string', description: 'Node ID', required: true }, direction: { type: 'string', description: 'Direction: front, back, forward, backward', required: true, enum: ['front', 'back', 'forward', 'backward'] } }],
    ['alignNodes', 'Align multiple nodes', { nodeIds: { type: 'array', description: 'Node IDs', required: true }, alignment: { type: 'string', description: 'Alignment type', required: true, enum: ['left', 'right', 'top', 'bottom', 'center-h', 'center-v'] } }],
    ['distributeNodes', 'Distribute nodes evenly', { nodeIds: { type: 'array', description: 'Node IDs', required: true }, direction: { type: 'string', description: 'horizontal or vertical', required: true, enum: ['horizontal', 'vertical'] } }],
    ['resizeToFit', 'Resize frame to fit children', { nodeId: { type: 'string', description: 'Frame ID', required: true } }],
    ['detachInstance', 'Detach a component instance', { instanceId: { type: 'string', description: 'Instance ID', required: true } }],
    ['createComponentSet', 'Create a component set (variants)', { componentIds: { type: 'array', description: 'Component IDs', required: true }, name: { type: 'string', description: 'Set name', required: true } }],
    ['swapComponent', 'Swap an instance to a different component', { instanceId: { type: 'string', description: 'Instance ID', required: true }, newComponentId: { type: 'string', description: 'New component ID', required: true } }],
    ['selectNodes', 'Set the current selection', { nodeIds: { type: 'array', description: 'Node IDs to select', required: true } }],
    ['scrollToNode', 'Scroll viewport to a node', { nodeId: { type: 'string', description: 'Node ID', required: true } }],
    ['lockAllChildren', 'Lock all children of a node', { nodeId: { type: 'string', description: 'Parent node ID', required: true } }],
  ];

  for (const [name, description, parameters] of structureTools) {
    tools.push({ name, description, category: 'structure', parameters, execute: wiredExecutor(name) });
  }

  // ── Design Variables / Tokens (11) ──
  const variableTools: [string, string, Record<string, OPToolParam>][] = [
    ['createVariable', 'Create a design variable', { name: { type: 'string', description: 'Variable name', required: true }, type: { type: 'string', description: 'Variable type', required: true, enum: ['color', 'number', 'string', 'boolean'] }, value: { type: 'string', description: 'Variable value', required: true }, collectionId: { type: 'string', description: 'Collection ID', required: true } }],
    ['updateVariable', 'Update a variable value', { variableId: { type: 'string', description: 'Variable ID', required: true }, value: { type: 'string', description: 'New value', required: true } }],
    ['deleteVariable', 'Delete a variable', { variableId: { type: 'string', description: 'Variable ID', required: true } }],
    ['bindVariable', 'Bind a variable to a node property', { nodeId: { type: 'string', description: 'Node ID', required: true }, property: { type: 'string', description: 'Property to bind', required: true }, variableId: { type: 'string', description: 'Variable ID', required: true } }],
    ['unbindVariable', 'Remove variable binding from a node', { nodeId: { type: 'string', description: 'Node ID', required: true }, property: { type: 'string', description: 'Property to unbind', required: true } }],
    ['getCollection', 'Get a variable collection', { collectionId: { type: 'string', description: 'Collection ID', required: true } }],
    ['listCollections', 'List all variable collections', {}],
    ['createCollection', 'Create a new variable collection', { name: { type: 'string', description: 'Collection name', required: true } }],
    ['deleteCollection', 'Delete a variable collection', { collectionId: { type: 'string', description: 'Collection ID', required: true } }],
    ['renameCollection', 'Rename a variable collection', { collectionId: { type: 'string', description: 'Collection ID', required: true }, name: { type: 'string', description: 'New name', required: true } }],
    ['getVariableBindings', 'List all bindings for a variable', { variableId: { type: 'string', description: 'Variable ID', required: true } }],
  ];

  for (const [name, description, parameters] of variableTools) {
    tools.push({ name, description, category: 'variables', parameters, execute: wiredExecutor(name) });
  }

  // ── Vector & Export (14) ──
  const vectorTools: [string, string, Record<string, OPToolParam>][] = [
    ['booleanUnion', 'Boolean union of shapes', { nodeIds: { type: 'array', description: 'Node IDs', required: true } }],
    ['booleanSubtract', 'Boolean subtract', { nodeIds: { type: 'array', description: 'Node IDs (first minus rest)', required: true } }],
    ['booleanIntersect', 'Boolean intersect', { nodeIds: { type: 'array', description: 'Node IDs', required: true } }],
    ['booleanExclude', 'Boolean exclude', { nodeIds: { type: 'array', description: 'Node IDs', required: true } }],
    ['pathScale', 'Scale vector paths', { nodeId: { type: 'string', description: 'Node ID', required: true }, scaleX: { type: 'number', description: 'X scale factor', required: true }, scaleY: { type: 'number', description: 'Y scale factor', required: true } }],
    ['pathSimplify', 'Simplify vector path', { nodeId: { type: 'string', description: 'Node ID', required: true }, tolerance: { type: 'number', description: 'Simplification tolerance', required: false } }],
    ['viewportZoomToFit', 'Zoom viewport to fit all content', {}],
    ['viewportZoomToNode', 'Zoom viewport to a specific node', { nodeId: { type: 'string', description: 'Node ID', required: true } }],
    ['exportImage', 'Export node/page as image', { nodeId: { type: 'string', description: 'Node ID (omit for full page)', required: false }, format: { type: 'string', description: 'Export format', required: false, enum: ['png', 'svg', 'pdf', 'jpg'] }, scale: { type: 'number', description: 'Export scale', required: false, default: 1 } }],
    ['exportSvg', 'Export node as SVG string', { nodeId: { type: 'string', description: 'Node ID', required: true } }],
    ['exportCSS', 'Export node as CSS properties', { nodeId: { type: 'string', description: 'Node ID', required: true } }],
    ['exportJSX', 'Export node as JSX component', { nodeId: { type: 'string', description: 'Node ID', required: true }, framework: { type: 'string', description: 'Target framework', required: false, enum: ['react', 'vue', 'html'] } }],
    ['exportTailwind', 'Export node with Tailwind classes', { nodeId: { type: 'string', description: 'Node ID', required: true } }],
    ['exportDesignTokens', 'Export all variables as design tokens', { format: { type: 'string', description: 'Token format', required: false, enum: ['css', 'json', 'tailwind', 'scss'] } }],
  ];

  for (const [name, description, parameters] of vectorTools) {
    tools.push({ name, description, category: 'vector', parameters, execute: wiredExecutor(name) });
  }

  // ── Analysis & Diffing (6) ──
  const analysisTools: [string, string, Record<string, OPToolParam>][] = [
    ['analyzeColors', 'Analyze all colors in the document', { pageId: { type: 'string', description: 'Page ID (omit for all)', required: false } }],
    ['analyzeTypography', 'Analyze typography usage', { pageId: { type: 'string', description: 'Page ID (omit for all)', required: false } }],
    ['analyzeSpacing', 'Analyze spacing and padding patterns', { pageId: { type: 'string', description: 'Page ID (omit for all)', required: false } }],
    ['analyzeClusters', 'Analyze visual clustering and grouping', { pageId: { type: 'string', description: 'Page ID (omit for all)', required: false } }],
    ['diffCreate', 'Create a visual diff between two states', { beforeSnapshot: { type: 'string', description: 'Before state JSON', required: true }, afterSnapshot: { type: 'string', description: 'After state JSON', required: true } }],
    ['diffShow', 'Display an existing diff', { diffId: { type: 'string', description: 'Diff ID', required: true } }],
  ];

  for (const [name, description, parameters] of analysisTools) {
    tools.push({ name, description, category: 'analysis', parameters, execute: wiredExecutor(name) });
  }

  return tools;
}

// Singleton tool list
let _registry: OPTool[] | null = null;

/**
 * Load the full 86-tool registry. Cached after first load.
 */
export async function loadToolRegistry(): Promise<OPTool[]> {
  if (!_registry) {
    _registry = buildToolDefinitions();
  }
  return _registry;
}

/**
 * Convert an OPTool to MCP-compatible format for LLM tool-calling.
 */
export function toolToMCPFormat(tool: OPTool): MCPToolDefinition {
  const properties: Record<string, { type: string; description: string; enum?: string[] }> = {};
  const required: string[] = [];

  for (const [paramName, param] of Object.entries(tool.parameters)) {
    properties[paramName] = {
      type: param.type === 'array' ? 'array' : param.type === 'object' ? 'object' : param.type,
      description: param.description,
      ...(param.enum && { enum: param.enum }),
    };
    if (param.required) {
      required.push(paramName);
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: 'object',
      properties,
      required,
    },
  };
}

/**
 * Get tools filtered by category.
 */
export async function getToolsByCategory(category: OPTool['category']): Promise<OPTool[]> {
  const registry = await loadToolRegistry();
  return registry.filter(t => t.category === category);
}

/**
 * Find a specific tool by name.
 */
export async function findTool(name: string): Promise<OPTool | undefined> {
  const registry = await loadToolRegistry();
  return registry.find(t => t.name === name);
}

/**
 * Get category-level summary for prompt building (avoids sending all 86 schemas).
 */
export async function getToolSummary(): Promise<Record<string, { count: number; tools: string[] }>> {
  const registry = await loadToolRegistry();
  const summary: Record<string, { count: number; tools: string[] }> = {};

  for (const tool of registry) {
    if (!summary[tool.category]) {
      summary[tool.category] = { count: 0, tools: [] };
    }
    summary[tool.category].count++;
    summary[tool.category].tools.push(tool.name);
  }

  return summary;
}
