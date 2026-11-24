# LGG

基于 React、TypeScript、Vite 的英雄联盟内部 PVP“天命”内战编排工具。
默认以游客身份进入，无需账号或数据库，选手与比赛保存在当前浏览器。
配置 Cloudflare D1 后可主动登录云端共享数据；两种模式的选手、比赛、阵容与账号映射互相隔离。

## 功能

- 本地选手库、默认费用和随机平衡分队。
- 支持“经典天命”和“阵容先行”两套规则；阵容先行会先确认双方英雄，再随机分配选手队伍与位置。
- 按 OPGG Global 五路登场率随机英雄，并生成全局 Ban。
- 赛后手动提交正式结果；未提交的编排不计入战绩。
- 对局历史、选手排行榜、英雄排行榜和同源浏览器标签页同步。
- 维护本地选手并修正或删除错误比赛。
- JSON 导入、导出备份；导入替换前自动下载原有数据。
- 可选 D1 云端模式：成员查看和新增对局，管理员维护选手、修改与删除对局。游客不会请求 D1。

## 项目结构

- `src/`：React + TypeScript 应用入口、Hooks、领域模型和业务模块。
- `src/components/`：按界面职责拆分的 React 组件。
- `src/hooks/useAuth.ts`：游客和云端身份初始化。
- `cloudflare/`：D1 表结构、Worker API、服务端权限检查及部署配置。
- `src/auth/`：React 与迁移期控制器之间的类型化认证状态桥。
- `src/navigation/`：受权限约束的 React 页面导航状态。
- `src/services/`：旧数据库连接代码存档，当前应用不调用。
- `src/data/`：本地存储、备份校验、玩家和比赛的数据模型。
- `src/domain/`：经过 TypeScript 严格检查的搜索、战绩和客户端采集逻辑。
- `src/config/supabase.ts`：旧项目配置，已禁用。
- `src/controllers/`：由 React 生命周期加载的功能控制器；新状态优先放入 Hooks 和领域模块。
- `vite.config.ts`：Vite 开发与生产构建配置。
- `supabase/schema.sql`：表结构、触发器、RLS 权限和 Realtime 配置。
- `SUPABASE_SETUP.md`：数据迁移和旧 Supabase 资料。
- `data/opgg-data.json`：GitHub Actions 每日生成的位置数据。
- `scripts/update-opgg.mjs`：OPGG 数据抓取器。
- `collector-go/`：唯一保留的 Windows Go 本机代理，只转发 LOL 客户端接口；对局解析和确认由浏览器完成。
- `.github/workflows/deploy.yml`：在 Windows Runner 测试并构建采集器；`dev` 仅验证，`main` 验证通过后发布 Pages。

## 对局采集器

先构建并双击 `collector-go/start-collector.cmd` 启动 Go 本机代理，再在“记录正式比赛”
弹窗中点击“采集数据”。Go 程序只透明转发 LCU 请求，网页负责选择、解析并展示对局；
只有用户确认后才会保存到当前模式的数据源（游客本地 / 已登录云端）。详细说明见 `collector-go/README.md`。

## 数据备份与游客模式

页面顶部提供“导出数据 / 导入数据”。首次访问新浏览器为空选手库，可在“管理”新增选手，
或者导入 `lgg-backup` JSON。导入后立即恢复历史与排行榜；刷新后数据保留。
各设备、浏览器、站点域名使用独立数据，不自动同步。清理站点数据或使用无痕窗口可能丢失本地记录，
请定期导出备份。导出包含原始比赛快照和账号关联，排行榜从比赛重新计算。

原 Supabase 项目已暂停，不再用于应用运行。暂停项目下载的原始 `.backup.gz` 可以转换：

```powershell
py -3 scripts/convert-supabase-backup.py backups/original.backup.gz backups/lgg-backup.json
```

转换器仅提取 public 业务表，不把认证密码、会话和密钥放入游客版 JSON。
原始备份保留完整数据库内容，应妥善保存。`backups/` 已加入 Git 忽略，且不属于公开站点构建目录。
旧 SQL 脚本保留供归档使用。每日 OPGG 工作流只更新 JSON 文件，不再写数据库。

每日北京时间 00:23 采集五路英雄数据，最新结果写入 `data/opgg-data.json`，历史版本由 Git 保存。
采集成功后自动触发网站发布，将 JSON 复制到 GitHub Pages 的 `data/opgg-data.json`。
浏览器另缓存一份英雄池，供网络异常时继续使用；D1 只保存共享选手、账号和比赛。

## D1 免费套餐与云端模式

部署和备份迁移见 [D1_SETUP.md](D1_SETUP.md)。网站仍可放在 GitHub Pages，只有主动登录
云端的业务数据请求才通过 Worker 访问 D1。不配置接口地址时，网站正常运行游客模式。
两种模式不会自动合并、上传或相互覆盖；云端断线/额度不足会明确报错，不会静默写入游客缓存。
游客可以使用编排、本地选手管理、本地比赛记录/统计、采集及 JSON 备份，不能查看云端共享记录。

## 本地开发

```bash
pnpm install
pnpm dev
```

生产构建与完整校验：

```bash
pnpm check
```
