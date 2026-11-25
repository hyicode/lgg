import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataAccess, scopedStorage } from '../src/data/dataAccess.ts';
import { emptyBackup, LOCAL_DATA_KEY, readLocalBackup, saveLocalBackup } from '../src/data/localStore.ts';

function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
test('guest reads and mutations make zero cloud requests', async () => {
  const local = storage();
  const guest = createDataAccess(null, local, () => { throw new Error('Guest must not access network'); });
  assert.equal((await guest.readBackup()).tables.players.length, 0);
  assert.equal((await guest.from('players').insert({ id: 'p1', display_name: '游客', normalized_name: '游客', active: true, default_cost: 1 })).error, null);
  assert.equal((await guest.readBackup()).tables.players.length, 1);
  assert.equal((await guest.from('players').update({ default_cost: 2 }).eq('id', 'p1')).error, null);
  assert.equal((await guest.from('players').delete().eq('id', 'p1')).error, null);
});
test('cloud failures never fall back to or overwrite guest storage', async () => {
  const local = storage(); local.setItem('lgg.local-data.v1', 'preserve guest contents');
  const cloud = createDataAccess({ endpoint: 'https://api.example', token: 'test', role: 'member' }, local, async () => new Response(JSON.stringify({ error: 'quota exceeded' }), { status: 503 }));
  assert.match((await cloud.from('matches').insert({ id: 'm1' })).error.message, /quota/);
  await assert.rejects(cloud.readBackup(), /quota/);
  assert.equal(local.getItem('lgg.local-data.v1'), 'preserve guest contents');
});
test('cloud drafts and mappings use distinct storage keys from guest data', () => {
  const local = storage(), guest = scopedStorage(local, null), cloud = scopedStorage(local, 'endpoint.member');
  guest.setItem('lgg-setup-v3', 'guest'); cloud.setItem('lgg-setup-v3', 'cloud');
  assert.equal(guest.getItem('lgg-setup-v3'), 'guest');
  assert.equal(cloud.getItem('lgg-setup-v3'), 'cloud');
  cloud.removeItem('lgg-setup-v3');
  assert.equal(guest.getItem('lgg-setup-v3'), 'guest');
});

const session = { endpoint: 'https://api.example', token: 'test', role: 'member' };
const player = { id: 'p1', display_name: '数据库选手', normalized_name: '数据库选手', active: true, default_cost: 2 };
function snapshot() {
  const backup = emptyBackup();
  backup.tables.players = [player];
  backup.tables.riot_accounts = [{ id: 'a1', account_name: '账号#CN1', normalized_name: '账号#cn1' }];
  backup.tables.matches = [{ id: 'm1', winner: 'blue', played_at: '2026-11-25T00:00:00Z', participants: [] }];
  return backup;
}

test('database snapshot replaces all guest tables and logout reads the synced copy without network', async () => {
  const local = storage();
  const before = snapshot();
  before.tables.players = [{ ...player, default_cost: 99 }, { ...player, id: 'guest', display_name: '游客独有', normalized_name: '游客独有' }];
  before.tables.matches.push({ ...before.tables.matches[0], id: 'guest-match' });
  before.tables.riot_accounts.push({ id: 'guest-account', account_name: '游客账号', normalized_name: '游客账号' });
  saveLocalBackup(before, local);
  const remote = snapshot();
  const requests = [];
  const cloud = createDataAccess(session, local, async (url, options) => {
    requests.push({ url, method: options.method });
    return Response.json(remote);
  });
  await cloud.readBackup();
  assert.deepEqual(readLocalBackup(local).tables, remote.tables);
  const guest = createDataAccess(null, local, () => { throw new Error('Guest must not access network'); });
  assert.deepEqual((await guest.readBackup()).tables, remote.tables);
  await guest.from('players').update({ default_cost: 8 }).eq('id', 'p1');
  await cloud.readBackup();
  assert.equal(readLocalBackup(local).tables.players[0].default_cost, 2);
  assert.deepEqual(requests, Array(2).fill({ url: 'https://api.example/api/snapshot', method: 'GET' }));
});

test('an empty database clears old cached records instead of merging or falling back', async () => {
  const local = storage();
  saveLocalBackup(snapshot(), local);
  const cloud = createDataAccess(session, local, async () => Response.json(emptyBackup()));
  await cloud.readBackup();
  assert.deepEqual(readLocalBackup(local).tables, emptyBackup().tables);
});

test('invalid snapshots and unavailable storage preserve the previous cache', async () => {
  const local = storage();
  saveLocalBackup(snapshot(), local);
  const before = local.getItem(LOCAL_DATA_KEY);
  const invalid = snapshot();
  invalid.tables.matches = [{ id: 'broken', winner: 'invalid' }];
  await assert.rejects(createDataAccess(session, local, async () => Response.json(invalid)).readBackup());
  assert.equal(local.getItem(LOCAL_DATA_KEY), before);
  const full = { getItem: local.getItem, setItem() { throw new Error('QuotaExceededError'); } };
  await assert.rejects(createDataAccess(session, full, async () => Response.json(emptyBackup())).readBackup(), /未保存/);
  assert.equal(local.getItem(LOCAL_DATA_KEY), before);
});

test('overlapping refreshes finish in order and recover after a failed refresh', async () => {
  const local = storage();
  let release;
  let calls = 0;
  const cloud = createDataAccess(session, local, async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { release = resolve; });
    if (calls === 2) return Response.json({ error: 'offline' }, { status: 503 });
    return Response.json(emptyBackup());
  });
  const first = cloud.readBackup();
  const second = cloud.readBackup();
  const failure = assert.rejects(second, /offline/);
  const third = cloud.readBackup();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release(Response.json(snapshot()));
  await first;
  await failure;
  await third;
  assert.equal(calls, 3);
  assert.deepEqual(readLocalBackup(local).tables, emptyBackup().tables);
});
