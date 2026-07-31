import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const app = await readFile(new URL("../assets/js/app.js", import.meta.url), "utf8");

test("公共账号只能新增正式对局和缺失的 Riot 账号引用", () => {
  assert.match(schema, /create policy "matches inserted by members"[\s\S]*?for insert[\s\S]*?public\.is_active_member\(\)/);
  assert.match(schema, /create policy "riot_accounts inserted by members"[\s\S]*?for insert[\s\S]*?active = true/);
  assert.doesNotMatch(schema, /create policy "players inserted by members"/);
  assert.doesNotMatch(schema, /create policy "(?:matches|riot_accounts|player_stats) (?:updated|deleted|managed) by members"/);
});

test("已落库数据的修改和删除策略只允许管理员", () => {
  assert.match(schema, /create policy "players updated by admins"[\s\S]*?for update[\s\S]*?public\.is_admin\(\)/);
  assert.match(schema, /create policy "players deleted by admins"[\s\S]*?for delete[\s\S]*?public\.is_admin\(\)/);
  assert.match(schema, /create policy "matches updated by admins"[\s\S]*?for update[\s\S]*?public\.is_admin\(\)/);
  assert.match(schema, /create policy "matches deleted by admins"[\s\S]*?for delete[\s\S]*?public\.is_admin\(\)/);
  assert.match(schema, /revoke all on function public\.recalc_player_stats\(\) from public, anon, authenticated/);
});

test("公共写入流程不使用 upsert 更新既有账号", () => {
  const accountWriter = app.slice(app.indexOf("async function ensureRiotAccounts"), app.indexOf("function resolveParticipantAccounts"));
  assert.match(accountWriter, /\.insert\(missing\)/);
  assert.doesNotMatch(app, /\.upsert\(/);
});

test("公共账号看不到也无法切换到管理界面", () => {
  assert.match(app, /viewId === "adminView" && !isAdmin\(\)/);
});
