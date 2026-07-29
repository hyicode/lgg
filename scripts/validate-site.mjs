import { readFile } from "node:fs/promises";

const files = [
  "index.html",
  "assets/styles.css",
  "assets/js/app.js",
  "assets/js/stats-core.js",
  "assets/js/search-core.js",
  "assets/js/supabase-config.js",
  "supabase/schema.sql",
];

for (const file of files) {
  const content = await readFile(file, "utf8");
  if (!content.trim()) throw new Error(`${file} is empty`);
}

const html = await readFile("index.html", "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`Duplicate HTML ids: ${[...new Set(duplicates)].join(", ")}`);

const app = await readFile("assets/js/app.js", "utf8");
for (const match of app.matchAll(/\$\("([#.][^"]+)"\)/g)) {
  const selector = match[1];
  if (selector.startsWith("#") && !ids.includes(selector.slice(1))) {
    throw new Error(`Missing HTML element for ${selector}`);
  }
}

const data = JSON.parse(await readFile("data/opgg-data.json", "utf8"));
for (const lane of ["top", "jungle", "middle", "bottom", "support"]) {
  if (!Array.isArray(data.pools?.[lane]) || data.pools[lane].length < 10) {
    throw new Error(`Invalid OPGG pool: ${lane}`);
  }
}

console.log(`Validated ${files.length} site files, ${ids.length} HTML ids, and five OPGG pools.`);
