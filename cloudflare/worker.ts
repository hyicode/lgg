import { columns, encodeRow, decodeRow, type Table, type Row } from './data.ts';
import { emptyBackup, validateBackup } from '../src/data/localStore.ts';

// Minimal D1 contracts keep the API type-checkable without browser globals or SDKs.
interface Statement {
  bind(...values: unknown[]): Statement;
  all(): Promise<{ results: Row[] }>;
}
export interface Env {
  DB: { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<{ results: Row[] }[]> };
  ADMIN_TOKEN?: string;
  MEMBER_TOKEN?: string;
  FRONTEND_ORIGINS: string;
  AUTH_RATE_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function requireValue(condition: unknown, message = '请求数据无效。'): asserts condition {
  if (!condition) throw new HttpError(400, message);
}
async function equalSecret(a: string, b?: string) {
  if (!b || b.length < 6 || a.length < 6 || a.length > 256) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([a, b].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const x = new Uint8Array(left), y = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
async function authenticate(request: Request, env: Env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
  const role = request.headers.get('X-LGG-Role');
  if (role && !['admin', 'member'].includes(role)) throw new HttpError(401, '请选择有效的登录身份。');
  // Legacy long access codes remain compatible, but a shared password always
  // requires an explicit role; never silently promote members to admin.
  if (!role && env.ADMIN_TOKEN === env.MEMBER_TOKEN) throw new HttpError(401, '请选择成员或管理员身份后登录。');
  if (role !== 'member' && await equalSecret(token, env.ADMIN_TOKEN)) return 'admin';
  if (role !== 'admin' && await equalSecret(token, env.MEMBER_TOKEN)) return 'member';
  throw new HttpError(401, '密码不正确或已更改，请重新登录云端。');
}
async function readJson(request: Request) {
  // Enforce a real stream limit, including requests without Content-Length.
  const reader = request.body?.getReader();
  requireValue(reader);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 512 * 1024) { await reader.cancel(); throw new HttpError(413, '单次提交数据过大。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpError(400, '请求必须是 JSON。'); }
}
function validateRows(table: Table, rows: Row[]) {
  const backup = emptyBackup();
  backup.tables[table] = rows;
  try { validateBackup(backup); }
  catch (error) { throw new HttpError(400, (error as Error).message); }
  for (const row of rows) {
    requireValue(Object.values(row).every(value => typeof value !== 'string' || value.length <= 5000));
    if (table === 'matches') {
      requireValue((row.participants as unknown[]).length <= 10);
      requireValue(row.duration_seconds == null || (Number.isInteger(row.duration_seconds) && Number(row.duration_seconds) >= 0));
    }
  }
}
async function query(request: Request, env: Env, role: string) {
  const body = await readJson(request);
  requireValue(body && typeof body === 'object' && Object.hasOwn(columns, body.table));
  const table = body.table as Table;
  const operation = body.operation;
  requireValue(['select', 'insert', 'update', 'delete'].includes(operation));
  if (role !== 'admin' && operation !== 'select' && !(operation === 'insert' && table !== 'players')) {
    throw new HttpError(403, '只有管理员可以修改或删除云端记录。');
  }
  const filters = body.filters ?? [];
  requireValue(Array.isArray(filters) && filters.length <= 5);
  const parameters: unknown[] = [];
  const clauses = filters.map((filter: { column: string; values: unknown[] }) => {
    requireValue(['id', 'normalized_name', 'game_id'].includes(filter.column) && (columns[table] as readonly string[]).includes(filter.column));
    requireValue(Array.isArray(filter.values) && filter.values.length > 0 && filter.values.length <= 90);
    requireValue(filter.values.every(value => typeof value === 'string' && value.length <= 256));
    parameters.push(...filter.values);
    return `${filter.column} IN (${filter.values.map(() => '?').join(',')})`;
  });
  requireValue(parameters.length <= 80);
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  if (operation === 'update' || operation === 'delete') {
    requireValue(filters.some((filter: { column: string }) => filter.column === 'id'), '修改或删除必须指定记录 ID。');
  }
  requireValue(body.single == null || ['required', 'optional'].includes(body.single));
  const checkSingle = (rows: Row[]) => {
    if (body.single && (rows.length > 1 || (body.single === 'required' && !rows.length))) throw new HttpError(404, '未找到唯一记录。');
  };
  let rows: Row[] = [];
  if (operation === 'select') {
    rows = (await env.DB.prepare(`SELECT * FROM ${table}${where}`).bind(...parameters).all()).results.map(decodeRow);
  } else if (operation === 'delete') {
    // Controller deletes by IDs, and does not request a single result on mutations.
    requireValue(!body.single);
    rows = (await env.DB.prepare(`DELETE FROM ${table}${where} RETURNING *`).bind(...parameters).all()).results.map(decodeRow);
  } else {
    const inputs = operation === 'insert' ? (Array.isArray(body.input) ? body.input : [body.input]) : [body.input];
    requireValue(inputs.length > 0 && inputs.length <= 50);
    for (const input of inputs) {
      requireValue(input && typeof input === 'object' && !Array.isArray(input));
      requireValue(Object.keys(input).every(key => (columns[table] as readonly string[]).includes(key)));
      if (operation === 'update') requireValue(!['id', 'created_at', 'updated_at'].some(key => key in input));
    }
    const now = new Date().toISOString();
    if (operation === 'insert') {
      rows = inputs.map((input: Row) => ({ id: crypto.randomUUID(), ...(table === 'matches' ? { blue_team: '蓝方', red_team: '红方' } : {}), ...input, created_at: now, ...(table !== 'riot_accounts' ? { updated_at: now } : {}) }));
      validateRows(table, rows);
      checkSingle(rows);
      const statements = rows.map(row => env.DB.prepare(`INSERT INTO ${table} (${columns[table].join(',')}) VALUES (${columns[table].map(() => '?').join(',')}) RETURNING *`).bind(...encodeRow(table, row)));
      rows = (await env.DB.batch(statements)).flatMap(result => result.results.map(decodeRow));
    } else {
      const existing = (await env.DB.prepare(`SELECT * FROM ${table}${where}`).bind(...parameters).all()).results.map(decodeRow);
      const changes = { ...body.input, ...(table !== 'riot_accounts' ? { updated_at: now } : {}) };
      validateRows(table, existing.map(row => ({ ...row, ...changes })));
      requireValue(!body.single);
      const keys = Object.keys(changes);
      requireValue(keys.length > 0);
      const values = keys.map(key => key === 'participants' ? JSON.stringify(changes[key]) : key === 'active' ? Number(changes[key]) : changes[key]);
      rows = (await env.DB.prepare(`UPDATE ${table} SET ${keys.map(key => `${key} = ?`).join(',')}${where} RETURNING *`).bind(...values, ...parameters).all()).results.map(decodeRow);
    }
  }
  checkSingle(rows);
  return { data: body.single ? rows[0] ?? null : rows };
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowed = env.FRONTEND_ORIGINS.split(',').map(value => value.trim());
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowed.includes(origin)) return respond({ error: '来源未获允许。' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-LGG-Role', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
    try {
      // All credential-bearing API routes share a per-IP budget so guessing via
      // a data route cannot bypass the login limit. No D1 access is needed.
      const allowed = await env.AUTH_RATE_LIMIT.limit({ key: `auth:${request.headers.get('CF-Connecting-IP') || 'local'}` });
      if (!allowed.success) { headers['Retry-After'] = '60'; throw new HttpError(429, '请求过于频繁，请一分钟后重试。'); }
      // Even reads require membership. An unauthenticated request never touches D1.
      const role = await authenticate(request, env);
      const path = new URL(request.url).pathname;
      if (path === '/api/session' && request.method === 'GET') return respond({ role });
      if (path === '/api/snapshot' && request.method === 'GET') {
        const names = Object.keys(columns) as Table[];
        const tables = await env.DB.batch(names.map(name => env.DB.prepare(`SELECT * FROM ${name}`)));
        return respond({ ...emptyBackup(), tables: Object.fromEntries(names.map((name, i) => [name, tables[i].results.map(decodeRow)])) });
      }
      if (path === '/api/query' && request.method === 'POST') return respond(await query(request, env, role));
      return respond({ error: '接口不存在。' }, 404);
    } catch (error) {
      if (error instanceof HttpError) return respond({ error: error.message }, error.status);
      if (/UNIQUE constraint|PRIMARY KEY/i.test(String(error))) return respond({ error: '该记录或名称已存在，请刷新后重试。' }, 409);
      return respond({ error: '云端服务暂不可用，数据未确认保存，请稍后重试。' }, 503);
    }
  },
};
