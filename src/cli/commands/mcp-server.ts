// CLI command — starts the DanteForge MCP tool server over stdio
import { logger } from '../../core/logger.js';

export async function mcpServer(): Promise<void> {
  try {
    const { createAndStartMCPServer } = await import('../../core/mcp-server.js');
    await createAndStartMCPServer();
  } catch (err) {
    logger.error(`Failed to start MCP server: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.message.includes('Cannot find module')) {
      logger.info('Install @modelcontextprotocol/sdk: npm install @modelcontextprotocol/sdk');
    }
    process.exit(1);
  }
}
