$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir
& node ".\collector\index.mjs"

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "采集桥异常退出，错误码：$LASTEXITCODE" -ForegroundColor Red
}
