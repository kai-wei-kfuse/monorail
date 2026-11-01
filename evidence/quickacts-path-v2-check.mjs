// Read-only verification of the revised v1.1 local path helpers against Node win32 & POSIX semantics.
import { posix, win32 } from 'node:path';

export function safeRelative(path) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.split('/').some(p => p === '..' || p === '.')) {
    throw new Error(`Unsafe relative path: ${path}`);
  }
  return path;
}

export function splitRoot(rawPath) {
  const sep = rawPath.includes('\\') ? '\\' : '/';
  let m;
  if ((m = /^([\\/]{2}[?.][\\/]UNC[\\/][^\\/]+[\\/][^\\/]+)(?:[\\/](.*))?$/i.exec(rawPath))) {
    return { root: m[1].replace(/[\\/]/g, sep), rest: m[2] ?? '', sep };
  }
  if ((m = /^([\\/]{2}[?.][\\/][A-Za-z]:)(?:[\\/](.*))?$/.exec(rawPath))) {
    return { root: `${m[1].replace(/[\\/]/g, sep)}${sep}`, rest: m[2] ?? '', sep };
  }
  if ((m = /^([\\/]{2}[^\\/?]+[\\/][^\\/]+)(?:[\\/](.*))?$/.exec(rawPath))) {
    return { root: m[1].replace(/[\\/]/g, sep), rest: m[2] ?? '', sep };
  }
  if ((m = /^([A-Za-z]:)(?:[\\/](.*))?$/.exec(rawPath))) {
    return { root: `${m[1]}${sep}`, rest: m[2] ?? '', sep };
  }
  if ((m = /^\/+(.*)$/.exec(rawPath))) {
    return { root: '/', rest: m[1] ?? '', sep: '/' };
  }
  return { root: '', rest: rawPath, sep };
}

function buildPath(root, sep, segments) {
  if (segments.length === 0) return root;
  const joined = segments.join(sep);
  if (!root || root.endsWith(sep)) return `${root}${joined}`;
  return `${root}${sep}${joined}`;
}

export function resolveLocal(baseRoot, relative) {
  const { root, rest, sep } = splitRoot(baseRoot);
  const baseSegments = rest.split(/[\\/]+/).filter(Boolean);
  const relSegments = safeRelative(relative).split('/').filter(Boolean);
  return buildPath(root, sep, [...baseSegments, ...relSegments]);
}

export function parentLocal(fullPath) {
  const { root, rest, sep } = splitRoot(fullPath);
  const segments = rest.split(/[\\/]+/).filter(Boolean);
  segments.pop();
  return buildPath(root, sep, segments);
}

const winRoots = [
  'C:\\',
  'C:/',
  'C:\\data',
  'C:\\data\\',
  'C:/用户 数据/',
  '\\\\server\\share',
  '\\\\server\\share\\',
  '\\\\server\\share\\嵌套 目录\\',
  '\\\\?\\C:\\',
  '\\\\?\\C:\\Users\\kai_wei\\AppData\\Roaming\\',
  '\\\\?\\UNC\\server\\share\\',
];

const relatives = ['settings.yaml', 'cards/abc-123.md', 'timelog/2026-11-01.md'];

const results = [];
for (const root of winRoots) {
  for (const rel of relatives) {
    const full = resolveLocal(root, rel);
    const parent = parentLocal(full);
    const expectedFull = win32.join(root, rel);
    const expectedParent = win32.dirname(expectedFull);
    const parentIsAbsolute = win32.isAbsolute(parent);
    const fullMatches = win32.normalize(full) === win32.normalize(expectedFull);
    const parentMatches = win32.normalize(parent) === win32.normalize(expectedParent);
    results.push({
      root,
      rel,
      full,
      parent,
      expectedParent,
      parentIsAbsolute,
      fullMatches,
      parentMatches,
    });
  }
}

const posixRoots = ['/var/data', '/var/data/', '/'];
for (const root of posixRoots) {
  for (const rel of relatives) {
    const full = resolveLocal(root, rel);
    const parent = parentLocal(full);
    const expectedFull = posix.join(root, rel);
    const expectedParent = posix.dirname(expectedFull);
    results.push({
      root,
      rel,
      full,
      parent,
      expectedParent,
      parentIsAbsolute: posix.isAbsolute(parent),
      fullMatches: posix.normalize(full) === posix.normalize(expectedFull),
      parentMatches: posix.normalize(parent) === posix.normalize(expectedParent),
    });
  }
}

const unsafeInputs = ['', '/abs', 'a\\b', 'C:foo', '../escape', 'a/../b', './a', 'a/./b'];
const unsafeRejected = unsafeInputs.every(input => {
  try {
    resolveLocal('C:\\data', input);
    return false;
  } catch {
    return true;
  }
});

const summary = {
  totalCases: results.length,
  failedCases: results.filter(r => !r.parentIsAbsolute || !r.fullMatches || !r.parentMatches),
  unsafeRejected,
  rootSample: results.filter(r => r.rel === 'settings.yaml'),
};

console.log(JSON.stringify(summary, null, 2));
if (summary.failedCases.length > 0 || !unsafeRejected) {
  console.error('PLAN_PATH_V2_CHECK_FAILED');
  process.exitCode = 1;
}
