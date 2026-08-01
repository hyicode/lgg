export function AuthGate() {
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
          Supabase 尚未配置。请先填写 <code>src/config/supabase.ts</code>。
        </div>
      </div>
    </section>
  );
}
