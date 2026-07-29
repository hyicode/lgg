$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodePath = Join-Path $installDir "node.exe"
$bridgePath = Join-Path $installDir "index.mjs"

try {
  $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:32145/health" -TimeoutSec 1
  if ($health.StatusCode -eq 200) {
    exit 0
  }
}
catch {
  # 未启动时继续拉起。
}

Start-Process -FilePath $nodePath `
  -ArgumentList @($bridgePath, "--on-demand") `
  -WorkingDirectory $installDir `
  -WindowStyle Hidden
