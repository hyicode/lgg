import test from "node:test";
import assert from "node:assert/strict";
import { snapshotRow, syncSnapshot } from "../scripts/sync-opgg.mjs";

const now = new Date("2026-09-18T16:30:00Z");
const fixture = () => ({
  source: "OPGG", schema: 1, capturedAt: "2026-09-19", generatedAt: now.toISOString(),
  pools: Object.fromEntries(["top", "jungle", "middle", "bottom", "support"].map(lane =>
    [lane, Array.from({ length: 20 }, (_, i) => ({ slug: `hero-${i}`, weight: 2, winRate: 50, banRate: 1 }))])),
});
const config = { url: "https://example.supabase.co", key: "sb_secret_test", now };

test("OPGG archive uses Shanghai date and rejects stale or incomplete snapshots", () => {
  assert.equal(snapshotRow(fixture(), now).captured_at, "2026-09-19");
  assert.throws(() => snapshotRow({ ...fixture(), capturedAt: "2026-09-18" }, now), /today/);
  const broken = fixture();
  broken.pools.support = [];
  assert.throws(() => snapshotRow(broken, now), /support/);
});

test("OPGG archive upserts by date and checks the returned snapshot", async () => {
  let requests = 0;
  const fetchImpl = async (url, init) => {
    requests++;
    assert.equal(url.searchParams.get("on_conflict"), "captured_at");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.apikey, config.key);
    assert.equal(init.headers.Authorization, undefined);
    assert.match(init.headers.Prefer, /merge-duplicates/);
    return Response.json([JSON.parse(init.body)]);
  };
  await syncSnapshot(fixture(), { ...config, fetchImpl });
  await syncSnapshot(fixture(), { ...config, fetchImpl });
  assert.equal(requests, 2);
});

test("OPGG sync fails visibly for missing credentials, HTTP errors and missing confirmation", async () => {
  await assert.rejects(syncSnapshot(fixture(), { now }), /Configure/);
  await assert.rejects(syncSnapshot(fixture(), { ...config, fetchImpl: async () => new Response("secret", { status: 401 }) }), /HTTP 401/);
  await assert.rejects(syncSnapshot(fixture(), { ...config, fetchImpl: async () => Response.json([]) }), /did not confirm/);
  await assert.rejects(syncSnapshot(fixture(), { ...config, url: "https://example.org" }), /Supabase project URL/);
});
