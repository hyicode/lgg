param(
  [Parameter(Mandatory = $true)]
  [string]$SourceBase
)

$ErrorActionPreference = "Stop"
$source = $SourceBase.TrimEnd("/")
$installDir = Join-Path $env:LOCALAPPDATA "LGGCollector"
$exePath = Join-Path $installDir "lgg-collector.exe"
$launcherPath = Join-Path $installDir "protocol-launcher.cmd"
$startPath = Join-Path $installDir "start-collector.cmd"
$tempDir = Join-Path $env:TEMP ("LGGCollector-" + [Guid]::NewGuid().ToString("N"))

try {
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

  $tempExe = Join-Path $tempDir "lgg-collector.exe"
  $tempLauncher = Join-Path $tempDir "protocol-launcher.cmd"
  $tempStart = Join-Path $tempDir "start-collector.cmd"

  Write-Host "正在下载 Go 版 LGG 本机代理..." -ForegroundColor Cyan
  Invoke-WebRequest -UseBasicParsing "$source/lgg-collector.exe" -OutFile $tempExe
  Invoke-WebRequest -UseBasicParsing "$source/protocol-launcher.cmd" -OutFile $tempLauncher
  Invoke-WebRequest -UseBasicParsing "$source/start-collector.cmd" -OutFile $tempStart

  $oldProcesses = Get-CimInstance Win32_Process -Filter "Name = 'lgg-collector.exe'" -ErrorAction SilentlyContinue
  foreach ($process in $oldProcesses) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }

  Copy-Item -Force $tempExe $exePath
  Copy-Item -Force $tempLauncher $launcherPath
  Copy-Item -Force $tempStart $startPath

  $protocolRoot = "HKCU:\Software\Classes\lggcollector"
  New-Item -Path $protocolRoot -Force | Out-Null
  Set-Item -Path $protocolRoot -Value "URL:LGG Collector Protocol"
  New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -Force | Out-Null
  New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
  Set-Item -Path "$protocolRoot\shell\open\command" -Value "`"$launcherPath`" `"%1`""

  Start-Process -FilePath $exePath -ArgumentList "--on-demand" -WindowStyle Hidden
  Write-Host ""
  Write-Host "安装完成。Go 本机代理已经启动。" -ForegroundColor Green
  Write-Host "安装位置：$installDir"
  Write-Host "现在可以返回 LGG 网页并再次点击采集数据。"
} finally {
  if (Test-Path $tempDir) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
