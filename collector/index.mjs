import { execFile } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { extractGameId, normalizeLcuMatch, normalizeLiveMatch } from "./bridge-core.mjs";

const execFileAsync = promisify(execFile);
const collectorDir = path.dirname(fileURLToPath(import.meta.url));

async function readConfig() {
  const defaults = {
    port: 32145,
    allowedOrigins: ["https://hyicode.github.io"],
  };
  try {
    return {
      ...defaults,
      ...JSON.parse(await readFile(path.join(collectorDir, "config.json"), "utf8")),
    };
  } catch (error) {
    if (error.code === "ENOENT") return defaults;
    throw error;
  }
}

function requestJson(url, { headers = {}, rejectUnauthorized = true, timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith("https:") ? https : http;
    const request = transport.get(url, { headers, rejectUnauthorized, timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          const error = new Error(`HTTP ${response.statusCode}`);
          error.status = response.statusCode;
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("客户端返回了无效 JSON。"));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("请求客户端超时。")));
    request.on("error", reject);
  });
}

async function discoverLeagueClient() {
  const command = [
    "$process = Get-CimInstance Win32_Process -Filter \"Name = 'LeagueClientUx.exe'\" | Select-Object -First 1",
    "if ($process) { $process.CommandLine }",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
    windowsHide: true,
    timeout: 5000,
  });
  const commandLine = stdout.trim();
  const port = commandLine.match(/--app-port[= ]([0-9]+)/)?.[1];
  const token = commandLine.match(/--remoting-auth-token[= ](?:"([^"]+)"|([^\s"]+))/)?.slice(1).find(Boolean);
  if (!port || !token) throw new Error("未找到英雄联盟客户端。请先登录国服客户端。");
  return {
    baseUrl: `https://127.0.0.1:${port}`,
    authorization: `Basic ${Buffer.from(`riot:${token}`).toString("base64")}`,
  };
}

async function lcuJson(client, endpoint) {
  return requestJson(`${client.baseUrl}${endpoint}`, {
    headers: { Authorization: client.authorization },
    rejectUnauthorized: false,
  });
}

async function collectFromLeagueClient() {
  const errors = [];
  try {
    const client = await discoverLeagueClient();
    try {
      const raw = await lcuJson(client, "/lol-end-of-game/v1/eog-stats-block");
      const match = normalizeLcuMatch(raw, "League Client API（赛后数据）");
      if (match.participants.length >= 10) return match;
      errors.push("赛后接口玩家数据不完整");
    } catch (error) {
      errors.push(`赛后接口：${error.message}`);
    }

    try {
      const history = await lcuJson(
        client,
        "/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=1",
      );
      const gameId = extractGameId(history);
      if (gameId) {
        try {
          const detail = await lcuJson(client, `/lol-match-history/v1/games/${encodeURIComponent(gameId)}`);
          const match = normalizeLcuMatch(detail, "League Client API（最近对局）");
          if (match.participants.length >= 10) return match;
        } catch (error) {
          errors.push(`对局详情：${error.message}`);
        }
      }
      const match = normalizeLcuMatch(history, "League Client API（最近对局）");
      if (match.participants.length >= 10) return match;
      errors.push("最近对局玩家数据不完整");
    } catch (error) {
      errors.push(`最近对局：${error.message}`);
    }
  } catch (error) {
    errors.push(error.message);
  }

  try {
    const live = await requestJson("https://127.0.0.1:2999/liveclientdata/allgamedata", {
      rejectUnauthorized: false,
    });
    const match = normalizeLiveMatch(live);
    if (match.participants.length >= 10) return match;
    errors.push("实时接口玩家数据不完整");
  } catch (error) {
    errors.push(`实时接口：${error.message}`);
  }

  throw new Error(`无法取得完整对局。${errors.join("；")}`);
}

function isAllowedOrigin(origin, config) {
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function sendJson(response, status, data, origin = "") {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  });
  response.end(JSON.stringify(data));
}

async function main() {
  if (process.platform !== "win32") throw new Error("当前采集桥仅支持 Windows。");
  const config = await readConfig();
  const onDemand = process.argv.includes("--on-demand");
  let lastRequestAt = Date.now();
  const server = http.createServer(async (request, response) => {
    lastRequestAt = Date.now();
    const origin = request.headers.origin || "";
    if (!isAllowedOrigin(origin, config)) {
      sendJson(response, 403, { error: "该网页来源不允许访问采集桥。" });
      return;
    }
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {}, origin);
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true, service: "LGG Collector Bridge" }, origin);
      return;
    }
    if (request.method === "GET" && request.url === "/collect") {
      try {
        sendJson(response, 200, await collectFromLeagueClient(), origin);
      } catch (error) {
        sendJson(response, 503, { error: error.message }, origin);
      }
      return;
    }
    sendJson(response, 404, { error: "Not found" }, origin);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`端口 ${config.port} 已被占用；采集桥可能已经启动。`);
    } else {
      console.error(error.message);
    }
    process.exitCode = 1;
  });
  server.listen(config.port, "127.0.0.1", () => {
    console.log("LGG 本机采集桥已启动。");
    console.log(`监听地址：http://127.0.0.1:${config.port}`);
    console.log("请保持此窗口开启，然后在 LGG 的记录对局窗口点击“采集数据”。");
    console.log("按 Ctrl+C 可退出。");
  });
  if (onDemand) {
    const idleTimer = setInterval(() => {
      if (Date.now() - lastRequestAt < 120_000) return;
      clearInterval(idleTimer);
      server.close(() => process.exit(0));
    }, 15_000);
    idleTimer.unref();
  }
}

main().catch((error) => {
  console.error(`采集桥启动失败：${error.message}`);
  process.exitCode = 1;
});
