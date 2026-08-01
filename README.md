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

- `src/`：React + TypeScript 应用入口、Hooks、领域模型和业务模块。
- `src/components/`：按界面职责拆分的 React 组件。
- `src/domain/`：经过 TypeScript 严格检查的搜索、战绩和客户端采集逻辑。
- `src/config/supabase.ts`：浏览器可用的 Supabase 项目地址和发布密钥。
- `assets/js/app.js`：迁移期间的界面适配控制器；新业务逻辑不再放入此文件。
- `vite.config.ts`：Vite 开发与生产构建配置。
- `supabase/schema.sql`：表结构、触发器、RLS 权限和 Realtime 配置。
- `SUPABASE_SETUP.md`：Supabase 维护与恢复说明。
- `data/opgg-data.json`：GitHub Actions 每日生成的位置数据。
- `scripts/update-opgg.mjs`：OPGG 数据抓取器。
- `collector-go/`：唯一保留的 Windows Go 本机代理，只转发 LOL 客户端接口；对局解析和确认由浏览器完成。

## 对局采集器

先构建并双击 `collector-go/start-collector.cmd` 启动 Go 本机代理，再在“记录正式比赛”
弹窗中点击“采集数据”。Go 程序只透明转发 LCU 请求，网页负责选择、解析并展示对局；
只有用户确认后才会提交到 Supabase。详细说明见 `collector-go/README.md`。

## 本地开发

```bash
pnpm install
pnpm dev
```

生产构建与完整校验：

```bash
pnpm check
```
