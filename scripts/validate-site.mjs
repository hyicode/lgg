import { readFile } from "node:fs/promises";

const files = [
  "index.html",
  "src/main.tsx",
  "src/App.tsx",
  "src/components/AppHeader.tsx",
  "src/components/AuthGate.tsx",
  "src/components/DateRangeFilters.tsx",
  "src/hooks/useAuth.ts",
  "src/hooks/useAppController.ts",
  "src/hooks/useViewNavigation.ts",
  "src/hooks/useSharedData.ts",
  "src/auth/authState.ts",
  "src/data/models.ts",
  "src/data/sharedData.ts",
  "src/navigation/viewState.ts",
  "src/services/supabaseClient.ts",
  "src/domain/stats.ts",
  "src/domain/search.ts",
  "src/domain/collector.ts",
  "src/domain/draft.ts",
  "src/config/supabase.ts",
  "vite.config.ts",
  "assets/styles.css",
  "src/controllers/appController.ts",
  "supabase/schema.sql",
];

for (const file of files) {
  const content = await readFile(file, "utf8");
  if (!content.trim()) throw new Error(`${file} is empty`);
}

const componentFiles = [
  "src/App.tsx",
  "src/components/AppHeader.tsx",
  "src/components/AuthGate.tsx",
  "src/components/DateRangeFilters.tsx",
];
const appMarkup = (await Promise.all(componentFiles.map((file) => readFile(file, "utf8")))).join("\n");
const ids = [...appMarkup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
ids.push("blueName", "bluePlayers", "redName", "redPlayers");
for (const prefix of ["history", "rank", "adminMatch"]) {
  ids.push(`${prefix}Range`, `${prefix}From`, `${prefix}To`);
}
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`Duplicate HTML ids: ${[...new Set(duplicates)].join(", ")}`);

const app = await readFile("src/controllers/appController.ts", "utf8");
for (const match of app.matchAll(/\$\("([#.][^"]+)"\)/g)) {
  const selector = match[1];
  if (/^#[A-Za-z][\w-]*$/.test(selector) && !ids.includes(selector.slice(1))) {
    throw new Error(`Missing HTML element for ${selector}`);
  }
}

const data = JSON.parse(await readFile("data/opgg-data.json", "utf8"));
for (const lane of ["top", "jungle", "middle", "bottom", "support"]) {
  if (!Array.isArray(data.pools?.[lane]) || data.pools[lane].length < 10) {
    throw new Error(`Invalid OPGG pool: ${lane}`);
  }
  if (data.pools[lane].some((hero) => !Number.isFinite(hero.winRate) || hero.winRate < 0 || hero.winRate > 100)) {
    throw new Error(`Invalid OPGG win rate: ${lane}`);
  }
}

console.log(`Validated ${files.length} React/Vite files, ${ids.length} UI ids, and five OPGG pools.`);
