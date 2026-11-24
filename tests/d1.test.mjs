import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../cloudflare/worker.ts';
import { backupToSql } from '../scripts/prepare-d1-import.mjs';
import { emptyBackup } from '../src/data/localStore.ts';

const admin = 'a'.repeat(64), member = 'm'.repeat(64);
function setup(overrides = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../cloudflare/migrations/0001_business_data.sql', import.meta.url), 'utf8'));
  let calls = 0;
  function prepare(sql) {
    calls++;
    let values = [];
    const statement = { bind(...args) { values = args; return statement; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; } };
    return statement;
  }
  const env = { DB: { prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } }, ADMIN_TOKEN: admin, MEMBER_TOKEN: member, FRONTEND_ORIGINS: 'https://hyicode.github.io', AUTH_RATE_LIMIT: { limit: async () => ({ success: true }) }, ...overrides };
  async function request(path, token, body, origin = 'https://hyicode.github.io', role) {
    return worker.fetch(new Request(`https://api.example${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(role ? { 'X-LGG-Role': role } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
  }
  return { sqlite, request, calls: () => calls };
}
const player = { id: 'p1', display_name: "测试'选手", normalized_name: "测试'选手", default_cost: 1.5, active: true };
test('shared passwords require an explicit identity and preserve member restrictions', async () => {
  const password = 'testpwd';
  const s = setup({ ADMIN_TOKEN: password, MEMBER_TOKEN: password });
  assert.equal((await s.request('/api/session', password)).status, 401);
  for (const role of ['member', 'admin']) {
    const r = await s.request('/api/session', password, undefined, 'https://hyicode.github.io', role);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).role, role);
  }
  assert.equal((await s.request('/api/query', password, { table: 'players', operation: 'delete' }, 'https://hyicode.github.io', 'member')).status, 403);
  assert.equal((await s.request('/api/session', 'incorrect', undefined, 'https://hyicode.github.io', 'admin')).status, 401);
  assert.equal(s.calls(), 0);
  s.sqlite.close();
});
test('credential rate limit prevents data access and applies beyond the login route', async () => {
  const s = setup({ AUTH_RATE_LIMIT: { limit: async () => ({ success: false }) } });
  for (const path of ['/api/session', '/api/snapshot']) {
    const r = await s.request(path, admin);
    assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '60');
  }
  assert.equal(s.calls(), 0); s.sqlite.close();
});
test('D1 authentication and origin checks reject guests before any database access', async () => {
  const s = setup();
  assert.equal((await s.request('/api/snapshot')).status, 401);
  assert.equal((await s.request('/api/query', 'wrong', {})).status, 401);
  assert.equal((await s.request('/api/snapshot', admin, undefined, 'https://evil.example')).status, 403);
  assert.equal(s.calls(), 0);
  assert.deepEqual(await (await s.request('/api/session', member)).json(), { role: 'member' });
  assert.equal(s.calls(), 0);
  s.sqlite.close();
});
test('D1 preserves role permissions, parameterizes values, and persists CRUD', async () => {
  const s = setup();
  const q = (token, body) => s.request('/api/query', token, body);
  assert.equal((await q(member, { table: 'players', operation: 'insert', input: player })).status, 403);
  assert.equal((await q(admin, { table: 'players', operation: 'insert', input: player })).status, 200);
  assert.equal((await q(admin, { table: 'players', operation: 'insert', input: { ...player, id: 'p2' } })).status, 409);
  assert.equal((await q(member, { table: 'riot_accounts', operation: 'insert', input: { account_name: 'abc', normalized_name: 'abc' } })).status, 200);
  assert.equal((await q(member, { table: 'matches', operation: 'insert', input: { id: 'match1', played_at: '2026-11-24T00:00:00Z', winner: 'blue', participants: [] } })).status, 200);
  const snapshot = await (await s.request('/api/snapshot', member)).json();
  assert.equal(snapshot.tables.players[0].display_name, player.display_name);
  assert.equal(snapshot.tables.players[0].active, true);
  assert.deepEqual(snapshot.tables.matches[0].participants, []);
  assert.equal((await q(member, { table: 'matches', operation: 'delete', filters: [{ column: 'id', values: ['match1'] }] })).status, 403);
  assert.equal((await q(admin, { table: 'players', operation: 'update', input: { default_cost: 3 }, filters: [{ column: 'id', values: ['p1'] }] })).status, 200);
  const selected = await (await q(admin, { table: 'players', operation: 'select', filters: [{ column: 'id', values: ['p1'] }], single: 'required' })).json();
  assert.equal(selected.data.default_cost, 3);
  assert.equal((await q(admin, { table: 'matches', operation: 'delete', filters: [{ column: 'id', values: ['match1'] }] })).status, 200);
  assert.equal((await (await s.request('/api/snapshot', member)).json()).tables.matches.length, 0);
  s.sqlite.close();
});
test('D1 rejects broad mutations, SQL identifiers, invalid payloads, and rolls back batch conflicts', async () => {
  const s = setup();
  for (const body of [
    { table: 'players', operation: 'delete' },
    { table: 'players; DROP TABLE matches', operation: 'select' },
    { table: 'players', operation: 'select', filters: [{ column: 'id) OR 1=1 --', values: ['p1'] }] },
    { table: 'players', operation: 'insert', input: { ...player, default_cost: -1 } },
    { table: 'players', operation: 'update', input: { id: 'changed' }, filters: [{ column: 'id', values: ['p1'] }] },
  ]) assert.equal((await s.request('/api/query', admin, body)).status, 400);
  const added = await s.request('/api/query', admin, { table: 'players', operation: 'insert', input: [player, { ...player, id: 'p2' }] });
  assert.equal(added.status, 400);
  assert.equal((await (await s.request('/api/snapshot', member)).json()).tables.players.length, 0);
  s.sqlite.close();
});
test('backup migration roundtrips quotes, booleans and nested JSON without auth data', () => {
  const s = setup(), backup = emptyBackup(), now = '2026-11-24T00:00:00Z';
  backup.tables.players = [{ ...player, created_at: now, updated_at: now }];
  backup.tables.matches = [{ id: 'match1', played_at: now, created_at: now, updated_at: now, winner: 'red', participants: [{ team: 'red', champion: { slug: 'test', name: "带'引号" } }], blue_team: '蓝方', red_team: '红方', duration_seconds: null, note: null, game_id: null }];
  backup.tables.profiles = [{ secret: 'must-not-export' }];
  const sql = backupToSql(backup);
  assert.ok(!sql.includes('must-not-export'));
  s.sqlite.exec(sql);
  assert.equal(s.sqlite.prepare('SELECT display_name FROM players').get().display_name, player.display_name);
  assert.deepEqual(JSON.parse(s.sqlite.prepare('SELECT participants FROM matches').get().participants), backup.tables.matches[0].participants);
  s.sqlite.close();
});
