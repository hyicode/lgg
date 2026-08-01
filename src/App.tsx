import { useLegacyController } from "./hooks/useLegacyController";

function AuthGate() {
  return (
    <section className="auth-gate" id="authGate">
      <div className="login-card">
        <div className="eyebrow">League of Legends · Custom PVP</div>
        <h1>LGG</h1>
        <p>登录后进入天命、共享战绩与排行榜。</p>
        <form id="loginForm">
          <label>
            账号
            <input id="loginAccount" autoComplete="username" placeholder="请输入账号" required />
          </label>
          <label>
            密码
            <input id="loginPassword" type="password" autoComplete="current-password" required />
          </label>
          <button className="primary" id="loginBtn" type="submit">进入 LGG</button>
        </form>
        <div className="form-error" id="loginError" role="alert" />
        <div className="setup-warning hidden" id="supabaseSetupWarning">
          Supabase 尚未配置。请先填写 <code>assets/js/supabase-config.js</code>。
        </div>
      </div>
    </section>
  );
}

function AppHeader() {
  return (
    <>
      <header className="hero">
        <div className="hero-brand">
          <div className="eyebrow">League of Legends · Custom PVP</div>
          <h1>LGG · 天命</h1>
          <p>天命已定，胜负由你们共同记录。</p>
        </div>
        <div className="account-box">
          <span id="accountLabel" />
          <button className="mini" id="logoutBtn">退出</button>
        </div>
      </header>

      <nav className="main-nav" aria-label="主功能">
        <button className="nav-btn active" data-view="rollView">天命</button>
        <button className="nav-btn" data-view="historyView">对局历史</button>
        <button className="nav-btn" data-view="leaderboardView">战绩排行</button>
        <button className="nav-btn admin-only hidden" data-view="adminView">管理</button>
      </nav>

      <div className="toolbar">
        <div><span className="status-dot" /><span id="dataStatus">正在加载位置数据…</span></div>
        <div className="toolbar-actions">
          <button
            className="mini admin-only hidden test-data-toggle"
            id="testDataModeBtn"
            type="button"
            aria-pressed="false"
          >
            测试数据：关
          </button>
          <button className="mini" id="localMappingsBtn">游戏 ID 映射</button>
          <button className="mini" id="heroStatsBtn">英雄数据</button>
          <button className="mini" id="resetBtn">清空阵容</button>
        </div>
      </div>
    </>
  );
}

function TeamSetup({ side, name }: { side: "blue" | "red"; name: string }) {
  return (
    <div className={`team${side === "red" ? " red" : ""}`}>
      <input type="hidden" id={`${side}Name`} defaultValue={name} />
      <div className="players" id={`${side}Players`} />
    </div>
  );
}

function ClashDivider() {
  return (
    <div className="clash-divider">
      <span className="clash-line" />
      <div className="draw-options-panel">
        <div className="draw-options-head">
          <strong>天命规则</strong>
          <span className="bp-cycle-summary">
            <strong className="bp-round" id="globalBpRound">第 1 / 5 轮</strong>
            <button className="bp-details-button" id="globalBpDetailsBtn" type="button">BP 详情</button>
          </span>
        </div>
        <div className="draw-options-grid">
          <label className="draw-option" title="重新随机蓝红双方阵容">
            <input type="checkbox" id="randomTeams" defaultChecked />
            <span><strong>随机分队</strong></span>
          </label>
          <label className="draw-option" title="随机交换选手所在的固定位置牌">
            <input type="checkbox" id="randomPositions" defaultChecked />
            <span><strong>随机位置</strong></span>
          </label>
          <label className="draw-option" title="按位置英雄池随机抽取">
            <input type="checkbox" id="randomHeroes" defaultChecked />
            <span><strong>随机英雄</strong></span>
          </label>
          <label className="draw-option" title="本局双方英雄不能相同">
            <input type="checkbox" id="uniqueHeroes" defaultChecked />
            <span><strong>禁止英雄重复</strong></span>
          </label>
          <label className="draw-option global-bp-option" title="记录本局后计入一轮，已用英雄后续不可再选，第五轮后自动重置">
            <input type="checkbox" id="globalBp" defaultChecked />
            <span><strong>全局 BP</strong></span>
          </label>
        </div>
        <div className="global-bp-status">
          <span id="globalBpStatus">已禁用 0 个英雄</span>
          <button className="mini" id="clearGlobalBpBtn" type="button">清空</button>
        </div>
      </div>
      <span className="clash-matchup">
        <span className="clash-team-cost blue" id="blueCost">费用 0</span>
        <span className="clash-emblem" role="img" aria-label="蓝方对阵红方">
          <span className="clash-icon"><span className="clash-glyph">⚔</span></span>
          <span className="clash-vs">VS</span>
        </span>
        <span className="clash-team-cost red" id="redCost">费用 0</span>
      </span>
      <div className="control clash-controls">
        <div className="draw-actions">
          <button className="roll" id="rollBtn">开启天命！</button>
          <button className="reveal hidden" id="revealBtn">揭晓天命</button>
          <button className="primary hidden" id="recordBtn">记录本局</button>
          <button className="ghost hidden" id="againBtn">再启天命</button>
          <button className="ghost hidden" id="backBtn">调整阵容</button>
        </div>
      </div>
      <span className="clash-line" />
    </div>
  );
}

function RollView() {
  return (
    <section className="view" id="rollView">
      <section id="setupSection">
        <div className="setup">
          <TeamSetup side="blue" name="蓝方" />
          <ClashDivider />
          <TeamSetup side="red" name="红方" />
        </div>
        <div className="form-error" id="rollError" role="alert" />
      </section>

      <section className="arena" id="arena" aria-live="polite">
        <div className="ban-list" id="banListLeft" />
        <div className="results" id="results" />
        <div className="ban-list" id="banListRight" />
      </section>
      <div className="fate-fx-layer" id="fateFxLayer" aria-hidden="true" />
    </section>
  );
}

function DateRangeFilters({ prefix }: { prefix: "history" | "rank" | "adminMatch" }) {
  return (
    <>
      <select id={`${prefix}Range`} defaultValue="all">
        <option value="all">全部时间</option>
        <option value="7">最近 1 周</option>
        <option value="30">最近 30 天</option>
        <option value="custom">自定义</option>
      </select>
      <input className="hidden" id={`${prefix}From`} type="date" aria-label="开始日期" />
      <input className="hidden" id={`${prefix}To`} type="date" aria-label="结束日期" />
    </>
  );
}

function HistoryView() {
  return (
    <section className="view hidden" id="historyView">
      <div className="section-head">
        <div><h2>对局历史</h2><p>仅手动提交的比赛会出现在这里。</p></div>
        <div className="filters">
          <button className="ghost" id="manualMatchBtn">录入历史对局</button>
          <DateRangeFilters prefix="history" />
        </div>
      </div>
      <div className="match-list" id="matchList" />
      <div className="pager">
        <button className="ghost" id="historyPrev">上一页</button>
        <span id="historyPage" />
        <button className="ghost" id="historyNext">下一页</button>
      </div>
    </section>
  );
}

function LeaderboardView() {
  return (
    <section className="view hidden" id="leaderboardView">
      <div className="section-head">
        <div><h2>共享战绩</h2><p>按正式提交的对局实时计算。</p></div>
        <div className="filters"><DateRangeFilters prefix="rank" /></div>
      </div>
      <div className="summary-grid" id="summaryGrid" />
      <div className="rank-tools">
        <input className="search-input" id="rankSearch" type="search" placeholder="支持中文、拼音或首字母…" />
        <label>最少场次 <input id="minGames" type="number" min="1" defaultValue="1" /></label>
      </div>
      <div className="rank-grid">
        <section className="panel">
          <h3>选手排行榜</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>选手</th><th>场次</th><th>胜负</th><th>胜率</th><th>连胜</th><th>常用位置 / 英雄</th></tr></thead>
              <tbody id="playerRankBody" />
            </table>
          </div>
        </section>
        <section className="panel">
          <h3>英雄排行榜</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>英雄</th><th>登场</th><th>胜场</th><th>胜率</th><th>Ban</th><th>出现率</th></tr></thead>
              <tbody id="championRankBody" />
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}

function AdminView() {
  return (
    <section className="view hidden" id="adminView">
      <div className="section-head">
        <div><h2>管理员控制台</h2><p>维护共享选手库并修正正式比赛。</p></div>
        <div className="admin-head-actions admin-only hidden">
          <button className="ghost" id="adminReconcileBtn" type="button">数据校对</button>
          <button className="ghost" id="testFillBtn" type="button">测试填充阵容</button>
        </div>
      </div>
      <div className="admin-reconcile-status hidden" id="adminReconcileStatus" role="status" aria-live="polite" />
      <div className="admin-grid">
        <section className="panel">
          <h3>选手库</h3>
          <form className="inline-form" id="playerForm">
            <input id="playerName" maxLength={24} placeholder="选手名称" required />
            <input id="playerCost" type="number" min="0" step="0.5" defaultValue="1" required />
            <button className="primary" type="submit">新增选手</button>
          </form>
          <input
            className="search-input"
            id="adminPlayerSearch"
            type="search"
            placeholder="搜索选手…"
            style={{ width: "100%", marginBottom: 10 }}
          />
          <div className="admin-batch-toolbar admin-only hidden">
            <label className="admin-batch-select">
              <input id="adminPlayerSelectAll" type="checkbox" />
              <span>全选当前结果</span>
            </label>
            <span className="admin-batch-count" id="adminPlayerSelectionCount">已选 0 人</span>
            <div className="admin-batch-actions">
              <button className="mini" id="clearPlayerSelectionBtn" type="button">清空选择</button>
              <button className="mini" id="batchEnablePlayersBtn" type="button">批量启用</button>
              <button className="mini" id="batchDisablePlayersBtn" type="button">批量停用</button>
              <button className="mini" id="batchPlayerCostBtn" type="button">统一费用</button>
            </div>
          </div>
          <div id="adminPlayerList" className="admin-list" />
        </section>
        <section className="panel" id="adminMatchSection">
          <h3>对局管理</h3>
          <div className="filters" style={{ marginBottom: 10 }}>
            <DateRangeFilters prefix="adminMatch" />
          </div>
          <div className="admin-batch-toolbar admin-only hidden">
            <label className="admin-batch-select">
              <input id="adminMatchSelectAll" type="checkbox" />
              <span>全选当前结果</span>
            </label>
            <span className="admin-batch-count" id="adminMatchSelectionCount">已选 0 场</span>
            <div className="admin-batch-actions">
              <button className="mini" id="clearMatchSelectionBtn" type="button">清空选择</button>
              <button className="mini danger" id="batchDeleteMatchesBtn" type="button">批量删除</button>
            </div>
          </div>
          <div id="adminMatchList" className="admin-list" />
        </section>
      </div>
    </section>
  );
}

function MainApplication() {
  return (
    <main className="app hidden" id="app">
      <AppHeader />
      <RollView />
      <HistoryView />
      <LeaderboardView />
      <AdminView />
    </main>
  );
}

function DialogCloseButton() {
  return <button className="icon-btn" type="button" data-close-dialog aria-label="关闭">×</button>;
}

function CollectorPreview() {
  return (
    <section className="collector-box full">
      <div className="collector-head">
        <div>
          <strong>客户端对局数据</strong>
          <small id="collectorStatus">启动本机采集桥后即可读取赛后数据。</small>
        </div>
        <button className="ghost" id="collectMatchBtn" type="button">采集数据</button>
      </div>
      <div className="collector-preview hidden" id="collectorPreview">
        <div className="collector-meta" id="collectorMeta" />
        <div className="collector-team-layout">
          <section className="collector-team-panel blue" aria-label="蓝方采集数据">
            <div className="collector-team-title">
              <strong><span className="collector-team-mark">蓝</span> 蓝方</strong>
              <small id="collectorBlueCount">0 / 5 已匹配</small>
            </div>
            <div className="table-wrap collector-team-table">
              <table>
                <colgroup>
                  <col className="collector-col-player" />
                  <col className="collector-col-lane" />
                  <col className="collector-col-account" />
                  <col className="collector-col-champion" />
                  <col className="collector-col-kda" />
                </colgroup>
                <thead><tr><th>选手</th><th>位置</th><th>游戏 ID</th><th>英雄</th><th>K / D / A</th></tr></thead>
                <tbody id="collectorBlueBody" />
              </table>
            </div>
          </section>
          <section className="collector-team-panel red" aria-label="红方采集数据">
            <div className="collector-team-title">
              <strong><span className="collector-team-mark">红</span> 红方</strong>
              <small id="collectorRedCount">0 / 5 已匹配</small>
            </div>
            <div className="table-wrap collector-team-table">
              <table>
                <colgroup>
                  <col className="collector-col-player" />
                  <col className="collector-col-lane" />
                  <col className="collector-col-account" />
                  <col className="collector-col-champion" />
                  <col className="collector-col-kda" />
                </colgroup>
                <thead><tr><th>选手</th><th>位置</th><th>游戏 ID</th><th>英雄</th><th>K / D / A</th></tr></thead>
                <tbody id="collectorRedBody" />
              </table>
            </div>
          </section>
        </div>
        <div className="unmatched-pool hidden" id="unmatchedPool">
          <div className="unmatched-head">未匹配的客户端玩家（拖到上方对应行）</div>
          <div className="unmatched-cards" id="unmatchedCards" />
        </div>
      </div>
    </section>
  );
}

function RecordDialog() {
  return (
    <dialog id="recordDialog" className="wide-dialog record-dialog">
      <form id="recordForm">
        <div className="dialog-head"><h2>记录正式比赛</h2><DialogCloseButton /></div>
        <div className="dialog-grid">
          <CollectorPreview />
          <fieldset>
            <legend>胜方（必填）</legend>
            <label><input type="radio" name="winner" value="blue" required /> 蓝方</label>
            <label><input type="radio" name="winner" value="red" /> 红方</label>
          </fieldset>
          <label>比赛时间<input id="playedAt" type="datetime-local" required /></label>
          <label className="full">备注<textarea id="matchNote" maxLength={500} rows={3} placeholder="可选" /></label>
        </div>
        <div className="form-error" id="recordError" role="alert" />
        <div className="dialog-actions">
          <button className="ghost" type="button" data-close-dialog>取消</button>
          <button className="primary" id="submitMatchBtn" type="submit">确认提交</button>
        </div>
      </form>
    </dialog>
  );
}

function EditMatchDialog() {
  return (
    <dialog id="editMatchDialog">
      <form id="editMatchForm">
        <div className="dialog-head"><h2>修正比赛结果</h2><DialogCloseButton /></div>
        <input id="editMatchId" type="hidden" />
        <div className="dialog-grid">
          <fieldset>
            <legend>胜方</legend>
            <label><input type="radio" name="editWinner" value="blue" required /> 蓝方</label>
            <label><input type="radio" name="editWinner" value="red" /> 红方</label>
          </fieldset>
          <label>比赛时间<input id="editPlayedAt" type="datetime-local" required /></label>
          <label className="full">备注<textarea id="editMatchNote" maxLength={500} rows={3} /></label>
        </div>
        <div className="form-error" id="editMatchError" role="alert" />
        <div className="dialog-actions">
          <button className="ghost" type="button" data-close-dialog>取消</button>
          <button className="primary" id="saveMatchBtn" type="submit">保存修改</button>
        </div>
      </form>
    </dialog>
  );
}

function ManualMatchDialog() {
  return (
    <dialog id="manualMatchDialog" className="wide-dialog">
      <div className="dialog-head"><h2>录入历史对局 — 选择对局</h2><DialogCloseButton /></div>
      <div className="collector-box" style={{ margin: "12px 18px" }}>
        <div className="collector-head">
          <div><strong>从客户端采集</strong><small id="manualCollectorStatus">点击按钮选择最近的自定义对局</small></div>
          <button className="ghost" id="manualCollectBtn" type="button">获取对局列表</button>
        </div>
        <form className="manual-game-id-form" id="manualGameIdForm">
          <label htmlFor="manualGameIdInput">对局 ID</label>
          <input id="manualGameIdInput" maxLength={64} placeholder="输入客户端对局 ID" autoComplete="off" required />
          <button className="ghost" type="submit">读取对局</button>
        </form>
        <div className="recent-games hidden" id="recentGamesList" />
        <div className="batch-import-bar hidden">
          <button className="link" id="batchSelectToggle" type="button" data-action="selectAll">全选</button>
          <button className="ghost" id="batchImportBtn" type="button">批量录入勾选对局</button>
          <small>勾选多场后点击，逐场录入；已导入的自动跳过。</small>
        </div>
      </div>
      <div style={{ padding: "0 18px 14px", color: "var(--muted)", fontSize: 13 }}>
        选择对局后将自动跳转到记录对局界面，在那里完成选手匹配和提交。
      </div>
    </dialog>
  );
}

function HeroStatsDialog() {
  return (
    <dialog id="heroStatsDialog" className="wide-dialog">
      <div className="dialog-head">
        <h2>OPGG 英雄位置数据</h2>
        <button className="icon-btn" id="heroStatsClose" aria-label="关闭">×</button>
      </div>
      <div className="rank-tools">
        <input className="search-input" id="heroSearch" type="search" placeholder="支持中文、拼音或首字母…" />
        <div className="hero-lane-tabs" role="tablist" aria-label="位置筛选">
          <button className="hero-lane-tab active" type="button" role="tab" data-hero-lane="all" aria-selected="true">全部</button>
          <button className="hero-lane-tab" type="button" role="tab" data-hero-lane="top" aria-selected="false">上单</button>
          <button className="hero-lane-tab" type="button" role="tab" data-hero-lane="jungle" aria-selected="false">打野</button>
          <button className="hero-lane-tab" type="button" role="tab" data-hero-lane="middle" aria-selected="false">中路</button>
          <button className="hero-lane-tab" type="button" role="tab" data-hero-lane="bottom" aria-selected="false">下路</button>
          <button className="hero-lane-tab" type="button" role="tab" data-hero-lane="support" aria-selected="false">辅助</button>
        </div>
        <input id="heroLane" type="hidden" defaultValue="all" />
      </div>
      <div className="table-wrap hero-table">
        <table>
          <thead>
            <tr>
              <th>英雄</th>
              <th>位置登场率</th>
              <th>
                <button className="hero-sort-button active" type="button" data-hero-sort="weight" aria-pressed="true">
                  累计登场率 <span aria-hidden="true">↓</span>
                </button>
              </th>
              <th>
                <button className="hero-sort-button" type="button" data-hero-sort="winRate" aria-pressed="false">
                  胜率 <span aria-hidden="true">↕</span>
                </button>
              </th>
              <th>
                <button className="hero-sort-button" type="button" data-hero-sort="banRate" aria-pressed="false">
                  禁用率 <span aria-hidden="true">↕</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody id="heroStatsBody" />
        </table>
      </div>
    </dialog>
  );
}

function PlayerLibraryDialog() {
  return (
    <dialog id="playerLibraryDialog" className="wide-dialog player-library-dialog">
      <div className="dialog-head">
        <div>
          <h2>选择选手</h2>
          <small id="playerLibrarySlot">请选择要放入此牌的选手</small>
        </div>
        <DialogCloseButton />
      </div>
      <div className="player-library-body">
        <div className="player-library-tools">
          <input
            className="search-input"
            id="playerLibrarySearch"
            type="search"
            placeholder="搜索选手名称、拼音或首字母…"
            autoComplete="off"
          />
          <button className="ghost" id="clearPlayerCardBtn" type="button">清空此牌</button>
        </div>
        <div className="player-library-cards" id="playerLibraryCards" />
      </div>
    </dialog>
  );
}

function GlobalBpDialog() {
  return (
    <dialog id="globalBpDialog" className="bp-details-dialog">
      <div className="dialog-head">
        <div>
          <h2>全局 BP 详情</h2>
          <small id="globalBpDialogMeta">当前周期尚未开始</small>
        </div>
        <DialogCloseButton />
      </div>
      <div className="bp-details-body" id="globalBpDetailsBody" />
    </dialog>
  );
}

function LocalMappingsDialog() {
  return (
    <dialog id="localMappingsDialog" className="local-mappings-dialog">
      <div className="dialog-head">
        <div>
          <h2>本地游戏 ID 映射</h2>
          <small>建立 LGG 玩家与游戏 ID 的双向关系，仅保存在当前浏览器。</small>
        </div>
        <DialogCloseButton />
      </div>
      <div className="local-mappings-body">
        <form id="localMappingForm" className="local-mapping-form">
          <label>
            LGG 玩家
            <select id="localMappingPlayer" required>
              <option value="">选择玩家</option>
            </select>
          </label>
          <span className="local-mapping-arrow" aria-hidden="true">↔</span>
          <label>
            游戏 ID
            <input
              id="localMappingGameId"
              maxLength={64}
              placeholder="例如：召唤师名#CN1"
              autoComplete="off"
              required
            />
          </label>
          <button className="primary" type="submit">保存映射</button>
        </form>
        <p className="local-mapping-tip">
          采集对局和录入历史对局时会自动匹配；同一玩家或游戏 ID 只能保留一条关系。
        </p>
        <div className="form-error" id="localMappingError" role="alert" />
        <div className="local-mappings-list" id="localMappingsList" />
      </div>
    </dialog>
  );
}

function Dialogs() {
  return (
    <>
      <RecordDialog />
      <EditMatchDialog />
      <ManualMatchDialog />
      <HeroStatsDialog />
      <PlayerLibraryDialog />
      <GlobalBpDialog />
      <LocalMappingsDialog />
      <div className="toast" id="toast" role="status" />
    </>
  );
}

export default function App() {
  const controllerError = useLegacyController();

  return (
    <>
      <AuthGate />
      <MainApplication />
      <Dialogs />
      {controllerError ? (
        <div className="form-error controller-error" role="alert">
          应用初始化失败，请刷新页面后重试。
        </div>
      ) : null}
    </>
  );
}
