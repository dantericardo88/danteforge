import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { createAndStartMCPServer } from '../../core/mcp-server.js';

export interface McpServerCommandOptions {
  _startMcpServer?: () => Promise<void>;
}

export async function mcpServer(options: McpServerCommandOptions = {}): Promise<void> {
  return withErrorBoundary('mcp-server', async () => {
    const fn = options._startMcpServer ?? createAndStartMCPServer;
    await fn();
  });
}
