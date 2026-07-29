# LGG Collector 注册表注册脚本
# 以管理员身份运行此脚本以注册 lggcollector:// 协议

$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $installDir "lgg-collector.exe"
$launcherPath = Join-Path $installDir "protocol-launcher.cmd"

if (-not (Test-Path $exePath)) {
  Write-Host "错误：未找到 lgg-collector.exe" -ForegroundColor Red
  pause
  exit 1
}

$protocolRoot = "HKCU:\Software\Classes\lggcollector"
New-Item -Path $protocolRoot -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:LGG Collector Protocol"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -Force | Out-Null
New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
$command = "`"$launcherPath`" `"%1`""
Set-Item -Path "$protocolRoot\shell\open\command" -Value $command

Write-Host "lggcollector:// 协议注册成功。" -ForegroundColor Green
Write-Host "现在网页中的"启动采集器"按钮可以正常使用了。"
