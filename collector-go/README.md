# LGG Collector Proxy (Go)

LGG 只保留这一套 Go 本机代理。它编译为单个 Windows EXE，无需 Node.js 或其他运行时。

## 职责边界

Go 程序只做三件事：

1. 发现本机 `LeagueClientUx.exe` 的 LCU 端口和临时令牌；
2. 将网页请求透明转发到 `/proxy/lcu/*` 或 `/proxy/live/*`；
3. 限制允许访问代理的网页来源，并在按需模式下自动退出。

它不会选择对局、解析玩家字段、判断位置、保存数据或向远端提交数据。这些业务逻辑全部在浏览器端完成。

## 网页安装

网页下载 `LGG-Collector-Setup.cmd` 后，会安装：

- `%LOCALAPPDATA%\LGGCollector\lgg-collector.exe`
- `lggcollector://` 协议启动器
- 手动启动脚本

安装器和网页分发文件位于 `public/collector/`。

## 构建

```cmd
cd collector-go
build.cmd
```

发布网页安装资源及绿色版压缩包：

```cmd
release.cmd
```

## 接口

| 接口 | 说明 |
|------|------|
| `GET /health` | 返回 Go 代理版本和运行模式 |
| `GET /discover` | 检查 LCU 是否可连接 |
| `/proxy/lcu/*` | 透明转发到 LCU |
| `/proxy/live/*` | 透明转发到 Live Client Data API |

`/collect` 和 `/recent-games` 不再存在。

## 参数

| 参数 | 说明 |
|------|------|
| `--on-demand` | 空闲 2 分钟后自动退出 |
| `--version` | 显示版本信息 |
