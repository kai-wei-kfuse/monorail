import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import imports from 'eslint-plugin-import';
import { readdirSync } from 'node:fs';

const layers = ['shared', 'domain', 'data', 'platform', 'store', 'services', 'ui', 'widgets', 'pages'];
const allowed = {
  shared: [], domain: ['shared'], data: ['shared', 'domain'], platform: ['shared'],
  store: ['shared', 'domain'], services: ['shared', 'domain', 'data', 'platform', 'store'],
  ui: ['shared'], widgets: ['shared', 'services', 'store', 'ui'],
  pages: ['shared', 'widgets', 'services', 'store', 'ui'],
};
const zones = layers.flatMap(target => ['app', ...layers].filter(from => from !== target && !allowed[target].includes(from))
  .map(from => ({ target: `./src/${target}`, from: `./src/${from}` })));
// 同一层内互不引用的单元：pages 下每个页面目录；widgets 下每个组件文件和每个子目录（.css 等资源不算单元）。
// 按目录现状生成，新加的页面或组件自动受约束。
const units = (dir, keep) => readdirSync(`./src/${dir}`, { withFileTypes: true })
  .filter(e => e.isDirectory() || (keep && /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)))
  .map(e => `./src/${dir}/${e.name}`);
const siblings = list => list.flatMap(target => list.filter(from => from !== target).map(from => ({ target, from })));
zones.push(...siblings(units('pages', false)), ...siblings(units('widgets', true)));
// Tracking cannot read card/task state; callers only use its public InTx API.
zones.push({ target: './src/services/tracking', from: './src/services', except: ['./tracking'] });
for (const name of ['card', 'task', 'picker', 'degrade', 'baseline', 'review', 'idea', 'record']) {
  zones.push({ target: './src/services/tracking', from: `./src/domain/${name}` });
  zones.push({ target: './src/domain/timeline', from: `./src/domain/${name}` });
}
for (const name of readdirSync('./src/services').filter(name => /\.ts$/.test(name) && !/\.test\.ts$/.test(name))) {
  zones.push({ target: `./src/services/${name}`, from: './src/services/tracking', except: ['./api.ts'] });
}

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  files: ['src/**/*.{ts,tsx}'],
  plugins: { import: imports },
  settings: { 'import/resolver': { typescript: { project: './tsconfig.json' } } },
  rules: {
    'import/no-restricted-paths': ['error', { zones }],
    'import/no-cycle': ['error', { ignoreExternal: true }],
    '@typescript-eslint/consistent-type-imports': 'error',
  },
});
