import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function snapshotRow(payload, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  if (payload.source !== "OPGG" || payload.schema !== 1 || payload.capturedAt !== today ||
      !Number.isFinite(Date.parse(payload.generatedAt))) {
    throw new Error("Expected a valid OPGG snapshot captured today (Asia/Shanghai).");
  }
  for (const lane of ["top", "jungle", "middle", "bottom", "support"]) {
    const heroes = payload.pools?.[lane];
    if (!Array.isArray(heroes) || heroes.length < 20 || heroes.some((hero) =>
      typeof hero.slug !== "string" || !hero.slug ||
      !Number.isFinite(hero.weight) || hero.weight <= 0 || hero.weight > 100 ||
      !Number.isFinite(hero.winRate) || hero.winRate < 0 || hero.winRate > 100 ||
      !Number.isFinite(hero.banRate) || hero.banRate < 0 || hero.banRate > 100)) {
      throw new Error(`Invalid or incomplete OPGG lane: ${lane}`);
    }
  }
  return { captured_at: payload.capturedAt, generated_at: payload.generatedAt, payload };
}

export async function syncSnapshot(payload, { url, key, fetchImpl = fetch, now } = {}) {
  const row = snapshotRow(payload, now);
  if (!url || !key) throw new Error("Configure SUPABASE_URL and SUPABASE_SECRET_KEY in GitHub Actions.");
  const base = new URL(url);
  if (base.protocol !== "https:" || !base.hostname.endsWith(".supabase.co") ||
      base.username || base.password || base.port || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("SUPABASE_URL must be an HTTPS Supabase project URL.");
  }
  const headers = { apikey: key, "Content-Type": "application/json" };
  // New sb_secret keys use apikey; legacy service_role JWTs also require Bearer.
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  const response = await fetchImpl(new URL("/rest/v1/opgg_daily_snapshots?on_conflict=captured_at", base), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(`OPGG database sync failed (HTTP ${response.status}); check table and backend key configuration.`);
  const rows = await response.json();
  if (rows.length !== 1 || rows[0].captured_at !== row.captured_at ||
      rows[0].payload?.generatedAt !== row.payload.generatedAt) {
    throw new Error("Database did not confirm the expected OPGG snapshot.");
  }
  console.log(`Saved OPGG snapshot ${row.captured_at} to Supabase.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const payload = JSON.parse(await readFile("data/opgg-data.json", "utf8"));
    await syncSnapshot(payload, { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY });
  } catch (error) {
    // Never print request headers or credentials.
    console.error(error.message);
    process.exitCode = 1;
  }
}
