import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function bundleNodeEntry({ entryPoint, outfile, forbiddenSubstrings = [] }) {
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    outfile,
    banner: {
      js: "import { createRequire as __monorailCreateRequire } from 'node:module'; const require = __monorailCreateRequire(import.meta.url);",
    },
  });
  if (forbiddenSubstrings.length > 0) {
    const content = await readFile(outfile, 'utf8');
    for (const token of forbiddenSubstrings) {
      if (content.includes(token)) {
        throw new Error(`Bundle ${outfile} unexpectedly contains forbidden dependency "${token}"`);
      }
    }
  }
}

export async function buildMcpBundle() {
  await bundleNodeEntry({
    entryPoint: 'mcp/main.ts',
    outfile: 'dist-mcp/monorail-mcp.mjs',
  });
}

export async function buildCliBundle() {
  await bundleNodeEntry({
    entryPoint: 'cli/main.ts',
    outfile: 'dist-cli/monorail-cli.mjs',
    forbiddenSubstrings: ['node_modules/@modelcontextprotocol', 'McpServer'],
  });
}

const isEntry =
  Boolean(process.argv[1]) &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isEntry) {
  const target = process.argv[2] ?? 'all';
  if (target === 'mcp') {
    await buildMcpBundle();
  } else if (target === 'cli') {
    await buildCliBundle();
  } else {
    await Promise.all([buildMcpBundle(), buildCliBundle()]);
  }
}
