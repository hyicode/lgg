import { supabaseConfig, accountAliases } from "./supabase-config.js";
import { computeLeaderboards, filterMatchesByRange, asDate } from "./stats-core.js";
import { createSearchForms, fuzzyMatches } from "./search-core.js";
import { matchCollectedParticipants } from "./collector-core.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";
import { pinyin } from "https://cdn.jsdelivr.net/npm/pinyin-pro@3.28.2/+esm";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const LANES = [
  ["top", "上单", "TOP"],
  ["jungle", "打野", "JGL"],
  ["middle", "中路", "MID"],
  ["bottom", "下路", "BOT"],
  ["support", "辅助", "SUP"],
];
const CACHE_SCHEMA = 10;
const HISTORY_PAGE_SIZE = 20;
const COLLECTOR_URL = "http://127.0.0.1:32145";
const searchFormCache = new Map();

const state = {
  supabase: null,
  user: null,
  member: null,
  players: [],
  matches: [],
  pools: null,
  poolMeta: null,
  results: [],
  bans: [],
  order: [],
  revealed: 0,
  busy: false,
  draftId: null,
  submitted: false,
  collectedMatch: null,
  collectorNeedsInstall: false,
  historyPage: 1,
  setupRestored: false,
  realtimeChannel: null,
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function normalizeName(value = "") {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

function searchForms(value = "") {
  const key = String(value);
  if (searchFormCache.has(key)) return searchFormCache.get(key);
  const aliases = [
    pinyin(key, { toneType: "none", nonZh: "consecutive" }),
    pinyin(key, { pattern: "first", toneType: "none", nonZh: "consecutive" }),
  ];
  const forms = createSearchForms(key, aliases);
  searchFormCache.set(key, forms);
  return forms;
}

function fuzzySearch(value, query) {
  return fuzzyMatches(searchForms(value), query);
}

function formatNumber(value, digits = 1) {
  const number = Number(value || 0);
  return number.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatDate(value) {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date) : "未知时间";
}

function localDateTimeValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function toast(message, duration = 3600) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), duration);
}

function isAdmin() {
  return state.member?.role === "admin";
}

function activePlayers() {
  return state.players.filter((player) => player.active);
}

function playerById(id) {
  return state.players.find((player) => player.id === id);
}

function playerByName(name) {
  const key = normalizeName(name);
  return state.players.find((player) => player.active && player.normalizedName === key);
}

function clearSubscriptions() {
  if (state.supabase && state.realtimeChannel) {
    state.supabase.removeChannel(state.realtimeChannel);
  }
  state.realtimeChannel = null;
}

function makePlayerInputs(side) {
  const container = $(`#${side}Players`);
  container.innerHTML = "";
  for (let index = 1; index <= 5; index += 1) {
    container.insertAdjacentHTML("beforeend", `
      <label class="player-row">
        <span class="number">0${index}</span>
        <span class="player-search">
          <input class="player-name search-input" data-side="${side}" data-slot="${index - 1}" maxlength="24" autocomplete="off" placeholder="搜索选手 ${index}" aria-label="${side === "blue" ? "蓝方" : "红方"}选手 ${index}" aria-autocomplete="list" aria-expanded="false">
          <span class="player-suggestions hidden" role="listbox"></span>
        </span>
        <span class="cost-label">费</span>
        <input class="cost-input" type="number" min="0" step="0.5" value="1" aria-label="选手 ${index} 费用">
      </label>`);
  }
}

function hidePlayerSuggestions(input) {
  const suggestions = input.closest(".player-search")?.querySelector(".player-suggestions");
  if (!suggestions) return;
  suggestions.classList.add("hidden");
  suggestions.innerHTML = "";
  input.setAttribute("aria-expanded", "false");
  delete input.dataset.suggestionIndex;
}

function matchingPlayers(query) {
  const selectedIds = new Set(
    $$(".player-name")
      .map((input) => input.dataset.playerId)
      .filter(Boolean),
  );
  return activePlayers()
    .filter((player) => !selectedIds.has(player.id))
    .filter((player) => !query || fuzzySearch(player.displayName, query))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-CN"));
}

function renderPlayerSuggestions(input) {
  const suggestions = input.closest(".player-search")?.querySelector(".player-suggestions");
  if (!suggestions) return;
  const matches = matchingPlayers(input.value.trim());
  suggestions.innerHTML = matches.length
    ? matches.map((player) => `<button type="button" role="option" data-player-option="${player.id}"><strong>${escapeHtml(player.displayName)}</strong><small>费用 ${formatNumber(player.defaultCost)}</small></button>`).join("")
    : `<span class="no-suggestion">没有匹配的选手</span>`;
  suggestions.classList.remove("hidden");
  input.setAttribute("aria-expanded", "true");
  input.dataset.suggestionIndex = "-1";
}

function selectPlayerSuggestion(input, playerId) {
  const player = playerById(playerId);
  if (!player?.active) return;
  input.value = player.displayName;
  input.dataset.playerId = player.id;
  input.setCustomValidity("");
  input.closest(".player-row").querySelector(".cost-input").value = formatNumber(player.defaultCost);
  hidePlayerSuggestions(input);
  updateCostTotals();
  saveLocalSetup();
}

function movePlayerSuggestion(input, direction) {
  const suggestions = input.closest(".player-search")?.querySelector(".player-suggestions");
  if (!suggestions || suggestions.classList.contains("hidden")) renderPlayerSuggestions(input);
  const options = [...suggestions.querySelectorAll("[data-player-option]")];
  if (!options.length) return;
  const current = Number(input.dataset.suggestionIndex || -1);
  const next = (current + direction + options.length) % options.length;
  options.forEach((option, index) => option.classList.toggle("active", index === next));
  input.dataset.suggestionIndex = String(next);
  options[next].scrollIntoView({ block: "nearest" });
}

function syncPlayerInput(input, updateCost = true) {
  const player = playerByName(input.value);
  const previousId = input.dataset.playerId || "";
  input.dataset.playerId = player?.id || "";
  input.setCustomValidity(input.value && !player ? "请从共享选手库中选择" : "");
  if (player && updateCost && previousId !== player.id) {
    input.closest(".player-row").querySelector(".cost-input").value = formatNumber(player.defaultCost);
  }
  updateCostTotals();
}

function lineup(side) {
  return $$(`#${side}Players .player-row`).map((row) => {
    const input = row.querySelector(".player-name");
    return {
      id: input.dataset.playerId || "",
      name: input.value.trim(),
      cost: Number(row.querySelector(".cost-input").value),
    };
  });
}

function setLineup(side, players) {
  const rows = $$(`#${side}Players .player-row`);
  players.forEach((player, index) => {
    const input = rows[index].querySelector(".player-name");
    input.value = player.name;
    input.dataset.playerId = player.id;
    rows[index].querySelector(".cost-input").value = formatNumber(player.cost);
  });
  updateCostTotals();
  saveLocalSetup();
}

function updateCostTotals() {
  for (const side of ["blue", "red"]) {
    const total = lineup(side).reduce((sum, player) => sum + (Number.isFinite(player.cost) ? player.cost : 0), 0);
    $(`#${side}Cost`).textContent = `费用 ${formatNumber(total)}`;
  }
}

function saveLocalSetup() {
  try {
    localStorage.setItem("lgg-setup-v3", JSON.stringify({
      blueName: $("#blueName").value,
      redName: $("#redName").value,
      blue: lineup("blue"),
      red: lineup("red"),
      unique: $("#uniqueHeroes").checked,
      sequential: $("#sequentialReveal").checked,
    }));
  } catch {
    // 本机偏好保存失败不影响主流程。
  }
}

function restoreLocalSetup() {
  if (state.setupRestored) return;
  try {
    const saved = JSON.parse(localStorage.getItem("lgg-setup-v3") || "null");
    if (!saved) {
      state.setupRestored = true;
      return;
    }
    $("#blueName").value = saved.blueName || "蓝方";
    $("#redName").value = saved.redName || "红方";
    for (const side of ["blue", "red"]) {
      const savedPlayers = saved[side] || [];
      const rows = $$(`#${side}Players .player-row`);
      savedPlayers.forEach((entry, index) => {
        const name = typeof entry === "string" ? entry : entry.name;
        const matched = playerById(entry.id) || playerByName(name);
        if (!matched || !rows[index]) return;
        const input = rows[index].querySelector(".player-name");
        input.value = matched.displayName;
        input.dataset.playerId = matched.id;
        rows[index].querySelector(".cost-input").value = Number.isFinite(entry.cost) ? entry.cost : matched.defaultCost;
      });
    }
    $("#uniqueHeroes").checked = Boolean(saved.unique);
    $("#sequentialReveal").checked = Boolean(saved.sequential);
    updateCostTotals();
    state.setupRestored = true;
  } catch {
    // 旧缓存格式异常时从空名单开始。
    state.setupRestored = true;
  }
}

function validateSetup() {
  const error = $("#rollError");
  const players = [...lineup("blue"), ...lineup("red")];
  if (!state.pools) {
    error.textContent = "分路数据尚未加载完成。";
    return false;
  }
  if (players.some((player) => !player.id || !playerById(player.id)?.active)) {
    error.textContent = "请从共享选手库中选择双方全部 10 名选手。";
    return false;
  }
  if (new Set(players.map((player) => player.id)).size !== 10) {
    error.textContent = "同一名选手不能在本局重复出现。";
    return false;
  }
  if (players.some((player) => !Number.isFinite(player.cost) || player.cost < 0)) {
    error.textContent = "费用必须是大于或等于 0 的数字。";
    return false;
  }
  if (!$("#blueName").value.trim() || !$("#redName").value.trim()) {
    error.textContent = "请填写双方队名。";
    return false;
  }
  error.textContent = "";
  return true;
}

function secureInt(max) {
  if (max <= 0) return 0;
  const limit = 0x100000000 - (0x100000000 % max);
  const array = new Uint32Array(1);
  do crypto.getRandomValues(array); while (array[0] >= limit);
  return array[0] % max;
}

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = secureInt(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function weightedChoice(items, field = "weight") {
  const weights = items.map((item) => Math.max(1, Math.round(Number(item[field] || 0) * 100)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let roll = secureInt(total);
  for (let index = 0; index < items.length; index += 1) {
    if (roll < weights[index]) return items[index];
    roll -= weights[index];
  }
  return items.at(-1);
}

function avatar(champion) {
  let hash = 0;
  for (const character of champion.slug) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const initial = champion.name.slice(0, 1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 58% 38%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 65% 13%)"/></linearGradient></defs><rect width="144" height="144" fill="url(#g)"/><text x="72" y="91" text-anchor="middle" font-size="58" font-family="serif" font-weight="700" fill="#fff4cc">${escapeHtml(initial)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function portrait(champion) {
  return champion.image || avatar(champion);
}

function validPools(pools) {
  return LANES.every(([lane]) => pools?.[lane]?.length >= 10)
    && Object.values(pools).flat().every((hero) => hero?.slug && Number(hero.weight) > 0 && Number(hero.banRate) >= 0);
}

async function loadPools() {
  const status = $("#dataStatus");
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem("lgg-pools-v3") || "null");
    if (cached?.schema === CACHE_SCHEMA && validPools(cached.pools)) {
      state.pools = cached.pools;
      state.poolMeta = cached.meta;
      status.textContent = `本机缓存 · ${cached.meta?.capturedAt || "未知日期"}`;
    }
  } catch {
    cached = null;
  }
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const response = await fetch(`./data/opgg-data.json?date=${today}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote = await response.json();
    if (remote.source !== "OPGG" || !validPools(remote.pools)) throw new Error("分路数据格式不正确");
    state.pools = remote.pools;
    state.poolMeta = {
      source: remote.source,
      patch: remote.patch || "",
      capturedAt: remote.capturedAt || "",
      generatorVersion: remote.generatorVersion || 0,
    };
    localStorage.setItem("lgg-pools-v3", JSON.stringify({ schema: CACHE_SCHEMA, pools: state.pools, meta: state.poolMeta }));
    status.textContent = `OPGG ${remote.patch || "未知版本"} · ${remote.capturedAt}`;
  } catch (error) {
    if (!state.pools) {
      status.textContent = "分路数据加载失败，暂时无法 Roll";
      $("#rollError").textContent = "请检查网络后刷新页面。";
    } else {
      status.textContent += " · 离线缓存";
    }
    console.warn("OPGG 数据加载失败", error);
  }
  if (state.pools) await enrichTencentPortraits();
}

async function enrichTencentPortraits() {
  try {
    const response = await fetch("https://game.gtimg.cn/images/lol/act/img/js/heroList/hero_list.js", { cache: "no-store" });
    if (!response.ok) return;
    const catalog = await response.json();
    const byAlias = new Map((catalog.hero || []).map((hero) => [String(hero.alias || "").toLowerCase(), hero]));
    for (const pool of Object.values(state.pools)) {
      for (const champion of pool) {
        const hero = byAlias.get(champion.slug.toLowerCase());
        if (hero) {
          champion.id = Number(hero.heroId || hero.id || 0);
          champion.image = `https://game.gtimg.cn/images/lol/act/img/champion/${encodeURIComponent(hero.alias)}.png`;
        }
      }
    }
  } catch {
    // 图片同步失败时使用本地生成头像。
  }
}

function balancePlayers() {
  if (!validateSetup()) return;
  const all = [...lineup("blue"), ...lineup("red")];
  let best = Number.POSITIVE_INFINITY;
  const solutions = [];
  const full = all.reduce((sum, player) => sum + player.cost, 0);
  for (let mask = 0; mask < (1 << 10); mask += 1) {
    let count = 0;
    let total = 0;
    for (let index = 0; index < 10; index += 1) {
      if (mask & (1 << index)) {
        count += 1;
        total += all[index].cost;
      }
    }
    if (count !== 5) continue;
    const difference = Math.abs(full - 2 * total);
    if (difference < best - 1e-9) {
      best = difference;
      solutions.length = 0;
      solutions.push(mask);
    } else if (Math.abs(difference - best) < 1e-9) {
      solutions.push(mask);
    }
  }
  const selected = solutions[secureInt(solutions.length)];
  const blue = [];
  const red = [];
  all.forEach((player, index) => (selected & (1 << index) ? blue : red).push(player));
  setLineup("blue", shuffle(blue));
  setLineup("red", shuffle(red));
  toast(`分队完成：双方费用差 ${formatNumber(best)}`);
}

function assignTeam(players, team) {
  const shuffled = shuffle(players);
  return LANES.map(([lane, laneLabel, abbreviation], index) => ({
    team,
    player: shuffled[index],
    lane,
    laneLabel,
    abbreviation,
    champion: null,
  }));
}

function generateBans() {
  const unique = new Map();
  Object.values(state.pools).flat().forEach((hero) => {
    const old = unique.get(hero.slug);
    if (!old || Number(hero.banRate) > Number(old.banRate)) unique.set(hero.slug, hero);
  });
  const candidates = [...unique.values()].filter((hero) => Number(hero.banRate) > 0);
  const bans = [];
  while (bans.length < 10 && candidates.length) {
    const chosen = weightedChoice(candidates, "banRate");
    bans.push(chosen);
    candidates.splice(candidates.findIndex((hero) => hero.slug === chosen.slug), 1);
  }
  return bans;
}

function pickHeroes(items, unique, banned) {
  const used = new Set();
  for (const item of shuffle(items)) {
    const candidates = state.pools[item.lane].filter((hero) => !banned.has(hero.slug) && (!unique || !used.has(hero.slug)));
    if (!candidates.length) throw new Error(`${item.laneLabel}英雄池不足，无法满足当前规则。`);
    item.champion = weightedChoice(candidates);
    used.add(item.champion.slug);
  }
  return items;
}

function roll() {
  if (!validateSetup()) return;
  saveLocalSetup();
  try {
    const blue = assignTeam(lineup("blue"), "blue");
    const red = assignTeam(lineup("red"), "red");
    state.bans = generateBans();
    state.results = pickHeroes([...blue, ...red], $("#uniqueHeroes").checked, new Set(state.bans.map((hero) => hero.slug)));
    state.order = shuffle(state.results.map((_, index) => index));
    state.revealed = 0;
    state.draftId = crypto.randomUUID();
    state.submitted = false;
    state.collectedMatch = null;
    renderRoll();
    $("#setupSection").classList.add("hidden");
    $("#arena").classList.add("show");
  } catch (error) {
    $("#rollError").textContent = error.message;
  }
}

function renderBans() {
  const chip = (hero) => `<div class="ban-chip" title="${escapeHtml(hero.name)} · 禁用率 ${formatNumber(hero.banRate, 2)}%"><img alt="${escapeHtml(hero.name)}" src="${portrait(hero)}"><span>${escapeHtml(hero.name)}</span><small>${formatNumber(hero.banRate, 2)}%</small></div>`;
  $("#banListLeft").innerHTML = state.bans.slice(0, 5).map(chip).join("");
  $("#banListRight").innerHTML = state.bans.slice(5, 10).map(chip).join("");
}

function renderRoll() {
  renderBans();
  const teams = [["blue", $("#blueName").value.trim()], ["red", $("#redName").value.trim()]];
  $("#results").innerHTML = teams.map(([team, name]) => `
    <div class="result-team ${team === "red" ? "red" : ""}">
      <div class="result-title">${escapeHtml(name)}</div>
      <div class="cards">${state.results.map((result, index) => result.team === team
        ? `<article class="card" data-index="${index}"><div class="card-inner"><div class="face back"><span>?</span></div><div class="face front"></div></div></article>`
        : "").join("")}</div>
    </div>`).join("");
  $("#revealBtn").textContent = $("#sequentialReveal").checked ? "揭晓下一位" : "全部揭晓";
  $("#revealBtn").classList.remove("hidden");
  $("#recordBtn").classList.add("hidden");
  $("#recordBtn").disabled = false;
  $("#recordBtn").textContent = "记录本局";
  $("#againBtn").classList.add("hidden");
  updateProgress();
}

function fillFront(card, result, index) {
  const champion = result.champion;
  card.querySelector(".front").innerHTML = `
    <img class="portrait" alt="${escapeHtml(champion.name)}" src="${portrait(champion)}">
    <div class="card-copy">
      <div class="meta-row"><div class="lane">${result.laneLabel} · ${result.abbreviation}</div><div class="pick-rate-label">登场率 ${formatNumber(champion.weight, 2)}%</div></div>
      <div class="summoner">${escapeHtml(result.player.name)}</div>
      <div class="champion-line"><div class="champion">${escapeHtml(champion.name)}</div><button class="reroll" data-reroll="${index}">再次随机</button></div>
    </div><div class="badge">${result.abbreviation}</div>`;
  const image = card.querySelector("img");
  image.addEventListener("error", () => { image.src = avatar(champion); }, { once: true });
}

function finishReveal() {
  $("#revealBtn").classList.add("hidden");
  $("#recordBtn").classList.remove("hidden");
  $("#againBtn").classList.remove("hidden");
}

function revealNext() {
  if (state.busy || state.revealed >= 10) return;
  state.busy = true;
  const index = state.order[state.revealed];
  const card = $(`.card[data-index="${index}"]`);
  fillFront(card, state.results[index], index);
  requestAnimationFrame(() => card.classList.add("revealed"));
  state.revealed += 1;
  updateProgress();
  setTimeout(() => {
    state.busy = false;
    if (state.revealed === 10) finishReveal();
  }, 650);
}

function revealAll() {
  if (state.busy || state.revealed >= 10) return;
  state.busy = true;
  state.results.forEach((result, index) => fillFront($(`.card[data-index="${index}"]`), result, index));
  requestAnimationFrame(() => $$(".card").forEach((card) => card.classList.add("revealed")));
  state.revealed = 10;
  updateProgress();
  setTimeout(() => {
    state.busy = false;
    finishReveal();
  }, 650);
}

function updateProgress() {
  $("#progress").textContent = state.revealed === 10 ? "全部揭晓 · 10 / 10" : `等待揭晓 · ${state.revealed} / 10`;
}

function rerollHero(index) {
  if (state.submitted) return;
  const result = state.results[index];
  if (!result) return;
  const blocked = new Set([result.champion.slug, ...state.bans.map((hero) => hero.slug)]);
  if ($("#uniqueHeroes").checked) state.results.forEach((item, itemIndex) => itemIndex !== index && blocked.add(item.champion.slug));
  const candidates = state.pools[result.lane].filter((hero) => !blocked.has(hero.slug));
  if (!candidates.length) return toast(`${result.laneLabel}没有可用的新英雄。`);
  result.champion = weightedChoice(candidates);
  state.collectedMatch = null;
  fillFront($(`.card[data-index="${index}"]`), result, index);
}

function backToSetup() {
  state.busy = false;
  $("#arena").classList.remove("show");
  $("#setupSection").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetSetup() {
  backToSetup();
  $$(".player-name").forEach((input) => {
    input.value = "";
    input.dataset.playerId = "";
  });
  $$(".cost-input").forEach((input) => { input.value = "1"; });
  $("#blueName").value = "蓝方";
  $("#redName").value = "红方";
  $("#uniqueHeroes").checked = false;
  $("#sequentialReveal").checked = false;
  $("#rollError").textContent = "";
  state.collectedMatch = null;
  localStorage.removeItem("lgg-setup-v3");
  updateCostTotals();
}

function openRecordDialog() {
  if (state.revealed !== 10 || state.submitted) return;
  $("#recordForm").reset();
  $("#recordError").textContent = "";
  $("#playedAt").value = localDateTimeValue();
  renderCollectedMatch();
  $("#recordDialog").showModal();
  refreshCollectorConnection();
}

async function collectorRequest(path, timeout = 2500) {
  const response = await fetch(`${COLLECTOR_URL}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `采集桥返回 HTTP ${response.status}`);
  return data;
}

async function collectorIsRunning() {
  try {
    const health = await collectorRequest("/health", 1500);
    return health.ok === true && health.service === "LGG Collector Bridge";
  } catch {
    return false;
  }
}

function updateCollectorButton() {
  $("#collectMatchBtn").textContent = state.collectorNeedsInstall
    ? "下载安装采集器"
    : (state.collectedMatch ? "重新采集" : "采集数据");
}

async function refreshCollectorConnection() {
  if (await collectorIsRunning()) {
    state.collectorNeedsInstall = false;
    updateCollectorButton();
    if (!state.collectedMatch) $("#collectorStatus").textContent = "采集器已连接，可以读取客户端数据。";
    return true;
  }
  if (!state.collectedMatch) $("#collectorStatus").textContent = "采集器未运行；点击采集数据会自动尝试唤起。";
  return false;
}

async function tryStartCollector() {
  $("#collectorStatus").textContent = "正在唤起采集器…";
  window.location.href = "lggcollector://start";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (await collectorIsRunning()) {
      state.collectorNeedsInstall = false;
      return true;
    }
  }
  return false;
}

function downloadCollectorInstaller() {
  const sourceBase = new URL("./collector/", window.location.href).href.replace(/\/$/, "");
  const installer = [
    "@echo off",
    "chcp 65001 >nul",
    "title LGG Collector Installer",
    "echo 正在准备 LGG 采集器安装程序...",
    "set \"INSTALLER=%TEMP%\\LGGCollector-Install.ps1\"",
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '${sourceBase}/install-collector.ps1' -OutFile '%INSTALLER%'"`,
    "if errorlevel 1 (",
    "  echo.",
    "  echo 安装程序下载失败，请检查网络后重试。",
    "  pause",
    "  exit /b 1",
    ")",
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" -SourceBase "${sourceBase}"`,
    "if errorlevel 1 (",
    "  echo.",
    "  echo 安装失败，请保留窗口中的错误信息。",
    "  pause",
    "  exit /b 1",
    ")",
    "echo.",
    "pause",
    "",
  ].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([installer], { type: "application/octet-stream" }));
  link.download = "LGG-Collector-Setup.cmd";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  state.collectorNeedsInstall = false;
  updateCollectorButton();
  $("#collectorStatus").textContent = "请运行下载的安装器；安装完成后再次点击采集数据。";
  $("#recordError").textContent = "";
}

function collectedByPlayerId() {
  return new Map((state.collectedMatch?.rows || []).map(({ result, participant }) => [result.player.id, participant]));
}

function renderCollectedMatch() {
  const collection = state.collectedMatch;
  const preview = $("#collectorPreview");
  if (!collection) {
    preview.classList.add("hidden");
    $("#collectorStatus").textContent = "启动本机采集桥后即可读取赛后数据。";
    updateCollectorButton();
    return;
  }
  const duration = collection.durationSeconds ? `${Math.round(collection.durationSeconds / 60)} 分钟` : "时长未知";
  $("#collectorStatus").textContent = `已匹配 ${collection.rows.length} 名选手，请核对后提交。`;
  $("#collectorMeta").textContent = `${collection.source} · ${duration}${collection.gameId ? ` · 对局 ${collection.gameId}` : ""}`;
  $("#collectorBody").innerHTML = collection.rows.map(({ result, participant }) => `
    <tr class="${result.team}">
      <td>${result.team === "blue" ? "蓝方" : "红方"}</td>
      <td><strong>${escapeHtml(result.player.name)}</strong></td>
      <td>${escapeHtml(participant.accountName || "—")}</td>
      <td>${escapeHtml(participant.championName || result.champion.name)}</td>
      <td class="num">${participant.stats.kills} / ${participant.stats.deaths} / ${participant.stats.assists}</td>
      <td class="num">${participant.stats.creepScore}</td>
    </tr>`).join("");
  preview.classList.remove("hidden");
  updateCollectorButton();
  if (collection.winner) {
    const winnerInput = $(`input[name="winner"][value="${collection.winner}"]`);
    if (winnerInput) winnerInput.checked = true;
  }
  if (collection.playedAt) {
    const playedAt = new Date(collection.playedAt);
    if (!Number.isNaN(playedAt.getTime())) $("#playedAt").value = localDateTimeValue(playedAt);
  }
}

async function collectMatchData() {
  const button = $("#collectMatchBtn");
  const error = $("#recordError");
  if (state.collectorNeedsInstall) {
    downloadCollectorInstaller();
    return;
  }
  button.disabled = true;
  error.textContent = "";
  $("#collectorStatus").textContent = "正在读取英雄联盟客户端…";
  try {
    if (!await collectorIsRunning()) {
      if (!await tryStartCollector()) {
        state.collectedMatch = null;
        state.collectorNeedsInstall = true;
        renderCollectedMatch();
        $("#collectorStatus").textContent = "未能唤起采集器。";
        error.textContent = "可能尚未安装，或浏览器阻止了外部应用。点击同一按钮下载安装。";
        return;
      }
    }
    state.collectorNeedsInstall = false;
    $("#collectorStatus").textContent = "采集器已启动，正在读取英雄联盟客户端…";
    const collected = await collectorRequest("/collect", 12_000);
    if (!Array.isArray(collected.participants) || collected.participants.length < 10) {
      throw new Error("采集到的玩家不足 10 人，请确认读取的是完整的召唤师峡谷对局。");
    }
    const mapping = matchCollectedParticipants(state.results, collected.participants);
    if (mapping.unmatched.length || mapping.rows.length !== 10) {
      const names = mapping.unmatched.map((result) => result.player.name).join("、");
      throw new Error(`采集数据与当前 Roll 结果不一致，未匹配选手：${names || "未知"}。`);
    }
    state.collectedMatch = { ...collected, rows: mapping.rows };
    renderCollectedMatch();
  } catch (caught) {
    state.collectedMatch = null;
    renderCollectedMatch();
    const bridgeHint = caught instanceof TypeError || caught.name === "TimeoutError"
      ? "采集器连接中断，请重新启动后再试。"
      : caught.message;
    error.textContent = bridgeHint;
    if (!await collectorIsRunning()) {
      state.collectorNeedsInstall = true;
      updateCollectorButton();
    }
  } finally {
    button.disabled = false;
  }
}

function matchSnapshot() {
  const blue = state.results.filter((result) => result.team === "blue");
  const red = state.results.filter((result) => result.team === "red");
  const collected = collectedByPlayerId();
  return {
    teams: {
      blueName: $("#blueName").value.trim(),
      redName: $("#redName").value.trim(),
      blueTotalCost: blue.reduce((sum, result) => sum + result.player.cost, 0),
      redTotalCost: red.reduce((sum, result) => sum + result.player.cost, 0),
    },
    lineup: state.results.map((result) => {
      const participant = collected.get(result.player.id);
      return {
        team: result.team,
        playerId: result.player.id,
        playerName: result.player.name,
        accountName: participant?.accountName || "",
        cost: result.player.cost,
        lane: result.lane,
        laneLabel: result.laneLabel,
        champion: {
          slug: result.champion.slug,
          name: result.champion.name,
          weight: Number(result.champion.weight),
          banRate: Number(result.champion.banRate),
        },
        ...(participant ? { stats: participant.stats } : {}),
      };
    }),
    bans: state.bans.map((hero) => ({ slug: hero.slug, name: hero.name, banRate: Number(hero.banRate) })),
  };
}

async function submitMatch(event) {
  event.preventDefault();
  if (state.submitted) return;
  const button = $("#submitMatchBtn");
  const error = $("#recordError");
  try {
    const winner = new FormData($("#recordForm")).get("winner");
    if (!winner) throw new Error("请选择胜方。");
    const playedAt = new Date($("#playedAt").value);
    if (Number.isNaN(playedAt.getTime())) throw new Error("请填写有效比赛时间。");
    const snapshot = matchSnapshot();
    const payload = {
      id: state.draftId,
      schema_version: state.collectedMatch ? 2 : 1,
      played_at: playedAt.toISOString(),
      created_by: state.user.id,
      winner,
      score: { blue: null, red: null },
      note: $("#matchNote").value.trim(),
      teams: snapshot.teams,
      lineup: snapshot.lineup,
      bans: snapshot.bans,
      options: {
        uniqueHeroes: $("#uniqueHeroes").checked,
        sequentialReveal: $("#sequentialReveal").checked,
        ...(state.collectedMatch ? {
          collector: {
            source: state.collectedMatch.source,
            gameId: state.collectedMatch.gameId,
            collectedAt: state.collectedMatch.collectedAt,
            durationSeconds: state.collectedMatch.durationSeconds,
            gameMode: state.collectedMatch.gameMode,
          },
        } : {}),
      },
      data_version: {
        source: state.poolMeta?.source || "OPGG",
        patch: state.poolMeta?.patch || "",
        capturedAt: state.poolMeta?.capturedAt || "",
        generatorVersion: Number(state.poolMeta?.generatorVersion || 0),
      },
    };
    button.disabled = true;
    error.textContent = "";
    const { error: insertError } = await state.supabase.from("matches").insert(payload);
    if (insertError) throw insertError;
    state.submitted = true;
    $("#recordDialog").close();
    $("#recordBtn").disabled = true;
    $("#recordBtn").textContent = "本局已记录";
    $$(".reroll").forEach((item) => { item.disabled = true; });
    toast("比赛已写入共享战绩。");
  } catch (caught) {
    const existing = state.draftId
      ? await state.supabase.from("matches").select("id").eq("id", state.draftId).maybeSingle()
      : { data: null };
    if (existing.data?.id) {
      state.submitted = true;
      $("#recordDialog").close();
      $("#recordBtn").disabled = true;
      $("#recordBtn").textContent = "本局已记录";
      toast("比赛已成功记录。");
    } else {
      error.textContent = caught.message || "提交失败，请检查网络后重试。";
    }
  } finally {
    button.disabled = false;
  }
}

function selectedMatches(prefix) {
  return filterMatchesByRange(
    state.matches,
    $(`#${prefix}Range`).value,
    $(`#${prefix}From`).value,
    $(`#${prefix}To`).value,
  );
}

function scoreLabel(match) {
  const hasScore = Number.isInteger(match.score?.blue) && Number.isInteger(match.score?.red);
  return hasScore ? `${match.score.blue} : ${match.score.red}` : (match.winner === "blue" ? "蓝方胜" : "红方胜");
}

function matchCard(match, includeActions = true) {
  const blue = (match.lineup || []).filter((slot) => slot.team === "blue");
  const red = (match.lineup || []).filter((slot) => slot.team === "red");
  const mini = (slots) => slots.map((slot) => `<span>${escapeHtml(slot.playerName)} · ${escapeHtml(slot.champion?.name || "—")}</span>`).join("");
  return `
    <article class="match-card">
      <div class="match-main">
        <div class="match-team ${match.winner === "blue" ? "winner" : ""}">
          <strong>${escapeHtml(match.teams?.blueName || "蓝方")}</strong>
          <div class="lineup-mini">${mini(blue)}</div>
        </div>
        <div class="versus"><div class="score">${scoreLabel(match)}</div><small>${formatDate(match.playedAt)}</small></div>
        <div class="match-team red ${match.winner === "red" ? "winner" : ""}">
          <strong>${escapeHtml(match.teams?.redName || "红方")}</strong>
          <div class="lineup-mini">${mini(red)}</div>
        </div>
      </div>
      <div class="match-meta">
        ${match.submittedByName ? `<span>记录人：${escapeHtml(match.submittedByName)}</span>` : ""}
        <span>版本：${escapeHtml(match.dataVersion?.patch || "未知")}</span>
        ${match.note ? `<span class="note">${escapeHtml(match.note)}</span>` : ""}
        ${includeActions && isAdmin() ? `<span class="match-actions"><button class="mini" data-edit-match="${match.id}">修正</button><button class="mini danger" data-delete-match="${match.id}">删除</button></span>` : ""}
      </div>
    </article>`;
}

function renderHistory() {
  const matches = selectedMatches("history");
  const pageCount = Math.max(1, Math.ceil(matches.length / HISTORY_PAGE_SIZE));
  state.historyPage = Math.min(state.historyPage, pageCount);
  const start = (state.historyPage - 1) * HISTORY_PAGE_SIZE;
  const page = matches.slice(start, start + HISTORY_PAGE_SIZE);
  $("#matchList").innerHTML = page.length ? page.map((match) => matchCard(match)).join("") : `<div class="panel empty">当前时间范围没有正式比赛。</div>`;
  $("#historyPage").textContent = `${state.historyPage} / ${pageCount} · 共 ${matches.length} 场`;
  $("#historyPrev").disabled = state.historyPage <= 1;
  $("#historyNext").disabled = state.historyPage >= pageCount;
}

function renderLeaderboard() {
  const matches = selectedMatches("rank");
  const data = computeLeaderboards(matches);
  const queryText = $("#rankSearch").value.trim();
  const minGames = Math.max(1, Number($("#minGames").value) || 1);
  const cards = [
    ["总场次", data.summary.matches],
    ["近 30 天", data.summary.recentMatches],
    ["活跃选手", data.summary.uniquePlayers],
    ["蓝方胜率", `${formatNumber(data.summary.blueWinRate)}%`],
    ["最活跃", data.summary.mostActive],
  ];
  $("#summaryGrid").innerHTML = cards.map(([label, value]) => `<div class="summary-card"><small>${label}</small><strong>${escapeHtml(value)}</strong></div>`).join("");

  const players = data.players.filter((player) => player.games >= minGames && (!queryText || fuzzySearch(player.name, queryText)));
  $("#playerRankBody").innerHTML = players.length ? players.map((player) => `
    <tr>
      <td><strong>${escapeHtml(player.name)}</strong></td>
      <td class="num">${player.games}</td>
      <td class="num">${player.wins}–${player.losses}</td>
      <td class="num">${formatNumber(player.winRate)}%</td>
      <td class="num">${player.currentStreak} / 最高 ${player.bestStreak}</td>
      <td>${escapeHtml(player.favoriteLane)} / ${escapeHtml(player.favoriteChampion)}</td>
    </tr>`).join("") : `<tr><td colspan="6" class="empty">没有符合条件的选手。</td></tr>`;

  const champions = data.champions.filter((champion) => !queryText || fuzzySearch(`${champion.name} ${champion.slug}`, queryText));
  $("#championRankBody").innerHTML = champions.length ? champions.map((champion) => `
    <tr>
      <td><strong>${escapeHtml(champion.name)}</strong><br><small>${escapeHtml(champion.slug)}</small></td>
      <td class="num">${champion.picks}</td>
      <td class="num">${champion.wins}</td>
      <td class="num">${formatNumber(champion.winRate)}%</td>
      <td class="num">${champion.bans}</td>
      <td class="num">${formatNumber(champion.presenceRate)}%</td>
    </tr>`).join("") : `<tr><td colspan="6" class="empty">没有符合条件的英雄。</td></tr>`;
}

function renderHeroStats() {
  if (!state.pools) return;
  const laneFilter = $("#heroLane").value;
  const search = $("#heroSearch").value.trim();
  const laneNames = new Map(LANES.map(([key, name]) => [key, name]));
  const grouped = new Map();
  for (const [lane, heroes] of Object.entries(state.pools)) {
    if (laneFilter !== "all" && laneFilter !== lane) continue;
    for (const hero of heroes) {
      let row = grouped.get(hero.slug);
      if (!row) {
        row = { name: hero.name, slug: hero.slug, weight: 0, banRate: 0, lanes: [] };
        grouped.set(hero.slug, row);
      }
      row.weight += Number(hero.weight);
      row.banRate = Math.max(row.banRate, Number(hero.banRate));
      row.lanes.push(`${laneNames.get(lane)} ${formatNumber(hero.weight, 2)}%`);
    }
  }
  const rows = [...grouped.values()]
    .filter((hero) => !search || fuzzySearch(`${hero.name} ${hero.slug}`, search))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, "zh-CN"));
  $("#heroStatsBody").innerHTML = rows.map((hero) => `
    <tr><td><strong>${escapeHtml(hero.name)}</strong><br><small>${escapeHtml(hero.slug)}</small></td><td>${hero.lanes.map(escapeHtml).join("<br>")}</td><td class="num">${formatNumber(hero.weight, 2)}%</td><td class="num">${formatNumber(hero.banRate, 2)}%</td></tr>`).join("");
}

function renderAdmin() {
  if (!isAdmin()) return;
  $("#adminPlayerList").innerHTML = state.players.length ? state.players.map((player) => `
    <div class="admin-row">
      <div class="grow"><strong>${escapeHtml(player.displayName)}</strong><small>默认费用 ${formatNumber(player.defaultCost)} · ${player.active ? "启用" : "已停用"}</small></div>
      <button class="mini" data-edit-player="${player.id}">编辑</button>
      <button class="mini ${player.active ? "danger" : ""}" data-toggle-player="${player.id}">${player.active ? "停用" : "启用"}</button>
    </div>`).join("") : `<div class="empty">还没有选手，请先新增。</div>`;
  $("#adminMatchList").innerHTML = state.matches.length
    ? state.matches.slice(0, 20).map((match) => `<div class="admin-row"><div class="grow"><strong>${escapeHtml(match.teams?.blueName)} vs ${escapeHtml(match.teams?.redName)}</strong><small>${formatDate(match.playedAt)} · ${scoreLabel(match)}</small></div><button class="mini" data-edit-match="${match.id}">修正</button><button class="mini danger" data-delete-match="${match.id}">删除</button></div>`).join("")
    : `<div class="empty">还没有正式比赛。</div>`;
}

async function addPlayer(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  const name = $("#playerName").value.trim();
  const normalizedName = normalizeName(name);
  const defaultCost = Number($("#playerCost").value);
  if (!name || name.length > 24 || !Number.isFinite(defaultCost) || defaultCost < 0) return toast("请填写有效的选手名称和费用。");
  if (state.players.some((player) => player.normalizedName === normalizedName)) return toast("选手名称已经存在。");
  try {
    const { error } = await state.supabase.from("players").insert({
      display_name: name,
      normalized_name: normalizedName,
      default_cost: defaultCost,
      active: true,
    });
    if (error) throw error;
    $("#playerForm").reset();
    $("#playerCost").value = "1";
    toast("选手已加入共享选手库。");
  } catch (error) {
    toast(`新增失败：${error.message}`);
  }
}

async function editPlayer(id) {
  if (!isAdmin()) return;
  const player = playerById(id);
  if (!player) return;
  const displayName = prompt("选手名称", player.displayName)?.trim();
  if (!displayName) return;
  const costInput = prompt("默认费用", String(player.defaultCost));
  if (costInput === null) return;
  const defaultCost = Number(costInput);
  const normalizedName = normalizeName(displayName);
  if (!Number.isFinite(defaultCost) || defaultCost < 0) return toast("默认费用无效。");
  if (state.players.some((item) => item.id !== id && item.normalizedName === normalizedName)) return toast("选手名称已经存在。");
  try {
    const { error } = await state.supabase.from("players").update({
      display_name: displayName,
      normalized_name: normalizedName,
      default_cost: defaultCost,
    }).eq("id", id);
    if (error) throw error;
    toast("选手资料已更新；历史快照保持原样。");
  } catch (error) {
    toast(`更新失败：${error.message}`);
  }
}

async function togglePlayer(id) {
  if (!isAdmin()) return;
  const player = playerById(id);
  if (!player) return;
  try {
    const { error } = await state.supabase.from("players").update({ active: !player.active }).eq("id", id);
    if (error) throw error;
    toast(player.active ? "选手已停用。" : "选手已重新启用。");
  } catch (error) {
    toast(`更新失败：${error.message}`);
  }
}

function openEditMatch(id) {
  if (!isAdmin()) return;
  const match = state.matches.find((item) => item.id === id);
  if (!match) return;
  $("#editMatchForm").reset();
  $("#editMatchId").value = id;
  $(`input[name="editWinner"][value="${match.winner}"]`).checked = true;
  $("#editPlayedAt").value = localDateTimeValue(asDate(match.playedAt));
  $("#editMatchNote").value = match.note || "";
  $("#editMatchError").textContent = "";
  $("#editMatchDialog").showModal();
}

async function saveMatchEdit(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  const error = $("#editMatchError");
  const button = $("#saveMatchBtn");
  try {
    const winner = new FormData($("#editMatchForm")).get("editWinner");
    const playedAt = new Date($("#editPlayedAt").value);
    if (!winner || Number.isNaN(playedAt.getTime())) throw new Error("请完整填写胜方和比赛时间。");
    button.disabled = true;
    const { error: updateError } = await state.supabase.from("matches").update({
      winner,
      played_at: playedAt.toISOString(),
      note: $("#editMatchNote").value.trim(),
    }).eq("id", $("#editMatchId").value);
    if (updateError) throw updateError;
    $("#editMatchDialog").close();
    toast("比赛结果已修正。");
  } catch (caught) {
    error.textContent = caught.message || "保存失败。";
  } finally {
    button.disabled = false;
  }
}

async function deleteMatch(id) {
  if (!isAdmin()) return;
  const match = state.matches.find((item) => item.id === id);
  if (!match || !confirm(`确定删除 ${match.teams?.blueName} vs ${match.teams?.redName} 的记录吗？此操作无法撤销。`)) return;
  try {
    const { error } = await state.supabase.from("matches").delete().eq("id", id);
    if (error) throw error;
    toast("比赛记录已删除。");
  } catch (error) {
    toast(`删除失败：${error.message}`);
  }
}

function renderAllSharedData() {
  renderHistory();
  renderLeaderboard();
  renderAdmin();
}

function mapPlayer(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    normalizedName: row.normalized_name,
    defaultCost: Number(row.default_cost),
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMatch(row) {
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    playedAt: row.played_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUid: row.created_by,
    submittedByPlayerId: row.submitted_by_player_id,
    submittedByName: row.submitted_by_name,
    winner: row.winner,
    score: row.score,
    note: row.note,
    teams: row.teams,
    lineup: row.lineup,
    bans: row.bans,
    options: row.options,
    dataVersion: row.data_version,
  };
}

async function refreshPlayers() {
  const { data, error } = await state.supabase
    .from("players")
    .select("*")
    .order("display_name", { ascending: true });
  if (error) {
    toast(`选手库读取失败：${error.message}`);
    return;
  }
  state.players = (data || []).map(mapPlayer);
  restoreLocalSetup();
  renderAllSharedData();
}

async function refreshMatches() {
  const { data, error } = await state.supabase
    .from("matches")
    .select("*")
    .order("played_at", { ascending: false });
  if (error) {
    toast(`对局读取失败：${error.message}`);
    return;
  }
  state.matches = (data || []).map(mapMatch);
  renderAllSharedData();
}

function startSharedListeners() {
  clearSubscriptions();
  refreshPlayers();
  refreshMatches();
  state.realtimeChannel = state.supabase
    .channel("lgg-shared-data")
    .on("postgres_changes", { event: "*", schema: "public", table: "players" }, refreshPlayers)
    .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, refreshMatches)
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") toast("实时同步连接失败，刷新页面后会重新连接。");
    });
}

function showAuthenticatedApp() {
  $("#authGate").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#accountLabel").textContent = `${state.member.displayName || state.member.role} · ${state.member.role === "admin" ? "管理员" : "公共账号"}`;
  $$(".admin-only").forEach((element) => element.classList.toggle("hidden", !isAdmin()));
  startSharedListeners();
  loadPools();
}

async function handleAuthUser(user) {
  if (!user) {
    clearSubscriptions();
    state.user = null;
    state.member = null;
    $("#app").classList.add("hidden");
    $("#authGate").classList.remove("hidden");
    return;
  }
  try {
    const { data: profile, error: profileError } = await state.supabase
      .from("profiles")
      .select("id, username, display_name, role, active")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;
    if (!profile?.active || !["admin", "member"].includes(profile.role)) {
      throw new Error("账号尚未获得 LGG 使用权限。");
    }
    state.user = user;
    state.member = {
      username: profile.username,
      displayName: profile.display_name,
      role: profile.role,
      active: profile.active,
    };
    $("#loginError").textContent = "";
    showAuthenticatedApp();
  } catch (error) {
    $("#loginError").textContent = error.message;
    await state.supabase.auth.signOut();
  }
}

async function login(event) {
  event.preventDefault();
  const button = $("#loginBtn");
  const error = $("#loginError");
  const alias = normalizeName($("#loginAccount").value);
  const email = accountAliases[alias] || $("#loginAccount").value.trim();
  if (!email.includes("@")) {
    error.textContent = "账号或密码不正确。";
    return;
  }
  try {
    button.disabled = true;
    error.textContent = "";
    const { error: signInError } = await state.supabase.auth.signInWithPassword({
      email,
      password: $("#loginPassword").value,
    });
    if (signInError) throw signInError;
  } catch {
    error.textContent = "账号或密码不正确。";
  } finally {
    button.disabled = false;
  }
}

async function initializeSupabase() {
  const { enabled, url, publishableKey } = supabaseConfig;
  if (!enabled || !url || !publishableKey || publishableKey.startsWith("REPLACE_WITH")) {
    $("#supabaseSetupWarning").classList.remove("hidden");
    $("#loginBtn").disabled = true;
    return;
  }
  state.supabase = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  const { data: { session }, error } = await state.supabase.auth.getSession();
  if (error) {
    $("#loginError").textContent = "登录状态读取失败，请刷新页面。";
  } else {
    await handleAuthUser(session?.user || null);
  }
  state.supabase.auth.onAuthStateChange((event, nextSession) => {
    if (event === "INITIAL_SESSION") return;
    setTimeout(() => handleAuthUser(nextSession?.user || null), 0);
  });
}

function switchView(viewId) {
  if (viewId === "adminView" && !isAdmin()) return;
  $$(".view").forEach((view) => view.classList.toggle("hidden", view.id !== viewId));
  $$(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
  if (viewId === "historyView") renderHistory();
  if (viewId === "leaderboardView") renderLeaderboard();
  if (viewId === "adminView") renderAdmin();
}

function toggleCustomRange(prefix) {
  const custom = $(`#${prefix}Range`).value === "custom";
  $(`#${prefix}From`).classList.toggle("hidden", !custom);
  $(`#${prefix}To`).classList.toggle("hidden", !custom);
  state.historyPage = 1;
  prefix === "history" ? renderHistory() : renderLeaderboard();
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", login);
  $("#logoutBtn").addEventListener("click", () => state.supabase.auth.signOut());
  $$(".nav-btn").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#rollBtn").addEventListener("click", roll);
  $("#balanceBtn").addEventListener("click", balancePlayers);
  $("#revealBtn").addEventListener("click", () => ($("#sequentialReveal").checked ? revealNext() : revealAll()));
  $("#backBtn").addEventListener("click", backToSetup);
  $("#againBtn").addEventListener("click", roll);
  $("#recordBtn").addEventListener("click", openRecordDialog);
  $("#collectMatchBtn").addEventListener("click", collectMatchData);
  $("#resetBtn").addEventListener("click", resetSetup);
  $("#recordForm").addEventListener("submit", submitMatch);
  $("#editMatchForm").addEventListener("submit", saveMatchEdit);
  $$("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  $("#playerForm").addEventListener("submit", addPlayer);
  $("#results").addEventListener("click", (event) => {
    const button = event.target.closest("[data-reroll]");
    if (button) rerollHero(Number(button.dataset.reroll));
  });
  document.addEventListener("input", (event) => {
    if (event.target.matches(".player-name")) {
      syncPlayerInput(event.target);
      renderPlayerSuggestions(event.target);
    }
    if (event.target.matches(".cost-input,.team-name,#uniqueHeroes,#sequentialReveal")) {
      updateCostTotals();
      saveLocalSetup();
    }
  });
  document.addEventListener("focusin", (event) => {
    if (event.target.matches(".player-name")) renderPlayerSuggestions(event.target);
  });
  document.addEventListener("focusout", (event) => {
    if (event.target.matches(".player-name")) {
      setTimeout(() => hidePlayerSuggestions(event.target), 120);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    const option = event.target.closest("[data-player-option]");
    if (!option) return;
    event.preventDefault();
    const input = option.closest(".player-search").querySelector(".player-name");
    selectPlayerSuggestion(input, option.dataset.playerOption);
  });
  document.addEventListener("keydown", (event) => {
    if (!event.target.matches(".player-name")) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      movePlayerSuggestion(event.target, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      const suggestions = event.target.closest(".player-search").querySelector(".player-suggestions");
      const active = suggestions.querySelector("[data-player-option].active");
      if (active) {
        event.preventDefault();
        selectPlayerSuggestion(event.target, active.dataset.playerOption);
      }
    } else if (event.key === "Escape") {
      hidePlayerSuggestions(event.target);
    }
  });
  for (const container of ["#matchList", "#adminMatchList"]) {
    $(container).addEventListener("click", (event) => {
      const edit = event.target.closest("[data-edit-match]");
      const remove = event.target.closest("[data-delete-match]");
      if (edit) openEditMatch(edit.dataset.editMatch);
      if (remove) deleteMatch(remove.dataset.deleteMatch);
    });
  }
  $("#adminPlayerList").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-player]");
    const toggle = event.target.closest("[data-toggle-player]");
    if (edit) editPlayer(edit.dataset.editPlayer);
    if (toggle) togglePlayer(toggle.dataset.togglePlayer);
  });
  $("#historyPrev").addEventListener("click", () => { state.historyPage -= 1; renderHistory(); });
  $("#historyNext").addEventListener("click", () => { state.historyPage += 1; renderHistory(); });
  $("#historyRange").addEventListener("change", () => toggleCustomRange("history"));
  $("#rankRange").addEventListener("change", () => toggleCustomRange("rank"));
  for (const id of ["historyFrom", "historyTo"]) $(`#${id}`).addEventListener("change", renderHistory);
  for (const id of ["rankFrom", "rankTo", "rankSearch", "minGames"]) $(`#${id}`).addEventListener("input", renderLeaderboard);
  $("#heroStatsBtn").addEventListener("click", () => { renderHeroStats(); $("#heroStatsDialog").showModal(); });
  $("#heroStatsClose").addEventListener("click", () => $("#heroStatsDialog").close());
  $("#heroSearch").addEventListener("input", renderHeroStats);
  $("#heroLane").addEventListener("change", renderHeroStats);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return;
    if ($("#arena").classList.contains("show") && (event.code === "Space" || event.code === "Enter") && !event.target.closest("button,input,select,textarea,dialog")) {
      event.preventDefault();
      $("#sequentialReveal").checked ? revealNext() : revealAll();
    }
  });
}

makePlayerInputs("blue");
makePlayerInputs("red");
updateCostTotals();
bindEvents();
initializeSupabase();
