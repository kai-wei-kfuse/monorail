import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.ts';
import { createPipeApplicationClient } from '../client/applicationClient.ts';
import { defaultPipePath } from '../client/pipe.ts';
import { startHttp } from './http.ts';

// stdout belongs exclusively to MCP JSON-RPC; diagnostics go to stderr.
const { values } = parseArgs({ options: { http: { type: 'boolean' }, port: { type: 'string' } } });
const client = createPipeApplicationClient(defaultPipePath());
if (values.http) {
  if (values.port === undefined || !/^\d+$/.test(values.port)) throw new Error('HTTP mode requires --port <TCP port>');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HTTP mode requires --port between 1 and 65535');
  const http = await startHttp(client, { port });
  console.error(`MONORAIL MCP listening: ${http.url}`);
  const close = () => { void http.close().catch(error => { console.error(error); process.exitCode = 1; }); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
} else {
  if (values.port !== undefined) throw new Error('--port requires --http');
  serveStdio(() => createServer(client), { legacy: 'serve', onerror: error => console.error('MCP stdio:', error) });
}
