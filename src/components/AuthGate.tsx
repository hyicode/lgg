import { useState, type FormEvent } from "react";

interface AuthGateProps {
  error: string | null;
  hidden: boolean;
  loading: boolean;
  configured: boolean;
  onLogin(account: string, password: string): Promise<void>;
}

export function AuthGate({ error, hidden, loading, configured, onLogin }: AuthGateProps) {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onLogin(account, password);
  }

  return (
    <section className={`auth-gate${hidden ? " hidden" : ""}`} id="authGate">
      <div className="login-card">
        <div className="eyebrow">League of Legends · Custom PVP</div>
        <h1>LGG</h1>
        <p>登录后进入天命、共享战绩与排行榜。</p>
        <form id="loginForm" onSubmit={submit}>
          <label>
            账号
            <input
              id="loginAccount"
              autoComplete="username"
              placeholder="请输入账号"
              value={account}
              onChange={(event) => setAccount(event.currentTarget.value)}
              required
            />
          </label>
          <label>
            密码
            <input
              id="loginPassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
            />
          </label>
          <button className="primary" id="loginBtn" type="submit" disabled={!configured || loading}>
            {loading ? "登录中…" : "进入 LGG"}
          </button>
        </form>
        <div className="form-error" id="loginError" role="alert">{error}</div>
        <div className={`setup-warning${configured ? " hidden" : ""}`} id="supabaseSetupWarning">
          Supabase 尚未配置。请先填写 <code>src/config/supabase.ts</code>。
        </div>
      </div>
    </section>
  );
}
