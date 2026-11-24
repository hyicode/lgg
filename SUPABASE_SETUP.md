# Supabase 已停用

2026-11-24 已下载原项目完整备份，并将业务数据迁移至 Cloudflare D1。
游客数据只保存在浏览器；登录后的共享数据使用 D1。当前配置见 D1_SETUP.md。

原项目：LGG（gsswdsuiytprekjgrjqs，新加坡）。项目保持暂停，没有永久删除。
完整压缩备份、转换后的 JSON、D1 SQL 导出均保存在本机 backups/，不提交 Git、不发布到网站。
迁移核对结果：22 名选手、23 个游戏账号、29 场比赛。旧认证账号不迁移至 D1。

## 旧每日归档任务已移除

旧 Supabase 写入步骤及 scripts/sync-opgg.mjs 已删除。
Update OPGG data 继续每日采集英雄数据，仅写 data/opgg-data.json，成功后自动发布网站。
它不访问 Supabase，也不访问 D1；不再需要 SUPABASE_SECRET_KEY 等 Actions 凭证。
仓库中原有的 Supabase SQL 和禁用配置仅作为历史资料，不应重新启用。

## 从原始备份恢复本地数据

```powershell
py -3 scripts/convert-supabase-backup.py backups/original.backup.gz backups/lgg-backup.json
```

转换器仅提取 public 业务表，不导出认证密码、会话或密钥。
在游客模式使用“导入数据”加载 JSON；导入会替换当前浏览器数据，替换前可导出备份。
原始压缩备份仍可能含认证资料，请妥善保管。
