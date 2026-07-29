@echo off
chcp 65001 >nul
title LGG Collector Installer
echo 正在准备 LGG 采集器安装程序...
set "INSTALLER=%TEMP%\LGGCollector-Install.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://hyicode.github.io/lgg/collector/install-collector.ps1' -OutFile '%INSTALLER%'"
if errorlevel 1 (
  echo.
  echo 安装程序下载失败，请检查网络后重试。
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" -SourceBase "https://hyicode.github.io/lgg/collector"
if errorlevel 1 (
  echo.
  echo 安装失败，请保留窗口中的错误信息。
  pause
  exit /b 1
)
echo.
pause
