import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer as createPipeServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport as LegacyStdio } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport as LegacyHttp } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client, StreamableHTTPClientTransport, isCallToolResult } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { contextResult, findItemsResult, lookupResult, saveIdeaResult, timerMutationResult } from '../src/shared/application.ts';
import { startHttp } from './http.ts';
import { createServer } from './server.ts';
import { createApplicationClient, createPipeApplicationClient } from '../client/applicationClient.ts';
import { callDesktop } from '../client/pipe.ts';
import { runCli } from '../cli/main.ts';
import { ApplicationError, applicationErrorSchema } from '../src/shared/appError.ts';

const main = fileURLToPath(new URL('./main.ts', import.meta.url));
const bundledEntry = fileURLToPath(new URL('../dist-mcp/monorail-mcp.mjs', import.meta.url));
const toolNames = [
  'get_context',
  'get_operation_result',
  'save_idea',
  'capture_todo',
  'find_items',
  'get_time_summary',
  'list_time_entries',
  'start_timer',
  'start_task_item',
  'pause_timer',
  'resume_timer',
  'stop_timer',
  'start_break',
  'return_from_break',
  'add_time_entry',
];

// Controlled desktop peer: real Node streams and Windows pipe, no production fallback.
async function desktopFixture() {
  const pipe = String.raw`\\.\pipe\monorail-compat-${randomUUID()}`;
  const calls: unknown[] = [];
  const peer = createPipeServer(socket => {
    const lines = createInterface({ input: socket });
    lines.once('line', line => {
      const request = JSON.parse(line);
      calls.push(request);
      assert.ok(toolNames.includes(request.method));
      const now = new Date().toISOString();
      const result = request.method === 'get_context' ? { status: 'ready', operation_id: randomUUID(), expected_state: 'ts1:fixture', as_of: now }
        : request.method === 'get_operation_result' ? { status: 'not_found', operation_id: request.arguments.operation_id }
        : { status: 'committed', operation_id: request.arguments.operation_id, committed_at: now, replayed: false, warnings: [], next_operation_id: randomUUID(),
          data: { id: randomUUID(), text: request.arguments.text, created_at: now, tags: [], pool: '活跃池' } };
      const reply = request.arguments.text === '磁盘失败' ? { error: 'disk full' }
        : request.arguments.text === '状态冲突' ? { error: {
          status: 'error', code: 'STATE_CHANGED', category: 'not_executed', message: '计时状态已改变',
          next_step: '复制最新状态再决定是否执行', latest_context: { operation_id: randomUUID(), expected_state: 'ts1:new', allowed_actions: ['start_timer'] },
        } } : { result };
      socket.end(JSON.stringify(reply) + '\n');
    });
  });
  await new Promise<void>((resolve, reject) => { peer.once('error', reject); peer.listen(pipe, resolve); });
  return { pipe, calls, listening: () => peer.listening,
    close: () => new Promise<void>((resolve, reject) => peer.close(e => e ? reject(e) : resolve())) };
}

for (const era of ['legacy', 'modern'] as const) for (const transportKind of ['stdio', 'http'] as const) {
  test(`${era} ${transportKind}: discovery, save, validation and desktop failures`, async () => {
    const fixture = await desktopFixture();
    const env = { ...process.env, MONORAIL_MCP_PIPE: fixture.pipe } as Record<string, string>;
    const http = transportKind === 'http' ? await startHttp(createPipeApplicationClient(fixture.pipe), { port: 0 }) : undefined;
    const legacy = new LegacyClient({ name: 'compat-2025', version: '1' });
    const modern = new Client({ name: 'compat-2026', version: '1' }, { versionNegotiation: { mode: 'auto' } });
    try {
      if (era === 'legacy') {
        await legacy.connect(http ? new LegacyHttp(http.url) : new LegacyStdio({ command: process.execPath, args: [main], env }));
      } else {
        await modern.connect(http ? new StreamableHTTPClientTransport(http.url) : new StdioClientTransport({ command: process.execPath, args: [main], env }));
        assert.equal(modern.getProtocolEra(), 'modern');
        assert.equal(modern.getNegotiatedProtocolVersion(), '2026-07-28');
      }
      const client = era === 'legacy' ? legacy : modern;
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map(t => t.name), toolNames);
      assert.equal(tools[0].inputSchema.type, 'object');
      const context = await client.callTool({ name: 'get_context', arguments: {} });
      assert.ok(isCallToolResult(context));
      const { operation_id } = contextResult.parse(context.structuredContent);
      const result = await client.callTool({ name: 'save_idea', arguments: { operation_id, text: '中文协议验证\n第二行' } });
      assert.ok(isCallToolResult(result));
      assert.notEqual(result.isError, true);
      assert.equal(saveIdeaResult.parse(result.structuredContent).data.text, '中文协议验证\n第二行');
      const lookup = await client.callTool({ name: 'get_operation_result', arguments: { operation_id: randomUUID() } });
      assert.ok(isCallToolResult(lookup)); assert.equal(lookupResult.parse(lookup.structuredContent).status, 'not_found');
      const count = fixture.calls.length;
      for (const args of [{ operation_id, text: '  ' }, { operation_id, text: 'x', path: '../state.yaml' }, { text: 'missing id' }]) {
        const invalid = await client.callTool({ name: 'save_idea', arguments: args });
        assert.ok(isCallToolResult(invalid)); assert.equal(invalid.isError, true);
      }
      assert.equal(fixture.calls.length, count);
      const failed = await client.callTool({ name: 'save_idea', arguments: { operation_id, text: '磁盘失败' } });
      assert.ok(isCallToolResult(failed)); assert.equal(failed.isError, true);
      assert.match(JSON.stringify(failed.content), /disk full/);
      const conflict = await client.callTool({ name: 'save_idea', arguments: { operation_id, text: '状态冲突' } });
      assert.ok(isCallToolResult(conflict)); assert.equal(conflict.isError, true);
      const failure = applicationErrorSchema.parse(conflict.structuredContent);
      assert.equal(failure.code, 'STATE_CHANGED');
      assert.equal(failure.category, 'not_executed');
      assert.deepEqual(failure.latest_context && typeof failure.latest_context === 'object' && !Array.isArray(failure.latest_context)
        ? failure.latest_context.allowed_actions : undefined, ['start_timer']);
      await fixture.close();
      const offline = await client.callTool({ name: 'save_idea', arguments: { operation_id, text: '离线' } });
      assert.ok(isCallToolResult(offline)); assert.equal(offline.isError, true);
      assert.match(JSON.stringify(offline.content), /无法连接单轨/);
      assert.deepEqual((await client.listTools()).tools.map(t => t.name), toolNames);
    } finally {
      await Promise.all([legacy.close(), modern.close()]);
      if (http) await http.close();
      if (fixture.listening()) await fixture.close();
    }
  });
}

test('ApplicationClient validates input before transport and rejects malformed transport responses', async () => {
  let sent = 0;
  const client = createApplicationClient({
    send: async () => {
      sent++;
      return { bad: 'shape' };
    },
  });
  await assert.rejects(
    client.call('save_idea', { operation_id: randomUUID(), text: '   ' }),
    (err: unknown) => {
      assert.equal(applicationErrorSchema.parse((err as { failure?: unknown }).failure).code, 'INVALID_INPUT');
      return true;
    },
  );
  assert.equal(sent, 0);

  await assert.rejects(
    client.call('get_context', {}),
    (err: unknown) => {
      const parsed = applicationErrorSchema.parse((err as { failure?: unknown }).failure);
      assert.equal(parsed.code, 'INVALID_RESPONSE');
      assert.equal(parsed.category, 'result_unknown');
      return true;
    },
  );
  assert.equal(sent, 1);
});

test('A3 mixed entrypoints: MCP and CLI share state, replay receipts across entrypoints, and reject stale timer state without silent retry', async () => {
  let stateSeq = 1;
  let expectedState = `ts1:mixed-${stateSeq}`;
  let timerMode: 'idle' | 'running' | 'paused' = 'idle';
  const receipts = new Map<string, { command: string; arguments: Record<string, unknown>; data: unknown; committed_at: string }>();
  const ideas: Array<{ id: string; text: string; created_at: string; tags: string[]; pool: '活跃池' }> = [];

  const baseClient = createApplicationClient({
    send: async (req) => {
      const now = '2026-11-03T12:00:00+08:00';
      if (req.method === 'get_context') {
        return {
          status: 'ready',
          operation_id: randomUUID(),
          expected_state: expectedState,
          as_of: now,
          timer: {
            mode: timerMode,
            expected_state: expectedState,
            open_entry: {
              id: 'e1',
              description: timerMode === 'running' ? '混合计时' : '',
              project: timerMode === 'running' ? '学习' : '待机',
              tags: [],
              started_at: now,
              ended_at: null,
              card_id: null,
              kind: timerMode === 'paused' ? '暂停' : '普通',
              source: '计时',
            },
            paused_target: null,
            pending: null,
            current_card: null,
            rest: null,
            allowed_actions: ['start_timer', 'pause_timer', 'stop_timer'],
          },
        };
      }
      if (req.method === 'get_operation_result') {
        const opId = req.arguments.operation_id.toLowerCase();
        const r = receipts.get(opId);
        if (!r) return { status: 'not_found', operation_id: opId };
        return {
          status: 'committed',
          operation_id: opId,
          command: r.command,
          request: { method: r.command, arguments: r.arguments },
          data: r.data,
          committed_at: r.committed_at,
        };
      }
      if (req.method === 'find_items') {
        return {
          as_of: now,
          query: req.arguments.query ?? '',
          ambiguous: false,
          ideas: ideas.map(i => ({ ...i, needs: null, exact_match: true })),
          todo_cards: [],
          tasks: [],
        };
      }
      if (req.method === 'save_idea') {
        const opId = req.arguments.operation_id.toLowerCase();
        const normArgs = { text: req.arguments.text, ...(req.arguments.needs ? { needs: req.arguments.needs } : {}) };
        const existing = receipts.get(opId);
        if (existing) {
          if (existing.command !== 'save_idea' || JSON.stringify(existing.arguments) !== JSON.stringify(normArgs)) {
            throw new ApplicationError({
              status: 'error',
              code: 'OPERATION_CONFLICT',
              category: 'not_executed',
              message: 'OPERATION_CONFLICT：同一 operation_id 参数不一致',
              next_step: '使用新 operation_id',
            });
          }
          return {
            status: 'committed',
            operation_id: opId,
            data: existing.data,
            committed_at: existing.committed_at,
            replayed: true,
            warnings: [],
            next_operation_id: randomUUID(),
          };
        }
        const item = { id: randomUUID(), text: req.arguments.text, created_at: now, tags: [], pool: '活跃池' as const };
        ideas.push(item);
        receipts.set(opId, { command: 'save_idea', arguments: normArgs, data: item, committed_at: now });
        return {
          status: 'committed',
          operation_id: opId,
          data: item,
          committed_at: now,
          replayed: false,
          warnings: [],
          next_operation_id: randomUUID(),
        };
      }
      if (req.method === 'start_timer' || req.method === 'pause_timer' || req.method === 'stop_timer') {
        const opId = req.arguments.operation_id.toLowerCase();
        const normArgs: Record<string, unknown> = { expected_state: req.arguments.expected_state };
        if (req.method === 'start_timer') normArgs.description = req.arguments.description;
        const existing = receipts.get(opId);
        if (existing) {
          if (existing.command !== req.method || JSON.stringify(existing.arguments) !== JSON.stringify(normArgs)) {
            throw new ApplicationError({
              status: 'error',
              code: 'OPERATION_CONFLICT',
              category: 'not_executed',
              message: 'OPERATION_CONFLICT：同一 operation_id 参数不一致',
              next_step: '使用新 operation_id',
            });
          }
          return {
            status: 'committed',
            operation_id: opId,
            data: existing.data,
            committed_at: existing.committed_at,
            replayed: true,
            warnings: [],
            next_operation_id: randomUUID(),
          };
        }
        if (req.arguments.expected_state !== expectedState) {
          throw new ApplicationError({
            status: 'error',
            code: 'STATE_CHANGED',
            category: 'not_executed',
            message: 'STATE_CHANGED：计时状态已变化',
            next_step: '获取最新状态后再试',
            latest_context: { expected_state: expectedState, allowed_actions: ['start_timer'] },
          });
        }
        timerMode = req.method === 'start_timer' ? 'running' : req.method === 'pause_timer' ? 'paused' : 'idle';
        stateSeq++;
        expectedState = `ts1:mixed-${stateSeq}`;
        const data = {
          noop: false,
          reason: null,
          effective_at: now,
          expected_state: expectedState,
          timer: {
            mode: timerMode,
            expected_state: expectedState,
            open_entry: {
              id: `e-${stateSeq}`,
              description: req.method === 'start_timer' ? req.arguments.description : '',
              project: '学习',
              tags: [],
              started_at: now,
              ended_at: null,
              card_id: null,
              kind: timerMode === 'paused' ? '暂停' : '普通',
              source: '计时',
            },
            paused_target: null,
            pending: null,
            current_card: null,
            rest: null,
            allowed_actions: ['start_timer', 'pause_timer', 'stop_timer'],
          },
        };
        receipts.set(opId, { command: req.method, arguments: normArgs, data, committed_at: now });
        return {
          status: 'committed',
          operation_id: opId,
          data,
          committed_at: now,
          replayed: false,
          warnings: [],
          next_operation_id: randomUUID(),
        };
      }
      throw new Error(`Unsupported in test: ${req.method}`);
    },
  });

  const http = await startHttp(baseClient, { port: 0 });
  const mcpClient = new Client({ name: 'mixed-mcp', version: '1' }, { versionNegotiation: { mode: 'auto' } });
  await mcpClient.connect(new StreamableHTTPClientTransport(http.url));
  try {
    // 1. MCP saves idea -> CLI finds it & replays same operation_id
    const sharedOpId = randomUUID();
    const mcpSave = await mcpClient.callTool({
      name: 'save_idea',
      arguments: { operation_id: sharedOpId, text: 'MCP 写入，CLI 重放与查询' },
    });
    assert.ok(isCallToolResult(mcpSave));
    assert.equal(saveIdeaResult.parse(mcpSave.structuredContent).replayed, false);

    let cliFindOut = '';
    assert.equal(
      await runCli(['find', 'MCP 写入', '--kind', 'idea', '--json'], {
        createClient: () => baseClient,
        writeStdout: t => { cliFindOut += t; },
      }),
      0,
    );
    assert.equal(findItemsResult.parse(JSON.parse(cliFindOut).result).ideas.length, 1);

    let cliReplayOut = '';
    assert.equal(
      await runCli(['idea', 'add', 'MCP 写入，CLI 重放与查询', '--operation-id', sharedOpId, '--json'], {
        createClient: () => baseClient,
        writeStdout: t => { cliReplayOut += t; },
      }),
      0,
    );
    assert.equal(saveIdeaResult.parse(JSON.parse(cliReplayOut).result).replayed, true);

    let cliConflictOut = '';
    assert.equal(
      await runCli(['idea', 'add', '不同内容必须冲突', '--operation-id', sharedOpId, '--json'], {
        createClient: () => baseClient,
        writeStdout: t => { cliConflictOut += t; },
      }),
      3,
    );
    assert.equal(JSON.parse(cliConflictOut).error.code, 'OPERATION_CONFLICT');

    // 2. CLI starts timer -> MCP pauses -> CLI stops -> CLI replays start_timer with original --operation-id
    const timerStartOpId = randomUUID();
    let cliStartOut = '';
    assert.equal(
      await runCli(['timer', 'start', '跨入口计时', '--operation-id', timerStartOpId, '--json'], {
        createClient: () => baseClient,
        writeStdout: t => { cliStartOut += t; },
      }),
      0,
    );
    const started = timerMutationResult.parse(JSON.parse(cliStartOut).result);
    assert.equal(started.data.timer.mode, 'running');

    const mcpPause = await mcpClient.callTool({
      name: 'pause_timer',
      arguments: { operation_id: started.next_operation_id, expected_state: started.data.expected_state },
    });
    assert.ok(isCallToolResult(mcpPause));
    assert.equal(timerMutationResult.parse(mcpPause.structuredContent).data.timer.mode, 'paused');

    let cliStopOut = '';
    assert.equal(
      await runCli(['timer', 'stop', '--json'], {
        createClient: () => baseClient,
        writeStdout: t => { cliStopOut += t; },
      }),
      0,
    );
    assert.equal(timerMutationResult.parse(JSON.parse(cliStopOut).result).data.timer.mode, 'idle');

    // Replay CLI timer start with --operation-id after MCP pause + CLI stop advanced expected_state
    let cliTimerReplayOut = '';
    assert.equal(
      await runCli(['timer', 'start', '跨入口计时', '--operation-id', timerStartOpId, '--json'], {
        createClient: () => baseClient,
        writeStdout: t => { cliTimerReplayOut += t; },
      }),
      0,
    );
    assert.equal(timerMutationResult.parse(JSON.parse(cliTimerReplayOut).result).replayed, true);

    // 3. Concurrent state mutation between CLI automatic get_context and write -> rejected with STATE_CHANGED (exit 3), no silent retry
    let mutated = false;
    const racingClient = createApplicationClient({
      send: async (req) => {
        const res = await baseClient.call(req.method, req.arguments as never);
        if (req.method === 'get_context' && !mutated) {
          mutated = true;
          await mcpClient.callTool({
            name: 'start_timer',
            arguments: {
              operation_id: randomUUID(),
              expected_state: (res as { expected_state: string }).expected_state,
              description: 'MCP 抢先修改状态',
            },
          });
        }
        return res;
      },
    });
    let staleOut = '';
    assert.equal(
      await runCli(['timer', 'start', 'CLI 过期状态请求', '--json'], {
        createClient: () => racingClient,
        writeStdout: t => { staleOut += t; },
      }),
      3,
    );
    assert.equal(JSON.parse(staleOut).error.code, 'STATE_CHANGED');
  } finally {
    await mcpClient.close();
    await http.close();
    void createServer;
  }
});

test('EBUSY is a busy existing host and never starts another desktop process', async () => {
  const connection = mock.method(net, 'createConnection', () => {
    const socket = new net.Socket();
    queueMicrotask(() => socket.destroy(Object.assign(new Error('pipe busy'), { code: 'EBUSY' })));
    return socket;
  });
  syncBuiltinESMExports();
  let starts = 0;
  try {
    await assert.rejects(callDesktop(String.raw`\\.\pipe\busy-existing-host.mcp`, { method: 'get_context', arguments: {} }, {
      spawnProcess: () => { starts++; throw new Error('must not launch'); },
    }), /PIPE_BUSY/);
    assert.equal(starts, 0);
    assert.equal(connection.mock.callCount(), 1);
  } finally { connection.mock.restore(); syncBuiltinESMExports(); }
});

test('HTTP rejects untrusted browser origins and Host before business dispatch', async () => {
  const http = await startHttp(createApplicationClient({ send: async () => { throw new Error('must not dispatch'); } }), { port: 0 });
  try {
    for (const origin of ['https://example.com', 'null', 'http://localhost:9999', '']) {
      const result = await fetch(http.url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' });
      assert.equal(result.status, 403);
    }
    // fetch normalizes Host; use the raw Node client to send the actual hostile header.
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(http.url, { method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject); req.end('{}');
    });
    assert.equal(hostStatus, 403);
    assert.equal((await fetch(new URL('/elsewhere', http.url))).status, 404);
    const malformed = await fetch(http.url, { method: 'POST', headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
  } finally { await http.close(); }
});

test('pipe client distinguishes setup_required, corrupted config, startup failure, cancellation and coalesced --background launch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'monorail-pipe-test-'));
  const configDir = join(dir, 'profile');
  const dataDir = join(dir, 'data');
  const fakeExe = join(dir, 'fake-monorail.exe');
  mkdirSync(configDir);
  mkdirSync(dataDir);
  writeFileSync(fakeExe, '');
  const offlinePipe = String.raw`\\.\pipe\monorail-bg-${randomUUID()}.mcp`;
  const req = { method: 'get_context' as const, arguments: {} };

  await assert.rejects(
    callDesktop(offlinePipe, req, { configDir }),
    /SETUP_REQUIRED/,
  );

  writeFileSync(join(configDir, 'config.json'), '{broken');
  await assert.rejects(
    callDesktop(offlinePipe, req, { configDir }),
    /CONFIG_CORRUPTED/,
  );

  writeFileSync(join(configDir, 'config.json'), JSON.stringify({ root: dataDir }));
  await assert.rejects(
    callDesktop(offlinePipe, req, { configDir }),
    /UNAVAILABLE/,
  );

  writeFileSync(join(configDir, 'mcp-host.json'), JSON.stringify({ executable: join(dir, 'missing.exe') }));
  await assert.rejects(
    callDesktop(offlinePipe, req, { configDir }),
    /CONFIG_CORRUPTED/,
  );

  writeFileSync(join(configDir, 'mcp-host.json'), JSON.stringify({ executable: fakeExe }));
  await assert.rejects(
    callDesktop(offlinePipe, req, {
      configDir,
      spawnProcess: () => {
        const child = Object.assign(new EventEmitter(), { unref() {} }) as unknown as ChildProcess;
        setImmediate(() => child.emit('exit', 1, null));
        return child;
      },
    }),
    /STARTUP_FAILED/,
  );

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    callDesktop(offlinePipe, req, { configDir, signal: aborted.signal }),
    /CANCELLED/,
  );

  let spawns = 0;
  let server: ReturnType<typeof createPipeServer> | undefined;
  try {
    const spawnProcess = (exe: string, args: string[]) => {
      spawns++;
      assert.equal(exe, fakeExe);
      assert.deepEqual(args, ['--background']);
      const child = Object.assign(new EventEmitter(), { unref() {} }) as unknown as ChildProcess;
      server = createPipeServer(socket => {
        const lines = createInterface({ input: socket });
        lines.once('line', () => {
          socket.end(JSON.stringify({ result: { status: 'ready', operation_id: randomUUID(), expected_state: 'ts1:bg', as_of: new Date().toISOString() } }) + '\n');
        });
      });
      server.listen(offlinePipe);
      return child;
    };
    const [first, second] = await Promise.all([
      callDesktop(offlinePipe, req, { configDir, spawnProcess }),
      callDesktop(offlinePipe, req, { configDir, spawnProcess }),
    ]);
    assert.equal(spawns, 1);
    assert.equal(contextResult.parse(first).status, 'ready');
    assert.equal(contextResult.parse(second).status, 'ready');
  } finally {
    if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
  }
});

test('self-contained dist-mcp/monorail-mcp.mjs runs from a clean path with spaces and Chinese characters over stdio and HTTP', async () => {
  assert.ok(existsSync(bundledEntry), 'dist-mcp/monorail-mcp.mjs must be built before smoke tests');
  const fixture = await desktopFixture();
  const isolatedDir = mkdtempSync(join(tmpdir(), '单轨 MCP 发行测试 '));
  const standaloneMjs = join(isolatedDir, 'monorail-mcp.mjs');
  copyFileSync(bundledEntry, standaloneMjs);
  const env = { ...process.env, MONORAIL_MCP_PIPE: fixture.pipe } as Record<string, string>;

  const stdioClient = new Client({ name: 'standalone-stdio', version: '1' }, { versionNegotiation: { mode: 'auto' } });
  let httpProc: ChildProcess | undefined;
  const httpClient = new Client({ name: 'standalone-http', version: '1' }, { versionNegotiation: { mode: 'auto' } });
  try {
    await stdioClient.connect(new StdioClientTransport({
      command: process.execPath,
      args: [standaloneMjs],
      cwd: isolatedDir,
      env,
    }));
    assert.deepEqual((await stdioClient.listTools()).tools.map(t => t.name), toolNames);
    const stdioCtx = await stdioClient.callTool({ name: 'get_context', arguments: {} });
    assert.ok(isCallToolResult(stdioCtx));
    const parsedStdioCtx = contextResult.parse(stdioCtx.structuredContent);

    // Also test standalone CLI --http --port <port>
    const port = 28000 + Math.floor(Math.random() * 10000);
    httpProc = spawn(process.execPath, [standaloneMjs, '--http', '--port', String(port)], {
      cwd: isolatedDir,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    const url = await new Promise<URL>((resolve, reject) => {
      const lines = createInterface({ input: httpProc!.stderr! });
      lines.on('line', line => {
        const match = /MONORAIL MCP listening: (http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec(line);
        if (match) resolve(new URL(match[1]));
      });
      httpProc!.once('exit', code => reject(new Error(`standalone HTTP exited early: ${String(code)}`)));
    });
    await httpClient.connect(new StreamableHTTPClientTransport(url));
    assert.deepEqual((await httpClient.listTools()).tools.map(t => t.name), toolNames);
    const httpCtx = await httpClient.callTool({ name: 'get_context', arguments: {} });
    assert.ok(isCallToolResult(httpCtx));
    const parsedHttpCtx = contextResult.parse(httpCtx.structuredContent);
    assert.equal(parsedStdioCtx.status, parsedHttpCtx.status);
  } finally {
    await Promise.all([stdioClient.close(), httpClient.close()]);
    if (httpProc && !httpProc.killed) httpProc.kill();
    if (fixture.listening()) await fixture.close();
  }
});
