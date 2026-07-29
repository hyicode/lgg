@echo off
chcp 65001 >nul

:: 协议启动器 - 由 lggcollector:// 协议调用
:: %1 = lggcollector://... 的完整 URL

set "COLLECTOR_DIR=%~dp0"
set "EXE_PATH=%COLLECTOR_DIR%lgg-collector.exe"

:: 检查采集器是否已在运行
powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest 'http://127.0.0.1:32145/health' -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 exit /b 0

:: 启动采集器
start "" "%EXE_PATH%" --on-demand
exit /b 0
