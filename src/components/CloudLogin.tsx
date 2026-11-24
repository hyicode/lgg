import { useState, type FormEvent } from 'react';
import { cloudEndpoint, cloudSession, loginCloud, logoutCloud } from '../auth/cloudSession';
import { cloudRequest } from '../data/cloudClient';
import { requestSharedDataRefresh } from '../data/sharedData';

export function CloudLogin() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try { await loginCloud(code, role); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '登录失败。'); setBusy(false); }
  }
  async function exportCloud() {
    if (!cloudSession) return;
    setBusy(true); setError('');
    try {
      const backup = await cloudRequest(cloudSession, '/api/snapshot');
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `lgg-cloud-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导出失败。'); }
    finally { setBusy(false); }
  }
  if (cloudSession) return <section className="local-backup-panel" aria-label="云端数据">
    <p>云端模式 · 当前查看和保存的是共享数据，游客本地数据独立保留。</p>
    <div className="toolbar-actions">
      <button className="mini" onClick={() => requestSharedDataRefresh()}>刷新云端数据</button>
      <button className="mini" onClick={() => void exportCloud()} disabled={busy}>导出云端备份</button>
      <button className="mini" onClick={logoutCloud}>退出云端，使用游客</button>
    </div><small>切换模式会刷新页面，请先保存正在编辑的内容。</small><div role="status">{error}</div>
  </section>;
  return <section className="local-backup-panel" aria-label="云端登录">
    {cloudEndpoint ? <>
      <button className="mini" onClick={() => setOpen(!open)}>登录云端共享数据</button>
      {open && <form onSubmit={submit} className="inline-form">
        <label>登录身份<select value={role} onChange={event => setRole(event.target.value as 'admin' | 'member')}><option value="member">普通成员</option><option value="admin">管理员</option></select></label>
        <label>云端密码<input type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} required minLength={6} maxLength={256} /></label>
        <button className="primary" disabled={busy}>{busy ? '登录中…' : '登录云端'}</button>
        <small>选择身份并输入对应密码。登录后刷新页面，请先保存正在编辑的内容；游客数据不会自动上传。</small>
      </form>}
    </> : <small>云端尚未启用，游客功能可正常使用。</small>}
    <div role="status">{error}</div>
  </section>;
}
