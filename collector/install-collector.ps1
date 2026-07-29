param(
  [string]$SourceBase = "https://hyicode.github.io/lgg/collector"
)

$ErrorActionPreference = "Stop"
$installDir = Join-Path $env:LOCALAPPDATA "LGGCollector"
$tempDir = Join-Path $env:TEMP ("LGGCollector-" + [guid]::NewGuid().ToString("N"))
$sourceBase = $SourceBase.TrimEnd("/")

function Get-CollectorFile {
  param([string]$Name)
  $localFile = Join-Path $PSScriptRoot $Name
  $targetFile = Join-Path $installDir $Name
  if (Test-Path -LiteralPath $localFile) {
    Write-Host "正在安装 $Name..."
    Copy-Item -LiteralPath $localFile -Destination $targetFile -Force
  }
  else {
    Write-Host "正在下载 $Name..."
    Invoke-WebRequest -UseBasicParsing "$sourceBase/$Name" -OutFile $targetFile
  }
}

try {
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null

  $installedNode = Join-Path $installDir "node.exe"
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $installedNode) {
    Write-Host "已找到采集器运行环境。"
  }
  elseif ($nodeCommand) {
    Write-Host "正在复制 Node.js 运行环境..."
    Copy-Item -LiteralPath $nodeCommand.Source -Destination $installedNode -Force
  }
  else {
    Write-Host "正在下载 Node.js 运行环境，请稍候..."
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
    $releases = Invoke-RestMethod "https://nodejs.org/dist/index.json"
    $release = $releases |
      Where-Object { $_.lts -and $_.files -contains "win-$architecture-zip" } |
      Select-Object -First 1
    if (-not $release) {
      throw "未找到适用于当前电脑的 Node.js LTS 版本。"
    }
    $version = $release.version
    $archive = Join-Path $tempDir "node.zip"
    Invoke-WebRequest `
      -UseBasicParsing `
      "https://nodejs.org/dist/$version/node-$version-win-$architecture.zip" `
      -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $tempDir -Force
    $downloadedNode = Get-ChildItem -Path $tempDir -Filter node.exe -Recurse | Select-Object -First 1
    if (-not $downloadedNode) {
      throw "Node.js 运行环境下载不完整。"
    }
    Copy-Item -LiteralPath $downloadedNode.FullName -Destination $installedNode -Force
  }

  Get-CollectorFile "index.mjs"
  Get-CollectorFile "bridge-core.mjs"
  Get-CollectorFile "protocol-launcher.ps1"

  $protocolRoot = "HKCU:\Software\Classes\lggcollector"
  New-Item -Path $protocolRoot -Force | Out-Null
  Set-Item -Path $protocolRoot -Value "URL:LGG Collector Protocol"
  New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -Force | Out-Null
  New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
  $launcher = Join-Path $installDir "protocol-launcher.ps1"
  $command = "`"powershell.exe`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" `"%1`""
  Set-Item -Path "$protocolRoot\shell\open\command" -Value $command

  Write-Host "正在启动采集器..."
  & $launcher
  Write-Host ""
  Write-Host "LGG 采集器安装成功。" -ForegroundColor Green
  Write-Host "返回网页，点击“启动采集器”或“采集数据”即可使用。"
}
finally {
  if (Test-Path -LiteralPath $tempDir) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force
  }
}
