import { posix, win32 } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { sha256Hex, sha256HexBytes } from '../shared/sha256';
import { parentLocal, resolveLocal, tauriFs } from './fs';

const encoder = new TextEncoder();

const native = vi.hoisted(() => ({
  exists: vi.fn(), stat: vi.fn(), readFile: vi.fn(), readTextFile: vi.fn(), readDir: vi.fn(),
  mkdir: vi.fn(), writeTextFile: vi.fn(), rename: vi.fn(), remove: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-fs', () => native);
vi.mock('@tauri-apps/api/path', () => { throw new Error('Path IPC must not be used'); });

const info = { mtime: new Date('2026-11-01T00:00:00Z'), size: 7 };
beforeEach(() => {
  for (const mock of Object.values(native)) mock.mockReset();
  native.exists.mockResolvedValue(true);
  native.stat.mockResolvedValue(info);
  native.readFile.mockResolvedValue(encoder.encode('content'));
  native.readTextFile.mockResolvedValue('content');
  native.readDir.mockResolvedValue([]);
});

it('preserves absolute Windows/POSIX roots, shares, namespaces, separators and parent directories', () => {
  const windows = ['C:\\', 'C:/', 'C:\\data', 'C:\\data\\', 'C:/用户 数据/',
    '\\\\server\\share', '\\\\server\\share\\目录\\', '\\\\?\\C:\\', '\\\\.\\C:\\',
    '\\\\?\\UNC\\server\\share\\', '\\\\?\\Volume{1234}\\'];
  for (const root of windows) for (const relative of ['settings.yaml', 'cards/a.md', 'timelog/2026-11-01.md']) {
    const full = resolveLocal(root, relative), expected = win32.join(root, relative);
    expect(win32.normalize(full), root).toBe(win32.normalize(expected));
    expect(win32.normalize(parentLocal(full)), root).toBe(win32.normalize(win32.dirname(expected)));
    expect(win32.isAbsolute(parentLocal(full)), root).toBe(true);
  }
  for (const root of ['/', '/var/data/', '/用户 数据']) {
    const full = resolveLocal(root, 'cards/a.md');
    expect(full).toBe(posix.join(root, 'cards/a.md'));
    expect(parentLocal(full)).toBe(posix.dirname(full));
  }
  expect(parentLocal(resolveLocal('C:\\', 'settings.yaml'))).toBe('C:\\');
  expect(parentLocal(resolveLocal('C:/', 'settings.yaml'))).toBe('C:/');
});

it('keeps the existing relative-path boundary and rejects relative data-directory roots', () => {
  for (const path of ['', '/abs', 'a\\b', 'C:foo', '../escape', 'a/../b', './a']) {
    expect(() => resolveLocal('C:\\data', path)).toThrow('Unsafe relative path');
  }
  for (const root of ['', 'data', 'C:', 'C:relative', '\\\\server']) {
    expect(() => resolveLocal(root, 'settings.yaml')).toThrow('Data directory must be absolute');
  }
});

it('reads existing files with exactly three FS requests, starting stat and raw byte read together, and preserves UTF-8 BOM & CRLF bytes', async () => {
  let readingBytes = false;
  native.stat.mockImplementation(() => new Promise((resolve, reject) => queueMicrotask(() => {
    if (!readingBytes) reject(new Error('stat and readFile were serialized'));
    else resolve(info);
  })));
  native.readFile.mockImplementation(async () => { readingBytes = true; return encoder.encode('content'); });
  const fs = await tauriFs('C:\\data');
  expect(await fs.read('settings.yaml')).toEqual({
    text: 'content',
    version: `${info.mtime.getTime()}:7`,
    byteHash: sha256Hex('content'),
  });
  expect(native.exists).toHaveBeenCalledExactlyOnceWith('C:\\data\\settings.yaml');
  expect(native.stat).toHaveBeenCalledExactlyOnceWith('C:\\data\\settings.yaml');
  expect(native.readFile).toHaveBeenCalledExactlyOnceWith('C:\\data\\settings.yaml');
  expect(native.readTextFile).not.toHaveBeenCalled();

  // Verify UTF-8 BOM (EF BB BF) and CRLF are preserved in both text and byteHash
  const bomCrlfBytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('第一行\r\n第二行\r\n')]);
  native.stat.mockResolvedValueOnce({ mtime: info.mtime, size: bomCrlfBytes.byteLength });
  native.readFile.mockResolvedValueOnce(bomCrlfBytes);
  const bomSnap = await fs.read('records/bom.md');
  expect(bomSnap?.text).toBe('\uFEFF第一行\r\n第二行\r\n');
  expect(bomSnap?.byteHash).toBe(sha256HexBytes(bomCrlfBytes));
});

it('returns null only for absent files and propagates disappearance or either read failure', async () => {
  const fs = await tauriFs('C:\\data');
  native.exists.mockResolvedValueOnce(false);
  expect(await fs.read('missing.md')).toBeNull();
  expect(native.stat).not.toHaveBeenCalled();
  expect(native.readFile).not.toHaveBeenCalled();
  for (const operation of [native.stat, native.readFile]) {
    const error = new Error('file disappeared or access denied');
    operation.mockRejectedValueOnce(error);
    await expect(fs.read('a.md')).rejects.toBe(error);
  }
});

it('keeps recursive listing sorted and creates atomic-write parents at the actual volume root', async () => {
  native.readDir.mockImplementation(async (path: string) => path === 'C:\\'
    ? [{ name: 'settings.yaml', isFile: true }, { name: 'cards', isDirectory: true }]
    : [{ name: 'a.md', isFile: true }]);
  const fs = await tauriFs('C:\\');
  expect(await fs.list('', true)).toEqual(['cards/a.md', 'settings.yaml']);
  await fs.atomicWrite('settings.yaml', 'updated');
  expect(native.mkdir).toHaveBeenCalledExactlyOnceWith('C:\\', { recursive: true });
  const temporary = native.writeTextFile.mock.calls[0][0] as string;
  expect(temporary).toMatch(/^C:\\settings\.yaml\.tmp-/);
  expect(native.rename).toHaveBeenCalledExactlyOnceWith(temporary, 'C:\\settings.yaml');
  await fs.remove('cards/a.md');
  expect(native.remove).toHaveBeenCalledExactlyOnceWith('C:\\cards\\a.md');
});
