// Builds a hidden, isolated Tauri benchmark frontend; it never connects to a user's data/profile.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const environmentFile = 'evidence/0.2.5-latency-benchmark-environment.json';
const environment = JSON.parse(await readFile(environmentFile, 'utf8'));
const frontend = join(environment.root, 'frontend'), dataRoot = join(environment.root, 'data');
await mkdir(frontend, { recursive: true });
await mkdir(join(environment.baseline, 'evidence'), { recursive: true });
await copyFile('evidence/native-latency-driver.mjs', join(environment.baseline, 'evidence/native-latency-driver.mjs'));
const sizes = [
  { name: 'small', cards: 5, tasks: 2, records: 10, reviews: 1 },
  { name: 'large', cards: 60, tasks: 12, records: 100, reviews: 8 },
];
const scenarios = [];
for (const size of sizes) for (const variant of (size.name === 'small' ? ['baseline', 'optimized'] : ['optimized', 'baseline'])) {
  const root = join(dataRoot, `${size.name}-${variant}`);
  await mkdir(root, { recursive: true });
  scenarios.push({ variant, root, size });
}
const baseline = join(environment.baseline, 'evidence/native-latency-driver.mjs').replaceAll('\\', '/');
const optimized = resolve('evidence/native-latency-driver.mjs').replaceAll('\\', '/');
const source = `
import { measureVariant as baseline } from ${JSON.stringify(baseline)};
import { measureVariant as optimized } from ${JSON.stringify(optimized)};
import { invoke } from '@tauri-apps/api/core';
try {
  const rows = [];
  for (const scenario of ${JSON.stringify(scenarios)}) {
    await invoke('evidence', { message: 'latency-progress:' + scenario.size.name + ':' + scenario.variant });
    rows.push(...await (scenario.variant === 'baseline' ? baseline : optimized)(scenario.variant, scenario.root, scenario.size));
  }
  await invoke('evidence', { message: 'latency-result:' + JSON.stringify({ status: 'passed', rows }) });
} catch (error) {
  await invoke('evidence', { message: 'latency-result:' + JSON.stringify({ status: 'failed', error: String(error), stack: error?.stack }) });
  throw error;
}
`;
await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'js' },
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', nodePaths: [resolve('node_modules')],
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.DEV': 'false' },
  outfile: join(frontend, 'benchmark.js'), loader: { '.css': 'empty' },
  plugins: [{ name: 'count-real-sdk-invocations', setup(builder) {
    builder.onLoad({ filter: /@tauri-apps[\\/]api[\\/]core\.js$/ }, async ({ path }) => {
      const contents = await readFile(path, 'utf8');
      const call = 'return window.__TAURI_INTERNALS__.invoke(cmd, args, options);';
      if (contents.split(call).length !== 2) throw new Error('Tauri SDK invoke shape changed');
      return { contents: contents.replace(call, `
        const active = window.__latencyActive;
        if (active) active.ipc[cmd] = (active.ipc[cmd] ?? 0) + 1;
        ${call}`), loader: 'js' };
    });
  } }] });
await writeFile(join(frontend, 'bootstrap.js'), `
const report = message => window.__TAURI_INTERNALS__.invoke('evidence', { message });
window.addEventListener('error', event => report('latency-bootstrap-error:' + event.message));
window.addEventListener('unhandledrejection', event => report('latency-bootstrap-rejection:' + String(event.reason)));
await report('latency-bootstrap-ready');
try { await import('./benchmark.js'); }
catch (error) { await report('latency-result:' + JSON.stringify({ status: 'failed', error: String(error), stack: error?.stack })); }
`);
await writeFile(join(frontend, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="bootstrap.js"></script></body></html>');
await writeFile(join(frontend, 'blank.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
config.identifier = 'local.pixelrecord.latency.t' + environment.id;
config.productName = 'MonorailLatency' + environment.id;
config.build.beforeBuildCommand = null;
// A Windows drive prefix is parsed as a URL scheme by Tauri's FrontendDist union.
// Keep this a source-config-relative directory so assets use the bundled app protocol.
config.build.frontendDist = relative(resolve('src-tauri'), frontend).replaceAll('\\', '/');
for (const window of config.app.windows) {
  window.visible = false;
  window.title = 'Isolated latency benchmark ' + window.label;
  if (window.label === 'quickbar') window.url = 'blank.html';
}
config.app.security.capabilities = ['main', 'quickbar', 'mini', {
  identifier: 'latency-benchmark-data', windows: ['main'],
  permissions: [{ identifier: 'fs:scope', allow: [{ path: dataRoot }, { path: join(dataRoot, '**') }] }],
}];
environment.config = join(environment.root, 'tauri.benchmark.json');
environment.profile = join(process.env.APPDATA, config.identifier);
environment.executable = join(environment.root, 'Monorail-latency-benchmark.exe');
environment.scenarios = scenarios;
await writeFile(environment.config, JSON.stringify(config, null, 2));
await writeFile(environmentFile, JSON.stringify(environment, null, 2));
console.log(JSON.stringify({ config: environment.config, profile: environment.profile, frontend, scenarios }, null, 2));
