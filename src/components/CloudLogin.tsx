import { useEffect, useRef, useState, type FormEvent } from 'react';
import { cloudEndpoint, cloudSession, loginCloud, logoutCloud } from '../auth/cloudSession';

export function CloudLogin() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const roleSelect = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!open) return;
    roleSelect.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await loginCloud(code, role); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败。');
      setBusy(false);
    }
  }

  if (cloudSession) return <button className="mini" type="button" onClick={logoutCloud}>退出登录</button>;
  if (!cloudEndpoint) return null;
  return <div className="account-login" ref={container}>
    <button ref={trigger} className="mini" type="button" aria-expanded={open} aria-controls="accountLoginForm" onClick={() => setOpen(!open)}>登录</button>
    {open && <form id="accountLoginForm" aria-label="账户登录" onSubmit={submit} className="account-login-popover">
      <strong>账户登录</strong>
      <label>登录身份<select ref={roleSelect} value={role} onChange={event => setRole(event.target.value as 'admin' | 'member')}><option value="member">普通成员</option><option value="admin">管理员</option></select></label>
      <label>密码<input type="password" autoComplete="current-password" value={code} onChange={event => setCode(event.target.value)} required minLength={6} maxLength={256} /></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="primary" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
    </form>}
  </div>;
}
