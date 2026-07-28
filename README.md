# LGG Roll

单文件离线英雄联盟内部 PVP 随机工具。

- `LGG-Roll.html`：直接双击使用，断网时使用内置数据。
- `data/opgg-data.json`：GitHub Actions 生成的 OPGG Global 五路数据。
- `scripts/update-opgg.mjs`：抓取分路登场率与禁用率。

GitHub Actions 每天按北京时间检查一次。当天数据已存在时不会访问 OPGG；
否则更新 JSON。HTML 每个浏览器每天最多请求一次远端 JSON，失败时继续使用
本地缓存或内置快照。
