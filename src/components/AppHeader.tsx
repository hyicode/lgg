export function AppHeader() {
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
