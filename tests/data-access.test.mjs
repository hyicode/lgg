import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataAccess, scopedStorage } from '../src/data/dataAccess.ts';

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
