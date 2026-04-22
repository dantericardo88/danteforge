import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

export interface CompatibilityCheck {
  tool: string;
  version: string;
  compatible: boolean;
  issues: string[];
  recommendations: string[];
}

export async function checkToolCompatibility(): Promise<CompatibilityCheck[]> {
  const checks: CompatibilityCheck[] = [];

  // Check Claude Code compatibility
  checks.push(await checkClaudeCodeCompatibility());

  // Check Cursor compatibility
  checks.push(await checkCursorCompatibility());

  // Check Windsurf compatibility
  checks.push(await checkWindsurfCompatibility());

  // Check Codex compatibility
  checks.push(await checkCodexCompatibility());

  return checks;
}

async function checkClaudeCodeCompatibility(): Promise<CompatibilityCheck> {
  const check: CompatibilityCheck = {
    tool: 'Claude Code',
    version: 'latest',
    compatible: false,
    issues: [],
    recommendations: []
  };

  try {
    // Check if MCP server can be started
    const mcpServer = await import('../core/mcp-server.js');
    if (mcpServer) {
      check.compatible = true;
    }
  } catch (error) {
    check.issues.push('MCP server import failed');
    check.recommendations.push('Ensure MCP server is properly implemented');
  }

  return check;
}

async function checkCursorCompatibility(): Promise<CompatibilityCheck> {
  const check: CompatibilityCheck = {
    tool: 'Cursor',
    version: 'latest',
    compatible: false,
    issues: [],
    recommendations: []
  };

  try {
    // Check VS Code extension
    const extPath = path.join(process.cwd(), 'vscode-extension');
    await fs.access(extPath);
    check.compatible = true;
  } catch {
    check.issues.push('VS Code extension not found');
    check.recommendations.push('Ensure vscode-extension directory exists');
  }

  return check;
}

async function checkWindsurfCompatibility(): Promise<CompatibilityCheck> {
  const check: CompatibilityCheck = {
    tool: 'Windsurf',
    version: 'latest',
    compatible: true, // Assume compatible for now
    issues: [],
    recommendations: []
  };

  // Windsurf uses similar MCP protocol
  check.recommendations.push('Test MCP integration with Windsurf');

  return check;
}

async function checkCodexCompatibility(): Promise<CompatibilityCheck> {
  const check: CompatibilityCheck = {
    tool: 'Codex',
    version: 'latest',
    compatible: true, // Assume compatible for now
    issues: [],
    recommendations: []
  };

  // Codex uses MCP protocol
  check.recommendations.push('Test MCP integration with Codex');

  return check;
}