$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $serverRoot 'node.exe'
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
& $nodePath (Join-Path $serverRoot 'src\server.js') pair-code
