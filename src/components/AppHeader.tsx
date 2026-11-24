import type { MemberProfile } from "../auth/authState";
import type { ViewId } from "../navigation/viewState";
import { LocalBackupControls } from "./LocalBackupControls";
import { CloudLogin } from "./CloudLogin";

interface AppHeaderProps {
  member: MemberProfile | null;
  activeView: ViewId;
  onNavigate(view: ViewId): void;
}

const navigationItems: ReadonlyArray<{ id: ViewId; label: string; adminOnly?: boolean }> = [
  { id: "rollView", label: "天命" },
  { id: "historyView", label: "对局历史" },
  { id: "leaderboardView", label: "战绩排行" },
  { id: "adminView", label: "管理", adminOnly: true },
];

export function AppHeader({ activeView, member, onNavigate }: AppHeaderProps) {
  const admin = member?.role === "guest" || member?.role === "admin";

  return (
    <>
      <header className="hero">
        <div className={`header-rule-picker${activeView === "rollView" ? "" : " hidden"}`} id="ruleModeSwitcher" aria-label="天命规则">
          <span>天命规则</span>
          <div className="header-rule-buttons" role="group" aria-label="选择天命规则">
            <button type="button" className="active" data-rule-mode="classic" aria-pressed="true">经典</button>
            <button type="button" data-rule-mode="draft-first" aria-pressed="false">阵容先行</button>
          </div>
          <small id="activeRuleDescription">先随机选手队伍与位置，再抽取英雄。</small>
        </div>
        <div className="hero-brand">
          <div className="eyebrow">League of Legends · Custom PVP</div>
          <h1>LGG · 天命</h1>
          <p>天命已定，胜负由你们共同记录。</p>
        </div>
        <div className="account-box">
          <span id="accountLabel">
            {member?.role === 'guest' ? '游客 · 本地模式' : `${member?.displayName || '成员'} · 云端模式`}
          </span>
        </div>
      </header>

      <nav className="main-nav" aria-label="主功能">
        {navigationItems.map((item) => (
          <button
            key={item.id}
            className={`nav-btn${activeView === item.id ? " active" : ""}${item.adminOnly ? " admin-only" : ""}${item.adminOnly && !admin ? " hidden" : ""}`}
            data-view={item.id}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {member?.role === 'guest' && <LocalBackupControls />}
      <CloudLogin />

      <div className="toolbar">
        <div><span className="status-dot" /><span id="dataStatus">正在加载位置数据…</span></div>
        <div className="toolbar-actions">
          <button
            className={`mini admin-only test-data-toggle${admin ? "" : " hidden"}`}
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
