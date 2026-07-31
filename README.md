# LGG

基于 React、TypeScript、Vite、Supabase Auth 和 PostgreSQL 的英雄联盟内部 PVP
“天命”内战编排与多人共享战绩工具。

## 功能

- 共享选手库、默认费用和随机平衡分队。
- 按 OPGG Global 五路登场率随机英雄，并生成全局 Ban。
- 赛后手动提交正式结果；未提交的编排不计入战绩。
- 对局历史、选手排行榜、英雄排行榜和实时同步。
- 管理员维护选手并修正或删除错误比赛。
- `lgg_admin` 管理员账号与 `lgg` 公共提交账号。

## 项目结构

- `src/`：React + TypeScript 页面组件与应用入口。
- `assets/js/`：天命编排、战绩和客户端采集等兼容业务控制器。
- `vite.config.ts`：Vite 开发与生产构建配置。
- `assets/js/supabase-config.js`：浏览器可用的 Supabase 项目地址和发布密钥。
- `supabase/schema.sql`：表结构、触发器、RLS 权限和 Realtime 配置。
- `SUPABASE_SETUP.md`：Supabase 维护与恢复说明。
- `data/opgg-data.json`：GitHub Actions 每日生成的分路数据。
- `scripts/update-opgg.mjs`：OPGG 数据抓取器。
- `collector-go/`：Windows 本机采集桥，让网页在用户确认前读取并预览客户端对局数据。

## 对局采集器

先构建并双击 `collector-go/start-collector.cmd` 启动本机桥接服务，再在“记录正式比赛”
弹窗中点击“采集数据”。网页会展示双方、英雄、KDA、补刀和胜方，用户确认后
才会提交到 Supabase。详细说明见 `collector-go/README.md`。

## 本地开发

```bash
pnpm install
pnpm dev
```

生产构建与完整校验：

```bash
pnpm check
```
