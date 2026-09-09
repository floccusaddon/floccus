param(
  [string]$NodePath = ''
)

$ErrorActionPreference = 'Stop'

$serverRoot = Split-Path -Parent $PSScriptRoot
$resolvedNodePath = if ($NodePath) { (Resolve-Path -LiteralPath $NodePath).Path } else { (Get-Command node.exe -ErrorAction Stop).Source }
$nodeVersion = & $resolvedNodePath -p "process.versions.node"
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -ne 24) {
  throw "Node.js 24 LTS is required to package the bundled runtime. Found $nodeVersion at $resolvedNodePath."
}

Push-Location $serverRoot
try {
  & npm.cmd ci --omit=dev
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }

  $resolvedServerRoot = [IO.Path]::GetFullPath($serverRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $releaseRoot = [IO.Path]::GetFullPath((Join-Path $serverRoot 'release\floccus-local-service'))
  if (-not $releaseRoot.StartsWith($resolvedServerRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace a release directory outside the server project: $releaseRoot"
  }
  if (Test-Path -LiteralPath $releaseRoot) {
    Remove-Item -LiteralPath $releaseRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $releaseRoot | Out-Null
  Copy-Item -LiteralPath $resolvedNodePath -Destination (Join-Path $releaseRoot 'node.exe')
  Copy-Item -LiteralPath (Join-Path $serverRoot 'package.json') -Destination $releaseRoot
  Copy-Item -LiteralPath (Join-Path $serverRoot 'package-lock.json') -Destination $releaseRoot
  Copy-Item -LiteralPath (Join-Path $serverRoot 'Floccus Local.cmd') -Destination $releaseRoot
  Copy-Item -LiteralPath (Join-Path $serverRoot 'src') -Destination $releaseRoot -Recurse
  Copy-Item -LiteralPath (Join-Path $serverRoot 'scripts') -Destination $releaseRoot -Recurse
  Copy-Item -LiteralPath (Join-Path $serverRoot 'node_modules') -Destination $releaseRoot -Recurse
  New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'doc') | Out-Null
  Copy-Item -LiteralPath (Join-Path $serverRoot '..\doc\FLOCCUS_LOCAL.md') -Destination (Join-Path $releaseRoot 'doc')
  Copy-Item -LiteralPath (Join-Path $serverRoot '..\doc\FLOCCUS_LOCAL.zh-CN.md') -Destination (Join-Path $releaseRoot 'doc')
  Compress-Archive -LiteralPath $releaseRoot -DestinationPath (Join-Path $serverRoot 'release\floccus-local-service-windows.zip') -Force
  Write-Output "Packaged service: $(Join-Path $serverRoot 'release\floccus-local-service-windows.zip')"
} finally {
  Pop-Location
}
