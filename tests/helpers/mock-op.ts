// Mock .op file fixtures for testing — provides valid/invalid .op documents
// Used across op-codec, design-command, and visual-regression tests.

import type { OPDocument, OPNode } from '../../src/harvested/openpencil/op-codec.js';

/**
 * Create a minimal valid .op document for testing.
 */
export function createSimpleOP(): OPDocument {
  return {
    formatVersion: '1.0.0',
    generator: 'danteforge-test',
    created: '2026-03-12T00:00:00.000Z',
    document: {
      name: 'Test Design',
      pages: [
        {
          id: 'page-1',
          type: 'page',
          name: 'Main',
        },
      ],
    },
    nodes: [
      {
        id: 'frame-1',
        type: 'frame',
        name: 'Root Frame',
        width: 1440,
        height: 900,
        x: 0,
        y: 0,
        fills: [{ type: 'solid', color: '#FFFFFF' }],
        layoutMode: 'vertical',
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        children: [],
      },
    ],
    variableCollections: [],
  };
}

/**
 * Create a medium-complexity .op document with nested components.
 */
export function createMediumOP(): OPDocument {
  return {
    formatVersion: '1.0.0',
    generator: 'danteforge-test',
    created: '2026-03-12T00:00:00.000Z',
    document: {
      name: 'Login Page',
      pages: [
        { id: 'page-1', type: 'page', name: 'Login' },
      ],
    },
    nodes: [
      {
        id: 'frame-root',
        type: 'frame',
        name: 'Login Page',
        width: 1440,
        height: 900,
        x: 0,
        y: 0,
        fills: [{ type: 'solid', color: '#F9FAFB' }],
        layoutMode: 'vertical',
        layoutGap: 24,
        padding: { top: 64, right: 64, bottom: 64, left: 64 },
        children: [
          {
            id: 'header',
            type: 'frame',
            name: 'Header',
            width: 1312,
            height: 80,
            layoutMode: 'horizontal',
            padding: { top: 16, right: 24, bottom: 16, left: 24 },
            children: [
              {
                id: 'logo',
                type: 'text',
                name: 'Logo',
                characters: 'MyApp',
                fontSize: 24,
                fontFamily: 'Inter',
                fontWeight: 700,
                fills: [{ type: 'solid', color: '#111827' }],
              },
            ],
          },
          {
            id: 'login-card',
            type: 'frame',
            name: 'Login Card',
            width: 400,
            height: 480,
            fills: [{ type: 'solid', color: '#FFFFFF' }],
            cornerRadius: 12,
            layoutMode: 'vertical',
            layoutGap: 16,
            padding: { top: 32, right: 32, bottom: 32, left: 32 },
            effects: [{ type: 'drop-shadow', color: '#0000001A', radius: 16, offset: { x: 0, y: 4 } }],
            children: [
              {
                id: 'title',
                type: 'text',
                name: 'Title',
                characters: 'Sign In',
                fontSize: 28,
                fontFamily: 'Inter',
                fontWeight: 600,
                fills: [{ type: 'solid', color: '#111827' }],
              },
              {
                id: 'email-input',
                type: 'frame',
                name: 'Email Input',
                width: 336,
                height: 48,
                cornerRadius: 8,
                fills: [{ type: 'solid', color: '#FFFFFF' }],
                strokes: [{ type: 'solid', color: '#D1D5DB', weight: 1 }],
                padding: { top: 12, right: 16, bottom: 12, left: 16 },
              },
              {
                id: 'password-input',
                type: 'frame',
                name: 'Password Input',
                width: 336,
                height: 48,
                cornerRadius: 8,
                fills: [{ type: 'solid', color: '#FFFFFF' }],
                strokes: [{ type: 'solid', color: '#D1D5DB', weight: 1 }],
                padding: { top: 12, right: 16, bottom: 12, left: 16 },
              },
              {
                id: 'submit-btn',
                type: 'frame',
                name: 'Submit Button',
                width: 336,
                height: 48,
                cornerRadius: 8,
                fills: [{ type: 'solid', color: '#3B82F6' }],
                layoutMode: 'horizontal',
                padding: { top: 12, right: 24, bottom: 12, left: 24 },
                children: [
                  {
                    id: 'btn-text',
                    type: 'text',
                    name: 'Button Label',
                    characters: 'Sign In',
                    fontSize: 16,
                    fontFamily: 'Inter',
                    fontWeight: 600,
                    fills: [{ type: 'solid', color: '#FFFFFF' }],
                    textAlign: 'center',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    variableCollections: [
      {
        id: 'colors',
        name: 'Colors',
        variables: [
          { id: 'var-primary', name: 'primary', collection: 'colors', type: 'color', value: '#3B82F6' },
          { id: 'var-bg', name: 'background', collection: 'colors', type: 'color', value: '#F9FAFB' },
          { id: 'var-text', name: 'text-primary', collection: 'colors', type: 'color', value: '#111827' },
          { id: 'var-border', name: 'border', collection: 'colors', type: 'color', value: '#D1D5DB' },
        ],
      },
      {
        id: 'spacing',
        name: 'Spacing',
        variables: [
          { id: 'var-sp-sm', name: 'spacing-sm', collection: 'spacing', type: 'number', value: 8 },
          { id: 'var-sp-md', name: 'spacing-md', collection: 'spacing', type: 'number', value: 16 },
          { id: 'var-sp-lg', name: 'spacing-lg', collection: 'spacing', type: 'number', value: 24 },
          { id: 'var-sp-xl', name: 'spacing-xl', collection: 'spacing', type: 'number', value: 32 },
        ],
      },
    ],
  };
}

/**
 * Create a complex .op document with many nodes.
 */
export function createComplexOP(): OPDocument {
  const medium = createMediumOP();
  // Add more pages and nodes to simulate a complex project
  medium.document.name = 'Full Application';
  medium.document.pages.push(
    { id: 'page-2', type: 'page', name: 'Dashboard' },
    { id: 'page-3', type: 'page', name: 'Settings' },
  );

  // Add more nodes
  const dashboardFrame: OPNode = {
    id: 'frame-dashboard',
    type: 'frame',
    name: 'Dashboard',
    width: 1440,
    height: 900,
    layoutMode: 'vertical',
    layoutGap: 16,
    padding: { top: 24, right: 24, bottom: 24, left: 24 },
    children: Array.from({ length: 10 }, (_, i) => ({
      id: `widget-${i}`,
      type: 'frame' as const,
      name: `Widget ${i + 1}`,
      width: 300,
      height: 200,
      fills: [{ type: 'solid' as const, color: '#FFFFFF' }],
      cornerRadius: 8,
    })),
  };

  medium.nodes.push(dashboardFrame);
  return medium;
}

/**
 * Create a malformed .op document (missing required fields).
 */
export function createMalformedOP(): Record<string, unknown> {
  return {
    formatVersion: '1.0.0',
    // Missing: document, nodes
    metadata: { broken: true },
  };
}

/**
 * Create an .op document with spacing violations (not on 4px grid).
 */
export function createBadSpacingOP(): OPDocument {
  const doc = createSimpleOP();
  doc.nodes[0].padding = { top: 13, right: 7, bottom: 15, left: 9 }; // All violate 4px grid
  return doc;
}

/**
 * Create an .op document with invalid colors.
 */
export function createBadColorsOP(): OPDocument {
  const doc = createSimpleOP();
  doc.nodes[0].fills = [{ type: 'solid', color: 'not-a-color' }];
  return doc;
}

/**
 * Get the JSON string of a simple .op document.
 */
export function getSimpleOPString(): string {
  return JSON.stringify(createSimpleOP(), null, 2);
}

/**
 * Get the JSON string of a medium .op document.
 */
export function getMediumOPString(): string {
  return JSON.stringify(createMediumOP(), null, 2);
}
