import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const lanes = ["top", "jungle", "middle", "bottom", "support"];
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "zh-CN",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
});

try {
  const pools = {};
  let patch = "";

  for (const lane of lanes) {
    const page = await context.newPage();
    const url = `https://op.gg/zh-cn/lol/champions?region=global&tier=emerald_plus&position=${lane}`;
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
          return { name, slug, weight: values[1], banRate: values[2] };
        })
        .filter(Boolean)
    );

    const unique = [...new Map(rows.map((hero) => [hero.slug, hero])).values()];
    if (unique.length < 20) {
      throw new Error(`${lane}: only parsed ${unique.length} champions`);
    }
    pools[lane] = unique;
    console.log(`${lane}: ${unique.length} champions`);
    await page.close();
  }

  const payload = {
    schema: 1,
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
