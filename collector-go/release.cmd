@echo off
chcp 65001 >nul
echo === LGG Collector Release Packager ===
echo.

cd /d "%~dp0"

set "DIST=%~dp0dist"
set "VERSION=v3.0.0"
set "PUBLIC=%~dp0..\public\collector"

if exist "%DIST%" rd /s /q "%DIST%"
mkdir "%DIST%\lgg-collector-%VERSION%" 2>nul

echo [1/4] 测试并编译 Go 转发代理...
go test ./...
if errorlevel 1 exit /b 1
set "CGO_ENABLED=0"
go build -trimpath -ldflags="-s -w" -o lgg-collector.exe .
if errorlevel 1 (
  echo 编译失败！
  pause
  exit /b 1
)

echo [2/4] 生成网页安装资源...
mkdir "%PUBLIC%" 2>nul
copy /y "lgg-collector.exe" "%PUBLIC%\" >nul
copy /y "install-collector.ps1" "%PUBLIC%\" >nul
copy /y "protocol-launcher.cmd" "%PUBLIC%\" >nul
copy /y "start-collector.cmd" "%PUBLIC%\" >nul

echo [3/4] 打包绿色版...

:: 复制必要文件
copy /y "lgg-collector.exe" "%DIST%\lgg-collector-%VERSION%\" >nul
copy /y "start-collector.cmd" "%DIST%\lgg-collector-%VERSION%\" >nul
copy /y "protocol-launcher.cmd" "%DIST%\lgg-collector-%VERSION%\" >nul
copy /y "register-protocol.ps1" "%DIST%\lgg-collector-%VERSION%\" >nul
copy /y "install-collector.ps1" "%DIST%\lgg-collector-%VERSION%\" >nul
copy /y "config.example.json" "%DIST%\lgg-collector-%VERSION%\" >nul
copy /y "README.md" "%DIST%\lgg-collector-%VERSION%\" >nul

echo [4/4] 创建压缩包...
powershell.exe -NoProfile -Command "Compress-Archive -Path '%DIST%\lgg-collector-%VERSION%' -DestinationPath '%DIST%\lgg-collector-%VERSION%.zip' -Force"

echo.
echo === 打包完成 ===
echo 输出目录：%DIST%\lgg-collector-%VERSION%\
echo 压缩包：  %DIST%\lgg-collector-%VERSION%.zip
echo.
dir "%DIST%\lgg-collector-%VERSION%\*" 2>nul
echo.
pause
