# LGG

基于 GitHub Pages、Supabase Auth 和 PostgreSQL 的英雄联盟内部 PVP
抽签与多人共享战绩工具。

## 功能

- 共享选手库、默认费用和随机平衡分队。
- 按 OPGG Global 五路登场率随机英雄，并生成全局 Ban。
- 赛后手动提交正式结果；未提交的抽签不计入战绩。
- 对局历史、选手排行榜、英雄排行榜和实时同步。
- 管理员维护选手并修正或删除错误比赛。
- `lgg_admin` 管理员账号与 `lgg` 公共提交账号。

## 项目结构

- `index.html`、`assets/`：GitHub Pages 静态应用。
- `assets/js/supabase-config.js`：浏览器可用的 Supabase 项目地址和发布密钥。
- `supabase/schema.sql`：表结构、触发器、RLS 权限和 Realtime 配置。
- `SUPABASE_SETUP.md`：Supabase 维护与恢复说明。
- `data/opgg-data.json`：GitHub Actions 每日生成的分路数据。
- `scripts/update-opgg.mjs`：OPGG 数据抓取器。
