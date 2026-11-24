import { cloudRequest, type CloudSession } from '../data/cloudClient';
import { createDataAccess, scopedStorage } from '../data/dataAccess';
import { DEFAULT_D1_API_URL } from '../config/cloud';

const SESSION_KEY = 'lgg.cloud-session.v1';
export const cloudEndpoint = (import.meta.env.VITE_D1_API_URL || DEFAULT_D1_API_URL).trim().replace(/\/$/, '');
function readSession(): CloudSession | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (saved?.endpoint === cloudEndpoint && saved.token?.length >= 32 && ['admin', 'member'].includes(saved.role) && saved.expiresAt > Date.now()) return saved;
  } catch { /* Storage unavailable: guest mode is still usable. */ }
  return null;
}
export const cloudSession = readSession();
export function getDataClient() { return createDataAccess(cloudSession, localStorage); }
export function getModeStorage() {
  return scopedStorage(localStorage, cloudSession ? `${cloudSession.endpoint}.${cloudSession.role}` : null);
}
export async function loginCloud(token: string) {
  if (!cloudEndpoint) throw new Error('云端尚未配置，当前可使用游客本地功能。');
  const url = new URL(cloudEndpoint);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('云端接口必须使用 HTTPS。');
  const session: CloudSession = { endpoint: cloudEndpoint, token: token.trim(), role: 'member' };
  const result = await cloudRequest(session, '/api/session');
  if (!['admin', 'member'].includes(result.role)) throw new Error('云端身份响应无效。');
  session.role = result.role;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, expiresAt: Date.now() + 12 * 3600000 }));
  window.location.reload();
}
export function logoutCloud() {
  sessionStorage.removeItem(SESSION_KEY);
  window.location.reload();
}
