# LGG Collector (Go)

纯 Go 实现的英雄联盟对局数据采集桥，编译为单个 exe，无需安装 Node.js。

## 与 Node.js 版的区别

| 特性 | Node.js 版 | Go 版 |
|------|-----------|-------|
| 运行时依赖 | 需要 Node.js (~70MB) | 无 (单文件 exe) |
| 文件大小 | ~50KB 脚本 + Node.js | ~7MB 单文件 |
| 安装方式 | 下载脚本安装 | 直接复制 exe |
| 启动速度 | 较慢 | 即时 |

## 绿色版使用

1. 下载 `lgg-collector.exe`
2. 放到任意目录（如桌面）
3. 双击运行，或在网页中通过 `lggcollector://` 协议唤起
4. 如需自定义端口/域名，在同目录创建 `config.json`

```json
{
  "port": 32145,
  "allowedOrigins": [
    "https://hyicode.github.io"
  ]
}
```

## 构建

```cmd
cd collector-go
build.cmd
```

或者手动：

```bash
go build -ldflags="-s -w" -o lgg-collector.exe .
```

## 命令行参数

| 参数 | 说明 |
|------|------|
| `--on-demand` | 按需模式：空闲 2 分钟后自动退出 |
| `--version` | 显示版本信息 |
