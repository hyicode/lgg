import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const lanes = [
  { key: "top", position: "top", sentinel: "mordekaiser" },
  { key: "jungle", position: "jungle", sentinel: "leesin" },
  { key: "middle", position: "mid", sentinel: "ahri" },
  { key: "bottom", position: "adc", sentinel: "ashe" },
  { key: "support", position: "support", sentinel: "thresh" },
];
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const browser = await chromium.launch({
  headless: true,
  ...(process.env.OPGG_BROWSER_PATH ? { executablePath: process.env.OPGG_BROWSER_PATH } : {}),
});
const context = await browser.newContext({
  locale: "zh-CN",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
});

const positionToLane = {
  TOP: "top",
  JUNGLE: "jungle",
  MID: "middle",
  ADC: "bottom",
  SUPPORT: "support",
};
const laneToPosition = {
  top: "top",
  jungle: "jungle",
  middle: "mid",
  bottom: "adc",
  support: "support",
};

async function fetchHtml(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "accept-language": "zh-CN,zh;q=0.9",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        },
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function detailPositions(html) {
  const match = html.match(/positions\\":(\[\{\\?"name\\?":[\s\S]*?\}\])/);
  if (!match) return [];
  try {
    return JSON.parse(match[1].replace(/\\"/g, '"'))
      .map((item) => positionToLane[item.name])
      .filter(Boolean);
  } catch {
    return [];
  }
}

function detailRates(html) {
  const win = html.match(/胜率<\/em><b[^>]*>([\d.]+)(?:<!-- -->)?%/);
  const pick = html.match(/选用率<\/em><b[^>]*>([\d.]+)(?:<!-- -->)?%/);
  const ban = html.match(/禁用率<\/em><b[^>]*>([\d.]+)(?:<!-- -->)?%/);
  if (!win || !pick || !ban) return null;
  return { winRate: Number(win[1]), weight: Number(pick[1]), banRate: Number(ban[1]) };
}

try {
  const pools = {};
  let patch = "";

  for (const { key: lane, position, sentinel } of lanes) {
    const page = await context.newPage();
    const url = `https://op.gg/zh-cn/lol/champions?region=global&tier=emerald_plus&position=${position}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector("table tbody tr", { timeout: 60000 });

    if (!patch) {
      const heading = await page.locator("h1").first().innerText().catch(() => "");
      patch = heading.match(/(?:Patch|版本)\s*([\d.]+)/i)?.[1] || "";
    }

    const rows = await page.locator("table tbody tr").evaluateAll((elements) =>
      elements
        .map((row) => {
          const link = [...row.querySelectorAll("a")].find((a) =>
            /\/lol\/champions\/[^/?#]+/.test(a.getAttribute("href") || "")
          );
          if (!link) return null;
          const href = link.getAttribute("href") || "";
          const slug = href.match(/\/lol\/champions\/([^/?#]+)/)?.[1];
          const values = (row.innerText.match(/\d+(?:\.\d+)?%/g) || []).map((v) =>
            Number(v.slice(0, -1))
          );
          if (!slug || values.length < 3) return null;
          const name =
            link.querySelector("img")?.getAttribute("alt")?.trim() ||
            link.textContent?.trim() ||
            slug;
          return { name, slug, winRate: values[0], weight: values[1], banRate: values[2] };
        })
        .filter(Boolean)
    );

    const unique = [...new Map(rows.map((hero) => [hero.slug, hero])).values()];
    if (unique.length < 20) {
      throw new Error(`${lane}: only parsed ${unique.length} champions`);
    }
    if (!unique.some((hero) => hero.slug === sentinel)) {
      throw new Error(`${lane}: expected ${sentinel}; the OPGG position filter may not have applied`);
    }
    pools[lane] = unique;
    console.log(`${lane}: ${unique.length} champions`);
    await page.close();
  }

  const champions = [
    ...new Map(
      Object.values(pools)
        .flat()
        .map((hero) => [hero.slug, hero])
    ).values(),
  ];
  const baseUrl = "https://op.gg/zh-cn/lol/champions";
  console.log(`Checking role coverage for ${champions.length} champions...`);
  const coverage = await mapLimit(champions, 6, async (hero) => {
    const html = await fetchHtml(
      `${baseUrl}/${hero.slug}/build?region=global&tier=emerald_plus`
    );
    return { hero, lanes: detailPositions(html) };
  });

  const missing = coverage.flatMap(({ hero, lanes: heroLanes }) =>
    heroLanes
      .filter((lane) => !pools[lane].some((item) => item.slug === hero.slug))
      .map((lane) => ({ hero, lane }))
  );
  console.log(`Supplementing ${missing.length} low-pick role entries...`);
  const supplements = await mapLimit(missing, 6, async ({ hero, lane }) => {
    const position = laneToPosition[lane];
    const html = await fetchHtml(
      `${baseUrl}/${hero.slug}/build/${position}?region=global&tier=emerald_plus`
    );
    const rates = detailRates(html);
    if (!rates || !(rates.winRate >= 0) || !(rates.weight > 0) || !(rates.banRate >= 0)) {
      throw new Error(`${hero.slug}/${position}: missing summary rates`);
    }
    return { lane, hero: { ...hero, ...rates } };
  });
  for (const item of supplements) pools[item.lane].push(item.hero);
  for (const lane of Object.keys(pools)) {
    pools[lane].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, "zh-CN"));
  }
  const payload = {
    schema: 1,
    generatorVersion: 4,
    source: "OPGG",
    region: "global",
    tier: "emerald_plus",
    mode: "ranked",
    patch,
    capturedAt: today,
    generatedAt: new Date().toISOString(),
    pools,
  };

  await mkdir("data", { recursive: true });
  await writeFile("data/opgg-data.json", `${JSON.stringify(payload)}\n`, "utf8");
} finally {
  await browser.close();
}
