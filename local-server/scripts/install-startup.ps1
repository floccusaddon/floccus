$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path -Parent $PSScriptRoot
$startupDir = [Environment]::GetFolderPath('Startup')
$launcherPath = Join-Path $startupDir 'Floccus Local.vbs'
$bundledNode = Join-Path $serverRoot 'node.exe'
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
$serverPath = Join-Path $serverRoot 'src\server.js'
$escapedNode = $nodePath.Replace('"', '""')
$escapedServer = $serverPath.Replace('"', '""')
$command = 'CreateObject("WScript.Shell").Run """' + $escapedNode + '"" ""' + $escapedServer + '"" start", 0, False'
[IO.File]::WriteAllText($launcherPath, $command, [Text.UTF8Encoding]::new($false))
Write-Output "Installed startup launcher: $launcherPath"
