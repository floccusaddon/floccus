$ErrorActionPreference = 'Stop'
$serverRoot = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $serverRoot 'node.exe'
$nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
$serverPath = Join-Path $serverRoot 'src\server.js'
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Floccus Local.vbs'
$databasePath = Join-Path $env:LOCALAPPDATA 'FloccusLocal\floccus-local.sqlite3'

function Test-FloccusLocal {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:32145/api/v1/health' -TimeoutSec 2
    return $health.service -eq 'floccus-local'
  } catch {
    return $false
  }
}

function Wait-ForInput {
  Write-Host ''
  Write-Host '按 Enter 返回菜单...' -NoNewline
  [Console]::ReadLine() | Out-Null
}

function Show-Diagnostics {
  $running = Test-FloccusLocal
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$serverPath*start*" })
  $port = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 32145 -State Listen -ErrorAction SilentlyContinue
  $startupInstalled = Test-Path -LiteralPath $startupPath

  Write-Host '故障信息' -ForegroundColor Cyan
  Write-Host ('服务连接：' + $(if ($running) { '正常' } else { '失败' }))
  Write-Host ('端口 32145：' + $(if ($port) { '监听中' } else { '未监听' }))
  Write-Host ('服务进程：' + $(if ($processes.Count) { $processes.ProcessId -join ', ' } else { '未找到' }))
  Write-Host ('开机启动：' + $(if ($startupInstalled) { '已设置' } else { '未设置' }))
  Write-Host ('程序目录：' + $serverRoot)
  if (Test-Path -LiteralPath $databasePath) {
    $database = Get-Item -LiteralPath $databasePath
    Write-Host ('数据库：' + $database.FullName)
    Write-Host ('数据库大小：' + $database.Length + ' 字节')
    Write-Host ('最后写入：' + $database.LastWriteTime)
  } else {
    Write-Host ('数据库：尚未创建（' + $databasePath + '）')
  }
}

while ($true) {
  Clear-Host
  $running = Test-FloccusLocal
  $startupInstalled = Test-Path -LiteralPath $startupPath
  Write-Host 'Floccus Local' -ForegroundColor Cyan
  Write-Host ('服务：' + $(if ($running) { '运行中' } else { '未运行' })) -ForegroundColor $(if ($running) { 'Green' } else { 'Yellow' })
  Write-Host ('开机启动：' + $(if ($startupInstalled) { '已设置' } else { '未设置' }))
  Write-Host ''
  Write-Host '1. 生成配对码（自动复制）'
  Write-Host '2. 启动服务'
  Write-Host ('3. ' + $(if ($startupInstalled) { '取消开机启动（当前已设置）' } else { '设置开机启动（当前未设置）' }))
  Write-Host '4. 查看故障信息'
  Write-Host '5. 关闭菜单（同步继续运行）'
  Write-Host ''

  $choice = Read-Host '请输入 1-5'
  try {
    switch ($choice) {
      '1' {
        & (Join-Path $PSScriptRoot 'start-hidden.ps1')
        $code = & $nodePath $serverPath pair-code
        Set-Clipboard -Value ([string]$code)
        Start-Sleep -Milliseconds 200
        Write-Host ''
        Write-Host ('配对码：' + $code) -ForegroundColor Yellow
        Write-Host '已复制到剪贴板。每个配对码只能使用一次，有效期 15 分钟。' -ForegroundColor Green
        Wait-ForInput
      }
      '2' {
        & (Join-Path $PSScriptRoot 'start-hidden.ps1')
        Write-Host ''
        Write-Host '服务已运行。' -ForegroundColor Green
        Wait-ForInput
      }
      '3' {
        if ($startupInstalled) {
          & (Join-Path $PSScriptRoot 'uninstall-startup.ps1') | Out-Null
          Write-Host ''
          Write-Host '已取消开机启动。' -ForegroundColor Yellow
        } else {
          & (Join-Path $PSScriptRoot 'install-startup.ps1') | Out-Null
          Write-Host ''
          Write-Host '已设置开机启动。' -ForegroundColor Green
        }
        Wait-ForInput
      }
      '4' {
        Write-Host ''
        Show-Diagnostics
        Wait-ForInput
      }
      '5' { return }
      default {
        Write-Host ''
        Write-Host '请输入 1、2、3、4 或 5。' -ForegroundColor Yellow
        Wait-ForInput
      }
    }
  } catch {
    Write-Host ''
    Write-Host ('操作失败：' + $_.Exception.Message) -ForegroundColor Red
    Wait-ForInput
  }
}
