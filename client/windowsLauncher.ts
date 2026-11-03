import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export interface BackgroundMonitor {
  process: ChildProcess;
  release(): void;
  diagnostics(): string;
}

// A detached Node child still belongs to some MCP hosts' Windows cleanup tree.
// WMI creates the application independently. This watcher observes its real exit
// until the pipe reports ready, and can then be stopped without stopping the app.
const watcherScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  $commandLine = [char]34 + $env:MONORAIL_BACKGROUND_EXECUTABLE + [char]34 + ' --background'
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine }
  if ($created.ReturnValue -ne 0) { throw "Win32_Process.Create failed: $($created.ReturnValue)" }
  $application = [System.Diagnostics.Process]::GetProcessById([int]$created.ProcessId)
  $null = $application.Handle
  $application.WaitForExit()
  exit $application.ExitCode
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

/** Windows-only fixed background launch; no shell input or implicit fallback. */
export function launchWindowsBackground(executable: string): BackgroundMonitor {
  let stderr = '';
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(watcherScript, 'utf16le').toString('base64'),
  ], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, MONORAIL_BACKGROUND_EXECUTABLE: executable },
  });
  child.stderr!.setEncoding('utf8');
  const onData = (value: string) => { stderr += value; };
  child.stderr!.on('data', onData);
  let released = false;
  return {
    process: child,
    diagnostics: () => stderr.trim(),
    release() {
      if (released) return;
      released = true;
      child.stderr!.off('data', onData);
      child.stderr!.destroy();
      // This PID is only the observer. The WMI-created application has another parent.
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}
