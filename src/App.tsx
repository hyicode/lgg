import { useEffect } from "react";

function AuthGate() {
  return (
    <section className="auth-gate" id="authGate">
      <div className="login-card">
        <div className="eyebrow">League of Legends · Custom PVP</div>
        <h1>LGG</h1>
        <p>登录后进入抽签、共享战绩与排行榜。</p>
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
        <div>
          <div className="eyebrow">League of Legends · Custom PVP</div>
          <h1>LGG</h1>
          <p>命运已洗牌。结果由你们共同记录。</p>
        </div>
        <div className="account-box">
          <span id="accountLabel" />
          <button className="mini" id="logoutBtn">退出</button>
        </div>
      </header>

      <nav className="main-nav" aria-label="主功能">
        <button className="nav-btn active" data-view="rollView">抽签</button>
        <button className="nav-btn" data-view="historyView">对局历史</button>
        <button className="nav-btn" data-view="leaderboardView">战绩排行</button>
        <button className="nav-btn member-only hidden" data-view="adminView">管理</button>
      </nav>

      <div className="toolbar">
        <div><span className="status-dot" /><span id="dataStatus">正在加载分路数据…</span></div>
        <div className="toolbar-actions">
          <button className="mini" id="heroStatsBtn">英雄数据</button>
          <button className="mini" id="resetBtn">重置名单</button>
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
      <span className="clash-matchup">
        <span className="clash-team-cost blue" id="blueCost">费用 0</span>
        <span className="clash-emblem" role="img" aria-label="蓝方对阵红方">
          <span className="clash-icon"><span className="clash-glyph">⚔</span></span>
          <span className="clash-vs">VS</span>
        </span>
        <span className="clash-team-cost red" id="redCost">费用 0</span>
      </span>
      <div className="control clash-controls">
        <div className="clash-quick-actions">
          <button className="ghost test-fill" id="testFillBtn">测试填充</button>
          <button className="ghost" id="balanceBtn">随机分选手</button>
        </div>
        <label className="check"><input type="checkbox" id="uniqueHeroes" /> 禁止英雄重复（全局）</label>
        <label className="check"><input type="checkbox" id="sequentialReveal" /> 逐个揭晓</label>
        <button className="roll" id="rollBtn">LGG，开始抽签！</button>
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
        <div className="arena-head">
          <h2>本局命运</h2>
          <div className="progress" id="progress">等待揭晓 · 0 / 10</div>
        </div>
        <div className="battle-layout">
          <aside className="ban-side left">
            <div className="ban-title">全局禁用 · 1–5</div>
            <div className="ban-list" id="banListLeft" />
          </aside>
          <div className="results" id="results" />
          <aside className="ban-side right">
            <div className="ban-title">全局禁用 · 6–10</div>
            <div className="ban-list" id="banListRight" />
          </aside>
        </div>
        <div className="reveal-bar">
          <button className="ghost" id="backBtn">返回名单</button>
          <button className="reveal" id="revealBtn">全部揭晓</button>
          <button className="primary hidden" id="recordBtn">记录本局</button>
          <button className="ghost hidden" id="againBtn">再抽一次</button>
        </div>
      </section>
    </section>
  );
}

function DateRangeFilters({ prefix }: { prefix: "history" | "rank" | "adminMatch" }) {
  return (
    <>
      <select id={`${prefix}Range`} defaultValue="all">
        <option value="all">全部时间</option>
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
      </div>
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
          <div id="adminPlayerList" className="admin-list" />
        </section>
        <section className="panel" id="adminMatchSection">
          <h3>对局管理</h3>
          <div className="filters" style={{ marginBottom: 10 }}>
            <DateRangeFilters prefix="adminMatch" />
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
        <div className="table-wrap">
          <table>
            <thead><tr><th>队伍</th><th>LGG 选手</th><th>分路</th><th>💬 拖入客户端玩家</th><th>英雄</th><th>K / D / A</th></tr></thead>
            <tbody id="collectorBody" />
          </table>
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
    <dialog id="recordDialog" className="wide-dialog">
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
        <div className="recent-games hidden" id="recentGamesList" />
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
        <h2>OPGG 英雄分路数据</h2>
        <button className="icon-btn" id="heroStatsClose" aria-label="关闭">×</button>
      </div>
      <div className="rank-tools">
        <input className="search-input" id="heroSearch" type="search" placeholder="支持中文、拼音或首字母…" />
        <select id="heroLane" defaultValue="all">
          <option value="all">全部分路</option>
          <option value="top">上单</option>
          <option value="jungle">打野</option>
          <option value="middle">中路</option>
          <option value="bottom">下路</option>
          <option value="support">辅助</option>
        </select>
      </div>
      <div className="table-wrap hero-table">
        <table>
          <thead><tr><th>英雄</th><th>分路</th><th>登场率</th><th>禁用率</th></tr></thead>
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

function Dialogs() {
  return (
    <>
      <RecordDialog />
      <EditMatchDialog />
      <ManualMatchDialog />
      <HeroStatsDialog />
      <PlayerLibraryDialog />
      <div className="toast" id="toast" role="status" />
    </>
  );
}

function LegacyController() {
  useEffect(() => {
    void import("../assets/js/app.js");
  }, []);

  return null;
}

export default function App() {
  return (
    <>
      <AuthGate />
      <MainApplication />
      <Dialogs />
      <LegacyController />
    </>
  );
}
