import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createPipeServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPipeApplicationClient } from '../client/applicationClient';
import { runCli } from '../cli/main';
import { CLI_HELP_COMMANDS, renderHelpText } from '../cli/output';
import { createServer as createMcpServer } from '../mcp/server';
import type { FileSnapshot, FileSystem } from '../src/data/fs';
import { createRepos } from '../src/data/repos';
import { migrateAll, migrateV3 } from '../src/data/migrations/v3';
import { initialState } from '../src/data/stateRepo';
import { SettingsRepo } from '../src/data/settingsRepo';
import { Journal } from '../src/data/journal';
import { stringify } from 'yaml';
import { CAPABILITY_CATEGORIES, buildCliExamples } from '../src/pages/settings/automationData';
import { createContext, run } from '../src/services/commit';
import { defaults } from '../src/shared/settings';
import { applicationContracts, applicationMethods, applicationRequest } from '../src/shared/application';
import { ApplicationError } from '../src/shared/appError';
import { handleApplicationRequest } from '../src/app/applicationController';

function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

function createDiskFs(rootDir: string) {
  const stats = {
    readCalls: 0,
    listCalls: 0,
    writeCalls: 0,
    bytesRead: 0,
    bytesWritten: 0,
  };
  const reset = () => {
    stats.readCalls = 0;
    stats.listCalls = 0;
    stats.writeCalls = 0;
    stats.bytesRead = 0;
    stats.bytesWritten = 0;
  };
  const fs: FileSystem = {
    async read(relPath: string): Promise<FileSnapshot | null> {
      stats.readCalls++;
      const full = join(rootDir, ...relPath.split('/'));
      if (!existsSync(full)) return null;
      const st = statSync(full);
      if (!st.isFile()) return null;
      const bytes = readFileSync(full);
      stats.bytesRead += bytes.byteLength;
      const text = bytes.toString('utf8');
      const byteHash = sha256Hex(bytes);
      return { text, version: `${st.mtimeMs}:${st.size}`, byteHash };
    },
    async list(relDir: string, recursive = false): Promise<string[]> {
      stats.listCalls++;
      const base = relDir ? join(rootDir, ...relDir.split('/')) : rootDir;
      if (!existsSync(base)) return [];
      const out: string[] = [];
      const walk = (dir: string, prefix: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (recursive) walk(full, rel);
          } else if (entry.isFile()) {
            out.push(rel);
          }
        }
      };
      walk(base, relDir);
      return out.sort();
    },
    async atomicWrite(relPath: string, text: string): Promise<void> {
      stats.writeCalls++;
      const full = join(rootDir, ...relPath.split('/'));
      mkdirSync(dirname(full), { recursive: true });
      const buf = Buffer.from(text, 'utf8');
      stats.bytesWritten += buf.byteLength;
      writeFileSync(full, buf);
    },
    async remove(relPath: string): Promise<void> {
      const full = join(rootDir, ...relPath.split('/'));
      rmSync(full, { force: true });
    },
  };
  return { fs, stats, reset };
}

function totalDirBytes(dir: string): { fileCount: number; totalBytes: number } {
  let fileCount = 0;
  let totalBytes = 0;
  const walk = (cur: string) => {
    if (!existsSync(cur)) return;
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        fileCount++;
        totalBytes += statSync(full).size;
      }
    }
  };
  walk(dir);
  return { fileCount, totalBytes };
}

describe('0.3.3 P6 comprehensive verification & benchmark suite', () => {
  it('verifies ADR 0029 41-method contract, real Named Pipe CLI + MCP parity, migration drill, and synthetic scale benchmark', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'monorail-033-p6-'));
    try {
      // =========================================================================
      // 1. Contract & Read-Only Classification & Help / Settings Guide Sync Check
      // =========================================================================
      const allMethods = [...applicationMethods];
      const readOnlyMethods = allMethods.filter((m) => applicationContracts[m].readOnly);
      const writeMethods = allMethods.filter((m) => !applicationContracts[m].readOnly);
      expect(allMethods.length).toBe(41);
      expect(writeMethods.length).toBe(30);
      expect(readOnlyMethods.length).toBe(11);
      expect(readOnlyMethods).toContain('get_idea_details');

      const rustBridgeSrc = readFileSync(resolve(process.cwd(), 'src-tauri/src/mcp_bridge.rs'), 'utf8');
      const rustReadOnlyBlock = rustBridgeSrc.match(/const READ_ONLY_METHODS:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\];/);
      expect(rustReadOnlyBlock).not.toBeNull();
      const rustReadOnlyList = Array.from(rustReadOnlyBlock![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
      expect(rustReadOnlyList.sort()).toEqual([...readOnlyMethods].sort());

      const helpText = renderHelpText();
      expect(helpText).toContain('monorail idea create');
      expect(helpText).toContain('monorail idea show');
      expect(helpText).toContain('monorail idea edit');
      expect(helpText).toContain('monorail task create');
      expect(helpText).toContain('monorail idea convert');
      expect(CLI_HELP_COMMANDS.length).toBeGreaterThanOrEqual(39);

      const guideMethods = CAPABILITY_CATEGORIES.flatMap((c) => c.methods.split('·').map((s) => s.trim()).filter(Boolean));
      expect(guideMethods.length).toBe(41);
      expect(buildCliExamples('/tmp/cli.mjs').find((e) => e.id === 'help')?.desc).toContain('41');

      // =========================================================================
      // 2. Real Named Pipe End-to-End Verification (CLI + MCP + Controller + Repos)
      // =========================================================================
      const e2eDir = join(workRoot, 'e2e-data');
      mkdirSync(e2eDir, { recursive: true });
      const isoNow = new Date('2026-11-08T10:00:00+08:00').toISOString();
      const { fs: e2eFs } = createDiskFs(e2eDir);
      const e2eRepos = createRepos(e2eFs);
      const e2eSettings = structuredClone(defaults);
      const e2eCtx = createContext({
        repos: e2eRepos,
        settings: e2eSettings,
        id: () => randomUUID(),
        now: () => isoNow,
        publish: () => {},
        log: async () => {},
        reminders: { update: async () => {} },
        random: () => 0,
      });
      await run(e2eCtx, async (tx) => {
        tx.state.current_card = null;
        tx.state.home_mode = 'guide';
      }, isoNow, { action: 'test.direct' });

      const pipePath = String.raw`\\.\pipe\monorail-033-p6-${randomUUID()}.mcp`;
      const pipeServer = createPipeServer((socket) => {
        socket.setEncoding('utf8');
        const rl = createInterface({ input: socket });
        rl.once('line', async (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          try {
            const parsed = applicationRequest.parse(JSON.parse(trimmed));
            const out = await handleApplicationRequest(e2eCtx, parsed);
            socket.end(JSON.stringify({ result: out }) + '\n');
          } catch (err) {
            if (err instanceof ApplicationError) {
              socket.end(JSON.stringify({ error: err.failure }) + '\n');
            } else {
              socket.end(
                JSON.stringify({
                  error: {
                    status: 'error',
                    code: 'INTERNAL_ERROR',
                    category: 'not_executed',
                    message: err instanceof Error ? err.message : String(err),
                    next_step: 'check logs',
                  },
                }) + '\n',
              );
            }
          }
        });
      });
      await new Promise<void>((resolveListen) => pipeServer.listen(pipePath, resolveListen));

      const pipeClient = () => createPipeApplicationClient(pipePath, { autoStart: false });
      const callCliJson = async (argv: string[], extra: { stdin?: string; files?: Record<string, string> } = {}) => {
        let stdout = '';
        let stderr = '';
        const exitCode = await runCli([...argv, '--json'], {
          createClient: pipeClient,
          readStdin: extra.stdin !== undefined ? async () => extra.stdin! : undefined,
          readTextFile: extra.files
            ? (p) => {
                if (!(p in extra.files!)) throw new Error(`ENOENT: ${p}`);
                return extra.files![p];
              }
            : undefined,
          writeStdout: (t) => {
            stdout += t;
          },
          writeStderr: (t) => {
            stderr += t;
          },
        });
        return { exitCode, body: JSON.parse(stdout), stderr };
      };

      const mcpServer = createMcpServer(pipeClient());
      const [mcpClientTransport, mcpServerTransport] = InMemoryTransport.createLinkedPair();
      const mcpClient = new Client({ name: 'p6-verifier', version: '0.3.3' });
      await mcpServer.connect(mcpServerTransport);
      await mcpClient.connect(mcpClientTransport);

      try {
        const listedTools = await mcpClient.listTools();
        expect(listedTools.tools.length).toBe(41);

        // (a) CLI idea create with multiline Markdown details & URLs
        const mdInitial = '## 详细设计\n- 第一点：标题与正文分离\n- 链接：https://example.com/spec\n```ts\nconst x = 1 & 2;\n```';
        const cliCreateIdea = await callCliJson(
          ['idea', 'create', '--title', '实现 0.3.3 想法长详情 #架构', '--details-file', 'idea.md', '--needs', '整块时间'],
          { files: { 'idea.md': mdInitial } },
        );
        expect(cliCreateIdea.exitCode).toBe(0);
        const ideaId = cliCreateIdea.body.result.data.idea.id as string;
        const rev1 = cliCreateIdea.body.result.data.idea.record_revision as string;
        expect(cliCreateIdea.body.result.data.idea.has_details).toBe(true);
        expect(cliCreateIdea.body.result.data.idea).not.toHaveProperty('details_markdown');

        // Add an attachment on disk to verify conversion preserves attachments too
        const recAfterCreate = await e2eRepos.records.getDetails(ideaId);
        expect(recAfterCreate).not.toBeNull();
        const prepAtt = await e2eRepos.records.prepareWrite(
          { ...recAfterCreate!.value, attachments: ['attachments/arch-diagram.png'] },
          recAfterCreate,
        );
        await new Journal(e2eFs).run(randomUUID(), [prepAtt.write]);

        // (b) MCP get_idea_details reads full details_markdown + updated revision
        const mcpDetails1 = await mcpClient.callTool({
          name: 'get_idea_details',
          arguments: { idea_id: ideaId },
        });
        expect(mcpDetails1.isError).toBeFalsy();
        const detailsPayload1 = JSON.parse((mcpDetails1.content as Array<{ text: string }>)[0].text);
        expect(detailsPayload1.idea.details_markdown).toBe(mdInitial);
        expect(detailsPayload1.idea.attachments).toEqual(['attachments/arch-diagram.png']);
        const revWithAttachment = detailsPayload1.idea.record_revision as string;

        // (c) CLI update_idea with stale revision -> RECORD_CHANGED (exit code 3, zero write)
        const cliStaleEdit = await callCliJson([
          'idea',
          'edit',
          ideaId,
          '--title',
          '尝试用旧修订覆盖',
          '--record-revision',
          rev1,
        ]);
        expect(cliStaleEdit.exitCode).toBe(3);
        expect(cliStaleEdit.body.error.code).toBe('RECORD_CHANGED');

        // (d) CLI update_idea title-only (omitting details keeps details intact!)
        const cliTitleEdit = await callCliJson([
          'idea',
          'edit',
          ideaId,
          '--title',
          '实现 0.3.3 想法长详情（已评审） #架构 #0.3.3',
        ]);
        expect(cliTitleEdit.exitCode).toBe(0);
        const revAfterTitleEdit = cliTitleEdit.body.result.data.idea.record_revision as string;
        expect(revAfterTitleEdit).not.toBe(revWithAttachment);
        const verifyAfterTitleEdit = await e2eRepos.records.getDetails(ideaId);
        expect(verifyAfterTitleEdit?.body).toBe(mdInitial);

        // (e) Create 1st main task via CLI `task create`, and 2nd coexisting main task via MCP `create_task`
        const cliMainTask1 = await callCliJson([
          'task',
          'create',
          '--name',
          '主线一：核心存储迁移',
          '--slot',
          '主线',
          '--item',
          '完成 v3 迁移器',
        ]);
        expect(cliMainTask1.exitCode).toBe(0);
        const mainTask1Id = cliMainTask1.body.result.data.task.id as string;
        expect(cliMainTask1.body.result.data.task.slot_index).toBe(1);

        const mcpMainTask2OpId = randomUUID();
        const mcpMainTask2 = await mcpClient.callTool({
          name: 'create_task',
          arguments: {
            operation_id: mcpMainTask2OpId,
            name: '主线二：独立窗口与自动化同版',
            slot: '主线',
            items: [
              { content: '实现独立想法窗口', type: '结果卡', timebox_minutes: null },
              { content: '压测 1000 条长文记录', type: '时间盒卡', timebox_minutes: 45 },
            ],
          },
        });
        expect(mcpMainTask2.isError).toBeFalsy();
        const mainTask2Payload = JSON.parse((mcpMainTask2.content as Array<{ text: string }>)[0].text);
        const mainTask2Id = mainTask2Payload.data.task.id as string;
        expect(mainTask2Payload.data.task.slot_index).toBe(2);
        expect(mainTask2Payload.data.created_card_ids.length).toBe(2);

        // (f) Attempt 3rd main task when mainTasks limit=2 -> TASK_CAPACITY_FULL zero-write
        const tasksBeforeFull = (await e2eRepos.tasks.list()).length;
        const cliMainTask3Full = await callCliJson([
          'task',
          'create',
          '--name',
          '主线三：超出容量应被拒绝',
          '--slot',
          '主线',
          '--item',
          '不应写入',
        ]);
        expect(cliMainTask3Full.exitCode).toBe(3);
        expect(cliMainTask3Full.body.error.code).toBe('TASK_CAPACITY_FULL');
        expect(cliMainTask3Full.body.error.latest_context.task_capacity).toEqual({
          slot: '主线',
          limit: 2,
          active_tasks: [
            { id: mainTask1Id, name: '主线一：核心存储迁移' },
            { id: mainTask2Id, name: '主线二：独立窗口与自动化同版' },
          ],
        });
        expect((await e2eRepos.tasks.list()).length).toBe(tasksBeforeFull);

        // (g) Convert idea into explicit 2nd main task (`mainTask2Id`), preserving idea details & attachments
        const convertOpId = randomUUID();
        const cliConvert = await callCliJson(
          [
            'idea',
            'convert',
            ideaId,
            '--task-id',
            mainTask2Id,
            '--operation-id',
            convertOpId,
            '--items-file',
            'conv-items.json',
          ],
          {
            files: {
              'conv-items.json': JSON.stringify([
                { content: '对齐 CLI 与 MCP 41 项契约', type: '结果卡', timebox_minutes: null },
                { content: '执行真实管道端到端回归', type: '时间盒卡', timebox_minutes: 30 },
              ]),
            },
          },
        );
        expect(cliConvert.exitCode).toBe(0);
        expect(cliConvert.body.result.data.idea.pool).toBe('已转任务');
        expect(cliConvert.body.result.data.idea.has_details).toBe(true);
        expect(cliConvert.body.result.data.idea).not.toHaveProperty('details_markdown');
        expect(cliConvert.body.result.data.task.id).toBe(mainTask2Id);
        expect(cliConvert.body.result.data.created_new_task).toBe(false);

        const detailsAfterConvert = await e2eRepos.records.getDetails(ideaId);
        expect(detailsAfterConvert?.body).toBe(mdInitial);
        expect(detailsAfterConvert?.value.attachments).toEqual(['attachments/arch-diagram.png']);

        const task2Details = await callCliJson(['task', 'show', mainTask2Id]);
        expect(task2Details.exitCode).toBe(0);
        expect(task2Details.body.result.items.length).toBe(4);
        for (const item of task2Details.body.result.items) {
          expect(item.content).not.toContain('https://example.com/spec');
        }

        const ctxAfterConvert = await callCliJson(['context', '--section', 'timer']);
        expect(ctxAfterConvert.body.result.timer.mode).toBe('idle');

        // (h) ADR 0029 Replay & Conflict
        const recordCountBeforeReplay = (await e2eRepos.records.list()).length;
        const replayConvert = await callCliJson(
          [
            'idea',
            'convert',
            ideaId,
            '--task-id',
            mainTask2Id,
            '--operation-id',
            convertOpId,
            '--items-file',
            'conv-items.json',
          ],
          {
            files: {
              'conv-items.json': JSON.stringify([
                { content: '对齐 CLI 与 MCP 41 项契约', type: '结果卡', timebox_minutes: null },
                { content: '执行真实管道端到端回归', type: '时间盒卡', timebox_minutes: 30 },
              ]),
            },
          },
        );
        expect(replayConvert.exitCode).toBe(0);
        expect(replayConvert.body.result.replayed).toBe(true);
        expect(replayConvert.body.result.data).toEqual(cliConvert.body.result.data);

        const conflictConvert = await callCliJson([
          'idea',
          'convert',
          ideaId,
          '--task-id',
          mainTask2Id,
          '--operation-id',
          convertOpId,
          '--item',
          '篡改后的事项内容',
        ]);
        expect(conflictConvert.exitCode).toBe(3);
        expect(conflictConvert.body.error.code).toBe('OPERATION_CONFLICT');
        expect((await e2eRepos.records.list()).length).toBe(recordCountBeforeReplay);
      } finally {
        await mcpClient.close();
        await mcpServer.close();
        await new Promise<void>((resolveClose) => pipeServer.close(() => resolveClose()));
      }

      // =========================================================================
      // 3. v2 -> v3 Migration Drill & Backup Verification
      // =========================================================================
      const migDrillDir = join(workRoot, 'mig-drill');
      mkdirSync(join(migDrillDir, 'records'), { recursive: true });
      mkdirSync(join(migDrillDir, 'tasks'), { recursive: true });
      mkdirSync(join(migDrillDir, 'cards'), { recursive: true });

      const v2Files: Record<string, string> = {
        'state.yaml': stringify({ ...initialState, schemaVersion: 2 }),
        'settings.yaml': stringify({ ...defaults, schemaVersion: 2, mainTasks: 1 }),
        'records/00000000-0000-4000-8000-000000000001.md':
          '---\nid: 00000000-0000-4000-8000-000000000001\nkind: 想法\ntext: "单行标题镜像 #标签1"\ntags:\n  - 标签1\npool: 活跃池\ncreated_at: "2026-11-01T10:00:00.000Z"\nlast_touched_at: "2026-11-01T10:00:00.000Z"\ndue_at: null\nblocking: false\ntask_id: null\ncard_id: null\nattachments: []\nneeds: null\ncold_since: null\n---\n单行标题镜像 #标签1',
        'records/00000000-0000-4000-8000-000000000002.md':
          '---\nid: 00000000-0000-4000-8000-000000000002\nkind: 想法\ntext: "看视频\\n稍后看 https://example.com/a\\n#服务器"\ntags:\n  - 服务器\npool: 活跃池\ncreated_at: "2026-11-01T10:05:00.000Z"\nlast_touched_at: "2026-11-01T10:05:00.000Z"\ndue_at: null\nblocking: false\ntask_id: null\ncard_id: null\nattachments: []\nneeds: null\ncold_since: null\n---\n看视频\r\n稍后看 https://example.com/a\r\n#服务器',
        'records/00000000-0000-4000-8000-000000000003.md':
          '---\nid: 00000000-0000-4000-8000-000000000003\nkind: 想法\ntext: "首行标题\\n第二行说明"\ntags: []\npool: 活跃池\ncreated_at: "2026-11-01T10:10:00.000Z"\nlast_touched_at: "2026-11-01T10:10:00.000Z"\ndue_at: null\nblocking: false\ntask_id: null\ncard_id: null\nattachments: []\nneeds: null\ncold_since: null\n---\n',
        'records/00000000-0000-4000-8000-000000000004.md':
          '---\nid: 00000000-0000-4000-8000-000000000004\nkind: 想法\ntext: "外部追加标题"\ntags: []\npool: 活跃池\ncreated_at: "2026-11-01T10:15:00.000Z"\nlast_touched_at: "2026-11-01T10:15:00.000Z"\ndue_at: null\nblocking: false\ntask_id: null\ncard_id: null\nattachments: []\nneeds: null\ncold_since: null\n---\n外部追加标题\n这是外部编辑器追加的第二段',
        'records/00000000-0000-4000-8000-000000000005.md':
          '---\nid: 00000000-0000-4000-8000-000000000005\nkind: 想法\ntext: "标题A\\n摘要R"\ntags: []\npool: 活跃池\ncreated_at: "2026-11-01T10:20:00.000Z"\nlast_touched_at: "2026-11-01T10:20:00.000Z"\ndue_at: null\nblocking: false\ntask_id: null\ncard_id: null\nattachments: []\nneeds: null\ncold_since: null\n---\n独立长正文B',
        'records/00000000-0000-4000-8000-000000000006.md':
          '---\nid: 00000000-0000-4000-8000-000000000006\nkind: 想法\ntext: ""\ntags: []\npool: 活跃池\ncreated_at: "2026-11-01T10:25:00.000Z"\nlast_touched_at: "2026-11-01T10:25:00.000Z"\ndue_at: null\nblocking: false\ntask_id: null\ncard_id: null\nattachments: []\nneeds: null\ncold_since: null\n---\n仅有详情正文无标题',
        'records/00000000-0000-4000-8000-000000000007.md':
          '---\nid: 00000000-0000-4000-8000-000000000007\nkind: 待办\ntext: "待办记录保持不变 #待办"\ntags:\n  - 待办\npool: null\ncreated_at: "2026-11-01T10:30:00.000Z"\nlast_touched_at: "2026-11-01T10:30:00.000Z"\ndue_at: null\nblocking: false\ntask_id: null\ncard_id: null\nattachments: []\nneeds: null\ncold_since: null\n---\n待办记录保持不变 #待办',
      };

      for (const [rel, content] of Object.entries(v2Files)) {
        const abs = join(migDrillDir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, 'utf8');
      }

      const { fs: drillFs } = createDiskFs(migDrillDir);
      const drillRes = await migrateV3(drillFs, { now: isoNow, id: () => randomUUID() });
      expect(drillRes.migrated).toBe(true);
      expect(drillRes.backup).toBeTruthy();

      for (const [rel, content] of Object.entries(v2Files)) {
        const backupBytes = readFileSync(join(migDrillDir, drillRes.backup!, rel));
        expect(sha256Hex(backupBytes)).toBe(sha256Hex(Buffer.from(content, 'utf8')));
      }

      const drillRepos = createRepos(drillFs);
      expect((await drillRepos.state.read()).schemaVersion).toBe(3);
      expect((await new SettingsRepo(drillFs).read()).mainTasks).toBe(2);

      // Explicitly assert all 6 ADR 0026 mapping cases + non-idea record preservation on real disk
      const migCase1 = await drillRepos.records.getDetails('00000000-0000-4000-8000-000000000001');
      expect(migCase1?.value.text).toBe('单行标题镜像 #标签1');
      expect(migCase1?.body).toBe('');
      expect(migCase1?.hasDetails).toBe(false);

      const migCase2 = await drillRepos.records.getDetails('00000000-0000-4000-8000-000000000002');
      expect(migCase2?.value.text).toBe('看视频');
      expect(migCase2?.body).toBe('\n稍后看 https://example.com/a\n#服务器');
      expect(migCase2?.hasDetails).toBe(true);

      const migCase3 = await drillRepos.records.getDetails('00000000-0000-4000-8000-000000000003');
      expect(migCase3?.value.text).toBe('首行标题');
      expect(migCase3?.body).toBe('\n第二行说明');
      expect(migCase3?.hasDetails).toBe(true);

      const migCase4 = await drillRepos.records.getDetails('00000000-0000-4000-8000-000000000004');
      expect(migCase4?.value.text).toBe('外部追加标题');
      expect(migCase4?.body).toBe('\n这是外部编辑器追加的第二段');
      expect(migCase4?.hasDetails).toBe(true);

      const migCase5 = await drillRepos.records.getDetails('00000000-0000-4000-8000-000000000005');
      expect(migCase5?.value.text).toBe('标题A');
      expect(migCase5?.body).toBe('\n摘要R\n\n独立长正文B');
      expect(migCase5?.hasDetails).toBe(true);

      const migCase6 = await drillRepos.records.getDetails('00000000-0000-4000-8000-000000000006');
      expect(migCase6?.value.text).toBe('');
      expect(migCase6?.body).toBe('仅有详情正文无标题');
      expect(migCase6?.hasDetails).toBe(true);

      const migTodo = await drillRepos.records.getDetails('00000000-0000-4000-8000-000000000007');
      expect(migTodo?.value.kind).toBe('待办');
      expect(migTodo?.value.text).toBe('待办记录保持不变 #待办');
      const all6CasesVerified = Boolean(
        migCase1 && migCase2 && migCase3 && migCase4 && migCase5 && migCase6 && migTodo,
      );

      // 3b. Real-disk Interrupted Journal (state-first) Recovery Drill
      const migInterruptDir = join(workRoot, 'mig-interrupt');
      for (const [rel, content] of Object.entries(v2Files)) {
        const abs = join(migInterruptDir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, 'utf8');
      }
      const { fs: baseInterruptFs } = createDiskFs(migInterruptDir);
      let failAfterStateWrite = false;
      const faultyFs: FileSystem = {
        ...baseInterruptFs,
        async atomicWrite(relPath: string, text: string) {
          await baseInterruptFs.atomicWrite(relPath, text);
          if (relPath === 'state.yaml') {
            failAfterStateWrite = true;
            throw new Error('SIMULATED_CRASH_AFTER_STATE_YAML_WRITE');
          }
        },
      };
      await expect(
        migrateV3(faultyFs, { now: isoNow, id: () => randomUUID() }),
      ).rejects.toThrow('SIMULATED_CRASH_AFTER_STATE_YAML_WRITE');
      expect(failAfterStateWrite).toBe(true);
      // .journal/<id>.json is still present on disk while state.yaml is already at schemaVersion 3
      const pendingJournalsBefore = await baseInterruptFs.list('.journal');
      expect(pendingJournalsBefore.length).toBe(1);

      // Now recover with a clean FS instance and run migrateV3 again
      const { fs: recoverFs } = createDiskFs(migInterruptDir);
      const recoverRes = await migrateV3(recoverFs, { now: isoNow, id: () => randomUUID() });
      expect(recoverRes.migrated).toBe(false);
      const pendingJournalsAfter = await recoverFs.list('.journal');
      expect(pendingJournalsAfter.length).toBe(0);
      const recoveredRepos = createRepos(recoverFs);
      expect((await recoveredRepos.state.read()).schemaVersion).toBe(3);
      expect((await new SettingsRepo(recoverFs).read()).mainTasks).toBe(2);
      const recoveredCase5 = await recoveredRepos.records.getDetails('00000000-0000-4000-8000-000000000005');
      expect(recoveredCase5?.value.text).toBe('标题A');
      expect(recoveredCase5?.body).toBe('\n摘要R\n\n独立长正文B');
      const backupDirsAfterRecovery = readdirSync(join(migInterruptDir, 'backup'));
      expect(backupDirsAfterRecovery.length).toBe(1);
      const interruptedRecoveryVerified =
        pendingJournalsBefore.length === 1 &&
        pendingJournalsAfter.length === 0 &&
        backupDirsAfterRecovery.length === 1 &&
        recoveredCase5?.body === '\n摘要R\n\n独立长正文B';

      // =========================================================================
      // 4. Synthetic Scale & Storage Benchmark (100/1000 x 2KiB/64KiB + 2000 baseline)
      // =========================================================================
      function buildExactUtf8Body(targetBytes: number): string {
        const unit = '## 性能压测章节\n- 详情段落内容 https://example.com/perf #性能\n';
        const unitBuf = Buffer.from(unit, 'utf8');
        const fullRepeats = Math.floor(targetBytes / unitBuf.byteLength);
        const remBytes = targetBytes - fullRepeats * unitBuf.byteLength;
        // Pad remainder with ASCII characters + trailing newline so UTF-8 byte length is exact
        const tail = remBytes > 0 ? 'x'.repeat(Math.max(0, remBytes - 1)) + '\n' : '';
        const out = unit.repeat(fullRepeats) + tail;
        expect(Buffer.byteLength(out, 'utf8')).toBe(targetBytes);
        return out;
      }

      const scenarios = [
        { label: '100x2KiB', count: 100, bodyBytes: 2048 },
        { label: '100x64KiB', count: 100, bodyBytes: 65536 },
        { label: '1000x2KiB', count: 1000, bodyBytes: 2048 },
        { label: '1000x64KiB', count: 1000, bodyBytes: 65536 },
        { label: '2000x256B-baseline', count: 2000, bodyBytes: 256 },
      ];

      const benchmarkResults: Array<Record<string, unknown>> = [];

      for (const sc of scenarios) {
        const scDir = join(workRoot, `bench-${sc.label}`);
        mkdirSync(join(scDir, 'records'), { recursive: true });
        writeFileSync(join(scDir, 'state.yaml'), stringify({ ...initialState, schemaVersion: 3 }), 'utf8');
        writeFileSync(join(scDir, 'settings.yaml'), stringify({ ...defaults, schemaVersion: 3, mainTasks: 2 }), 'utf8');

        const bodyChunk = buildExactUtf8Body(sc.bodyBytes);
        const actualUtf8Bytes = Buffer.byteLength(bodyChunk, 'utf8');
        expect(actualUtf8Bytes).toBe(sc.bodyBytes);

        let targetId = '';
        for (let i = 0; i < sc.count; i++) {
          const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
          if (i === Math.floor(sc.count / 2)) targetId = id;
          const fileContent =
            `---\n` +
            `id: ${id}\n` +
            `kind: 想法\n` +
            `text: "压测想法标题 ${i + 1} #性能"\n` +
            `tags:\n  - 性能\n` +
            `pool: 活跃池\n` +
            `created_at: "2026-11-08T08:00:00.000Z"\n` +
            `last_touched_at: "2026-11-08T08:00:00.000Z"\n` +
            `due_at: null\n` +
            `blocking: false\n` +
            `task_id: null\n` +
            `card_id: null\n` +
            `attachments: []\n` +
            `needs: null\n` +
            `cold_since: null\n` +
            `---\n` +
            bodyChunk;
          writeFileSync(join(scDir, 'records', `${id}.md`), fileContent, 'utf8');
        }

        // 1a) TRUE Cold Start: brand-new FS + RecordRepo before any run() or warm cache exists
        const { fs: coldFs, stats: coldIoStats, reset: resetColdIo } = createDiskFs(scDir);
        const coldRepos = createRepos(coldFs);
        resetColdIo();
        const heapBeforeTrueCold = process.memoryUsage().heapUsed;
        const tCold0 = performance.now();
        const coldSummaries = await coldRepos.records.list();
        const trueColdMs = Number((performance.now() - tCold0).toFixed(2));
        const heapAfterTrueCold = process.memoryUsage().heapUsed;
        expect(coldSummaries.length).toBe(sc.count);
        expect('body' in coldSummaries[0]).toBe(false);
        const trueColdIo = { ...coldIoStats };
        expect(trueColdIo.readCalls).toBe(sc.count);

        // Now initialize ctxForBench on a second FS instance and measure warm cached list()
        const { fs: cFs, stats: ioStats, reset: resetIo } = createDiskFs(scDir);
        const repos = createRepos(cFs);
        const benchSettings = structuredClone(defaults);
        const ctxForBench = createContext({
          repos,
          settings: benchSettings,
          id: () => randomUUID(),
          now: () => isoNow,
          publish: () => {},
          log: async () => {},
          reminders: { update: async () => {} },
          random: () => 0,
        });
        await run(ctxForBench, async (tx) => {
          tx.state.current_card = null;
          tx.state.home_mode = 'guide';
        }, isoNow, { action: 'test.direct' });

        // 1b) Warm cache list() after initialization transaction
        resetIo();
        const heapBeforeWarm = process.memoryUsage().heapUsed;
        const t0 = performance.now();
        const summaries = await repos.records.list();
        const warmMs = Number((performance.now() - t0).toFixed(2));
        const heapAfterWarm = process.memoryUsage().heapUsed;
        expect(summaries.length).toBe(sc.count);
        expect('body' in summaries[0]).toBe(false);
        const warmIo = { ...ioStats };

        // 2) Single timer commit (start_timer) — does not re-parse or clone record bodies
        const ctxInit = await handleApplicationRequest(ctxForBench, {
          method: 'get_context',
          arguments: { sections: ['timer'] },
        });
        const expectedState = (ctxInit as { expected_state: string }).expected_state;
        resetIo();
        const t1 = performance.now();
        await handleApplicationRequest(ctxForBench, {
          method: 'start_timer',
          arguments: {
            operation_id: randomUUID(),
            expected_state: expectedState,
            description: '压测计时提交',
            project: '未分类',
            tags: ['性能'],
          },
        });
        const timerCommitMs = Number((performance.now() - t1).toFixed(2));
        const timerCommitIo = { ...ioStats };

        // 3) Single getDetails on-demand load
        resetIo();
        const t2 = performance.now();
        const detailObj = await repos.records.getDetails(targetId);
        const getDetailsMs = Number((performance.now() - t2).toFixed(2));
        expect(Buffer.byteLength(detailObj?.body ?? '', 'utf8')).toBe(sc.bodyBytes);
        const getDetailsIo = { ...ioStats };

        // 4) Single content save (update_idea via handleApplicationRequest)
        const detailsForRev = await handleApplicationRequest(ctxForBench, {
          method: 'get_idea_details',
          arguments: { idea_id: targetId },
        });
        const revToken = (detailsForRev as { idea: { record_revision: string } }).idea.record_revision;
        resetIo();
        const tSaveStart = performance.now();
        await handleApplicationRequest(ctxForBench, {
          method: 'update_idea',
          arguments: {
            operation_id: randomUUID(),
            idea_id: targetId,
            record_revision: revToken,
            title: '压测想法标题（已修改） #性能',
          },
        });
        const contentSaveMs = Number((performance.now() - tSaveStart).toFixed(2));
        const contentSaveIo = { ...ioStats };

        // 5) Full-text find_items query
        resetIo();
        const t4 = performance.now();
        const findOut = await handleApplicationRequest(ctxForBench, {
          method: 'find_items',
          arguments: { kind: 'idea', query: 'https://example.com/perf' },
        });
        const findMs = Number((performance.now() - t4).toFixed(2));
        expect((findOut as { ideas: unknown[] }).ideas.length).toBe(sc.count);
        const findIo = { ...ioStats };

        const dirUsage = totalDirBytes(scDir);

        benchmarkResults.push({
          scenario: sc.label,
          recordCount: sc.count,
          targetUtf8BodyBytesPerRecord: sc.bodyBytes,
          actualUtf8BodyBytesPerRecord: actualUtf8Bytes,
          detailsBytesPerRecord: actualUtf8Bytes,
          trueColdStart: {
            elapsedMs: trueColdMs,
            heapDeltaBytes: Math.max(0, heapAfterTrueCold - heapBeforeTrueCold),
            io: trueColdIo,
          },
          warmCachedList: {
            elapsedMs: warmMs,
            heapDeltaBytes: Math.max(0, heapAfterWarm - heapBeforeWarm),
            io: warmIo,
          },
          coldStart: {
            elapsedMs: trueColdMs,
            heapDeltaBytes: Math.max(0, heapAfterTrueCold - heapBeforeTrueCold),
            io: trueColdIo,
          },
          singleTimerCommit: { elapsedMs: timerCommitMs, io: timerCommitIo },
          openSingleDetails: { elapsedMs: getDetailsMs, io: getDetailsIo },
          saveSingleTitleOnly: { elapsedMs: contentSaveMs, io: contentSaveIo },
          findItemsFullText: { elapsedMs: findMs, io: findIo },
          diskUsage: dirUsage,
        });
      }

      const evidenceDir = resolve(process.cwd(), 'evidence');
      mkdirSync(evidenceDir, { recursive: true });

      const verificationReport = {
        version: '0.3.3',
        generatedAt: new Date().toISOString(),
        explicitRunCommand: 'npx vitest run -c evidence/0.3.3-p6-verification.config.ts',
        contracts: {
          totalMethods: allMethods.length,
          writeMethods: writeMethods.length,
          readOnlyMethods: readOnlyMethods.length,
          newMethods033: [
            'create_idea',
            'get_idea_details',
            'update_idea',
            'create_task',
            'convert_idea_to_task',
          ],
          rustReadOnlySynced: true,
          cliHelpSynced: true,
          automationGuideSynced: true,
        },
        realPipeE2E: {
          passed: true,
          scopeNote:
            'Node net.createServer Named Pipe + production ApplicationController + MCP SDK InMemoryTransport + CLI runCli + real Node disk FS. Does not replace native Rust mcp_bridge or installed WebView2 multi-window manual smoke.',
          verifiedScenarios: [
            'CLI idea create with --details-file & MCP get_idea_details readback',
            'Attachment preservation & record_revision SHA-256 canonical token',
            'Stale record_revision rejected with RECORD_CHANGED (zero write)',
            'Title-only update_idea preserves raw Markdown details',
            '2 coexisting main tasks via CLI task create + MCP create_task (slot_index 1 & 2)',
            '3rd main task rejected with TASK_CAPACITY_FULL + active_tasks context (zero write)',
            'convert_idea_to_task into explicit 2nd main task preserves idea details & attachments without copying into cards or starting timer',
            'Same operation_id replay returns first receipt even after state change; changed args with same operation_id rejected with OPERATION_CONFLICT',
          ],
        },
        migrationDrill: {
          passed: all6CasesVerified && interruptedRecoveryVerified,
          fromSchemaVersion: 2,
          toSchemaVersion: 3,
          settingsMainTasksMigratedFrom1To2: true,
          backupByteVerified: true,
          adr0026All6MappingCasesVerified: all6CasesVerified,
          interruptedJournalStateFirstRecoveryVerified: interruptedRecoveryVerified,
        },
      };

      writeFileSync(
        join(evidenceDir, '0.3.3-coder6-p6-implementation-verification.json'),
        JSON.stringify(verificationReport, null, 2) + '\n',
        'utf8',
      );
      const benchmarkPayload = {
        version: '0.3.3',
        revision: 'r2-corrected-utf8-and-true-cold-start',
        historicalR1Path: 'evidence/0.3.3-coder6-p6-storage-benchmark-historical-r1.json',
        historicalR1Note:
          'Historical r1 used JS string .slice(0, sc.bodyBytes) on multi-byte Chinese characters (actual UTF-8 bytes were 2432 / 77824 / 304 for nominal 2048 / 65536 / 256) and measured list() after an initial run() transaction had already populated the in-memory summary cache. This corrected r2 report generates exact UTF-8 byte lengths (Buffer.byteLength === targetUtf8BodyBytesPerRecord) and reports both trueColdStart (brand-new RecordRepo reading all files cold from disk) and warmCachedList (subsequent list() on warm cache).',
        generatedAt: new Date().toISOString(),
        explicitRunCommand: 'npx vitest run -c evidence/0.3.3-p6-verification.config.ts',
        notes:
          'Measured on real disk FS + RecordRepo summary-first architecture (ADR 0026). trueColdStart reads all record files on a brand-new RecordRepo instance to verify SHA-256 hashes and extract frontmatter summaries without retaining body strings in committed cache or transaction clones; warmCachedList measures subsequent list() after initialization.',
        scenarios: benchmarkResults,
      };
      writeFileSync(
        join(evidenceDir, '0.3.3-coder6-p6-storage-benchmark.json'),
        JSON.stringify(benchmarkPayload, null, 2) + '\n',
        'utf8',
      );
      writeFileSync(
        join(evidenceDir, '0.3.3-coder6-p6-storage-benchmark-corrected-r2.json'),
        JSON.stringify(benchmarkPayload, null, 2) + '\n',
        'utf8',
      );
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  }, 60000);
});
