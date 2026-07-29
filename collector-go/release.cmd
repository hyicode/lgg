@echo off
chcp 65001 >nul
echo === LGG Collector Release Packager ===
echo.

cd /d "%~dp0"

set "DIST=%~dp0dist"
set "VERSION=v1.0.0"

if exist "%DIST%" rd /s /q "%DIST%"
mkdir "%DIST%\lgg-collector-%VERSION%" 2>nul

echo [1/3] 编译...
go build -ldflags="-s -w" -o lgg-collector.exe .
if errorlevel 1 (
  echo 编译失败！
  pause
  exit /b 1
)

echo [2/3] 打包文件...

:: 复制必要文件
copy /y "lgg-collector.exe" "%DIST%\lgg-collector-%VERSION%\" >nul
copy /y "start-collector.cmd" "%DIST%\lgg-collector-%VERSION%\" >nul
copy /y "protocol-launcher.cmd" "%DIST%\lgg-collector-%VERSION%\" >nul
copy /y "register-protocol.ps1" "%DIST%\lgg-collector-%VERSION%\" >nul
copy /y "config.example.json" "%DIST%\lgg-collector-%VERSION%\" >nul
copy /y "README.md" "%DIST%\lgg-collector-%VERSION%\" >nul

echo [3/3] 创建压缩包...
powershell.exe -NoProfile -Command "Compress-Archive -Path '%DIST%\lgg-collector-%VERSION%' -DestinationPath '%DIST%\lgg-collector-%VERSION%.zip' -Force"

echo.
echo === 打包完成 ===
echo 输出目录：%DIST%\lgg-collector-%VERSION%\
echo 压缩包：  %DIST%\lgg-collector-%VERSION%.zip
echo.
dir "%DIST%\lgg-collector-%VERSION%\*" 2>nul
echo.
pause
