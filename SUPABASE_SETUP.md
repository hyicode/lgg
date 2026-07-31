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
4. 把新项目的 URL 和 Publishable Key 更新到 `assets/js/supabase-config.js`。

SQL 中的 RLS 保证：

- 两个有效账号都可以读取选手库和对局。
- 公共账号只能新增正式对局及该局缺失的 Riot 账号引用；不能新增选手，也不能修改或删除任何已落库数据。
- 只有 `lgg_admin` 可以维护选手、修正对局或删除对局。
- 未登录用户不能读写任何共享数据。
