$ErrorActionPreference = 'Stop'
$startupDir = [Environment]::GetFolderPath('Startup')
$launcherPaths = @(
  (Join-Path $startupDir 'Floccus Local.vbs'),
  (Join-Path $startupDir 'Floccus Local.cmd')
)
$removed = $false
foreach ($launcherPath in $launcherPaths) {
  if (Test-Path -LiteralPath $launcherPath) {
    Remove-Item -LiteralPath $launcherPath -Force
    Write-Output "Removed startup launcher: $launcherPath"
    $removed = $true
  }
}
if (-not $removed) {
  Write-Output 'Floccus Local startup launcher is not installed.'
}
