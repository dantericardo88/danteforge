// OpenPencil .op Codec — Read/write/validate/diff .op JSON design files
// The .op format is a pure JSON serialization of the complete scene graph,
// variable collections, and component logic — fully version-controllable.

/**
 * A node in the .op scene graph — represents any visual element.
 */
export interface OPNode {
  id: string;
  type: 'frame' | 'rectangle' | 'ellipse' | 'text' | 'group' | 'component' | 'instance' | 'vector' | 'line' | 'page';
  name: string;
  visible?: boolean;
  locked?: boolean;
  children?: OPNode[];
  // Layout properties
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  // Style properties
  fills?: OPFill[];
  strokes?: OPStroke[];
  opacity?: number;
  cornerRadius?: number;
  // Layout constraints
  layoutMode?: 'none' | 'horizontal' | 'vertical';
  layoutAlign?: 'min' | 'center' | 'max' | 'stretch';
  layoutGap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  // Text properties (type === 'text')
  characters?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  lineHeight?: number | 'auto';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  // Constraints
  constraints?: { horizontal: 'min' | 'center' | 'max' | 'stretch' | 'scale'; vertical: 'min' | 'center' | 'max' | 'stretch' | 'scale' };
  // Effects
  effects?: OPEffect[];
}

export interface OPFill {
  type: 'solid' | 'gradient-linear' | 'gradient-radial' | 'image';
  color?: string; // hex
  opacity?: number;
  visible?: boolean;
}

export interface OPStroke {
  type: 'solid';
  color: string;
  weight: number;
  opacity?: number;
  position?: 'inside' | 'outside' | 'center';
}

export interface OPEffect {
  type: 'drop-shadow' | 'inner-shadow' | 'blur' | 'background-blur';
  visible?: boolean;
  color?: string;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

/**
 * A design variable (design token) in the .op format.
 */
export interface OPVariable {
  id: string;
  name: string;
  collection: string;
  type: 'color' | 'number' | 'string' | 'boolean';
  value: string | number | boolean;
  description?: string;
}

/**
 * A variable collection grouping related tokens.
 */
export interface OPVariableCollection {
  id: string;
  name: string;
  variables: OPVariable[];
}

/**
 * The complete .op document structure.
 */
export interface OPDocument {
  formatVersion: string;
  generator: string;
  created: string;
  modified?: string;
  document: {
    name: string;
    pages: OPNode[];
  };
  nodes: OPNode[];
  variableCollections?: OPVariableCollection[];
  metadata?: Record<string, unknown>;
}

/**
 * A diff entry describing a change between two .op documents.
 */
export interface OPDiffEntry {
  path: string;
  type: 'added' | 'removed' | 'modified';
  oldValue?: unknown;
  newValue?: unknown;
}

export interface OPDiff {
  entries: OPDiffEntry[];
  summary: {
    added: number;
    removed: number;
    modified: number;
  };
}

export interface OPValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const CURRENT_FORMAT_VERSION = '1.0.0';
const MAX_OP_FILE_SIZE = 2 * 1024 * 1024; // 2MB hard limit
const WARN_OP_FILE_SIZE = 500 * 1024;      // 500KB warning threshold

/**
 * Parse a raw JSON string into a typed OPDocument.
 * Throws on invalid JSON.
 */
export function parseOP(content: string): OPDocument {
  if (content.length > MAX_OP_FILE_SIZE) {
    throw new Error(`.op file exceeds maximum size of ${MAX_OP_FILE_SIZE / 1024 / 1024}MB`);
  }

  const parsed = JSON.parse(content);

  // Ensure minimum required structure
  if (!parsed.document || !parsed.nodes) {
    throw new Error('Invalid .op file: missing required "document" and "nodes" fields');
  }

  // Apply defaults for missing fields
  return {
    formatVersion: parsed.formatVersion ?? CURRENT_FORMAT_VERSION,
    generator: parsed.generator ?? 'unknown',
    created: parsed.created ?? new Date().toISOString(),
    modified: parsed.modified,
    document: parsed.document,
    nodes: parsed.nodes,
    variableCollections: parsed.variableCollections,
    metadata: parsed.metadata,
  };
}

/**
 * Serialize an OPDocument to a deterministic JSON string.
 * Uses consistent indentation and key ordering for Git-friendly diffs.
 */
export function stringifyOP(doc: OPDocument): string {
  const output = {
    formatVersion: doc.formatVersion,
    generator: doc.generator,
    created: doc.created,
    modified: new Date().toISOString(),
    document: doc.document,
    nodes: doc.nodes,
    ...(doc.variableCollections && { variableCollections: doc.variableCollections }),
    ...(doc.metadata && { metadata: doc.metadata }),
  };
  return JSON.stringify(output, null, 2);
}

/**
 * Validate an OPDocument for structural correctness.
 * Returns errors (blocking) and warnings (informational).
 */
export function validateOP(doc: OPDocument): OPValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!doc.formatVersion) errors.push('Missing formatVersion');
  if (!doc.document) errors.push('Missing document');
  if (!doc.nodes) errors.push('Missing nodes');
  if (!doc.document?.name) errors.push('Missing document.name');
  if (!Array.isArray(doc.document?.pages)) errors.push('document.pages must be an array');
  if (!Array.isArray(doc.nodes)) errors.push('nodes must be an array');

  // Validate nodes recursively
  if (Array.isArray(doc.nodes)) {
    validateNodes(doc.nodes, 'nodes', errors, warnings);
  }

  // Validate variable collections
  if (doc.variableCollections) {
    if (!Array.isArray(doc.variableCollections)) {
      errors.push('variableCollections must be an array');
    } else {
      for (const collection of doc.variableCollections) {
        if (!collection.id) errors.push(`Variable collection missing id`);
        if (!collection.name) errors.push(`Variable collection missing name`);
        if (!Array.isArray(collection.variables)) {
          errors.push(`Variable collection "${collection.name}" has non-array variables`);
        }
      }
    }
  }

  // Size warning
  const size = stringifyOP(doc).length;
  if (size > WARN_OP_FILE_SIZE) {
    warnings.push(`File size (${(size / 1024).toFixed(1)}KB) exceeds recommended limit (${WARN_OP_FILE_SIZE / 1024}KB)`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateNodes(nodes: OPNode[], path: string, errors: string[], warnings: string[]): void {
  const validTypes = ['frame', 'rectangle', 'ellipse', 'text', 'group', 'component', 'instance', 'vector', 'line', 'page'];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nodePath = `${path}[${i}]`;

    if (!node.id) errors.push(`${nodePath}: missing id`);
    if (!node.type) errors.push(`${nodePath}: missing type`);
    else if (!validTypes.includes(node.type)) {
      errors.push(`${nodePath}: invalid type "${node.type}"`);
    }
    if (!node.name) warnings.push(`${nodePath}: missing name`);

    // Validate fills
    if (node.fills) {
      for (const fill of node.fills) {
        if (fill.type === 'solid' && fill.color && !/^#[0-9a-fA-F]{3,8}$/.test(fill.color)) {
          errors.push(`${nodePath}: invalid fill color "${fill.color}" (expected hex)`);
        }
      }
    }

    // Validate spacing for grid alignment (8-point grid)
    if (node.padding) {
      const { top, right, bottom, left } = node.padding;
      for (const [side, val] of Object.entries({ top, right, bottom, left })) {
        if (typeof val === 'number' && val > 0 && val % 4 !== 0) {
          warnings.push(`${nodePath}: padding.${side} (${val}px) not aligned to 4px grid`);
        }
      }
    }

    // Recurse into children
    if (node.children && Array.isArray(node.children)) {
      validateNodes(node.children, `${nodePath}.children`, errors, warnings);
    }
  }
}

/**
 * Compute a structured diff between two OPDocuments.
 */
export function diffOP(a: OPDocument, b: OPDocument): OPDiff {
  const entries: OPDiffEntry[] = [];

  // Compare top-level fields
  if (a.document.name !== b.document.name) {
    entries.push({ path: 'document.name', type: 'modified', oldValue: a.document.name, newValue: b.document.name });
  }

  // Compare nodes by id
  const aNodeMap = buildNodeMap(a.nodes);
  const bNodeMap = buildNodeMap(b.nodes);

  for (const [id, nodeA] of aNodeMap) {
    const nodeB = bNodeMap.get(id);
    if (!nodeB) {
      entries.push({ path: `nodes/${id}`, type: 'removed', oldValue: nodeA.name });
    } else {
      // Check for property changes
      diffNodeProperties(nodeA, nodeB, `nodes/${id}`, entries);
    }
  }

  for (const [id, nodeB] of bNodeMap) {
    if (!aNodeMap.has(id)) {
      entries.push({ path: `nodes/${id}`, type: 'added', newValue: nodeB.name });
    }
  }

  // Compare variable collections
  const aVars = new Map((a.variableCollections ?? []).map(c => [c.id, c]));
  const bVars = new Map((b.variableCollections ?? []).map(c => [c.id, c]));

  for (const [id] of aVars) {
    if (!bVars.has(id)) {
      entries.push({ path: `variableCollections/${id}`, type: 'removed' });
    }
  }
  for (const [id] of bVars) {
    if (!aVars.has(id)) {
      entries.push({ path: `variableCollections/${id}`, type: 'added' });
    }
  }

  return {
    entries,
    summary: {
      added: entries.filter(e => e.type === 'added').length,
      removed: entries.filter(e => e.type === 'removed').length,
      modified: entries.filter(e => e.type === 'modified').length,
    },
  };
}

function buildNodeMap(nodes: OPNode[]): Map<string, OPNode> {
  const map = new Map<string, OPNode>();

  function walk(nodeList: OPNode[]) {
    for (const node of nodeList) {
      if (node.id) map.set(node.id, node);
      if (node.children) walk(node.children);
    }
  }

  walk(nodes);
  return map;
}

function diffNodeProperties(a: OPNode, b: OPNode, basePath: string, entries: OPDiffEntry[]): void {
  const keys: (keyof OPNode)[] = ['name', 'type', 'x', 'y', 'width', 'height', 'opacity', 'visible', 'layoutMode', 'layoutGap', 'fontSize', 'fontFamily', 'characters'];

  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      entries.push({ path: `${basePath}.${key}`, type: 'modified', oldValue: a[key], newValue: b[key] });
    }
  }
}

/**
 * Create a minimal skeleton .op document for fallback/template generation.
 */
export function createSkeletonOP(projectName: string, pageName = 'Main'): OPDocument {
  const pageId = `page-${Date.now()}`;
  const rootFrameId = `frame-${Date.now()}`;

  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    generator: 'danteforge/0.9.2',
    created: new Date().toISOString(),
    document: {
      name: projectName,
      pages: [
        {
          id: pageId,
          type: 'page',
          name: pageName,
          children: [],
        },
      ],
    },
    nodes: [
      {
        id: rootFrameId,
        type: 'frame',
        name: `${projectName} - ${pageName}`,
        width: 1440,
        height: 900,
        x: 0,
        y: 0,
        fills: [{ type: 'solid', color: '#FFFFFF' }],
        layoutMode: 'vertical',
        layoutGap: 0,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [],
      },
    ],
    variableCollections: [],
    metadata: { createdBy: 'danteforge', purpose: 'skeleton' },
  };
}
