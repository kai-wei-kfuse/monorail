import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPipeApplicationClient, type ApplicationClient } from '../client/applicationClient.ts';
import type { DesktopCallOptions } from '../client/pipe.ts';
import { inferMethodFromCommand, parseCliArgs, type ParseOptions } from './commands.ts';
import { executeCliCommand } from './execute.ts';
import { detectAgent } from './agentDetect.ts';
import { renderError, renderOutcome, type CliExitCode } from './output.ts';

export interface RunCliOptions extends ParseOptions {
  createClient?: () => ApplicationClient;
  /** 识别调用方用的环境变量（测试注入；缺省 process.env） */
  env?: Readonly<Record<string, string | undefined>>;
  pipe?: string;
  pipeOptions?: Omit<DesktopCallOptions, 'signal'>;
  signal?: AbortSignal;
  writeStdout?: (text: string) => void;
  writeStderr?: (text: string) => void;
}

function detectJsonFlag(argv: string[]): boolean {
  for (const token of argv) {
    if (token === '--') break;
    if (token === '--json') return true;
  }
  return false;
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<CliExitCode> {
  const writeStdout = options.writeStdout ?? (text => process.stdout.write(text + '\n'));
  const writeStderr = options.writeStderr ?? (text => process.stderr.write(text + '\n'));
  const jsonRequested = detectJsonFlag(argv);
  let inferredMethod = undefined;

  try {
    const parsed = await parseCliArgs(argv, options);
    inferredMethod = inferMethodFromCommand(parsed);
    const createClient =
      options.createClient ??
      (() => createPipeApplicationClient(options.pipe, options.pipeOptions));
    // 调用方：--agent / MONORAIL_AGENT → 已知 agent 环境变量 → 未识别（ADR 0019 第 6 条）
    const origin = { kind: 'cli' as const, agent: detectAgent(parsed.agent, options.env ?? process.env) };
    const outcome = await executeCliCommand(parsed, createClient, {
      signal: options.signal,
      origin,
    });
    const rendered = renderOutcome(outcome);
    writeStdout(rendered.stdout);
    return rendered.exitCode;
  } catch (error) {
    const rendered = renderError(error, {
      json: jsonRequested,
      method: inferredMethod,
    });
    if (rendered.stdout !== undefined) {
      writeStdout(rendered.stdout);
    }
    if (rendered.stderr !== undefined) {
      writeStderr(rendered.stderr);
    }
    return rendered.exitCode;
  }
}

async function main() {
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once('SIGINT', onSigint);
  try {
    const exitCode = await runCli(process.argv.slice(2), {
      signal: controller.signal,
    });
    process.exitCode = exitCode;
  } finally {
    process.off('SIGINT', onSigint);
  }
}

const isEntry =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isEntry) {
  void main();
}
