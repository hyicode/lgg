# 数据库已停用：使用游客本地模式

2026-11-24 已下载暂停项目的原始数据库备份，并转换成 `lgg-backup` JSON。
备份保存在本机 `backups/`（不提交 Git，不发布到网页）。
共 22 名选手、29 场比赛、23 个游戏账号、20 条战绩汇总、2 个旧账号档案；英雄归档表为空。
最晚比赛记录为 2026-09-29。原始下载文件名为 `db_cluster-16-10-2026@00-37-32.backup.gz`。

当前应用打开即以游客身份进入，不连接 Supabase。通过页面“导入数据”选择转换后的 JSON，
即可在当前浏览器使用原有数据。后续新增、编辑、删除只影响本地，不同步给其他设备。
用“导出数据”备份；导入另一份数据前会要求确认，并自动下载当前数据副本。

原数据库保持暂停，没有永久删除。不要再启用下方旧归档工作流或把后台密钥配置到 Actions。
下面仅保留旧系统资料供查阅，**不属于当前版本的部署步骤**。

---

# Supabase 配置与维护

当前项目已经完成初始化：

- 项目名：`LGG`
- 项目引用：`gsswdsuiytprekjgrjqs`
- 区域：新加坡
- 管理员：`lgg_admin`（对应 `lgg_admin@lgg.app`）
- 公共账号：`lgg`（对应 `lgg@lgg.app`）
- 公开注册：已关闭

浏览器端只保存 Supabase Project URL 和 Publishable Key，它们可以出现在公开仓库中。
密码、Secret Key、数据库密码和 Service Role Key 不得提交到 GitHub。

## 恢复数据库

如果以后重建项目：

1. 在 Supabase SQL Editor 运行 `supabase/schema.sql`。
2. 在 Authentication → Users 中手动创建上述两个邮箱账号，并设置各自密码。
3. 在 Authentication → Sign In / Providers 中关闭 `Allow new users to sign up`。
4. 把新项目的 URL 和 Publishable Key 更新到 `src/config/supabase.ts`，并更新 `.github/workflows/update-opgg.yml` 的 `SUPABASE_URL`。

## 每日英雄数据归档

每日 OPGG 工作流在北京时间 00:23 触发。抓取结果仍保存在
`data/opgg-data.json`，随后运行 `scripts/sync-opgg.mjs`，向
`public.opgg_daily_snapshots` 保存完整 JSON（含五路英雄数据及版本信息）。
按上海日期每天保留一条历史快照；同一天重跑会更新该条记录。
前端继续读取原 JSON 文件。数据库归档不对匿名或普通登录用户开放。

首次启用：

1. 在现有项目的 Supabase SQL Editor 执行 `supabase/opgg_daily_snapshots.sql`。
   新建项目运行完整 `supabase/schema.sql` 已包含此表。
2. 在 GitHub 仓库 Settings → Secrets and variables → Actions 新增仓库 Secret
   `SUPABASE_SECRET_KEY`，填入该 Supabase 项目的后台 Secret Key
   （`sb_secret_...`，也兼容旧版 `service_role` key）。此密钥有后台权限，
   仅交给可信仓库的 Actions，不要放入代码、前端配置或日志。
3. 将改动发布到默认分支后，在 Actions 手动运行 `Update OPGG data`。
   确认 `Archive daily hero data in Supabase` 成功，并在表中检查当天记录。

已有当天文件时也会执行同步；缺少密钥、数据不是当天、数据不完整或写入失败，
工作流会明确失败。同步安排在 JSON 提交之后，归档失败不会丢失本次文件更新；
修复配置后可重跑工作流。抓取失败时不使用旧数据伪装成当天快照。

实际数据库写入会产生使用活动，但免费项目仍按 Supabase 的低活跃规则判断，
不能保证每天一次归档就绝不会暂停。官方说明通常每天几次用户数据库请求足够；
付费套餐不受低活跃自动暂停影响：
https://supabase.com/docs/guides/platform/free-project-pausing

GitHub 定时任务也可能延迟或被禁用，应关注 Actions 失败通知；项目已经暂停时，
需先在控制台 Resume，归档脚本不能自动恢复暂停的项目。

SQL 中的 RLS 保证：

- 两个有效账号都可以读取选手库和对局。
- 公共账号只能新增正式对局及该局缺失的 Riot 账号引用；不能新增选手，也不能修改或删除任何已落库数据。
- 只有 `lgg_admin` 可以维护选手、修正对局或删除对局。
- 未登录用户不能读写任何共享数据。
