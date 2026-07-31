@echo off
chcp 65001 >nul
title LGG Collector Proxy
set "EXE_PATH=%~dp0lgg-collector.exe"

if not exist "%EXE_PATH%" (
  echo 未安装 Go 版 LGG 本机代理，请先从网页下载安装。
  pause
  exit /b 1
)

start "" /min "%EXE_PATH%" --on-demand
echo Go 本机代理已启动，可以返回 LGG 网页采集数据。
pause
