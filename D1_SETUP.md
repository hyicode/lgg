# Cloudflare D1 配置

当前项目的接口地址为 `https://lgg-api.hyicode.workers.dev`，数据库为 `lgg`（APAC）。
前端默认地址在 `src/config/cloud.ts`；`VITE_D1_API_URL` 可覆盖它。

## 数据与权限

- 游客：默认入口；全部业务读写走当前浏览器 `localStorage`，不向 Worker/D1 发请求。
- 云端成员：输入成员访问码后查看共享选手/比赛，新增比赛和缺失的游戏账号。
- 云端管理员：另用管理员访问码维护云端选手、修改和删除比赛。
- 访问码是本项目的凭证，不是 Cloudflare API Token；使用至少 32 字节随机生成值。
  Worker Secrets 保存访问码，前端仅将用户输入的访问码放在本标签页 `sessionStorage`，12 小时后需重新登录。
  这属于小团队共享访问码，不提供个人账号审计；轮换 Worker Secret 可立即撤销旧码。
- 退出云端会重新加载页面并恢复游客数据。游客与云端的选手、比赛、阵容、全局 BP、账号映射分别存储；不会自动上传游客记录。
- 每日英雄池继续由 GitHub Actions 生成静态 JSON，两种模式均可读取。它不需要数据库保活。

## 免费套餐

在 Cloudflare 控制台使用 Workers Free，不升级到付费套餐。
D1 免费额度目前为每天读取 500 万行、写入 10 万行，账户存储合计 5 GB，单库上限 500 MB；
Workers Free 每天 10 万次请求。超限可能导致接口失败，前端不会假装保存成功。
官方 D1 文档未列出因一周不访问就暂停数据库的规则，但仍需保留独立备份。

- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/

## 部署

1. 安装依赖并登录：

   ```powershell
   pnpm install
   pnpm exec wrangler login --scopes account:read user:read workers_scripts:write d1:write
   pnpm exec wrangler whoami
   ```

2. 在控制台确认账户为 Workers Free，创建数据库：

   ```powershell
   pnpm exec wrangler d1 create lgg --config cloudflare/wrangler.jsonc
   ```

   将返回的 `database_id` 写入 `cloudflare/wrangler.jsonc` 中已有的 `DB` 绑定，避免重复添加。
   `FRONTEND_ORIGINS` 设置为实际网站 origin（例如 `https://hyicode.github.io`，不含 `/lgg/` 路径）。
   正式发布可移除两个本地开发 origin。无需开放数据库本身，前端只知道 API 地址。

3. 应用表结构并导入已经核对的业务备份到**空库**：

   ```powershell
   pnpm d1:migrate:remote
   node --experimental-strip-types scripts/prepare-d1-import.mjs backups/lgg-backup-2026-11-24.json backups/d1-import.sql
   pnpm exec wrangler d1 execute lgg --remote --config cloudflare/wrangler.jsonc --file backups/d1-import.sql
   ```

   转换器仅导出 `players`、`riot_accounts`、`matches`，保留 ID、时间、参赛者 JSON 和账号引用。
   `player_stats` 从比赛实时重算；Supabase Auth、密码、profiles 和会话不迁移。
   使用普通 INSERT；重复导入报冲突，不覆盖现有数据。源文件与 SQL 均放在被忽略的 `backups/`，不要放进 `public/` 或 `data/`。

4. 使用两个独立、随机的长访问码，分别通过交互提示写入 Worker Secrets（不提交到 Git）：

   ```powershell
   pnpm exec wrangler secret put ADMIN_TOKEN --config cloudflare/wrangler.jsonc
   pnpm exec wrangler secret put MEMBER_TOKEN --config cloudflare/wrangler.jsonc
   pnpm d1:deploy
   ```

   访问码未配置时所有业务接口返回 401，避免未受保护的数据库访问。

5. 将部署得到的地址写入 `src/config/cloud.ts`，或设为 GitHub 仓库 Actions **变量**
   `VITE_D1_API_URL`，再运行网站构建/发布。这个变量只包含公开 API 地址，不能放访问码。
   本地开发可将该值写入被忽略的 `.env.local`。游客不会自动连接该地址。

6. 登录云端验证 22 名选手、23 个游戏账号、29 场历史比赛，并导出云端 JSON 与原备份逐字段比较。
   只有完成远端导入和核对，才能称为迁移完成；本地测试或生成 SQL 不代表已上线。

## 本地验证

```powershell
pnpm check
pnpm d1:migrate:local
pnpm d1:dev
```

本地访问码放在 `cloudflare/.dev.vars`（Git 忽略），不要使用正式凭证测试。
可另建一套本地预览构建设置 `VITE_D1_API_URL=http://127.0.0.1:8787`。

## 备份与恢复

云端页面的“导出云端备份”下载业务 JSON；D1 管理员也可导出 SQL：

```powershell
pnpm exec wrangler d1 export lgg --remote --config cloudflare/wrangler.jsonc --output backups/d1-export.sql
```

Supabase 原始压缩备份保留在本机 `backups/`。游客清理浏览器缓存前，先使用“导出数据”。
