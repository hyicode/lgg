@echo off
chcp 65001 >nul

set "EXE_PATH=%~dp0lgg-collector.exe"

powershell.exe -NoProfile -Command "try { $r = Invoke-RestMethod 'http://127.0.0.1:32145/health' -TimeoutSec 1; if ($r.runtime -eq 'go' -and $r.mode -eq 'proxy') { exit 0 }; exit 1 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 exit /b 0

if not exist "%EXE_PATH%" exit /b 2
start "" /min "%EXE_PATH%" --on-demand
exit /b 0
