import { createMcpServer, type McpServerDeps } from '../../src/core/mcp-server.js';

export interface AgentSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  callTool(name: string, args?: Record<string, unknown>): Promise<string>;
}

export function createAgentSession(deps: McpServerDeps = {}): AgentSession {
  const server = createMcpServer(deps);
  let reqId = 1;

  return {
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      const id = reqId++;
      const line = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      const response = await server.handleRequest(line, deps);
      if ('error' in response && response.error) {
        throw new Error(`JSON-RPC error ${response.error.code}: ${response.error.message}`);
      }
      return (response as { result?: unknown }).result;
    },

    async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
      const id = reqId++;
      const line = JSON.stringify({
        jsonrpc: '2.0', id,
        method: 'tools/call',
        params: { name, arguments: args },
      });
      const response = await server.handleRequest(line, deps);
      const result = (response as { result?: { isError?: boolean; content?: Array<{ text?: string }> } }).result;
      if (result?.isError) throw new Error(`Tool error: ${result?.content?.[0]?.text}`);
      return result?.content?.[0]?.text ?? '';
    },
  };
}
