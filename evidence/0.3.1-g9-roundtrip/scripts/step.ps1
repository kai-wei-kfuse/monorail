param([Parameter(Mandatory)][string]$Step, [Parameter(Mandatory)][string]$Tree, [Parameter(Mandatory)][string]$Test, [Parameter(Mandatory)][string]$Data, [string]$Base = '')
# 把 scripts/ 下的 nodeFs.ts 和指定测试拷进 worktree 的 src/rt/，在该 worktree 里用它自己的 vitest 跑，日志进 logs/，结果 json 进 results/。
$ErrorActionPreference = 'Stop'
$ev = Split-Path -Parent $PSScriptRoot
$wt = Join-Path $env:TEMP "monorail-rt-$Tree"
New-Item -ItemType Directory -Force "$wt\src\rt", "$ev\logs", "$ev\results" | Out-Null
Copy-Item "$PSScriptRoot\nodeFs.ts", "$PSScriptRoot\$Test" "$wt\src\rt\" -Force
$env:RT_DATA = Join-Path $env:TEMP "monorail-rt-data\$Data"
$env:RT_OUT = "$ev\results\$Step.json"
$env:RT_BASE = $Base
Push-Location $wt
try {
  $ErrorActionPreference = 'Continue'
  "# step=$Step tree=$wt commit=$(git rev-parse --short HEAD) data=$env:RT_DATA base=$Base node=$(node -v) tz=$([TimeZoneInfo]::Local.Id)" | Set-Content -Encoding utf8 "$ev\logs\$Step.log"
  node node_modules/vitest/vitest.mjs run "src/rt/$Test" 2>&1 | ForEach-Object { "$_" } | Tee-Object -Append "$ev\logs\$Step.log"
  "# exit=$LASTEXITCODE" | Add-Content -Encoding utf8 "$ev\logs\$Step.log"
  if ($LASTEXITCODE -ne 0) { throw "Round-trip test failed: $Step (exit $LASTEXITCODE)" }
} finally { Pop-Location }
