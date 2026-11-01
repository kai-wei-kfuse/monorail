// Read-only check of the proposed path helpers, against Windows path semantics.
import { win32 } from 'node:path';

function proposed(root, relative) {
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const sep = cleanRoot.includes('\\') ? '\\' : '/';
  const full = `${cleanRoot}${sep}${relative.replace(/\//g, sep)}`;
  const idx = Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\'));
  return { full, parent: idx > 0 ? full.slice(0, idx) : full };
}

const roots = ['C:\\', 'C:/', 'C:\\data', 'C:\\data\\', 'C:/用户 数据/', '\\\\server\\share\\', '\\\\?\\C:\\'];
const results = roots.map(root => {
  const actual = proposed(root, 'settings.yaml');
  const expectedFull = win32.join(root, 'settings.yaml');
  const expectedParent = win32.dirname(expectedFull);
  return {
    root, ...actual, expectedParent,
    parentIsAbsolute: win32.isAbsolute(actual.parent),
    matchesExpected: win32.normalize(actual.parent) === win32.normalize(expectedParent),
  };
});
console.log(JSON.stringify(results, null, 2));
if (results.some(result => !result.parentIsAbsolute || !result.matchesExpected)) {
  console.error('PLAN_PATH_CHECK_FAILED: proposed parentOf loses a Windows volume root separator');
  process.exitCode = 1;
}
