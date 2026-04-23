import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAdminCockpitDocument } from '../src/core/canvas-admin-seed.js';
import { scoreCanvasQuality } from '../src/core/canvas-quality-scorer.js';

describe('getAdminCockpitDocument', () => {
  it('returns a valid OPDocument with correct structure', () => {
    const doc = getAdminCockpitDocument();
    assert.equal(doc.formatVersion, '1.0.0');
    assert.equal(doc.generator, 'danteforge/canvas-admin-seed');
    assert.ok(doc.created);
    assert.ok(doc.nodes.length > 0);
  });

  it('uses custom projectName in document and root node', () => {
    const doc = getAdminCockpitDocument({ projectName: 'MyApp' });
    assert.equal(doc.document.name, 'MyApp Admin Cockpit');
    const root = doc.nodes[0];
    assert.equal(root.name, 'MyApp Admin');
  });

  it('root frame has horizontal layout (sidebar + main)', () => {
    const doc = getAdminCockpitDocument();
    const root = doc.nodes[0];
    assert.equal(root.layoutMode, 'horizontal');
    assert.equal(root.children?.length, 2);
  });

  it('sidebar has correct project logo text', () => {
    const doc = getAdminCockpitDocument({ projectName: 'AdminTest' });
    const root = doc.nodes[0];
    const sidebar = root.children?.[0];
    assert.ok(sidebar);
    const logo = sidebar.children?.find((n) => n.name === 'Logo');
    assert.ok(logo);
    assert.equal(logo.characters, 'AdminTest');
  });

  it('approval queue contains pending, approved, and vetoed cards', () => {
    const doc = getAdminCockpitDocument();
    const root = doc.nodes[0];
    const main = root.children?.[1];
    const adminRow = main?.children?.find((n) => n.name === 'AdminRow');
    const queue = adminRow?.children?.find((n) => n.name === 'ApprovalQueue');
    assert.ok(queue);
    const cards = queue.children?.filter((n) => n.name === 'ApprovalCard') ?? [];
    assert.equal(cards.length, 3);
  });

  it('pending approval card has Approve and Veto buttons', () => {
    const doc = getAdminCockpitDocument();
    const root = doc.nodes[0];
    const main = root.children?.[1];
    const adminRow = main?.children?.find((n) => n.name === 'AdminRow');
    const queue = adminRow?.children?.find((n) => n.name === 'ApprovalQueue');
    const pendingCard = queue?.children?.find((n) => n.name === 'ApprovalCard');
    assert.ok(pendingCard);
    const approveBtn = pendingCard.children?.find((n) => n.name === 'btn-approve');
    const vetoBtn = pendingCard.children?.find((n) => n.name === 'btn-veto');
    assert.ok(approveBtn, 'pending card should have approve button');
    assert.ok(vetoBtn, 'pending card should have veto button');
  });

  it('policy panel contains policy config rows', () => {
    const doc = getAdminCockpitDocument();
    const root = doc.nodes[0];
    const main = root.children?.[1];
    const adminRow = main?.children?.find((n) => n.name === 'AdminRow');
    const policyPanel = adminRow?.children?.find((n) => n.name === 'PolicyPanel');
    assert.ok(policyPanel);
    const rows = policyPanel.children?.filter((n) => n.name === 'PolicyRow') ?? [];
    assert.ok(rows.length >= 3, 'should have at least 3 policy rows');
  });

  it('audit log contains audit trail entries', () => {
    const doc = getAdminCockpitDocument();
    const root = doc.nodes[0];
    const main = root.children?.[1];
    const auditLog = main?.children?.find((n) => n.name === 'AuditLog');
    assert.ok(auditLog);
    const rows = auditLog.children?.filter((n) => n.name === 'AuditRow') ?? [];
    assert.ok(rows.length >= 2, 'should have at least 2 audit rows');
  });

  it('has variable collections for colors and spacing', () => {
    const doc = getAdminCockpitDocument();
    assert.ok(doc.variableCollections);
    const names = doc.variableCollections?.map((c) => c.name) ?? [];
    assert.ok(names.includes('Admin Colors'), 'should have Admin Colors collection');
    assert.ok(names.includes('Admin Spacing'), 'should have Admin Spacing collection');
  });

  it('uses custom primaryColor in fills', () => {
    const doc = getAdminCockpitDocument({ primaryColor: '#123456' });
    const root = doc.nodes[0];
    const sidebar = root.children?.[0];
    const sidebarFill = sidebar?.fills?.[0];
    assert.ok(sidebarFill);
    assert.equal(sidebarFill.color, '#123456');
  });

  it('scores composite >= 90 with canvas quality scorer', () => {
    const doc = getAdminCockpitDocument();
    const result = scoreCanvasQuality(doc);
    assert.ok(result.composite >= 90, `composite ${result.composite} should be >= 90`);
  });

  it('default options produce a complete document without errors', () => {
    assert.doesNotThrow(() => getAdminCockpitDocument());
    assert.doesNotThrow(() => getAdminCockpitDocument({ projectName: 'Test' }));
    assert.doesNotThrow(() => getAdminCockpitDocument({ primaryColor: '#FF0000', accentColor: '#00FF00' }));
  });
});
