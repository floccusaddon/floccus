$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $serverRoot 'node.exe'
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }

try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:32145/api/v1/health' -TimeoutSec 2
  if ($health.service -eq 'floccus-local') { return }
} catch {}

Start-Process -FilePath $nodePath -ArgumentList @((Join-Path $serverRoot 'src\server.js'), 'start') -WorkingDirectory $serverRoot -WindowStyle Hidden

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 100
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:32145/api/v1/health' -TimeoutSec 2
    if ($health.service -eq 'floccus-local') { return }
  } catch {}
}
throw 'Floccus Local 服务启动失败。请运行“Floccus Local.cmd”，选择“查看故障信息”。'
