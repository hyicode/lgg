@echo off
chcp 65001 >nul
title LGG Collector
echo LGG 本机采集桥 (Go)
echo.

cd /d "%~dp0"

:: 检查是否已在运行
powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest 'http://127.0.0.1:32145/health' -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo 采集桥已在运行中。
  pause
  exit /b 0
)

:: 启动采集器
echo 正在启动采集器...
start "" "%~dp0lgg-collector.exe" --on-demand
echo.
echo 采集器已启动！
echo 返回 LGG 网页，点击"采集数据"即可使用。
echo.
pause
