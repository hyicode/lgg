import type { Row, TableName, LocalBackup } from './localStore.ts';

export interface CloudSession { endpoint: string; token: string; role: 'admin' | 'member'; expiresAt?: number }
export const CLOUD_DATA_EVENT = 'lgg-cloud-data-changed';
export async function cloudRequest(session: CloudSession, path: string, body?: unknown, fetcher: typeof fetch = fetch) {
  if (session.expiresAt && session.expiresAt <= Date.now()) throw new Error('云端登录已过期，请退出后重新登录。');
  const response = await fetcher(`${session.endpoint}${path}`, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'omit',
    headers: { Authorization: `Bearer ${session.token}`, 'X-LGG-Role': session.role, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `云端请求失败 (${response.status})。`);
  return result;
}
export function createCloudClient(session: CloudSession, fetcher: typeof fetch = fetch) {
  function from(table: TableName) {
    let operation = 'select';
    let input: Row | Row[] = {};
    const filters: { column: string; values: unknown[] }[] = [];
    let single: 'required' | 'optional' | undefined;
    let pending: Promise<{ data: Row | Row[] | null; error: Error | null }> | undefined;
    const query = {
      select(_columns?: string) { return query; },
      insert(rows: Row | Row[]) { operation = 'insert'; input = rows; return query; },
      update(row: Row) { operation = 'update'; input = row; return query; },
      delete() { operation = 'delete'; return query; },
      eq(column: string, value: unknown) { filters.push({ column, values: [value] }); return query; },
      in(column: string, values: unknown[]) { filters.push({ column, values }); return query; },
      single() { single = 'required'; return query; },
      maybeSingle() { single = 'optional'; return query; },
      then(resolve: (value: { data: Row | Row[] | null; error: Error | null }) => unknown, reject?: (error: unknown) => unknown) {
        pending ??= cloudRequest(session, '/api/query', { table, operation, input, filters, single }, fetcher)
          .then(result => {
            if (operation !== 'select' && typeof window !== 'undefined') window.dispatchEvent(new Event(CLOUD_DATA_EVENT));
            return { data: result.data, error: null };
          }).catch(error => ({ data: null, error: error instanceof Error ? error : new Error(String(error)) }));
        return pending.then(resolve, reject);
      },
    };
    return query;
  }
  return { from, readBackup: () => cloudRequest(session, '/api/snapshot', undefined, fetcher) as Promise<LocalBackup> };
}
