import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import imports from 'eslint-plugin-import';

const layers = ['shared', 'domain', 'data', 'platform', 'store', 'services', 'ui', 'widgets', 'pages'];
const allowed = {
  shared: [], domain: ['shared'], data: ['shared', 'domain'], platform: ['shared'],
  store: ['shared', 'domain'], services: ['shared', 'domain', 'data', 'platform', 'store'],
  ui: ['shared'], widgets: ['shared', 'services', 'store', 'ui'],
  pages: ['shared', 'widgets', 'services', 'store', 'ui'],
};
const zones = layers.flatMap(target => ['app', ...layers].filter(from => from !== target && !allowed[target].includes(from))
  .map(from => ({ target: `./src/${target}`, from: `./src/${from}` })));
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
