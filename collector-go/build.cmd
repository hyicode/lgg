@echo off
chcp 65001 >nul
echo === LGG Collector Go Build ===
echo.

cd /d "%~dp0"

echo [1/2] 编译 Go 转发代理...
set "CGO_ENABLED=0"
go build -trimpath -ldflags="-s -w" -o lgg-collector.exe .
if errorlevel 1 (
  echo 编译失败！
  pause
  exit /b 1
)

echo [2/2] 生成完成。
echo.
echo 输出文件：%~dp0lgg-collector.exe
dir "%~dp0lgg-collector.exe" 2>nul
echo.
echo 绿色版使用说明：
echo   1. 将 lgg-collector.exe 放到任意目录
echo   2. 双击运行即可启动本机转发代理
echo   3. 如需自定义配置，在同目录创建 config.json
echo   4. 按需模式：lgg-collector.exe --on-demand
echo.
pause
