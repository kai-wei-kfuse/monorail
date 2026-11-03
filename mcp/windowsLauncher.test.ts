import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchWindowsBackground } from '../client/windowsLauncher.ts';

test('Windows independent launcher reports WMI launch failure and preserves literal paths', { skip: process.platform !== 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'monorail-launcher-'));
  // These characters are legal in Windows paths, but meaningful in PowerShell.
  // A literal environment value must never become executable script text.
  const invalidExecutable = join(root, "单轨 '$('literal'); fake.exe");
  const monitor = launchWindowsBackground(invalidExecutable);
  try {
    const [code] = await once(monitor.process, 'close');
    assert.notEqual(code, 0);
    assert.match(monitor.diagnostics(), /Win32_Process.Create failed:/);
  } finally { monitor.release(); }
});

test('Windows independent launcher observes a real target that exits before readiness', { skip: process.platform !== 'win32' }, async () => {
  // Node rejects --background; the observer must exit rather than waiting forever.
  const monitor = launchWindowsBackground(process.execPath);
  try {
    const [code] = await once(monitor.process, 'close');
    assert.notEqual(code, 0);
  } finally { monitor.release(); }
});
