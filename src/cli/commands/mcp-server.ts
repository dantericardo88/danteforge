import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { startMcpServer, type McpServerDeps } from '../../core/mcp-server.js';

export interface McpServerCommandOptions {
  _startMcpServer?: (deps?: McpServerDeps) => Promise<void>;
}

export async function mcpServer(options: McpServerCommandOptions = {}): Promise<void> {
  return withErrorBoundary('mcp-server', async () => {
    const fn = options._startMcpServer ?? startMcpServer;
    await fn({});
  });
}
