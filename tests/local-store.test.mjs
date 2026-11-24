import test from "node:test";
import assert from "node:assert/strict";
import { createLocalClient, emptyBackup, LOCAL_DATA_KEY, readLocalBackup, saveLocalBackup, validateBackup } from "../src/data/localStore.ts";

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
const player = { id: "p1", display_name: "选手甲", normalized_name: "选手甲", default_cost: 1, active: true };
const match = { id: "m1", game_id: "123", played_at: "2026-11-24T12:00:00Z", winner: "blue",
  participants: [{ playerId: "p1", team: "blue", champion: { slug: "ahri", name: "阿狸" } }] };

test("游客首次使用为空数据；本地修改刷新后保留且不会发出网络请求", async () => {
  const disk = storage();
  assert.equal(readLocalBackup(disk).tables.matches.length, 0);
  const client = createLocalClient(disk);
  assert.equal((await client.from("players").insert(player)).error, null);
  assert.equal((await client.from("matches").insert(match)).error, null);
  await client.from("players").update({ default_cost: 2 }).eq("id", "p1");
  const reloaded = createLocalClient(disk);
  const result = await reloaded.from("players").select("*").eq("id", "p1").single();
  assert.equal(result.data.default_cost, 2);
  assert.equal((await reloaded.from("matches").select("id").eq("game_id", "123").maybeSingle()).data.id, "m1");
  await reloaded.from("matches").delete().in("id", ["m1"]);
  assert.equal(readLocalBackup(disk).tables.matches.length, 0);
});

test("备份导入导出保留原始字段、账号引用和停用选手", () => {
  const disk = storage();
  const backup = emptyBackup();
  backup.tables.players.push({ ...player, active: false });
  backup.tables.matches.push({ ...match, note: "原始备注", participants: [{ ...match.participants[0], riotAccountId: "r1", stats: { kills: 5 } }] });
  backup.tables.riot_accounts.push({ id: "r1", account_name: "测试#CN1", normalized_name: "测试#cn1" });
  backup.tables.profiles = [{ id: "profile1", role: "admin" }];
  saveLocalBackup(backup, disk);
  const copied = validateBackup([{ backup: JSON.parse(disk.getItem(LOCAL_DATA_KEY)) }]);
  assert.deepEqual(copied.tables, backup.tables);
  assert.equal(copied.tables.players[0].active, false);
});

test("无效导入、重复写入、存储空间不足均保留已有数据", async () => {
  const disk = storage();
  const client = createLocalClient(disk);
  await client.from("players").insert(player);
  const before = disk.getItem(LOCAL_DATA_KEY);
  assert.ok((await client.from("players").insert(player)).error);
  assert.throws(() => saveLocalBackup({ format: "lgg-backup", version: 1, tables: {} }, disk));
  assert.equal(disk.getItem(LOCAL_DATA_KEY), before);
  const full = { getItem: disk.getItem, setItem() { throw new Error("QuotaExceededError"); } };
  assert.match((await createLocalClient(full).from("players").update({ default_cost: 3 }).eq("id", "p1")).error.message, /未保存/);
  assert.equal(disk.getItem(LOCAL_DATA_KEY), before);
});

test("损坏存储不会被静默清空或覆盖", async () => {
  const disk = storage();
  disk.setItem(LOCAL_DATA_KEY, "broken-json");
  assert.throws(() => readLocalBackup(disk), /已保留/);
  assert.ok((await createLocalClient(disk).from("players").insert(player)).error);
  assert.equal(disk.getItem(LOCAL_DATA_KEY), "broken-json");
});
