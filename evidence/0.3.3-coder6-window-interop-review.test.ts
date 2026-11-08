// Execute the production window controller and durable services; the port is a
// controlled event boundary. This does not claim real Rust/WebView2 verification.
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer as createMcpServer } from '../mcp/server';
import { createApplicationClient } from '../client/applicationClient';
import { runCli } from '../cli/main';
import { connectIdeaWindows } from '../src/app/ideaWindowController';
import { handleApplicationRequest } from '../src/app/applicationController';
import { fixture, seed, task } from '../src/services/serviceFixture';
import { createIdea } from '../src/services/ideaService';
import { createIdeaResult, updateIdeaData, createIdeaData } from '../src/shared/application';
import type { IdeaWindowsPort } from '../src/platform/ideaWindows';
import type { IdeaWindowCommand, IdeaWindowReply } from '../src/shared/ideaWindow';

function eventPort() {
  let handler: ((command: IdeaWindowCommand) => void) | null = null;
  const awaiting = new Map<string, (reply: IdeaWindowReply) => void>();
  const port: IdeaWindowsPort = {
    async openIdeaWindow() { return { label: 'idea-review', windowSession: 'session-review', mainEpoch: 1, created: true }; },
    async openIdeaDraftWindow() { return { label: 'idea-draft-review', windowSession: 'session-review', mainEpoch: 1, created: true }; },
    async hello() { return { label: 'idea-review', windowSession: 'session-review', mainEpoch: 1, kind: 'record', recordId: null, draftId: null, draftVersion: null, createOperationId: null, draftSnapshot: null }; },
    async send(_session, _epoch, command) { handler?.(command); },
    async reply(_target, reply) { const resolve = awaiting.get(reply.requestId); awaiting.delete(reply.requestId); resolve?.(reply); },
    async rebindDraftWindow() {}, async closeIdeaWindow() {}, async closeAllIdeaWindows() {}, async notifyCommitted() {},
    async subscribeCommands(callback) { handler = callback; return () => { handler = null; }; },
    async subscribeReplies() { return () => {}; }, async subscribeCommitted() { return () => {}; }, async subscribeDraftHandoff() { return () => {}; },
    async mainUpdateReady() {}, async ackDraftCheck() {}, async beginMaintenanceCheck() {}, async checkDraftsForMaintenance() {},
    async cancelMaintenanceCheck() {}, async focusDirtyWindow() { return null; }, async performAppExit() {},
  };
  function command(input: IdeaWindowCommand) {
    if (!handler) throw new Error('window command subscription not ready');
    const promise = new Promise<IdeaWindowReply>(resolve => awaiting.set(input.requestId, resolve));
    handler(input);
    return promise;
  }
  return { port, command };
}

async function replayViaAdapters(f: ReturnType<typeof fixture>, operationId: string, args: Record<string, unknown>, mode: 'edit' | 'create') {
  const client = createApplicationClient({ send: request => handleApplicationRequest(f.ctx, request) });
  const lookup = await client.call('get_operation_result', { operation_id: operationId });
  let stdout = '';
  const argv = mode === 'edit'
    ? ['idea', 'edit', String(args.idea_id), '--title', String(args.title), '--details-file', 'review.md', '--clear-needs', '--operation-id', operationId, '--json']
    : ['idea', 'create', '--title', String(args.title), '--details-file', 'review.md', '--operation-id', operationId, '--json'];
  const cliExit = await runCli(argv, {
    createClient: () => client, readTextFile: () => String(args.details_markdown), env: {},
    writeStdout: text => { stdout += text; }, writeStderr: () => {},
  });
  const server = createMcpServer(client);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'coder6-interop-review', version: '0.3.3' });
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  try {
    const result = await mcp.callTool({ name: mode === 'edit' ? 'update_idea' : 'create_idea', arguments: { operation_id: operationId, ...args } });
    return { lookup, cliExit, cli: JSON.parse(stdout), mcp: result };
  } finally { await mcp.close(); await server.close(); }
}

it('W1: a production window save receipt can be read and identically replayed by CLI and MCP', async () => {
  const f = fixture(); await seed(f, []);
  const initial = createIdeaResult.parse(await handleApplicationRequest(f.ctx, { method: 'create_idea', arguments: { operation_id: crypto.randomUUID(), title: '窗口A', details_markdown: '正文A' } }));
  const id = initial.data.idea.id, op = crypto.randomUUID();
  const events = eventPort(), controller = connectIdeaWindows(f.ctx, events.port);
  try {
    await controller.openIdeaWindow(id, '窗口A');
    const reply = await events.command({ kind: 'save', requestId: 'save-window', recordId: id, windowLabel: 'idea-review', windowSession: 'session-review', mainEpoch: f.ctx.mainEpoch, operationId: op, baseRevision: initial.data.idea.record_revision, text: '窗口B', detailsMarkdown: '正文B', needs: null, at: f.ctx.now() });
    expect(reply.kind).toBe('saved');
    const result = await replayViaAdapters(f, op, { idea_id: id, record_revision: initial.data.idea.record_revision, title: '窗口B', details_markdown: '正文B', needs: null }, 'edit');
    console.log('W1_OBSERVED', JSON.stringify({ lookup: result.lookup, cli: result.cli, mcp: result.mcp }));
    expect(result.cliExit).toBe(0);
    expect(result.cli.result.replayed).toBe(true);
    expect(result.mcp.isError).toBeFalsy();
    expect(result.lookup.status).toBe('committed');
    if (result.lookup.status === 'committed') expect(updateIdeaData.safeParse(result.lookup.data).success).toBe(true);
  } finally { controller.dispose(); }
});

it('W2: a production draft-create with no attachments or task has the same public create_idea intent', async () => {
  const f = fixture(); await seed(f, []);
  const draftId = crypto.randomUUID(), op = crypto.randomUUID();
  const events = eventPort(), controller = connectIdeaWindows(f.ctx, events.port);
  try {
    await controller.openIdeaDraftWindow({ draftId, draftVersion: 1, createOperationId: op, title: '草稿A', detailsMarkdown: '草稿正文A', needs: null, taskId: null, attachments: [], createdAt: f.ctx.now() });
    const reply = await events.command({ kind: 'draft-create', requestId: 'create-window', draftId, draftVersion: 1, createOperationId: op, windowLabel: 'idea-draft-review', windowSession: 'session-review', mainEpoch: f.ctx.mainEpoch, text: '草稿A', detailsMarkdown: '草稿正文A', needs: null, taskId: null, attachments: [], at: f.ctx.now() });
    expect(reply.kind).toBe('draft-created');
    const result = await replayViaAdapters(f, op, { title: '草稿A', details_markdown: '草稿正文A', needs: null }, 'create');
    console.log('W2_OBSERVED', JSON.stringify({ lookup: result.lookup, cli: result.cli, mcp: result.mcp }));
    expect(result.cliExit).toBe(0);
    expect(result.cli.result.replayed).toBe(true);
    expect(result.mcp.isError).toBeFalsy();
    if (result.lookup.status === 'committed') expect(createIdeaData.safeParse(result.lookup.data).success).toBe(true);
    expect(await f.ctx.repos.records.list()).toHaveLength(1);
  } finally { controller.dispose(); }
});

it('W3: explicitly clearing a task association is preserved through window update normalization', async () => {
  const f = fixture(); await seed(f, [], [task('related-task')]);
  const initial = await createIdea(f.ctx, { title: '有关联的想法', detailsMarkdown: '正文', taskId: 'related-task' });
  const events = eventPort(), controller = connectIdeaWindows(f.ctx, events.port);
  try {
    await controller.openIdeaWindow(initial.id, initial.text);
    const reply = await events.command({
      kind: 'save', requestId: 'clear-task', recordId: initial.id, windowLabel: 'idea-review', windowSession: 'session-review',
      mainEpoch: f.ctx.mainEpoch, operationId: crypto.randomUUID(), baseRevision: initial.recordRevision,
      text: initial.text, detailsMarkdown: initial.detailsMarkdown, needs: initial.needs, taskId: null, at: f.ctx.now(),
    });
    expect(reply.kind).toBe('saved');
    const actual = await f.ctx.repos.records.get(initial.id);
    console.log('W3_OBSERVED', JSON.stringify({ sentTaskId: null, storedTaskId: actual?.value.task_id, reply }));
    expect(actual?.value.task_id).toBeNull();
  } finally { controller.dispose(); }
});

it('W4: the same operation cannot replay an explicit task clear as an omitted task patch', async () => {
  const f = fixture(); await seed(f, [], [task('related-task')]);
  const initial = await createIdea(f.ctx, { title: '区分清空与省略', detailsMarkdown: '正文', taskId: 'related-task' });
  const events = eventPort(), controller = connectIdeaWindows(f.ctx, events.port);
  const command = {
    kind: 'save' as const, recordId: initial.id, windowLabel: 'idea-review', windowSession: 'session-review',
    mainEpoch: f.ctx.mainEpoch, operationId: crypto.randomUUID(), baseRevision: initial.recordRevision,
    text: initial.text, detailsMarkdown: initial.detailsMarkdown, needs: initial.needs, at: f.ctx.now(),
  };
  try {
    await controller.openIdeaWindow(initial.id, initial.text);
    await events.command({ ...command, requestId: 'explicit-clear', taskId: null });
    const second = await events.command({ ...command, requestId: 'omitted-task' });
    console.log('W4_OBSERVED', JSON.stringify(second));
    expect(second.kind).toBe('error');
    if (second.kind === 'error') expect(second.message).toContain('OPERATION_CONFLICT');
  } finally { controller.dispose(); }
});
