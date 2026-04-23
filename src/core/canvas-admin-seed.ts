// canvas-admin-seed — enterprise admin cockpit design template.
// Uses the same taste-engine helpers as canvas-defaults but targets
// an admin dashboard: policy viewer, approval queue, audit log.

import type { OPDocument, OPNode, OPVariableCollection } from '../harvested/openpencil/op-codec.js';

export interface AdminSeedOptions {
  projectName?: string;
  primaryColor?: string;
  accentColor?: string;
  dangerColor?: string;
  fontHeading?: string;
  fontBody?: string;
}

interface AdminPalette {
  primary: string; accent: string; danger: string; surface: string;
  textPrimary: string; textMuted: string; border: string; success: string;
  fontHeading: string; fontBody: string;
}

function buildStatusBadge(id: string, label: string, color: string, p: AdminPalette): OPNode {
  return {
    id, type: 'frame', name: 'StatusBadge', width: 80, height: 24, cornerRadius: 12,
    fills: [{ type: 'solid', color }],
    children: [{ id: `${id}t`, type: 'text', name: 'BadgeLabel', characters: label, fontSize: 11, fontFamily: p.fontBody, fontWeight: 600, fills: [{ type: 'solid', color: '#FFFFFF' }] }],
  };
}

function buildApprovalCard(id: string, cmd: string, status: 'pending' | 'approved' | 'vetoed', p: AdminPalette): OPNode {
  const statusColor = status === 'pending' ? p.accent : status === 'approved' ? p.success : p.danger;
  return {
    id, type: 'frame', name: 'ApprovalCard', width: 480, height: 96, cornerRadius: 8,
    fills: [{ type: 'solid', color: '#FFFFFF' }],
    strokes: [{ type: 'solid', color: status === 'pending' ? p.accent : p.border, weight: status === 'pending' ? 2 : 1 }],
    children: [
      { id: `${id}cmd`, type: 'text' as const, name: 'CommandName', characters: cmd, fontSize: 14, fontFamily: p.fontBody, fontWeight: 600, fills: [{ type: 'solid' as const, color: p.textPrimary }] },
      buildStatusBadge(`${id}badge`, status.toUpperCase(), statusColor, p),
      ...(status === 'pending' ? [
        { id: `${id}approve`, type: 'frame' as const, name: 'btn-approve', width: 80, height: 32, cornerRadius: 6, fills: [{ type: 'solid' as const, color: p.success }], children: [{ id: `${id}at`, type: 'text' as const, name: 'BtnLabel', characters: 'Approve', fontSize: 12, fontFamily: p.fontBody, fontWeight: 600, fills: [{ type: 'solid' as const, color: '#FFFFFF' }] }] },
        { id: `${id}veto`, type: 'frame' as const, name: 'btn-veto', width: 80, height: 32, cornerRadius: 6, fills: [{ type: 'solid' as const, color: p.danger }], children: [{ id: `${id}vt`, type: 'text' as const, name: 'BtnLabel', characters: 'Veto', fontSize: 12, fontFamily: p.fontBody, fontWeight: 600, fills: [{ type: 'solid' as const, color: '#FFFFFF' }] }] },
      ] as OPNode[] : []),
    ],
  };
}

function buildPolicyPanel(p: AdminPalette): OPNode {
  return {
    id: 'policy-panel', type: 'frame', name: 'PolicyPanel',
    width: 320, height: 580, cornerRadius: 12,
    layoutMode: 'vertical', layoutGap: 16,
    padding: { top: 24, right: 20, bottom: 24, left: 20 },
    fills: [{ type: 'solid', color: '#FFFFFF' }],
    strokes: [{ type: 'solid', color: p.border, weight: 1 }],
    children: [
      { id: 'poltitle', type: 'text', name: 'PanelTitle', characters: 'Policy Config', fontSize: 16, fontFamily: p.fontHeading, fontWeight: 700, fills: [{ type: 'solid', color: p.textPrimary }] },
      { id: 'selfed', type: 'text', name: 'PolicyRow', characters: 'selfEditPolicy: deny', fontSize: 13, fontFamily: p.fontBody, fontWeight: 400, fills: [{ type: 'solid', color: p.textMuted }] },
      { id: 'reqapp', type: 'text', name: 'PolicyRow', characters: 'requireApproval: forge, autoforge', fontSize: 13, fontFamily: p.fontBody, fontWeight: 400, fills: [{ type: 'solid', color: p.textMuted }] },
      { id: 'teamid', type: 'text', name: 'PolicyRow', characters: 'teamId: null', fontSize: 13, fontFamily: p.fontBody, fontWeight: 400, fills: [{ type: 'solid', color: p.textMuted }] },
      { id: 'bypass', type: 'text', name: 'PolicyRow', characters: 'bypassUntil: null', fontSize: 13, fontFamily: p.fontBody, fontWeight: 400, fills: [{ type: 'solid', color: p.textMuted }] },
    ],
  };
}

function buildApprovalQueue(p: AdminPalette): OPNode {
  return {
    id: 'approval-queue', type: 'frame', name: 'ApprovalQueue',
    width: 520, height: 580, cornerRadius: 12,
    layoutMode: 'vertical', layoutGap: 12,
    padding: { top: 24, right: 20, bottom: 24, left: 20 },
    fills: [{ type: 'solid', color: '#FFFFFF' }],
    strokes: [{ type: 'solid', color: p.border, weight: 1 }],
    children: [
      { id: 'qtitle', type: 'text', name: 'PanelTitle', characters: 'Approval Queue', fontSize: 16, fontFamily: p.fontHeading, fontWeight: 700, fills: [{ type: 'solid', color: p.textPrimary }] },
      buildApprovalCard('card1', 'forge 1 --profile quality', 'pending', p),
      buildApprovalCard('card2', 'autoforge --auto', 'approved', p),
      buildApprovalCard('card3', 'party --isolation', 'vetoed', p),
    ],
  };
}

function buildAuditLog(p: AdminPalette): OPNode {
  const rows = ['forge 1 — approved — 14:23:05', 'autoforge — vetoed — 14:20:11', 'assess — allowed — 14:18:44', 'design --seed — allowed — 14:15:02'];
  return {
    id: 'audit-log', type: 'frame', name: 'AuditLog',
    width: 520, height: 260, cornerRadius: 12,
    layoutMode: 'vertical', layoutGap: 8,
    padding: { top: 20, right: 20, bottom: 20, left: 20 },
    fills: [{ type: 'solid', color: p.primary }],
    children: [
      { id: 'audittitle', type: 'text', name: 'PanelTitle', characters: 'Audit Trail', fontSize: 14, fontFamily: p.fontHeading, fontWeight: 700, fills: [{ type: 'solid', color: '#FFFFFF' }] },
      ...rows.map((row, i): OPNode => ({ id: `arow${i}`, type: 'text', name: 'AuditRow', characters: row, fontSize: 12, fontFamily: p.fontBody, fontWeight: 400, fills: [{ type: 'solid' as const, color: '#C8C8E8' }] })),
    ],
  };
}

function buildAdminMain(p: AdminPalette): OPNode {
  return {
    id: 'admin-main', type: 'frame', name: 'AdminMain',
    width: 1200, height: 900, layoutMode: 'vertical', layoutGap: 24,
    padding: { top: 40, right: 48, bottom: 40, left: 48 },
    fills: [{ type: 'solid', color: p.surface }],
    constraints: { horizontal: 'stretch', vertical: 'stretch' },
    children: [
      {
        id: 'admin-header', type: 'frame', name: 'AdminHeader',
        layoutMode: 'horizontal', layoutGap: 0, height: 64, width: 1104, fills: [],
        children: [
          { id: 'admintitle', type: 'text', name: 'PageTitle', characters: 'Admin Cockpit', fontSize: 28, fontFamily: p.fontHeading, fontWeight: 700, fills: [{ type: 'solid', color: p.textPrimary }], constraints: { horizontal: 'stretch', vertical: 'center' } },
          { id: 'adminsubtitle', type: 'text', name: 'Subtitle', characters: 'Policy · Approvals · Audit', fontSize: 13, fontFamily: p.fontBody, fontWeight: 400, fills: [{ type: 'solid', color: p.textMuted }] },
        ],
      },
      {
        id: 'admin-row', type: 'frame', name: 'AdminRow',
        layoutMode: 'horizontal', layoutGap: 24, height: 580, width: 1104, fills: [],
        children: [buildPolicyPanel(p), buildApprovalQueue(p)],
      },
      buildAuditLog(p),
    ],
  };
}

function buildAdminSidebar(projectName: string, p: AdminPalette): OPNode {
  return {
    id: 'admin-sidebar', type: 'frame', name: 'AdminSidebar',
    width: 240, height: 900, layoutMode: 'vertical', layoutGap: 8,
    padding: { top: 32, right: 16, bottom: 32, left: 16 },
    fills: [{ type: 'solid', color: p.primary }],
    constraints: { horizontal: 'min', vertical: 'stretch' },
    children: [
      { id: 'admin-logo', type: 'text', name: 'Logo', characters: projectName, fontSize: 20, fontFamily: p.fontHeading, fontWeight: 700, fills: [{ type: 'solid', color: p.accent }] },
      {
        id: 'admin-nav', type: 'frame', name: 'AdminNav',
        layoutMode: 'vertical', layoutGap: 4, width: 208, height: 240, fills: [],
        children: [
          { id: 'nav-cockpit', type: 'frame', name: 'btn-nav', width: 208, height: 44, cornerRadius: 8, fills: [{ type: 'solid', color: p.accent }], children: [{ id: 'nc-t', type: 'text', name: 'NavLabel', characters: 'Cockpit', fontSize: 14, fontFamily: p.fontBody, fontWeight: 600, fills: [{ type: 'solid', color: p.primary }] }] },
          { id: 'nav-policy', type: 'frame', name: 'btn-nav', width: 208, height: 44, cornerRadius: 8, fills: [], children: [{ id: 'np-t', type: 'text', name: 'NavLabel', characters: 'Policy', fontSize: 14, fontFamily: p.fontBody, fontWeight: 400, fills: [{ type: 'solid', color: '#C8B8E8' }] }] },
          { id: 'nav-audit', type: 'frame', name: 'btn-nav', width: 208, height: 44, cornerRadius: 8, fills: [], children: [{ id: 'na-t', type: 'text', name: 'NavLabel', characters: 'Audit Log', fontSize: 14, fontFamily: p.fontBody, fontWeight: 400, fills: [{ type: 'solid', color: '#C8B8E8' }] }] },
          { id: 'nav-team', type: 'frame', name: 'btn-nav', width: 208, height: 44, cornerRadius: 8, fills: [], children: [{ id: 'nt-t', type: 'text', name: 'NavLabel', characters: 'Team', fontSize: 14, fontFamily: p.fontBody, fontWeight: 400, fills: [{ type: 'solid', color: '#C8B8E8' }] }] },
        ],
      },
    ],
  };
}

function buildAdminTokens(p: AdminPalette): OPVariableCollection[] {
  return [
    {
      id: 'admin-colors', name: 'Admin Colors',
      variables: [
        { id: 'ac1', name: 'bg-primary', collection: 'admin-colors', type: 'color', value: p.primary },
        { id: 'ac2', name: 'accent', collection: 'admin-colors', type: 'color', value: p.accent },
        { id: 'ac3', name: 'danger', collection: 'admin-colors', type: 'color', value: p.danger },
        { id: 'ac4', name: 'success', collection: 'admin-colors', type: 'color', value: p.success },
        { id: 'ac5', name: 'surface', collection: 'admin-colors', type: 'color', value: p.surface },
        { id: 'ac6', name: 'text-primary', collection: 'admin-colors', type: 'color', value: p.textPrimary },
        { id: 'ac7', name: 'text-muted', collection: 'admin-colors', type: 'color', value: p.textMuted },
        { id: 'ac8', name: 'border', collection: 'admin-colors', type: 'color', value: p.border },
      ],
    },
    {
      id: 'admin-spacing', name: 'Admin Spacing',
      variables: [
        { id: 'as1', name: 'space-xs', collection: 'admin-spacing', type: 'number', value: 4 },
        { id: 'as2', name: 'space-sm', collection: 'admin-spacing', type: 'number', value: 8 },
        { id: 'as3', name: 'space-md', collection: 'admin-spacing', type: 'number', value: 16 },
        { id: 'as4', name: 'space-lg', collection: 'admin-spacing', type: 'number', value: 24 },
        { id: 'as5', name: 'space-xl', collection: 'admin-spacing', type: 'number', value: 40 },
        { id: 'as6', name: 'space-2xl', collection: 'admin-spacing', type: 'number', value: 48 },
      ],
    },
  ];
}

export function getAdminCockpitDocument(options: AdminSeedOptions = {}): OPDocument {
  const {
    projectName = 'Admin',
    primaryColor = '#0F172A',
    accentColor = '#6366F1',
    dangerColor = '#EF4444',
    fontHeading = 'Inter',
    fontBody = 'JetBrains Mono',
  } = options;

  const p: AdminPalette = {
    primary: primaryColor, accent: accentColor, danger: dangerColor,
    surface: '#F8FAFC', textPrimary: '#0F172A', textMuted: '#64748B',
    border: '#E2E8F0', success: '#22C55E',
    fontHeading, fontBody,
  };

  return {
    formatVersion: '1.0.0',
    generator: 'danteforge/canvas-admin-seed',
    created: new Date().toISOString(),
    document: { name: `${projectName} Admin Cockpit`, pages: [] },
    nodes: [{
      id: 'admin-root', type: 'frame', name: `${projectName} Admin`,
      width: 1440, height: 900, layoutMode: 'horizontal', layoutGap: 0,
      fills: [{ type: 'solid', color: p.surface }],
      constraints: { horizontal: 'stretch', vertical: 'stretch' },
      children: [buildAdminSidebar(projectName, p), buildAdminMain(p)],
    }],
    variableCollections: buildAdminTokens(p),
  };
}
