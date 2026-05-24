import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCatalogIndex } from '../src/cli/commands/error-lookup.js';

describe('formatCatalogIndex', () => {
  it('produces a list grouped by category', () => {
    const text = formatCatalogIndex();
    // eslint-disable-next-line no-control-regex
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes('DanteForge Error Catalog'));
    assert.ok(stripped.includes('SETUP:'));
    assert.ok(stripped.includes('DF-SETUP-001'));
    assert.ok(stripped.includes('cataloged errors'));
  });

  it('filters by category when provided', () => {
    const text = formatCatalogIndex('setup');
    // eslint-disable-next-line no-control-regex
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes('SETUP:'));
    assert.ok(stripped.includes('DF-SETUP-001'));
    assert.ok(!stripped.includes('WORKFLOW:'), 'workflow section should be filtered out');
  });

  it('omits empty categories', () => {
    const text = formatCatalogIndex('workflow');
    // eslint-disable-next-line no-control-regex
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(!stripped.includes('SETUP:'), 'setup section should be omitted');
    assert.ok(stripped.includes('WORKFLOW:'));
  });
});
