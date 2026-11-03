import { createServer as createHttpServer } from 'node:http';
import { createMcpHandler, validateHostHeader } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createServer } from './server.ts';
import type { ApplicationClient } from '../client/applicationClient.ts';

export interface HttpOptions {
  port: number;
  /** Exact browser origins explicitly trusted by the operator; none by default. */
  allowedOrigins?: readonly string[];
  /** SDK body-size constraint, shared by both conversion layers; defaults to the SDK limit. */
  maxRequestBodySize?: number;
}

export async function startHttp(client: ApplicationClient, options: HttpOptions) {
  const report = (error: Error) => console.error('MCP HTTP:', error);
  // Official dual-era handler; legacy HTTP is stateless, not the old two-endpoint SSE transport.
  const handler = createMcpHandler(() => createServer(client), {
    legacy: 'stateless', onerror: report, maxRequestBodySize: options.maxRequestBodySize,
  });
  const serve = toNodeHandler(handler, { onerror: report, maxRequestBodySize: options.maxRequestBodySize });
  const server = createHttpServer((req, res) => {
    // MCP HTTP requires DNS-rebinding protection; this entry is local-only.
    if (!validateHostHeader(req.headers.host, ['127.0.0.1', 'localhost']).ok) {
      res.writeHead(403); res.end('Untrusted Host'); return;
    }
    if (req.headers.origin !== undefined && !options.allowedOrigins?.includes(req.headers.origin)) {
      res.writeHead(403); res.end('Untrusted Origin'); return;
    }
    if (req.url !== '/mcp') { res.writeHead(404); res.end('Not found'); return; }
    void serve(req, res).catch(error => {
      report(error);
      if (!res.headersSent) { res.writeHead(500); res.end('MCP adapter failed'); }
      else res.destroy(error);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  server.on('error', report);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP listener has no TCP address');
  return {
    url: new URL(`http://127.0.0.1:${address.port}/mcp`),
    async close() {
      await handler.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
