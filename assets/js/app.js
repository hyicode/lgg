import { supabaseConfig, accountAliases } from "./supabase-config.js";
import { comparePlayerStats, computeLeaderboards, filterMatchesByRange, asDate } from "./stats-core.js";
import { createSearchForms, fuzzyMatches } from "./search-core.js";
import { matchCollectedParticipants, championSlug } from "./collector-core.js";
import { createClient } from "@supabase/supabase-js";
import { pinyin } from "pinyin-pro";

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
let championIdMap = null; // { championId: "championName" }
const DRAW_OPTION_IDS = ["randomTeams", "randomPositions", "randomHeroes", "uniqueHeroes", "globalBp"];

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
  matchedParticipants: new Map(),
  collectorNeedsInstall: false,
  testDataEnabled: false,
  historyPage: 1,
  setupRestored: false,
  realtimeChannel: null,
  riotAccounts: new Map(),
  playerStats: new Map(),
  playerPickerInput: null,
  globalBpRosterKey: "",
  globalBpUsed: new Set(),
  globalBpRounds: 0,
  globalBpCommittedDraftId: null,
  fateSequence: 0,
  adminSelectedPlayers: new Set(),
  adminSelectedMatches: new Set(),
  adminBatchBusy: false,
  heroStatsSortKey: "weight",
  heroStatsSortDirection: "desc",
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

function normalizeClientPosition(position = "", lane = "", role = "") {
  const rawPosition = String(position || "").trim().toUpperCase();
  const rawLane = String(lane || "").trim().toUpperCase();
  const rawRole = String(role || "").trim().toUpperCase();
  const positionCode = ["", "NONE", "UNSELECTED", "FILL"].includes(rawPosition)
    ? rawLane
    : rawPosition;
  let key = "";
  if (positionCode === "TOP") key = "top";
  else if (positionCode === "JUNGLE") key = "jungle";
  else if (["MID", "MIDDLE", "CENTER"].includes(positionCode)) key = "middle";
  else if (["UTILITY", "SUPPORT"].includes(positionCode)) key = "support";
  else if (["BOT", "BOTTOM"].includes(positionCode)) {
    key = ["UTILITY", "SUPPORT", "DUO_SUPPORT"].includes(rawRole) ? "support" : "bottom";
  }
  return {
    key,
    label: LANES.find(([laneKey]) => laneKey === key)?.[1] || "未知",
  };
}

const CLIENT_POSITION_ICONS = {
  top: "./assets/lol-positions/top.svg",
  jungle: "./assets/lol-positions/jungle.svg",
  middle: "./assets/lol-positions/middle.svg",
  bottom: "./assets/lol-positions/bottom.svg",
  support: "./assets/lol-positions/support.svg",
};

function positionIconMarkup(position, className = "") {
  const normalized = typeof position === "object"
    ? position
    : normalizeClientPosition(position);
  const iconPath = CLIENT_POSITION_ICONS[normalized?.key];
  const classes = ["lol-position-icon", className, iconPath ? "" : "unknown"].filter(Boolean).join(" ");
  if (!iconPath) {
    return `<span class="${classes}" role="img" aria-label="位置未知"><span aria-hidden="true">—</span></span>`;
  }
  return `<span class="${classes}" role="img" aria-label="${escapeHtml(normalized.label)}"><img src="${iconPath}" alt="" aria-hidden="true"></span>`;
}

function loadGlobalBpState() {
  try {
    const saved = JSON.parse(localStorage.getItem("lgg-global-bp-v1") || "null");
    state.globalBpRosterKey = typeof saved?.rosterKey === "string" ? saved.rosterKey : "";
    state.globalBpUsed = new Set(Array.isArray(saved?.used) ? saved.used.filter(Boolean) : []);
    state.globalBpRounds = Number.isInteger(saved?.rounds)
      ? Math.min(4, Math.max(0, saved.rounds))
      : state.globalBpUsed.size ? 1 : 0;
  } catch {
    state.globalBpRosterKey = "";
    state.globalBpUsed = new Set();
    state.globalBpRounds = 0;
  }
}

function saveGlobalBpState() {
  try {
    localStorage.setItem("lgg-global-bp-v1", JSON.stringify({
      rosterKey: state.globalBpRosterKey,
      used: [...state.globalBpUsed],
      rounds: state.globalBpRounds,
    }));
  } catch {
    // 本机规则状态保存失败不影响天命流程。
  }
}

function currentRosterKey() {
  return [...lineup("blue"), ...lineup("red")]
    .map((player) => player.id)
    .filter(Boolean)
    .sort()
    .join("|");
}

function ensureGlobalBpRoster() {
  const rosterKey = currentRosterKey();
  if (rosterKey === state.globalBpRosterKey) return;
  state.globalBpRosterKey = rosterKey;
  state.globalBpUsed = new Set();
  state.globalBpRounds = 0;
  state.globalBpCommittedDraftId = null;
  saveGlobalBpState();
}

function clearGlobalBp() {
  state.globalBpRosterKey = currentRosterKey();
  state.globalBpUsed = new Set();
  state.globalBpRounds = 0;
  state.globalBpCommittedDraftId = null;
  saveGlobalBpState();
  renderDrawOptionsStatus();
  toast("已清空当前阵容的全局 BP 英雄池。");
}

function renderDrawOptionsStatus() {
  const round = $("#globalBpRound");
  if (round) round.textContent = `第 ${state.globalBpRounds + 1} / 5 轮`;
  const status = $("#globalBpStatus");
  if (status) status.textContent = `已禁用 ${state.globalBpUsed.size} 个英雄`;
  const clearButton = $("#clearGlobalBpBtn");
  if (clearButton) {
    const locked = $("#setupSection")?.classList.contains("roll-active");
    clearButton.disabled = locked || (state.globalBpUsed.size === 0 && state.globalBpRounds === 0);
  }
  if ($("#globalBpDialog")?.open) renderGlobalBpDetails();
}

function setDrawOptionsLocked(locked) {
  DRAW_OPTION_IDS.forEach((id) => {
    const input = $(`#${id}`);
    if (input) input.disabled = locked;
  });
  $(".draw-options-panel")?.classList.toggle("is-locked", locked);
  renderDrawOptionsStatus();
}

function globalBpHeroDetails() {
  const catalog = new Map();
  if (state.pools) {
    Object.values(state.pools).flat().forEach((hero) => {
      if (!catalog.has(hero.slug)) catalog.set(hero.slug, hero);
    });
  }
  return [...state.globalBpUsed]
    .map((slug) => catalog.get(slug) || {
      id: 0,
      slug,
      name: slug,
      image: "",
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function renderGlobalBpDetails() {
  const meta = $("#globalBpDialogMeta");
  const body = $("#globalBpDetailsBody");
  if (!meta || !body) return;
  const heroes = globalBpHeroDetails();
  meta.textContent = `已完成 ${state.globalBpRounds} / 5 轮 · 下一轮为第 ${state.globalBpRounds + 1} 轮 · 共禁用 ${heroes.length} 个英雄`;
  body.innerHTML = heroes.length
    ? `<div class="bp-details-grid">${heroes.map((hero) => `
      <article class="bp-hero-card">
        <img src="${escapeHtml(portrait(hero))}" alt="${escapeHtml(hero.name)}">
        <strong>${escapeHtml(hero.name)}</strong>
      </article>`).join("")}</div>`
    : `<div class="bp-details-empty"><strong>暂无全局禁用英雄</strong><small>成功记录一局后，使用过的英雄会显示在这里。</small></div>`;
  $$("#globalBpDetailsBody .bp-hero-card img").forEach((image, index) => {
    image.addEventListener("error", () => { image.src = avatar(heroes[index]); }, { once: true });
  });
}

function openGlobalBpDetails() {
  renderGlobalBpDetails();
  $("#globalBpDialog").showModal();
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

// ---- 本地 LGG 选手 ↔ 客户端玩家 双向映射 ----

const NAME_MAP_KEY = "lgg-name-map-v2";

function loadNameMappings() {
  try {
    const raw = localStorage.getItem(NAME_MAP_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (data && data.byPlayerId && data.byAccountName) {
      let changed = false;
      if (!data.byPlayerName) {
        data.byPlayerName = {};
        changed = true;
      }
      if (!data.byGameId) {
        data.byGameId = {};
        changed = true;
      }
      for (const [playerId, gameId] of Object.entries(data.byPlayerId)) {
        const player = playerById(playerId);
        if (!player || !gameId) continue;
        const playerKey = normalizeName(player.displayName);
        const gameKey = normalizeName(gameId);
        if (data.byPlayerName[playerKey] !== gameId) {
          data.byPlayerName[playerKey] = gameId;
          changed = true;
        }
        if (data.byGameId[gameKey] !== player.displayName) {
          data.byGameId[gameKey] = player.displayName;
          changed = true;
        }
      }
      if (data.version !== 3) {
        data.version = 3;
        changed = true;
      }
      if (changed) {
        try {
          localStorage.setItem(NAME_MAP_KEY, JSON.stringify(data));
        } catch { /* quota exceeded */ }
      }
      return data;
    }
  } catch { /* ignore */ }
  // 兼容旧版 v1 {playerId: accountName}
  try {
    const raw = localStorage.getItem("lgg-name-map-v1");
    if (raw) {
      const old = JSON.parse(raw);
      const byPlayerId = {};
      const byAccountName = {};
      for (const [pid, name] of Object.entries(old)) {
        if (!pid || !name) continue;
        const key = normalizeName(name);
        byPlayerId[pid] = name;
        byAccountName[key] = pid;
      }
      const map = { byPlayerId, byAccountName, byPlayerName: {}, byGameId: {}, version: 3 };
      localStorage.setItem(NAME_MAP_KEY, JSON.stringify(map));
      localStorage.removeItem("lgg-name-map-v1");
      return map;
    }
  } catch { /* ignore */ }
  return { byPlayerId: {}, byAccountName: {}, byPlayerName: {}, byGameId: {}, version: 3 };
}

function saveBidirectionalMapping(playerId, accountName) {
  if (!playerId || !accountName) return;
  const map = loadNameMappings();
  const accKey = normalizeName(accountName);
  const player = playerById(playerId);
  const playerKey = normalizeName(player?.displayName || "");
  // 清除旧的反向映射
  const oldAcc = map.byPlayerId[playerId];
  if (oldAcc) {
    const oldAccKey = normalizeName(oldAcc);
    delete map.byAccountName[oldAccKey];
    delete map.byGameId[oldAccKey];
    for (const [nameKey, gameId] of Object.entries(map.byPlayerName)) {
      if (normalizeName(gameId) === oldAccKey) delete map.byPlayerName[nameKey];
    }
  }
  // 清除旧的正向映射
  const oldPid = map.byAccountName[accKey];
  if (oldPid) {
    delete map.byPlayerId[oldPid];
    for (const [nameKey, gameId] of Object.entries(map.byPlayerName)) {
      if (normalizeName(gameId) === accKey) delete map.byPlayerName[nameKey];
    }
  }
  // 写入双向
  map.byPlayerId[playerId] = accountName;
  map.byAccountName[accKey] = playerId;
  if (playerKey) map.byPlayerName[playerKey] = accountName;
  if (player) map.byGameId[accKey] = player.displayName;
  map.version = 3;
  try {
    localStorage.setItem(NAME_MAP_KEY, JSON.stringify(map));
  } catch { /* quota exceeded */ }
}

/** 根据客户端账号名找 LGG 选手 */
function findPlayerByAccount(accountName) {
  if (!accountName) return null;
  const map = loadNameMappings();
  const key = normalizeName(accountName);
  const baseKey = key.split("#")[0];
  const pid = map.byAccountName[key] || map.byAccountName[baseKey];
  if (!pid) return null;
  return playerById(pid);
}

/** 根据 LGG 选手 ID 找客户端账号 */
function findAccountByPlayer(playerId) {
  if (!playerId) return "";
  const map = loadNameMappings();
  return map.byPlayerId[playerId] || "";
}

function removeBidirectionalMapping(playerId) {
  if (!playerId) return;
  const map = loadNameMappings();
  const accountName = map.byPlayerId[playerId];
  delete map.byPlayerId[playerId];
  if (accountName) {
    const accountKey = normalizeName(accountName);
    if (map.byAccountName[accountKey] === playerId) delete map.byAccountName[accountKey];
    delete map.byGameId[accountKey];
    for (const [nameKey, gameId] of Object.entries(map.byPlayerName)) {
      if (normalizeName(gameId) === accountKey) delete map.byPlayerName[nameKey];
    }
  }
  try {
    localStorage.setItem(NAME_MAP_KEY, JSON.stringify(map));
  } catch { /* quota exceeded */ }
}

function renderLocalMappings() {
  const select = $("#localMappingPlayer");
  const list = $("#localMappingsList");
  if (!select || !list) return;

  const selectedPlayerId = select.value;
  const players = [...state.players].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.displayName.localeCompare(b.displayName, "zh-CN");
  });
  select.innerHTML = `<option value="">选择玩家</option>${players.map((player) => `
    <option value="${escapeHtml(player.id)}">${escapeHtml(player.displayName)}${player.active ? "" : "（已停用）"}</option>
  `).join("")}`;
  if (players.some((player) => player.id === selectedPlayerId)) select.value = selectedPlayerId;

  const map = loadNameMappings();
  const rows = Object.entries(map.byPlayerId)
    .map(([playerId, gameId]) => ({
      playerId,
      gameId,
      player: playerById(playerId),
    }))
    .sort((a, b) => (a.player?.displayName || "").localeCompare(b.player?.displayName || "", "zh-CN"));

  list.innerHTML = rows.length
    ? rows.map(({ playerId, gameId, player }) => `
      <article class="local-mapping-row">
        <span class="local-mapping-player">
          <strong>${escapeHtml(player?.displayName || "已删除的玩家")}</strong>
          <small>${player?.active === false ? "已停用" : "LGG 玩家"}</small>
        </span>
        <span class="local-mapping-row-arrow" aria-hidden="true">↔</span>
        <span class="local-mapping-game-id" title="${escapeHtml(gameId)}">${escapeHtml(gameId)}</span>
        <span class="local-mapping-actions">
          ${player ? `<button class="mini" type="button" data-edit-local-mapping="${escapeHtml(playerId)}">编辑</button>` : ""}
          <button class="mini danger" type="button" data-delete-local-mapping="${escapeHtml(playerId)}">删除</button>
        </span>
      </article>
    `).join("")
    : `<div class="local-mappings-empty">还没有映射。保存一次后，采集与录入对局都会自动识别玩家。</div>`;
}

function openLocalMappings() {
  $("#localMappingForm").reset();
  $("#localMappingError").textContent = "";
  renderLocalMappings();
  $("#localMappingsDialog").showModal();
}

function saveLocalMapping(event) {
  event.preventDefault();
  const playerId = $("#localMappingPlayer").value;
  const gameId = $("#localMappingGameId").value.trim();
  const error = $("#localMappingError");
  const player = playerById(playerId);
  if (!player) {
    error.textContent = "请选择一个 LGG 玩家。";
    return;
  }
  if (!gameId || gameId.length > 64) {
    error.textContent = "请填写有效的游戏 ID。";
    return;
  }
  saveBidirectionalMapping(playerId, gameId);
  event.currentTarget.reset();
  error.textContent = "";
  renderLocalMappings();
  toast(`已保存 ${player.displayName} ↔ ${gameId}。`);
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
      <div class="player-row roster-card-row">
        <input class="player-name" type="hidden" data-side="${side}" data-slot="${index - 1}" value="">
        <input class="cost-input" type="hidden" value="1">
        <button class="roster-card is-empty" type="button" data-open-player-library aria-label="${side === "blue" ? "蓝方" : "红方"}第 ${index} 张选手牌，选择选手">
          <span class="roster-card-cost-badge">
            <span class="cost-gem" aria-hidden="true"></span>
            <span data-card-cost>1</span>
          </span>
          <span class="roster-card-inner">
            <span class="roster-card-face roster-card-front">
              <span class="roster-card-empty">
                <strong>?</strong>
                <small>选择选手</small>
              </span>
              <span class="roster-card-selected">
                <span class="roster-player-initial" data-card-initial>?</span>
                <strong data-card-name>未选择</strong>
                <small>点击替换</small>
              </span>
              <span class="roster-card-result">
                <img data-result-image alt="">
                <span class="roster-result-lane" data-result-lane></span>
                <span class="roster-result-champion" data-result-champion></span>
                <strong class="roster-result-player" data-result-player></strong>
                <span class="roster-result-rate" data-result-rate>
                  <span data-result-pick-rate></span>
                  <span data-result-win-rate></span>
                </span>
              </span>
            </span>
            <span class="roster-card-face roster-card-back" aria-hidden="true">
              <strong>?</strong>
              <small>天命待揭</small>
            </span>
          </span>
        </button>
        <div class="roster-cost-editor" role="group" aria-label="临时调整本局费用">
          <span class="roster-cost-editor-label">临时</span>
          <button type="button" data-temp-cost-step="-0.5" aria-label="费用减少 0.5">−</button>
          <output data-temp-cost>1</output>
          <button type="button" data-temp-cost-step="0.5" aria-label="费用增加 0.5">+</button>
          <button class="roster-cost-reset" type="button" data-temp-cost-reset aria-label="恢复选手库费用">还原</button>
        </div>
      </div>`);
  }
}

function renderRosterCard(row, player = null) {
  if (!row) return;
  const button = row.querySelector(".roster-card");
  if (!button) return;
  const input = row.querySelector(".player-name");
  const sideLabel = input?.dataset.side === "red" ? "红方" : "蓝方";
  const slot = Number(input?.dataset.slot || 0) + 1;
  const hasPlayer = Boolean(player?.id);
  const costInput = row.querySelector(".cost-input");
  const currentCost = Number(costInput?.value);
  const defaultCost = Number(player?.defaultCost);
  const displayCost = hasPlayer && Number.isFinite(currentCost)
    ? currentCost
    : Number.isFinite(defaultCost) ? defaultCost : 1;
  const hasCostOverride = hasPlayer
    && Number.isFinite(defaultCost)
    && Math.abs(displayCost - defaultCost) > 0.001;
  row.classList.toggle("has-player", hasPlayer);
  row.classList.toggle("has-cost-override", hasCostOverride);
  button.classList.toggle("is-empty", !hasPlayer);
  button.querySelector("[data-card-initial]").textContent = hasPlayer ? player.displayName.trim().slice(0, 1) : "?";
  button.querySelector("[data-card-name]").textContent = hasPlayer ? player.displayName : "未选择";
  button.querySelector("[data-card-cost]").textContent = formatNumber(displayCost);
  row.querySelector("[data-temp-cost]").textContent = formatNumber(displayCost);
  const label = hasPlayer
    ? `${sideLabel}第 ${slot} 张选手牌，当前选手 ${player.displayName}，费用 ${formatNumber(displayCost)}${hasCostOverride ? "，本局临时费用" : ""}，点击替换`
    : `${sideLabel}第 ${slot} 张选手牌，选择选手`;
  button.setAttribute("aria-label", label);
}

function changeTemporaryRosterCost(control) {
  const row = control.closest(".roster-card-row");
  const input = row?.querySelector(".player-name");
  const player = playerById(input?.dataset.playerId || "");
  const costInput = row?.querySelector(".cost-input");
  if (!row || !player || !costInput) return;

  const currentCost = Number(costInput.value);
  const step = Number(control.dataset.tempCostStep);
  const nextCost = control.hasAttribute("data-temp-cost-reset")
    ? Number(player.defaultCost)
    : Math.min(99, Math.max(0, (Number.isFinite(currentCost) ? currentCost : Number(player.defaultCost)) + step));
  costInput.value = formatNumber(nextCost);
  renderRosterCard(row, player);
  updateCostTotals();
  saveLocalSetup();
}

function renderPlayerLibrary() {
  const container = $("#playerLibraryCards");
  if (!container || !state.playerPickerInput) return;
  const currentId = state.playerPickerInput.dataset.playerId || "";
  const isCollectedPicker = state.playerPickerInput.matches(".manual-roster-pick");
  const selectedIds = new Set(
    $$(isCollectedPicker
      ? ".manual-roster-pick"
      : "#bluePlayers .player-name, #redPlayers .player-name")
      .map((input) => input.dataset.playerId)
      .filter(Boolean),
  );
  const query = $("#playerLibrarySearch").value.trim();
  const players = activePlayers()
    .filter((player) => !query || fuzzySearch(player.displayName, query))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-CN"));

  container.innerHTML = players.length
    ? players.map((player) => {
      const occupied = selectedIds.has(player.id) && player.id !== currentId;
      const current = player.id === currentId;
      return `
        <button class="library-player-card${current ? " current" : ""}" type="button"
          data-library-player="${escapeHtml(player.id)}"${occupied ? " disabled" : ""}
          aria-label="${escapeHtml(player.displayName)}，费用 ${formatNumber(player.defaultCost)}${occupied ? "，已在本局阵容中" : ""}">
          <span class="library-card-slot">${current ? "当前" : occupied ? "已上场" : "选手"}</span>
          <span class="library-cost-badge"><span class="cost-gem" aria-hidden="true"></span><span>${formatNumber(player.defaultCost)}</span></span>
          <span class="library-player-initial">${escapeHtml(player.displayName.trim().slice(0, 1))}</span>
          <strong>${escapeHtml(player.displayName)}</strong>
        </button>`;
    }).join("")
    : `<div class="player-library-empty">没有匹配的可用选手</div>`;
}

function openPlayerLibrary(row) {
  const input = row?.querySelector(".player-name");
  if (!input) return;
  state.playerPickerInput = input;
  if (input.matches(".manual-roster-pick")) {
    const idx = Number(input.dataset.rosterIdx);
    const result = state.results[idx];
    const participant = result ? getMatchedParticipant(result) : null;
    const gameId = result?._clientPlayer || participant?.accountName || "未知游戏 ID";
    const clientTeam = participant?.team === "red" ? "红方" : participant?.team === "blue" ? "蓝方" : "队伍未知";
    const clientPosition = normalizeClientPosition(participant?.position);
    $("#playerLibrarySlot").innerHTML = `${clientTeam} · ${positionIconMarkup(clientPosition, "picker-position-icon")} · ${escapeHtml(gameId)}，选择实际参赛选手`;
    $("#clearPlayerCardBtn").textContent = "取消匹配";
  } else {
    const sideLabel = input.dataset.side === "red" ? "红方" : "蓝方";
    const slot = Number(input.dataset.slot || 0) + 1;
    $("#playerLibrarySlot").textContent = `${sideLabel} · 第 ${slot} 张选手牌`;
    $("#clearPlayerCardBtn").textContent = "清空此牌";
  }
  $("#playerLibrarySearch").value = "";
  renderPlayerLibrary();
  $("#playerLibraryDialog").showModal();
  requestAnimationFrame(() => $("#playerLibrarySearch").focus());
}

function choosePlayerFromLibrary(playerId) {
  const input = state.playerPickerInput;
  const player = playerById(playerId);
  if (!input || !player?.active) return;
  const isCollectedPicker = input.matches(".manual-roster-pick");
  const duplicate = $$(isCollectedPicker
    ? ".manual-roster-pick"
    : "#bluePlayers .player-name, #redPlayers .player-name")
    .some((item) => item !== input && item.dataset.playerId === player.id);
  if (duplicate) {
    toast(`${player.displayName} 已经匹配到本局另一名玩家。`);
    return;
  }
  input.value = player.displayName;
  input.dataset.playerId = player.id;
  if (isCollectedPicker) {
    updateManualRosterPick(input);
    $("#playerLibraryDialog").close();
    return;
  }
  const row = input.closest(".player-row");
  row.querySelector(".cost-input").value = formatNumber(player.defaultCost);
  renderRosterCard(row, player);
  updateCostTotals();
  saveLocalSetup();
  $("#rollError").textContent = "";
  $("#playerLibraryDialog").close();
}

function clearPlayerCard() {
  const input = state.playerPickerInput;
  if (!input) return;
  input.value = "";
  input.dataset.playerId = "";
  if (input.matches(".manual-roster-pick")) {
    updateManualRosterPick(input);
    $("#playerLibraryDialog").close();
    return;
  }
  const row = input.closest(".player-row");
  row.querySelector(".cost-input").value = "1";
  renderRosterCard(row);
  updateCostTotals();
  saveLocalSetup();
  $("#playerLibraryDialog").close();
}

function hidePlayerSuggestions(input) {
  const suggestions = input.closest(".player-search")?.querySelector(".player-suggestions")
    || input.parentElement?.querySelector(".player-suggestions");
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
  const suggestions = input.closest(".player-search")?.querySelector(".player-suggestions")
    || input.parentElement?.querySelector(".player-suggestions");
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
  const costInput = input.closest(".player-row")?.querySelector(".cost-input");
  if (costInput) costInput.value = formatNumber(player.defaultCost);
  if (input.closest(".roster-card-row")) renderRosterCard(input.closest(".roster-card-row"), player);
  hidePlayerSuggestions(input);
  updateCostTotals();
  saveLocalSetup();
  // 录入对局界面：立即更新 roster 映射
  if (input.matches(".manual-roster-pick")) {
    updateManualRosterPick(input);
  }
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
    const costInput = input.closest(".player-row")?.querySelector(".cost-input");
    if (costInput) costInput.value = formatNumber(player.defaultCost);
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
    renderRosterCard(rows[index], playerById(player.id) || {
      id: player.id,
      displayName: player.name,
      defaultCost: player.cost,
    });
  });
  updateCostTotals();
  saveLocalSetup();
}

function updateCostTotals() {
  for (const side of ["blue", "red"]) {
    const el = $(`#${side}Cost`);
    if (!el) continue;
    const total = lineup(side).reduce((sum, player) => sum + (Number.isFinite(player.cost) ? player.cost : 0), 0);
    el.textContent = `费用 ${formatNumber(total)}`;
  }
}

function syncRosterCostsFromLibrary() {
  $$("#bluePlayers .player-name, #redPlayers .player-name").forEach((input) => {
    const player = playerById(input.dataset.playerId || "");
    if (!player) return;
    input.value = player.displayName;
    input.closest(".player-row").querySelector(".cost-input").value = formatNumber(player.defaultCost);
    renderRosterCard(input.closest(".player-row"), player);
  });
  updateCostTotals();
  saveLocalSetup();
}

function saveLocalSetup() {
  try {
    localStorage.setItem("lgg-setup-v3", JSON.stringify({
      blueName: $("#blueName").value,
      redName: $("#redName").value,
      blue: lineup("blue"),
      red: lineup("red"),
      drawOptions: Object.fromEntries(DRAW_OPTION_IDS.map((id) => [id, Boolean($(`#${id}`)?.checked)])),
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
        rows[index].querySelector(".cost-input").value = formatNumber(matched.defaultCost);
        renderRosterCard(rows[index], matched);
      });
    }
    for (const id of DRAW_OPTION_IDS) {
      if (typeof saved.drawOptions?.[id] === "boolean") $(`#${id}`).checked = saved.drawOptions[id];
    }
    if (!saved.drawOptions && typeof saved.unique === "boolean") $("#uniqueHeroes").checked = saved.unique;
    updateCostTotals();
    renderDrawOptionsStatus();
    state.setupRestored = true;
  } catch {
    // 旧缓存格式异常时从空名单开始。
    state.setupRestored = true;
  }
}

function validateSetup() {
  const error = $("#rollError");
  const players = [...lineup("blue"), ...lineup("red")];
  const selectedCount = players.filter((player) => player.id && playerById(player.id)?.active).length;
  if (selectedCount !== 10) {
    error.textContent = `请先选满双方全部 10 名选手（当前已选择 ${selectedCount} / 10），再开启天命。`;
    return false;
  }
  if (new Set(players.map((player) => player.id)).size !== 10) {
    error.textContent = "同一名选手不能在本局重复出现。";
    return false;
  }
  if (!state.pools) {
    error.textContent = "位置数据尚未加载完成。";
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
    && Object.values(pools).flat().every((hero) => hero?.slug
      && Number(hero.winRate) >= 0
      && Number(hero.winRate) <= 100
      && Number(hero.weight) > 0
      && Number(hero.banRate) >= 0);
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
    if (remote.source !== "OPGG" || !validPools(remote.pools)) throw new Error("位置数据格式不正确");
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
      status.textContent = "位置数据加载失败，暂时无法 Roll";
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
          champion.championName = String(hero.title || "").trim();
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

function fillTestPlayers() {
  if (!isAdmin()) return toast("只有管理员可以使用测试填充。");
  const available = shuffle(activePlayers());
  if (available.length < 10) {
    const message = `测试填充需要至少 10 名可用选手，当前只有 ${available.length} 名。`;
    $("#rollError").textContent = message;
    toast(message);
    return;
  }

  const selected = available.slice(0, 10).map((player) => ({
    id: player.id,
    name: player.displayName,
    cost: player.defaultCost,
  }));
  setLineup("blue", selected.slice(0, 5));
  setLineup("red", selected.slice(5));
  $$(".player-name").forEach((input) => hidePlayerSuggestions(input));
  $("#rollError").textContent = "";
  toast("已随机填充 10 名测试选手。");
}

const TEST_HERO_NAMES = ["盖伦", "赵信", "阿狸", "金克丝", "锤石"];

function testModeEnabled() {
  return isAdmin() && state.testDataEnabled;
}

function renderTestDataMode() {
  const button = $("#testDataModeBtn");
  if (!button) return;
  const enabled = testModeEnabled();
  button.textContent = `测试数据：${enabled ? "开" : "关"}`;
  button.classList.toggle("active", enabled);
  button.setAttribute("aria-pressed", String(enabled));
  updateCollectorButton();
}

function testRosterPlayers() {
  const roster = [];
  const seen = new Set();
  const addPlayer = (candidate) => {
    const player = playerById(candidate?.id);
    if (!player || seen.has(player.id)) return;
    seen.add(player.id);
    roster.push(player);
  };
  state.results.forEach((result) => addPlayer(result.player));
  [...lineup("blue"), ...lineup("red")].forEach(addPlayer);
  shuffle(activePlayers()).forEach(addPlayer);
  return roster.slice(0, 10);
}

function testAccountName(player, index) {
  return findAccountByPlayer(player.id) || `${player.displayName || `测试玩家${index + 1}`}#TEST`;
}

function testHero(lane, offset = 0) {
  const pool = state.pools?.[lane] || [];
  if (pool.length) return pool[Math.abs(offset) % pool.length];
  const laneIndex = Math.max(0, LANES.findIndex(([key]) => key === lane));
  return {
    id: 0,
    slug: championSlug(TEST_HERO_NAMES[laneIndex]),
    name: TEST_HERO_NAMES[laneIndex],
  };
}

function testParticipantStats(index, won, seed = 0) {
  const kills = (index * 3 + seed) % 12;
  const deaths = (index + seed) % 8;
  const assists = 4 + ((index * 5 + seed) % 15);
  return {
    kills,
    deaths,
    assists,
    goldEarned: 8_500 + index * 620 + seed * 17,
    visionScore: 8 + ((index * 7 + seed) % 34),
    damageDealt: 9_000 + index * 1_850 + seed * 41,
    level: 12 + ((index + seed) % 7),
    win: won,
  };
}

function generateTestCollectedMatch() {
  if (!testModeEnabled()) return false;
  if (state.results.length !== 10 || state.results.some((result) => !playerById(result.player?.id))) {
    const message = "请先完成一次包含 10 名选手的天命结果，再生成记录对局测试数据。";
    $("#recordError").textContent = message;
    toast(message);
    return false;
  }

  const seed = Date.now() % 10_000;
  const winner = seed % 2 ? "blue" : "red";
  const participants = state.results.map((result, index) => {
    const player = playerById(result.player.id);
    const hero = testHero(result.position, seed + index);
    return {
      team: result.team,
      position: result.position,
      accountName: testAccountName(player, index),
      championName: hero.name,
      championId: Number(hero.id || 0),
      stats: testParticipantStats(index, result.team === winner, seed),
    };
  });

  state.collectedMatch = {
    source: "测试数据（模拟客户端采集）",
    collectedAt: new Date().toISOString(),
    gameId: `TEST-${Date.now()}`,
    playedAt: new Date().toISOString(),
    durationSeconds: 1_620 + (seed % 540),
    gameMode: "CLASSIC",
    winner,
    participants,
    _testData: true,
  };
  state.matchedParticipants = new Map(
    state.results.map((result, index) => [result.player.id, index]),
  );
  state.collectorNeedsInstall = false;
  $("#recordError").textContent = "";
  if (!$("#matchNote").value.trim()) $("#matchNote").value = "测试数据";
  renderCollectedMatch();
  toast("已生成一场模拟客户端对局，请核对后提交。");
  return true;
}

function createTestRecentGames(count = 5) {
  const roster = testRosterPlayers();
  if (roster.length < 10) return [];
  const now = Date.now();
  return Array.from({ length: count }, (_, gameIndex) => {
    const ordered = gameIndex === 0 ? [...roster] : shuffle(roster);
    const winner = gameIndex % 2 === 0 ? "blue" : "red";
    const participants = ordered.map((player, index) => {
      const team = index < 5 ? "blue" : "red";
      const lane = LANES[index % 5][0];
      const hero = testHero(lane, gameIndex * 7 + index);
      return {
        team,
        position: lane,
        accountName: testAccountName(player, index),
        championName: hero.name,
        championId: Number(hero.id || 0),
        stats: testParticipantStats(index, team === winner, gameIndex + 1),
      };
    });
    return {
      gameId: `TEST-HISTORY-${now}-${gameIndex + 1}`,
      playedAt: new Date(now - (gameIndex + 1) * 86_400_000).toISOString(),
      durationSeconds: 1_500 + gameIndex * 137,
      gameMode: "CLASSIC",
      gameType: "CUSTOM_GAME",
      winner,
      participants,
      _testData: true,
    };
  });
}

function showTestRecentGames() {
  const games = createTestRecentGames();
  const status = $("#manualCollectorStatus");
  if (!games.length) {
    const message = "生成历史对局测试数据需要至少 10 名启用的选手。";
    status.textContent = message;
    $("#recentGamesList").classList.add("hidden");
    toast(message);
    return false;
  }
  status.textContent = `已生成 ${games.length} 场模拟自定义对局，点击选择：`;
  renderRecentGames(games);
  return true;
}

function toggleTestDataMode() {
  if (!isAdmin()) return toast("只有管理员可以开启测试数据。");
  state.testDataEnabled = !state.testDataEnabled;
  renderTestDataMode();
  if (state.testDataEnabled) {
    if ($("#recordDialog").open && !state.collectedMatch) generateTestCollectedMatch();
    if ($("#manualMatchDialog").open) showTestRecentGames();
  }
  toast(state.testDataEnabled
    ? "测试数据已开启；记录和录入对局将使用模拟数据。"
    : "测试数据已关闭；之后将恢复读取本机客户端。");
}

function assignTeam(players, team) {
  return LANES.map(([position, positionLabel, abbreviation], index) => ({
    team,
    player: players[index],
    position,
    positionLabel,
    abbreviation,
    champion: null,
  }));
}

function randomizeTeams() {
  const players = shuffle([...lineup("blue"), ...lineup("red")]);
  setLineup("blue", players.slice(0, 5));
  setLineup("red", players.slice(5));
}

function randomizeTeamPositions() {
  for (const side of ["blue", "red"]) setLineup(side, shuffle(lineup(side)));
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
    const candidates = state.pools[item.position].filter((hero) => !banned.has(hero.slug) && (!unique || !used.has(hero.slug)));
    if (!candidates.length) {
      const hint = $("#globalBp")?.checked ? "，请清空全局 BP 英雄池或调整规则" : "";
      throw new Error(`${item.positionLabel}英雄池不足，无法满足当前规则${hint}。`);
    }
    item.champion = weightedChoice(candidates);
    used.add(item.champion.slug);
  }
  return items;
}

function withoutRandomHeroes(items) {
  return items.map((item) => ({
    ...item,
    champion: {
      id: 0,
      slug: "",
      name: "",
      image: "",
      weight: 0,
      banRate: 0,
    },
  }));
}

function roll() {
  if (!validateSetup()) return;
  if ($("#randomTeams").checked) randomizeTeams();
  if ($("#randomPositions").checked) randomizeTeamPositions();
  if ($("#globalBp").checked) ensureGlobalBpRoster();
  saveLocalSetup();
  try {
    const blue = assignTeam(lineup("blue"), "blue");
    const red = assignTeam(lineup("red"), "red");
    state.bans = [];
    state.results = $("#randomHeroes").checked
      ? pickHeroes(
        [...blue, ...red],
        $("#uniqueHeroes").checked,
        $("#globalBp").checked ? new Set(state.globalBpUsed) : new Set(),
      )
      : withoutRandomHeroes([...blue, ...red]);
    state.order = rosterRevealOrder();
    state.revealed = 0;
    state.draftId = crypto.randomUUID();
    state.submitted = false;
    state.collectedMatch = null;
    state.matchedParticipants = new Map();
    state.globalBpCommittedDraftId = null;
    renderRoll();
    requestAnimationFrame(() => requestAnimationFrame(runFateSequence));
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
  $("#results").innerHTML = "";
  $("#setupSection").classList.add("roll-active");
  setDrawOptionsLocked(true);
  $$(".roster-card-row").forEach((row) => {
    row.classList.remove("has-roll-result");
    row.classList.add("is-drawing");
  });
  $("#rollBtn").classList.add("hidden");
  $("#backBtn").classList.remove("hidden");
  $("#backBtn").disabled = true;
  $("#revealBtn").classList.add("hidden");
  $("#recordBtn").classList.add("hidden");
  $("#recordBtn").disabled = false;
  $("#recordBtn").textContent = "记录本局";
  $("#againBtn").classList.add("hidden");
}

function rosterRevealOrder() {
  const order = [];
  for (let slot = 0; slot < 5; slot += 1) {
    for (const side of ["blue", "red"]) {
      const playerId = $$(`#${side}Players .player-name`)[slot]?.dataset.playerId;
      const index = state.results.findIndex((result) => result.player.id === playerId);
      if (index >= 0) order.push(index);
    }
  }
  return order;
}

function rosterRowForResult(result) {
  return $$(".roster-card-row").find((row) => row.querySelector(".player-name")?.dataset.playerId === result.player.id);
}

function fillRosterResult(result, index) {
  const champion = result.champion;
  const row = rosterRowForResult(result);
  if (!row) return;
  const image = row.querySelector("[data-result-image]");
  const hasChampion = Boolean(champion?.slug);
  image.hidden = !hasChampion;
  image.alt = hasChampion ? champion.name : "";
  if (hasChampion) image.src = portrait(champion);
  row.querySelector("[data-result-lane]").innerHTML = positionIconMarkup(result.position, "result-position-icon");
  row.querySelector("[data-result-champion]").textContent = hasChampion ? champion.name : "英雄自选";
  const rate = row.querySelector("[data-result-rate]");
  rate.hidden = !hasChampion;
  rate.querySelector("[data-result-pick-rate]").textContent = hasChampion
    ? `登场率：${formatNumber(champion.weight, 2)}%`
    : "";
  rate.querySelector("[data-result-win-rate]").textContent = hasChampion
    ? `胜率：${formatNumber(champion.winRate, 2)}%`
    : "";
  row.querySelector("[data-result-player]").textContent = result.player.name;
  row.classList.toggle("hero-self-pick", !hasChampion);
  row.classList.remove("soul-extracting", "soul-restored");
  row.dataset.resultIndex = String(index);
  row.classList.add("has-roll-result");
  if (hasChampion) image.addEventListener("error", () => { image.src = avatar(champion); }, { once: true });
  requestAnimationFrame(() => row.classList.remove("is-drawing"));
}

function commitGlobalBpResults(snapshot) {
  if (!$("#globalBp").checked || state.globalBpCommittedDraftId === state.draftId) return false;
  (snapshot?.participants || []).forEach((participant) => {
    const championName = participant.champion?.name || "";
    const catalogMatch = state.pools
      ? Object.values(state.pools).flat().find((hero) => normalizeName(hero.name) === normalizeName(championName))
      : null;
    const draftMatch = state.results.find((result) => result.player.id === participant.playerId);
    const slug = participant.champion?.slug
      || catalogMatch?.slug
      || (normalizeName(draftMatch?.champion?.name || "") === normalizeName(championName) ? draftMatch?.champion?.slug : "");
    if (slug) state.globalBpUsed.add(slug);
  });
  state.globalBpCommittedDraftId = state.draftId;
  state.globalBpRounds += 1;
  const cycleComplete = state.globalBpRounds >= 5;
  if (cycleComplete) {
    state.globalBpRounds = 0;
    state.globalBpUsed = new Set();
  }
  saveGlobalBpState();
  renderDrawOptionsStatus();
  return cycleComplete;
}

function finishReveal() {
  $("#revealBtn").classList.add("hidden");
  $("#revealBtn").disabled = false;
  $("#backBtn").disabled = false;
  $("#recordBtn").classList.remove("hidden");
  $("#againBtn").classList.remove("hidden");
}

function revealNext() {
  revealAll();
}

function waitForFate(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cleanupFateFx() {
  const layer = $("#fateFxLayer");
  if (!layer) return;
  layer.replaceChildren();
  layer.classList.remove("active");
  document.documentElement.classList.remove("fate-ritual-active");
  $$(".roster-card-row").forEach((row) => row.classList.remove("soul-extracting", "soul-restored"));
}

function cardSoulPoint(row) {
  const rect = row.querySelector(".roster-card")?.getBoundingClientRect();
  return rect
    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

async function runFateSequence() {
  if (state.busy || state.revealed >= state.order.length) return;
  const sequence = ++state.fateSequence;
  const ordered = state.order
    .map((index) => ({ index, result: state.results[index], row: rosterRowForResult(state.results[index]) }))
    .filter((item) => item.row);
  if (!ordered.length) return;

  state.busy = true;
  $("#backBtn").disabled = true;
  $("#revealBtn").disabled = true;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    ordered.forEach(({ index, result }) => fillRosterResult(result, index));
    state.revealed = ordered.length;
    state.busy = false;
    finishReveal();
    return;
  }

  cleanupFateFx();
  const layer = $("#fateFxLayer");
  const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const points = ordered.map(({ row }) => cardSoulPoint(row));
  const souls = [];
  layer.classList.add("active");
  document.documentElement.classList.add("fate-ritual-active");

  await waitForFate(760);
  if (sequence !== state.fateSequence) return;
  ordered.forEach(({ row, result }, index) => {
    row.classList.add("soul-extracting");
    const soul = document.createElement("span");
    soul.className = `fate-soul fate-soul-${result.team}`;
    soul.style.left = `${points[index].x}px`;
    soul.style.top = `${points[index].y}px`;
    layer.append(soul);
    souls.push(soul);
  });

  await waitForFate(180);
  if (sequence !== state.fateSequence) return;
  souls.forEach((soul, index) => {
    const point = points[index];
    soul.animate([
      { left: `${point.x}px`, top: `${point.y}px`, opacity: 0, transform: "translate(-50%, -50%) scale(2.8)" },
      { left: `${point.x}px`, top: `${point.y}px`, opacity: 1, transform: "translate(-50%, -50%) scale(1.5)", offset: 0.2 },
      { left: `${point.x}px`, top: `${point.y}px`, opacity: 1, transform: "translate(-50%, -50%) scale(0.38)", offset: 0.46 },
      { left: `${center.x}px`, top: `${center.y}px`, opacity: 1, transform: "translate(-50%, -50%) scale(0.68)", offset: 0.88 },
      { left: `${center.x}px`, top: `${center.y}px`, opacity: 0.82, transform: "translate(-50%, -50%) scale(0.16)" },
    ], {
      duration: 1500,
      delay: index * 24,
      easing: "cubic-bezier(0.42, 0, 0.18, 1)",
      fill: "forwards",
    });
  });

  await waitForFate(1710);
  if (sequence !== state.fateSequence) return;
  ordered.forEach(({ row }) => row.classList.remove("soul-extracting"));
  const core = document.createElement("span");
  core.className = "fate-core";
  core.style.left = `${center.x}px`;
  core.style.top = `${center.y}px`;
  layer.append(core);
  core.animate([
    { opacity: 0, transform: "translate(-50%, -50%) scale(0.12)" },
    { opacity: 1, transform: "translate(-50%, -50%) scale(1.9)", offset: 0.42 },
    { opacity: 1, transform: "translate(-50%, -50%) scale(1.15)", offset: 0.68 },
    { opacity: 0, transform: "translate(-50%, -50%) scale(3.8)" },
  ], {
    duration: 720,
    easing: "cubic-bezier(0.18, 0.72, 0.2, 1)",
    fill: "forwards",
  });

  await waitForFate(430);
  if (sequence !== state.fateSequence) return;
  souls.forEach((soul, index) => {
    const point = points[index];
    soul.animate([
      { left: `${center.x}px`, top: `${center.y}px`, opacity: 0.95, transform: "translate(-50%, -50%) scale(0.36)" },
      { left: `${center.x}px`, top: `${center.y}px`, opacity: 1, transform: "translate(-50%, -50%) scale(1.35)", offset: 0.12 },
      { left: `${point.x}px`, top: `${point.y}px`, opacity: 1, transform: "translate(-50%, -50%) scale(0.7)", offset: 0.82 },
      { left: `${point.x}px`, top: `${point.y}px`, opacity: 0, transform: "translate(-50%, -50%) scale(2.4)" },
    ], {
      duration: 620,
      easing: "cubic-bezier(0.12, 0.76, 0.2, 1)",
      fill: "forwards",
    });
  });
  await waitForFate(620);
  if (sequence !== state.fateSequence) return;
  ordered.forEach(({ row, result, index: resultIndex }) => {
    fillRosterResult(result, resultIndex);
    row.classList.add("soul-restored");
    setTimeout(() => row.classList.remove("soul-restored"), 950);
  });
  souls.forEach((soul) => soul.remove());

  if (sequence !== state.fateSequence) return;
  state.revealed = ordered.length;
  await waitForFate(460);
  if (sequence !== state.fateSequence) return;
  cleanupFateFx();
  state.busy = false;
  finishReveal();
}

function revealAll() {
  runFateSequence();
}

function rerollHero(index) {
  if (state.submitted) return;
  const result = state.results[index];
  if (!result?.champion?.slug) return;
  const blocked = new Set([
    result.champion.slug,
    ...state.bans.map((hero) => hero.slug),
    ...($("#globalBp").checked ? state.globalBpUsed : []),
  ]);
  if ($("#uniqueHeroes").checked) state.results.forEach((item, itemIndex) => itemIndex !== index && blocked.add(item.champion.slug));
  const candidates = state.pools[result.position].filter((hero) => !blocked.has(hero.slug));
  if (!candidates.length) return toast(`${result.positionLabel}没有可用的新英雄。`);
  result.champion = weightedChoice(candidates);
  state.collectedMatch = null;
  state.matchedParticipants = new Map();
  fillRosterResult(result, index);
}

function backToSetup() {
  state.fateSequence += 1;
  state.busy = false;
  cleanupFateFx();
  $("#setupSection").classList.remove("roll-active");
  $$(".roster-card-row").forEach((row) => {
    row.classList.remove("is-drawing", "has-roll-result");
    delete row.dataset.resultIndex;
  });
  $("#rollBtn").classList.remove("hidden");
  $("#backBtn").classList.add("hidden");
  $("#revealBtn").classList.add("hidden");
  $("#recordBtn").classList.add("hidden");
  $("#againBtn").classList.add("hidden");
  setDrawOptionsLocked(false);
}

function resetSetup() {
  backToSetup();
  $$(".player-name").forEach((input) => {
    input.value = "";
    input.dataset.playerId = "";
    if (input.closest(".roster-card-row")) renderRosterCard(input.closest(".roster-card-row"));
  });
  $$(".cost-input").forEach((input) => { input.value = "1"; });
  $("#blueName").value = "蓝方";
  $("#redName").value = "红方";
  $("#randomTeams").checked = true;
  $("#randomPositions").checked = true;
  $("#randomHeroes").checked = true;
  $("#uniqueHeroes").checked = true;
  $("#globalBp").checked = true;
  $("#rollError").textContent = "";
  state.collectedMatch = null;
  state.matchedParticipants = new Map();
  localStorage.removeItem("lgg-setup-v3");
  updateCostTotals();
  renderDrawOptionsStatus();
}

function openRecordDialog() {
  if (state.revealed !== 10 || state.submitted) return;
  $("#recordForm").reset();
  $("#recordError").textContent = "";
  $("#playedAt").value = localDateTimeValue();
  renderCollectedMatch();
  $("#recordDialog").showModal();
  if (testModeEnabled()) {
    if (!state.collectedMatch) generateTestCollectedMatch();
  } else {
    refreshCollectorConnection();
  }
  if (state.collectedMatch?._testData && !$("#matchNote").value.trim()) {
    $("#matchNote").value = "测试数据";
  }
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
  if (testModeEnabled()) return false;
  try {
    const health = await collectorRequest("/health", 1500);
    return health.ok === true
      && health.service === "LGG Collector Bridge"
      && health.runtime === "go"
      && health.mode === "proxy";
  } catch {
    return false;
  }
}

function updateCollectorButton() {
  if (testModeEnabled()) {
    $("#collectMatchBtn").textContent = state.collectedMatch ? "重新生成测试数据" : "生成测试数据";
    return;
  }
  $("#collectMatchBtn").textContent = state.collectedMatch ? "重新采集" : "采集数据";
}

async function refreshCollectorConnection() {
  if (testModeEnabled()) {
    state.collectorNeedsInstall = false;
    updateCollectorButton();
    if (!state.collectedMatch) $("#collectorStatus").textContent = "测试数据已开启，将生成模拟客户端对局。";
    return true;
  }
  if (await collectorIsRunning()) {
    state.collectorNeedsInstall = false;
    updateCollectorButton();
    if (!state.collectedMatch) $("#collectorStatus").textContent = "采集器已连接，可以读取客户端数据。";
    return true;
  }
  if (!state.collectedMatch) {
    $("#collectorStatus").textContent = "Go 本机代理未运行；点击采集数据将尝试启动，未安装时会下载安装器。";
    state.collectorNeedsInstall = true;
    updateCollectorButton();
  }
  return false;
}

async function tryStartCollector() {
  if (testModeEnabled()) return false;
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
  const result = new Map();
  if (!state.collectedMatch) return result;
  const participants = state.collectedMatch.participants;
  for (const [playerId, match] of state.matchedParticipants) {
    const p = typeof match === "number" ? participants[match] : match;
    result.set(playerId, p);
  }
  return result;
}

function getMatchedParticipant(result) {
  const match = state.matchedParticipants.get(result.player.id);
  if (match == null) return null;
  if (typeof match === "number") return state.collectedMatch?.participants?.[match] || null;
  return match;
}

function updateManualRosterPick(input) {
  const idx = parseInt(input.dataset.rosterIdx);
  const playerId = input.dataset.playerId;
  const result = state.results[idx];
  if (!result) return;
  const previousPlayerId = result.player?.id || "";
  const previousMatch = state.matchedParticipants.get(previousPlayerId);
  const participantIdx = Number.isInteger(result._participantIdx)
    ? result._participantIdx
    : Number.isInteger(previousMatch) ? previousMatch : null;

  // 先清除该客户端玩家之前对应的选手，保证一对一
  for (const [pid, match] of state.matchedParticipants) {
    if (participantIdx != null && typeof match === "number" && match === participantIdx) {
      state.matchedParticipants.delete(pid);
    }
  }
  if (playerId && playerById(playerId)) {
    const player = playerById(playerId);
    result.player = { id: player.id, name: player.displayName, cost: player.defaultCost };
    // 同步 matchedParticipants，确保提交时能取到客户端 KDA 数据
    if (participantIdx != null) state.matchedParticipants.set(player.id, participantIdx);
    const clientName = result._clientPlayer
      || (participantIdx != null ? state.collectedMatch?.participants?.[participantIdx]?.accountName : "");
    if (clientName) {
      saveBidirectionalMapping(player.id, clientName);
      toast(`已更新本地映射：${player.displayName} ↔ ${clientName}`);
    }
  } else if (!input.value.trim()) {
    result.player = { id: "", name: "", cost: 0 };
  }
  renderCollectedMatch();
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
  const participants = collection.participants || [];
  const duration = collection.durationSeconds ? `${Math.round(collection.durationSeconds / 60)} 分钟` : "时长未知";
  const matchedCount = state.matchedParticipants.size;
  const totalNeeded = state.results.length;
  $("#collectorStatus").textContent = `已匹配 ${matchedCount} / ${totalNeeded} 名选手。队伍、位置、英雄与战绩均来自英雄联盟客户端，请核对选手与游戏 ID 后提交。`;
  $("#collectorMeta").textContent = `${collection.source} · ${duration}${collection.gameId ? ` · 对局 ${collection.gameId}` : ""}`;

  // 已使用的参与者索引
  const usedIndices = new Set();
  for (const match of state.matchedParticipants.values()) {
    if (typeof match === "number") usedIndices.add(match);
  }

  // 蓝红双方分别渲染。除选手映射外，所有对局字段均只读取客户端数据。
  const teamRows = { blue: [], red: [] };
  const positionOrder = new Map(LANES.map(([key], index) => [key, index]));
  const displayResults = state.results.map((result, idx) => ({ result, idx }));
  displayResults.sort((a, b) => {
    const aParticipant = getMatchedParticipant(a.result);
    const bParticipant = getMatchedParticipant(b.result);
    const aTeam = aParticipant?.team === "red" ? 1 : 0;
    const bTeam = bParticipant?.team === "red" ? 1 : 0;
    if (aTeam !== bTeam) return aTeam - bTeam;
    const aPosition = normalizeClientPosition(aParticipant?.position).key;
    const bPosition = normalizeClientPosition(bParticipant?.position).key;
    return (positionOrder.get(aPosition) ?? 99) - (positionOrder.get(bPosition) ?? 99);
  });
  displayResults.forEach(({ result, idx }) => {
    const matchedParticipant = getMatchedParticipant(result);
    const clientPlayer = result._clientPlayer || matchedParticipant?.accountName || "";
    const clientChamp = result._clientChampion || matchedParticipant?.championName || "";
    const clientStats = matchedParticipant?.stats;
    const clientPosition = normalizeClientPosition(matchedParticipant?.position);
    const displayTeam = matchedParticipant?.team === "blue" || matchedParticipant?.team === "red"
      ? matchedParticipant.team
      : result.team;
    const clientKDA = result._clientKDA || (clientStats
      ? `${clientStats.kills || 0}/${clientStats.deaths || 0}/${clientStats.assists || 0}`
      : "");

    // 选手列：点击后打开选手库，适配借用账号后改绑实际参赛者
    const selectedPlayerName = result.player?.name || "";
    const playerCell = `
      <input class="player-name manual-roster-pick" type="hidden" data-roster-idx="${idx}"
        data-player-id="${escapeHtml(result.player?.id || "")}" value="${escapeHtml(selectedPlayerName)}">
      <button class="collector-player-picker" type="button" data-open-collected-player-library
        aria-label="${escapeHtml(selectedPlayerName ? `当前选手 ${selectedPlayerName}，点击从选手库更换` : "尚未匹配选手，点击从选手库选择")}">
        <span class="collector-player-initial">${escapeHtml(selectedPlayerName.trim().slice(0, 1) || "?")}</span>
        <span class="collector-player-copy">
          <strong>${escapeHtml(selectedPlayerName || "选择选手")}</strong>
          <small>点击更换</small>
        </span>
      </button>`;

    const laneCell = positionIconMarkup(clientPosition, "collector-position-icon");

    teamRows[displayTeam].push(`
      <tr class="${displayTeam}" data-player-id="${escapeHtml(result.player?.id || "")}">
        <td>${playerCell}</td>
        <td>${laneCell}</td>
        <td class="collector-game-id" title="${escapeHtml(clientPlayer)}">${escapeHtml(clientPlayer || "—")}</td>
        <td class="collector-champion" title="${escapeHtml(clientChamp)}">${escapeHtml(clientChamp || "—")}</td>
        <td class="num">${clientKDA || "—"}</td>
      </tr>`);
  });
  $("#collectorBlueBody").innerHTML = teamRows.blue.join("");
  $("#collectorRedBody").innerHTML = teamRows.red.join("");
  for (const side of ["blue", "red"]) {
    const matched = state.results.filter((result) => {
      const participant = getMatchedParticipant(result);
      return participant?.team === side;
    }).length;
    $(`#collector${side === "blue" ? "Blue" : "Red"}Count`).textContent = `${matched} / 5 已匹配`;
  }

  // 渲染未匹配的参与者卡片池
  // 渲染未匹配的参与者卡片池（仅普通采集模式使用）
  const unmatchedCards = $("#unmatchedCards");
  const unmatchedParticipants = participants.filter((_, i) => !usedIndices.has(i));
  const pool = $("#unmatchedPool");
  const isManualEntry = collection.source?.startsWith("手动录入");
  pool.classList.toggle("hidden", isManualEntry || unmatchedParticipants.length === 0);
  if (!isManualEntry && unmatchedParticipants.length) {
    unmatchedCards.innerHTML = unmatchedParticipants.map((p, i) => {
      const origIdx = participants.indexOf(p);
      return `
        <div class="participant-card" draggable="true" data-participant-idx="${origIdx}">
          <span class="pc-name">${escapeHtml(p.accountName || "未知")}</span>
          <span class="pc-champ">${escapeHtml(p.championName || "?")}</span>
          <span class="pc-kda">${p.stats.kills}/${p.stats.deaths}/${p.stats.assists}</span>
        </div>`;
    }).join("");
  }

  // 绑定拖拽事件（仅普通采集模式）
  if (!isManualEntry) bindDragEvents();

  // 渲染后：将已选选手名填入输入框
  $$(".manual-roster-pick").forEach((input) => {
    const idx = parseInt(input.dataset.rosterIdx);
    const player = state.results[idx]?.player;
    if (player?.name) {
      input.value = player.name;
      input.dataset.playerId = player.id;
    }
  });

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

function unmatchParticipant(playerId) {
  state.matchedParticipants.delete(playerId);
  renderCollectedMatch();
}

function bindDragEvents() {
  // 参与者卡片：拖拽开始
  $$(".participant-card").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", card.dataset.participantIdx);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", (e) => {
      card.classList.remove("dragging");
    });
  });

  // 放置区域
  $$(".drop-zone").forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => {
      zone.classList.remove("drag-over");
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const playerId = zone.dataset.playerId;
      const participantIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (!Number.isFinite(participantIdx)) return;
      // 先取消该参与者之前可能已匹配的其他选手
      for (const [pid, match] of state.matchedParticipants) {
        if (match === participantIdx) state.matchedParticipants.delete(pid);
      }
      state.matchedParticipants.set(playerId, participantIdx);
      // 记住映射关系，下次自动匹配
      const p = state.collectedMatch?.participants?.[participantIdx];
      if (p?.accountName) saveBidirectionalMapping(playerId, p.accountName);
      renderCollectedMatch();
    });
  });

  // 也允许放到整行上
  $$(".collector-team-table tbody tr").forEach((row) => {
    if (row.querySelector(".drop-zone")) return;
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const playerId = row.dataset.playerId;
      if (!playerId) return;
      const participantIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (!Number.isFinite(participantIdx)) return;
      for (const [pid, match] of state.matchedParticipants) {
        if (match === participantIdx) state.matchedParticipants.delete(pid);
      }
      state.matchedParticipants.set(playerId, participantIdx);
      const p = state.collectedMatch?.participants?.[participantIdx];
      if (p?.accountName) saveBidirectionalMapping(playerId, p.accountName);
      renderCollectedMatch();
    });
  });
}

function collectedMatchFromClientGame(normalized, source, manualGameId = "") {
  return {
    source,
    collectedAt: new Date().toISOString(),
    gameId: normalized.gameId,
    playedAt: normalized.playedAt,
    durationSeconds: normalized.durationSeconds,
    gameMode: normalized.gameMode,
    winner: normalized.winner || "",
    participants: normalized.participants.map((participant) => ({
      team: participant.team,
      position: participant.position,
      accountName: participant.accountName,
      championName: participant.championName,
      championId: participant.championId,
      stats: {
        kills: participant.stats?.kills || 0,
        deaths: participant.stats?.deaths || 0,
        assists: participant.stats?.assists || 0,
        goldEarned: participant.stats?.goldEarned || 0,
        visionScore: participant.stats?.visionScore || 0,
        damageDealt: participant.stats?.totalDamageDealtToChampions || 0,
        level: participant.stats?.champLevel || 0,
      },
    })),
    ...(manualGameId ? { _manualGameId: manualGameId } : {}),
  };
}

async function fetchClientGameDetail(gameId, source, manualGameId = "") {
  const detail = await collectorRequest(`/proxy/lcu/lol-match-history/v1/games/${encodeURIComponent(gameId)}`, 12_000);
  const champMap = await loadChampionIdMap();
  const normalized = normalizeLcuGameDetail(detail, champMap);
  if (!normalized || normalized.participants.length < 10) {
    throw new Error("对局详情获取失败或玩家不足 10 人。");
  }
  return collectedMatchFromClientGame(normalized, source, manualGameId);
}

async function fetchLatestClientMatch() {
  const history = await collectorRequest(
    "/proxy/lcu/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=20",
    12_000,
  );
  const games = history?.games?.games || [];
  const customGames = games.filter((game) =>
    game.gameType === "CUSTOM_GAME" || game.gameType === "PRACTICE_GAME"
  );
  if (!customGames.length) throw new Error("没有找到最近的自定义对局。");

  const detailErrors = [];
  for (const game of customGames) {
    const gameId = String(game.gameId || game.id || "");
    if (!gameId) continue;
    try {
      return await fetchClientGameDetail(gameId, "浏览器解析（客户端最近对局）");
    } catch (error) {
      detailErrors.push(error.message);
    }
  }
  throw new Error(detailErrors[0] || "最近的自定义对局详情读取失败。");
}

async function collectMatchData() {
  const button = $("#collectMatchBtn");
  const error = $("#recordError");
  if (testModeEnabled()) {
    button.disabled = true;
    try {
      generateTestCollectedMatch();
    } finally {
      button.disabled = false;
    }
    return;
  }
  button.disabled = true;
  error.textContent = "";
  $("#collectorStatus").textContent = "正在读取英雄联盟客户端…";
  try {
    if (!await collectorIsRunning()) {
      if (!await tryStartCollector()) {
        state.collectedMatch = null;
        state.matchedParticipants = new Map();
        state.collectorNeedsInstall = true;
        renderCollectedMatch();
        downloadCollectorInstaller();
        $("#collectorStatus").textContent = "未检测到 Go 本机代理，已下载安装器。";
        error.textContent = "请运行下载的安装器；安装完成后再次点击采集数据。";
        return;
      }
    }
    state.collectorNeedsInstall = false;
    $("#collectorStatus").textContent = "采集器已启动，正在读取英雄联盟客户端…";

    // Go 采集器只做透明转发；对局选择与数据解析全部在浏览器完成。
    const manualGameId = state.collectedMatch?._manualGameId;
    const collected = manualGameId
      ? await fetchClientGameDetail(manualGameId, "手动录入（浏览器解析）", manualGameId)
      : await fetchLatestClientMatch();
    if (!Array.isArray(collected.participants) || collected.participants.length < 10) {
      throw new Error("采集到的玩家不足 10 人，请确认读取的是完整的召唤师峡谷对局。");
    }
    state.collectedMatch = collected;
    // 自动匹配：先用历史映射，再用 score 匹配
    const participants = collected.participants;
    state.matchedParticipants = new Map();
    const used = new Set();
    // 第一轮：本地双向映射精准匹配
    for (const result of state.results) {
      const storedAcc = findAccountByPlayer(result.player.id);
      if (storedAcc) {
        const found = participants.findIndex((p, i) =>
          !used.has(i) && normalizeName(p.accountName || "") === normalizeName(storedAcc)
        );
        if (found >= 0) {
          state.matchedParticipants.set(result.player.id, found);
          used.add(found);
          continue;
        }
      }
      // 反向查：用客户端账号找 LGG 选手
      const pp = participants.find((p, i) => !used.has(i) && p.accountName);
      if (pp) {
        const matched = findPlayerByAccount(pp.accountName);
        if (matched && matched.id === result.player.id) {
          state.matchedParticipants.set(result.player.id, participants.indexOf(pp));
          used.add(participants.indexOf(pp));
        }
      }
    }
    // 第二轮：用 score 匹配剩余
    const unmatchedResults = state.results.filter((r) => !state.matchedParticipants.has(r.player.id));
    const remainingParticipants = participants.filter((_, i) => !used.has(i));
    if (unmatchedResults.length && remainingParticipants.length) {
      const mapping = matchCollectedParticipants(unmatchedResults, remainingParticipants);
      for (const { result, participant } of mapping.rows) {
        const pIdx = participants.indexOf(participant);
        if (pIdx >= 0) {
          state.matchedParticipants.set(result.player.id, pIdx);
        }
      }
    }
    renderCollectedMatch();
  } catch (caught) {
    state.collectedMatch = null;
    state.matchedParticipants = new Map();
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

function handleCollectMatchClick(event) {
  if (!testModeEnabled()) {
    collectMatchData();
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const button = $("#collectMatchBtn");
  button.disabled = true;
  try {
    generateTestCollectedMatch();
  } finally {
    button.disabled = false;
  }
}

function matchSnapshot() {
  const collected = collectedByPlayerId();
  return {
    blueTeam: $("#blueName").value.trim() || "蓝方",
    redTeam: $("#redName").value.trim() || "红方",
    participants: state.results.map((result) => {
      const participant = collected.get(result.player.id);
      const clientPosition = normalizeClientPosition(participant?.position);
      return {
        team: participant?.team || "",
        playerId: result.player.id,
        playerName: result.player.name,
        accountName: participant?.accountName || "",
        position: clientPosition.key,
        positionLabel: clientPosition.label,
        champion: {
          slug: championSlug(participant?.championName || ""),
          name: participant?.championName || "",
        },
        ...(participant?.stats ? { stats: participant.stats } : {}),
      };
    }),
  };
}

async function submitMatch(event) {
  event.preventDefault();
  if (state.submitted) return;
  const button = $("#submitMatchBtn");
  const error = $("#recordError");
  let snapshot = null;
  let confirmedMappings = [];
  try {
    const winner = new FormData($("#recordForm")).get("winner");
    if (!winner) throw new Error("请选择胜方。");
    const playedAt = new Date($("#playedAt").value);
    if (Number.isNaN(playedAt.getTime())) throw new Error("请填写有效比赛时间。");
    snapshot = matchSnapshot();
    confirmedMappings = snapshot.participants
      .filter((participant) => participant.playerId && participant.accountName && playerById(participant.playerId))
      .map((participant) => ({
        playerId: participant.playerId,
        accountName: participant.accountName,
      }));
    // 将 accountName 归一化为 riot_accounts 引用，避免数据冗余
    await ensureRiotAccounts(snapshot.participants);
    const payload = {
      id: state.draftId,
      played_at: playedAt.toISOString(),
      winner,
      note: $("#matchNote").value.trim(),
      blue_team: snapshot.blueTeam,
      red_team: snapshot.redTeam,
      participants: snapshot.participants,
      ...(state.collectedMatch ? {
        duration_seconds: state.collectedMatch.durationSeconds,
      } : {}),
    };
    button.disabled = true;
    button.textContent = "提交中...";
    error.textContent = "";
    const { error: insertError } = await state.supabase.from("matches").insert(payload);
    if (insertError) throw insertError;
    confirmedMappings.forEach(({ playerId, accountName }) => saveBidirectionalMapping(playerId, accountName));
    state.submitted = true;
    $("#recordDialog").close();
    $("#recordBtn").disabled = true;
    $("#recordBtn").textContent = "本局已记录";
    $$(".reroll").forEach((item) => { item.disabled = true; });
    const cycleComplete = commitGlobalBpResults(snapshot);
    toast(cycleComplete ? "比赛已记录；全局 BP 完成 5 轮并已自动重置。" : "比赛已写入共享战绩。");
  } catch (caught) {
    const existing = state.draftId
      ? await state.supabase.from("matches").select("id").eq("id", state.draftId).maybeSingle()
      : { data: null };
    if (existing.data?.id) {
      confirmedMappings.forEach(({ playerId, accountName }) => saveBidirectionalMapping(playerId, accountName));
      state.submitted = true;
      $("#recordDialog").close();
      $("#recordBtn").disabled = true;
      $("#recordBtn").textContent = "本局已记录";
      const cycleComplete = commitGlobalBpResults(snapshot || matchSnapshot());
      toast(cycleComplete ? "比赛已记录；全局 BP 完成 5 轮并已自动重置。" : "比赛已成功记录。");
    } else {
      error.textContent = caught.message || "提交失败，请检查网络后重试。";
    }
  } finally {
    button.disabled = false;
    button.textContent = "确认提交";
  }
}

// ---- 手动录入历史对局 ----

function openManualMatchDialog() {
  $("#manualCollectorStatus").textContent = testModeEnabled()
    ? "正在生成模拟自定义对局…"
    : "点击按钮选择最近的自定义对局";
  $("#recentGamesList").classList.add("hidden");
  $("#recentGamesList").innerHTML = "";
  $("#manualMatchDialog").showModal();
  if (testModeEnabled()) showTestRecentGames();
}

async function fetchRecentGames() {
  const btn = $("#manualCollectBtn");
  const status = $("#manualCollectorStatus");
  const list = $("#recentGamesList");
  btn.disabled = true;
  if (testModeEnabled()) {
    try {
      status.textContent = "正在重新生成模拟对局…";
      showTestRecentGames();
    } finally {
      btn.disabled = false;
    }
    return;
  }
  status.textContent = "正在读取客户端…";
  try {
    if (!await collectorIsRunning()) {
      if (!await tryStartCollector()) {
        downloadCollectorInstaller();
        status.textContent = "未检测到 Go 本机代理，已下载安装器；安装后再次点击读取。";
        return;
      }
    }
    // 1. 获取最近对局列表
    const listData = await collectorRequest("/proxy/lcu/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=20", 8000);
    const games = listData?.games?.games || [];
    if (!games.length) {
      status.textContent = "没有找到对局记录。";
      return;
    }

    // 2. 过滤自定义对局，逐个拉详情
    const customGames = games.filter(g => g.gameType === "CUSTOM_GAME" || g.gameType === "PRACTICE_GAME");
    if (!customGames.length) {
      status.textContent = "没有找到自定义对局。";
      return;
    }

    status.textContent = `找到 ${customGames.length} 场自定义对局，正在拉取详情…`;
    const champMap = await loadChampionIdMap();
    const detailedGames = [];
    for (const g of customGames) {
      try {
        const detail = await collectorRequest(`/proxy/lcu/lol-match-history/v1/games/${g.gameId}`, 8000);
        const normalized = normalizeLcuGameDetail(detail, champMap);
        if (normalized && normalized.participants.length >= 5) {
          detailedGames.push(normalized);
        }
      } catch { /* skip failed details */ }
    }

    if (!detailedGames.length) {
      status.textContent = "对局详情获取失败。";
      return;
    }
    status.textContent = `找到 ${detailedGames.length} 场自定义对局，点击选择：`;
    renderRecentGames(detailedGames);
  } catch (caught) {
    status.textContent = `读取失败：${caught.message}`;
  } finally {
    btn.disabled = false;
  }
}

function handleManualCollectClick(event) {
  if (!testModeEnabled()) {
    fetchRecentGames();
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const button = $("#manualCollectBtn");
  button.disabled = true;
  try {
    $("#manualCollectorStatus").textContent = "正在重新生成模拟对局…";
    showTestRecentGames();
  } finally {
    button.disabled = false;
  }
}

// 加载冠军 ID→名称映射（缓存一次）
async function loadChampionIdMap() {
  if (championIdMap) return championIdMap;
  try {
    const data = await collectorRequest("/proxy/lcu/lol-game-data/assets/v1/champion-summary.json", 5000);
    const map = {};
    for (const c of (data || [])) {
      if (c.id > 0) map[c.id] = c.name || c.alias || "";
    }
    championIdMap = map;
    return map;
  } catch {
    return {};
  }
}

// 规范化 LCU 对局详情
function normalizeLcuGameDetail(raw, champMap = {}) {
  const game = raw?.game || raw;
  if (!game) return null;
  const identities = game.participantIdentities || [];
  const idMap = new Map();
  for (const id of identities) {
    const pid = id?.participantId;
    if (pid && id.player) idMap.set(pid, id.player);
  }
  const participants = (game.participants || []).map(p => {
    const player = idMap.get(p.participantId) || {};
    const stats = p.stats || {};
    const timeline = p.timeline || {};
    const clientPosition = normalizeClientPosition(
      p.teamPosition || p.individualPosition || p.position || p.selectedPosition
        || stats.teamPosition || stats.individualPosition || stats.position,
      p.lane || timeline.lane || stats.lane,
      p.role || timeline.role || stats.role,
    );
    const champName = p.championName || (p.champion && p.champion.name) || p.skinName || player.championName || champMap[p.championId] || "";
    return {
      team: (p.teamId === 100 || p.team === "ORDER" || p.team === "BLUE") ? "blue" : "red",
      position: clientPosition.key,
      accountName: player.summonerName || player.gameName ||
        (player.riotIdGameName && player.riotIdTagLine ? `${player.riotIdGameName}#${player.riotIdTagLine}` : "") ||
        player.riotId || "",
      championName: champName,
      championId: p.championId || (p.champion && p.champion.id) || 0,
      stats: stats,
      win: stats.win === true || stats.win === "Win" || p.win === true || p.win === "Win",
    };
  }).filter(p => p.accountName || p.championId);

  // 去重
  const seen = new Set();
  const unique = participants.filter(p => {
    const key = `${p.team}|${p.accountName}|${p.championId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 从 teams 推断胜方
  let winner = "";
  const teams = game.teams || [];
  for (const t of teams) {
    const won = t.win === "Win" || t.win === true || t.isWinningTeam === true;
    if (won) {
      winner = (t.teamId === 100 || t.team === "ORDER" || t.team === "BLUE") ? "blue" : "red";
      break;
    }
  }

  return {
    gameId: String(game.gameId || game.id || ""),
    playedAt: game.gameCreationDate || (game.gameCreation ? new Date(game.gameCreation).toISOString() : ""),
    durationSeconds: game.gameDuration || game.gameLength || 0,
    gameMode: game.gameMode || "",
    gameType: game.gameType || "",
    winner,
    participants: unique,
  };
}

function renderRecentGames(games) {
  const list = $("#recentGamesList");
  list.classList.remove("hidden");
  list.innerHTML = games.map((game, idx) => {
    const dur = game.durationSeconds ? `${Math.round(game.durationSeconds / 60)}分钟` : "时长未知";
    const blue = game.participants.filter(p => p.team === "blue");
    const red = game.participants.filter(p => p.team === "red");
    const names = (p) => escapeHtml(p.accountName || p.championName || "?");
    const countStr = `蓝${blue.length}人 红${red.length}人`;
    return `
      <button type="button" class="recent-game-item" data-game-idx="${idx}">
        <span class="rg-num">#${idx + 1}</span>
        <span class="rg-time">${game.playedAt ? new Date(game.playedAt).toLocaleString("zh-CN") : "时间未知"}</span>
        <span class="rg-dur">${dur} · ${countStr}</span>
        <span class="rg-teams">
          <span class="rg-blue">蓝: ${blue.map(names).join(", ") || "—"}</span>
          <span class="rg-red">红: ${red.map(names).join(", ") || "—"}</span>
        </span>
      </button>`;
  }).join("");
  $$(".recent-game-item").forEach((btn) => {
    btn.addEventListener("click", () => selectRecentGame(games[parseInt(btn.dataset.gameIdx)]));
  });
}

function selectRecentGame(game) {
  const participants = game.participants || [];
  const players = activePlayers();

  // 为每个客户端玩家创建一行（不足10行补空）
  const results = [];
  for (let i = 0; i < Math.max(participants.length, 10); i++) {
    const p = participants[i] || {};
    const team = p.team || (i < 5 ? "blue" : "red");
    const clientPosition = normalizeClientPosition(p.position, p.lane, p.role);
    const mappedPlayer = p.accountName ? findPlayerByAccount(p.accountName) : null;
    const testPlayer = game._testData && p.accountName
      ? playerByName(p.accountName.split("#")[0])
      : null;
    const matchedPlayer = mappedPlayer || testPlayer;

    results.push({
      player: {
        id: matchedPlayer?.id || `manual-${i}`,
        name: matchedPlayer?.displayName || "",
        cost: matchedPlayer?.defaultCost || 1,
      },
      team,
      position: clientPosition.key,
      positionLabel: clientPosition.label,
      champion: {
        slug: championSlug(p.championName || ""),
        name: p.championName || "",
        weight: 0,
        banRate: 0,
      },
      _clientPlayer: p.accountName || `玩家${i + 1}`,
      _clientChampion: p.championName || "",
      _clientKDA: p.stats ? `${p.stats.kills || 0}/${p.stats.deaths || 0}/${p.stats.assists || 0}` : "",

      _participantIdx: i,
    });
  }

  const collected = {
    source: game._testData ? "手动录入（测试数据）" : "手动录入（客户端采集）",
    collectedAt: new Date().toISOString(),
    gameId: game.gameId,
    playedAt: game.playedAt,
    durationSeconds: game.durationSeconds,
    gameMode: game.gameMode,
    winner: game.winner || "",
    participants: participants.map(p => ({
      team: p.team,
      position: p.position,
      accountName: p.accountName,
      championName: p.championName,
      championId: p.championId,
      stats: {
        kills: p.stats?.kills || 0,
        deaths: p.stats?.deaths || 0,
        assists: p.stats?.assists || 0,
        goldEarned: p.stats?.goldEarned || 0,
        visionScore: p.stats?.visionScore || 0,
        damageDealt: p.stats?.totalDamageDealtToChampions || 0,
        level: p.stats?.champLevel || 0,
      },
    })),
    _manualGameId: game.gameId,
    _testData: Boolean(game._testData),
  };

  // 预匹配
  const mp = new Map();
  participants.forEach((p, i) => {
    const matched = results.find(r => r._participantIdx === i);
    if (matched?.player.id && !matched.player.id.startsWith("manual-")) {
      mp.set(matched.player.id, i);
    }
  });

  state.results = results;
  state.collectedMatch = collected;
  state.matchedParticipants = mp;
  state.revealed = 10;
  state.submitted = false;
  state.draftId = crypto.randomUUID();

  $("#manualMatchDialog").close();
  if (game.playedAt) {
    const d = new Date(game.playedAt);
    if (!Number.isNaN(d.getTime())) $("#playedAt").value = localDateTimeValue(d);
  }
  if (game.winner) {
    const radio = $(`input[name="winner"][value="${game.winner}"]`);
    if (radio) radio.checked = true;
  }
  openRecordDialog();
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
  return match.winner === "blue" ? "蓝方胜" : "红方胜";
}

function matchCard(match, includeActions = true) {
  const hasDetail = Array.isArray(match.participants);
  const positionOrder = new Map(LANES.map(([position, positionLabel], index) => [position, index]).concat(LANES.map(([, positionLabel], index) => [positionLabel, index])));
  const sortLineup = (slots) => [...slots].sort((a, b) => {
    const aRank = positionOrder.get(a.position) ?? positionOrder.get(a.positionLabel) ?? positionOrder.get(a.lane) ?? positionOrder.get(a.laneLabel) ?? 99;
    const bRank = positionOrder.get(b.position) ?? positionOrder.get(b.positionLabel) ?? positionOrder.get(b.lane) ?? positionOrder.get(b.laneLabel) ?? 99;
    return aRank - bRank;
  });
  const blue = sortLineup((match.participants || []).filter((slot) => slot.team === "blue"));
  const red = sortLineup((match.participants || []).filter((slot) => slot.team === "red"));
  const mini = (slots) => slots.map((slot) => `<span>${escapeHtml(slot.playerName || slot.accountName || "?")} · ${escapeHtml(slot.champion?.name || "—")}</span>`).join("");
  const detailRow = (slot) => `
    <div class="match-side-row">
      <span class="match-lane">${positionIconMarkup(slot.position || slot.lane, "history-position-icon")}</span>
      <span class="match-player"><strong>${escapeHtml(slot.playerName || "?")}</strong></span>
      <span class="match-account" title="${escapeHtml(resolveAccountName(slot) || "")}">${escapeHtml(resolveAccountName(slot) || "—")}</span>
      <span class="match-champion">${escapeHtml(slot.champion?.name || "—")}</span>
      <span class="match-kda">${slot.stats?.kills ?? 0} / ${slot.stats?.deaths ?? 0} / ${slot.stats?.assists ?? 0}</span>
    </div>`;
  const detailTeam = (side, slots, teamName) => `
    <section class="match-side match-side-${side}">
      <div class="match-side-head">
        <strong>${escapeHtml(teamName)}</strong>
        <span class="${match.winner === side ? "win" : "loss"}">${match.winner === side ? "胜方" : "败方"}</span>
      </div>
      <div class="match-side-columns" aria-hidden="true">
        <span>位置</span><span>选手</span><span>游戏 ID</span><span>英雄</span><span>K / D / A</span>
      </div>
      <div class="match-side-lineup">${slots.map(detailRow).join("")}</div>
    </section>`;
  return `
    <article class="match-card">
      <div class="match-main match-toggle" data-match-id="${match.id}" title="点击查看详情">
        <div class="match-team ${match.winner === "blue" ? "winner" : ""}">
          <strong>${escapeHtml(match.blueTeam || "蓝方")}</strong>
          ${hasDetail ? `<div class="lineup-mini">${mini(blue)}</div>` : ""}
        </div>
        <div class="versus"><div class="score">${scoreLabel(match)}</div><small>${formatDate(match.playedAt)}</small></div>
        <div class="match-team red ${match.winner === "red" ? "winner" : ""}">
          <strong>${escapeHtml(match.redTeam || "红方")}</strong>
          ${hasDetail ? `<div class="lineup-mini">${mini(red)}</div>` : ""}
        </div>
      </div>
      <div class="match-detail hidden" data-match-id="${match.id}">
        ${hasDetail ? `
        <div class="match-comparison">
          ${detailTeam("blue", blue, match.blueTeam || "蓝方")}
          ${detailTeam("red", red, match.redTeam || "红方")}
        </div>` : `<div class="loading-detail">点击加载详情…</div>`}
        <div class="match-meta">
          ${match.durationSeconds ? `<span>时长：${Math.round(match.durationSeconds / 60)}分钟</span>` : ""}
          ${match.note ? `<span class="note">${escapeHtml(match.note)}</span>` : ""}
          ${includeActions && isAdmin() ? `<span class="match-actions"><button class="mini" data-edit-match="${match.id}">修正</button><button class="mini danger" data-delete-match="${match.id}">删除</button></span>` : ""}
        </div>
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
      <td>${escapeHtml(player.favoritePosition)} / ${escapeHtml(player.favoriteChampion)}</td>
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
  const positionFilter = $("#heroLane").value;
  const search = $("#heroSearch").value.trim();
  const positionNames = new Map(LANES.map(([key, name]) => [key, name]));
  const grouped = new Map();
  for (const [position, heroes] of Object.entries(state.pools)) {
    if (positionFilter !== "all" && positionFilter !== position) continue;
    for (const hero of heroes) {
      let row = grouped.get(hero.slug);
      if (!row) {
        row = {
          name: hero.name,
          championName: hero.championName || "",
          slug: hero.slug,
          image: hero.image || "",
          weight: 0,
          weightedWinRate: 0,
          winRate: 0,
          banRate: 0,
          positions: [],
        };
        grouped.set(hero.slug, row);
      }
      row.name = hero.name || row.name;
      row.championName = hero.championName || row.championName;
      row.image = hero.image || row.image;
      row.weight += Number(hero.weight);
      row.weightedWinRate += Number(hero.winRate) * Number(hero.weight);
      row.banRate = Math.max(row.banRate, Number(hero.banRate));
      row.positions.push({
        key: position,
        label: positionNames.get(position) || position,
        weight: Number(hero.weight),
        winRate: Number(hero.winRate),
      });
    }
  }
  const rows = [...grouped.values()]
    .map((hero) => ({
      ...hero,
      winRate: hero.weight ? hero.weightedWinRate / hero.weight : 0,
    }))
    .filter((hero) => !search || fuzzySearch(`${hero.name} ${hero.championName} ${hero.slug}`, search))
    .sort((a, b) => {
      const difference = Number(a[state.heroStatsSortKey]) - Number(b[state.heroStatsSortKey]);
      const ordered = state.heroStatsSortDirection === "asc" ? difference : -difference;
      return ordered || a.name.localeCompare(b.name, "zh-CN");
    });
  $("#heroStatsBody").innerHTML = rows.map((hero) => `
    <tr>
      <td>
        <div class="hero-stats-identity">
          <img class="hero-stats-avatar" src="${escapeHtml(portrait(hero))}" alt="${escapeHtml(hero.championName || hero.name)}">
          <span class="hero-stats-names">
            <strong class="hero-stats-title">${escapeHtml(hero.name)}</strong>
            ${hero.championName && hero.championName !== hero.name ? `<small class="hero-stats-name">${escapeHtml(hero.championName)}</small>` : ""}
          </span>
        </div>
      </td>
      <td><div class="hero-position-list">${hero.positions.map((position) => `<span class="hero-position-chip hero-position-${escapeHtml(position.key)}"><strong>${escapeHtml(position.label)}</strong><small>${formatNumber(position.weight, 2)}%</small></span>`).join("")}</div></td>
      <td class="num hero-rate">${formatNumber(hero.weight, 2)}%</td>
      <td class="num hero-rate hero-win-rate">${formatNumber(hero.winRate, 2)}%</td>
      <td class="num hero-rate">${formatNumber(hero.banRate, 2)}%</td>
    </tr>`).join("");
  $$("#heroStatsBody .hero-stats-avatar").forEach((image, index) => {
    image.addEventListener("error", () => { image.src = avatar(rows[index]); }, { once: true });
  });
  $$('[data-hero-sort]').forEach((button) => {
    const active = button.dataset.heroSort === state.heroStatsSortKey;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.querySelector("span").textContent = active
      ? state.heroStatsSortDirection === "asc" ? "↑" : "↓"
      : "↕";
    button.closest("th").setAttribute("aria-sort", active
      ? state.heroStatsSortDirection === "asc" ? "ascending" : "descending"
      : "none");
  });
  $$('[data-hero-lane]').forEach((button) => {
    const active = button.dataset.heroLane === positionFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function changeHeroStatsSort(key) {
  if (!['weight', 'winRate', 'banRate'].includes(key)) return;
  if (state.heroStatsSortKey === key) {
    state.heroStatsSortDirection = state.heroStatsSortDirection === "desc" ? "asc" : "desc";
  } else {
    state.heroStatsSortKey = key;
    state.heroStatsSortDirection = "desc";
  }
  renderHeroStats();
}

function changeHeroLane(position) {
  if (!['all', 'top', 'jungle', 'middle', 'bottom', 'support'].includes(position)) return;
  $("#heroLane").value = position;
  renderHeroStats();
}

function renderAdmin() {
  if (!state.member) return;
  const admin = isAdmin();
  if (!admin) {
    state.testDataEnabled = false;
    state.adminSelectedPlayers.clear();
    state.adminSelectedMatches.clear();
  }
  state.adminSelectedPlayers = new Set(
    [...state.adminSelectedPlayers].filter((id) => state.players.some((player) => player.id === id)),
  );
  state.adminSelectedMatches = new Set(
    [...state.adminSelectedMatches].filter((id) => state.matches.some((match) => match.id === id)),
  );
  $$(".admin-only").forEach((element) => element.classList.toggle("hidden", !admin));
  renderTestDataMode();
  $("#playerForm").classList.toggle("hidden", !admin);
  const playerQuery = ($("#adminPlayerSearch")?.value || "").trim();
  const players = playerQuery
    ? state.players.filter(p => fuzzySearch(p.displayName, playerQuery))
    : state.players;
  $("#adminPlayerList").innerHTML = players.length ? players.map((player) => `
    <div class="admin-row ${state.adminSelectedPlayers.has(player.id) ? "selected" : ""}">
      ${admin ? `<label class="admin-row-select" title="选择 ${escapeHtml(player.displayName)}"><input type="checkbox" data-select-player="${player.id}" ${state.adminSelectedPlayers.has(player.id) ? "checked" : ""} aria-label="选择 ${escapeHtml(player.displayName)}"></label>` : ""}
      <div class="grow"><strong>${escapeHtml(player.displayName)}</strong><small>默认费用 ${formatNumber(player.defaultCost)} · ${player.active ? "启用" : "已停用"}</small></div>
      ${admin ? `<button class="mini" data-edit-player="${player.id}">编辑</button><button class="mini ${player.active ? "danger" : ""}" data-toggle-player="${player.id}">${player.active ? "停用" : "启用"}</button>` : ""}
    </div>`).join("") : `<div class="empty">没有匹配的选手。</div>`;
  syncAdminBatchToolbar(
    "Player",
    players.map((player) => player.id),
    state.adminSelectedPlayers,
    "人",
  );
  $("#adminMatchSection").classList.toggle("hidden", !admin);
  if (!admin) return;
  const filteredMatches = filterMatchesByRange(
    state.matches,
    $("#adminMatchRange")?.value || "all",
    $("#adminMatchFrom")?.value || "",
    $("#adminMatchTo")?.value || "",
  );
  $("#adminMatchList").innerHTML = filteredMatches.length
    ? filteredMatches.map((match) => `<div class="admin-row ${state.adminSelectedMatches.has(match.id) ? "selected" : ""}"><label class="admin-row-select" title="选择该场对局"><input type="checkbox" data-select-match="${match.id}" ${state.adminSelectedMatches.has(match.id) ? "checked" : ""} aria-label="选择 ${escapeHtml(match.blueTeam)} 对 ${escapeHtml(match.redTeam)}"></label><div class="grow"><strong>${escapeHtml(match.blueTeam)} vs ${escapeHtml(match.redTeam)}</strong><small>${formatDate(match.playedAt)} · ${scoreLabel(match)}</small></div><button class="mini" data-edit-match="${match.id}">修正</button><button class="mini danger" data-delete-match="${match.id}">删除</button></div>`).join("")
    : `<div class="empty">当前时间范围没有正式比赛。</div>`;
  syncAdminBatchToolbar(
    "Match",
    filteredMatches.map((match) => match.id),
    state.adminSelectedMatches,
    "场",
  );
}

function syncAdminBatchToolbar(kind, visibleIds, selection, unit) {
  const selectAll = $(`#admin${kind}SelectAll`);
  const count = $(`#admin${kind}SelectionCount`);
  if (!selectAll || !count) return;
  const selectedVisible = visibleIds.filter((id) => selection.has(id)).length;
  selectAll.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
  selectAll.disabled = state.adminBatchBusy || visibleIds.length === 0;
  count.textContent = `已选 ${selection.size} ${unit}`;
  const toolbar = selectAll.closest(".admin-batch-toolbar");
  toolbar.querySelectorAll("button").forEach((button) => {
    button.disabled = state.adminBatchBusy || selection.size === 0;
  });
}

function selectVisibleAdminRows(kind, checked) {
  const isPlayer = kind === "player";
  const list = isPlayer ? $("#adminPlayerList") : $("#adminMatchList");
  const selector = isPlayer ? "[data-select-player]" : "[data-select-match]";
  const selection = isPlayer ? state.adminSelectedPlayers : state.adminSelectedMatches;
  for (const input of list.querySelectorAll(selector)) {
    const id = isPlayer ? input.dataset.selectPlayer : input.dataset.selectMatch;
    if (checked) selection.add(id);
    else selection.delete(id);
  }
  renderAdmin();
}

async function batchUpdatePlayers(changes, actionLabel) {
  if (!isAdmin() || state.adminBatchBusy) return;
  const ids = [...state.adminSelectedPlayers].filter((id) => state.players.some((player) => player.id === id));
  if (!ids.length) return toast("请先选择选手。");
  state.adminBatchBusy = true;
  renderAdmin();
  try {
    const { error } = await state.supabase.from("players").update(changes).in("id", ids);
    if (error) throw error;
    await refreshPlayers();
    state.adminSelectedPlayers.clear();
    toast(`${ids.length} 名选手已${actionLabel}。`);
  } catch (error) {
    toast(`批量处理失败：${error.message}`);
  } finally {
    state.adminBatchBusy = false;
    renderAdmin();
  }
}

function batchSetPlayerCost() {
  const ids = [...state.adminSelectedPlayers];
  if (!ids.length) return toast("请先选择选手。");
  const input = prompt(`为选中的 ${ids.length} 名选手设置统一默认费用`, "1");
  if (input === null) return;
  const defaultCost = Number(input);
  if (!Number.isFinite(defaultCost) || defaultCost < 0) return toast("请输入不小于 0 的有效费用。");
  batchUpdatePlayers({ default_cost: defaultCost }, `把默认费用设置为 ${formatNumber(defaultCost)}`);
}

async function batchDeleteMatches() {
  if (!isAdmin() || state.adminBatchBusy) return;
  const ids = [...state.adminSelectedMatches].filter((id) => state.matches.some((match) => match.id === id));
  if (!ids.length) return toast("请先选择对局。");
  if (!confirm(`确定批量删除选中的 ${ids.length} 场正式对局吗？排行榜会随之重算，此操作无法撤销。`)) return;
  state.adminBatchBusy = true;
  renderAdmin();
  try {
    const { error } = await state.supabase.from("matches").delete().in("id", ids);
    if (error) throw error;
    await Promise.all([refreshMatches(), loadPlayerStats()]);
    state.adminSelectedMatches.clear();
    toast(`已删除 ${ids.length} 场正式对局，战绩正在重新计算。`);
  } catch (error) {
    toast(`批量删除失败：${error.message}`);
  } finally {
    state.adminBatchBusy = false;
    renderAdmin();
  }
}

async function reconcilePlayerStats() {
  if (!isAdmin()) return toast("只有管理员可以校对战绩数据。");
  const button = $("#adminReconcileBtn");
  const status = $("#adminReconcileStatus");
  const before = comparePlayerStats(state.matches, state.playerStats);
  button.disabled = true;
  button.textContent = "校对中…";
  status.className = "admin-reconcile-status";
  status.textContent = `正在复核 ${state.matches.length} 场正式对局；借号按实际参赛选手归属，不按 Riot 账号归属。`;

  try {
    let { data, error } = await state.supabase.rpc("admin_reconcile_player_stats");
    let compatibilityMode = false;
    if (error && (error.code === "PGRST202" || /admin_reconcile_player_stats/i.test(error.message || ""))) {
      const fallback = await state.supabase.rpc("recalc_player_stats");
      data = fallback.data;
      error = fallback.error;
      compatibilityMode = !error;
    }
    if (error) throw error;
    await Promise.all([refreshMatches(), loadPlayerStats()]);
    const after = comparePlayerStats(state.matches, state.playerStats);
    const result = data || {};
    const corrected = before.discrepancies.length;
    const invalid = Number(result.invalid_participants) || 0;
    const duplicates = Number(result.duplicate_assignments) || 0;
    const borrowed = Number(result.borrowed_accounts) || 0;
    const hasWarnings = invalid > 0 || duplicates > 0 || after.discrepancies.length > 0;
    const summary = [
      `已复核 ${Number(result.match_count) || state.matches.length} 场对局`,
      `${Number(result.player_count) || after.expected.size} 名实际选手`,
      corrected ? `修正 ${corrected} 名选手的汇总` : "汇总无需修正",
      compatibilityMode
        ? "借号仍按实际选手归属；更新数据库脚本后可显示借号明细"
        : borrowed
          ? `识别 ${borrowed} 个借号账号（已分别归属实际选手）`
          : "未发现借号账号",
    ];
    if (invalid) summary.push(`${invalid} 条参赛记录缺少有效选手 ID`);
    if (duplicates) summary.push(`${duplicates} 处同局选手重复`);
    if (after.discrepancies.length) summary.push(`${after.discrepancies.length} 名选手复核后仍不一致`);
    status.classList.toggle("warning", hasWarnings);
    status.textContent = `${summary.join("；")}。`;
    renderAllSharedData();
    toast(hasWarnings ? "数据校对完成，但仍有记录需要人工检查。" : "战绩数据校对完成。");
  } catch (error) {
    status.classList.add("warning");
    status.textContent = `校对失败：${error.message}。若数据库尚未更新，请先执行最新版 supabase/schema.sql。`;
    toast("战绩数据校对失败。");
  } finally {
    button.disabled = false;
    button.textContent = "数据校对";
  }
}

async function addPlayer(event) {
  event.preventDefault();
  if (!isAdmin()) return toast("只有管理员可以维护选手库。");
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
  if (!match || !confirm(`确定删除 ${match.blueTeam} vs ${match.redTeam} 的记录吗？此操作无法撤销。`)) return;
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

function normalizeStoredParticipantPosition(participant) {
  const storedPosition = participant?.position || participant?.lane || "";
  const normalized = normalizeClientPosition(storedPosition);
  const result = {
    ...participant,
    position: normalized.key || storedPosition,
    positionLabel: participant?.positionLabel || participant?.laneLabel || normalized.label,
  };
  delete result.lane;
  delete result.laneLabel;
  return result;
}

function mapMatch(row) {
  return {
    id: row.id,
    playedAt: row.played_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    winner: row.winner,
    durationSeconds: row.duration_seconds,
    note: row.note,
    blueTeam: row.blue_team,
    redTeam: row.red_team,
    participants: Array.isArray(row.participants)
      ? row.participants.map(normalizeStoredParticipantPosition)
      : row.participants,
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
  syncRosterCostsFromLibrary();
  if ($("#playerLibraryDialog").open) renderPlayerLibrary();
  if ($("#localMappingsDialog").open) renderLocalMappings();
  renderAllSharedData();
}

async function refreshMatches() {
  const { data, error } = await state.supabase
    .from("matches")
    .select("id,played_at,created_at,winner,duration_seconds,note,blue_team,red_team,participants")
    .order("played_at", { ascending: false });
  if (error) {
    toast(`对局读取失败：${error.message}`);
    return;
  }
  state.matches = (data || []).map(mapMatch);
  renderAllSharedData();
}

// 按需加载某场对局的 participants 详情
async function fetchMatchDetail(matchId) {
  const { data, error } = await state.supabase
    .from("matches")
    .select("participants")
    .eq("id", matchId)
    .single();
  if (error || !data) return null;
  return resolveParticipantAccounts(
    Array.isArray(data.participants)
      ? data.participants.map(normalizeStoredParticipantPosition)
      : data.participants,
  );
}

// loadPlayerStats 加载选手战绩汇总
async function loadPlayerStats() {
  const { data, error } = await state.supabase
    .from("player_stats")
    .select("player_id, games, wins, losses, kills, deaths, assists");
  if (error) return;
  state.playerStats = new Map((data || []).map(s => [s.player_id, s]));
}

// ---- riot_accounts 归一化 ----

// loadRiotAccounts 加载全部 riot 账号到本地缓存
async function loadRiotAccounts() {
  const { data, error } = await state.supabase
    .from("riot_accounts")
    .select("id, account_name");
  if (error) return;
  state.riotAccounts = new Map((data || []).map((a) => [a.id, a.account_name]));
}

// ensureRiotAccounts 只插入缺失的 riot_accounts，绝不更新既有记录
async function ensureRiotAccounts(participants) {
  const accountMap = new Map();
  for (const participant of participants) {
    if (!participant.accountName) continue;
    const normalizedName = normalizeName(participant.accountName);
    if (normalizedName && !accountMap.has(normalizedName)) {
      accountMap.set(normalizedName, {
        account_name: participant.accountName,
        normalized_name: normalizedName,
      });
    }
  }
  const accounts = [...accountMap.values()];
  if (!accounts.length) return;

  const normalizedNames = accounts.map((account) => account.normalized_name);
  const { data: existing, error: readError } = await state.supabase
    .from("riot_accounts")
    .select("id, account_name, normalized_name")
    .in("normalized_name", normalizedNames);
  if (readError) return;

  const existingNames = new Set((existing || []).map((row) => row.normalized_name));
  const missing = accounts.filter((account) => !existingNames.has(account.normalized_name));
  let inserted = [];
  if (missing.length) {
    const { data, error } = await state.supabase
      .from("riot_accounts")
      .insert(missing)
      .select("id, account_name, normalized_name");
    if (error) {
      // 并发提交可能已经插入同名账号；重新读取即可，绝不更新已落库记录。
      const retry = await state.supabase
        .from("riot_accounts")
        .select("id, account_name, normalized_name")
        .in("normalized_name", normalizedNames);
      if (retry.error) return;
      inserted = retry.data || [];
    } else {
      inserted = data || [];
    }
  }

  const rows = [...(existing || []), ...inserted];
  const nameMap = new Map(rows.map(r => [r.normalized_name, r.id]));
  for (const row of rows) {
    state.riotAccounts.set(row.id, row.account_name);
  }
  for (const p of participants) {
    if (!p.accountName) continue;
    const id = nameMap.get(normalizeName(p.accountName));
    if (id) {
      p.riotAccountId = id;
      delete p.accountName;
    }
  }
}

/*
 * 公共账号的共享数据写入路径必须保持 insert-only：
 * - matches 使用 insert 创建正式对局；
 * - riot_accounts 只插入尚不存在的账号；
 * - 已落库内容的 update/delete 只存在于管理员操作中。
 */

// resolveParticipantAccounts 将 participants 中的 riotAccountId 解析为 accountName（用于展示）
function resolveParticipantAccounts(participants) {
  if (!Array.isArray(participants)) return participants;
  for (const p of participants) {
    if (!p.accountName && p.riotAccountId) {
      p.accountName = state.riotAccounts.get(p.riotAccountId) || "";
    }
  }
  return participants;
}

// resolveAccountName 单个 participant 的 accountName 解析
function resolveAccountName(p) {
  if (p.accountName) return p.accountName;
  if (p.riotAccountId) return state.riotAccounts.get(p.riotAccountId) || "";
  return "";
}

function startSharedListeners() {
  clearSubscriptions();
  refreshPlayers();
  refreshMatches();
  loadRiotAccounts();
  loadPlayerStats();
  state.realtimeChannel = state.supabase
    .channel("lgg-shared-data")
    .on("postgres_changes", { event: "*", schema: "public", table: "players" }, refreshPlayers)
    .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, refreshMatches)
    .on("postgres_changes", { event: "*", schema: "public", table: "riot_accounts" }, loadRiotAccounts)
    .on("postgres_changes", { event: "*", schema: "public", table: "player_stats" }, loadPlayerStats)
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") toast("实时同步连接失败，刷新页面后会重新连接。");
    });
}

function showAuthenticatedApp() {
  $("#authGate").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#accountLabel").textContent = `${state.member.displayName || state.member.role} · ${state.member.role === "admin" ? "管理员" : "公共账号"}`;
  $$(".member-only").forEach((element) => element.classList.toggle("hidden", !state.member));
  startSharedListeners();
  loadPools();
}

async function handleAuthUser(user) {
  if (!user) {
    clearSubscriptions();
    state.user = null;
    state.member = null;
    state.testDataEnabled = false;
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
    // 仅清除本地会话，不发起网络请求（避免 403）
    await state.supabase.auth.signOut({ scope: "local" }).catch(() => {});
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
  } catch (caught) {
    error.textContent = caught?.message || caught?.error_description || "账号或密码不正确。";
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

  const currentView = document.querySelector(".view:not(.hidden)");
  const nextView = document.getElementById(viewId);
  if (!nextView || nextView === currentView) return;

  // 防止快速切换导致动画堆积
  if (switchView._busy) return;
  switchView._busy = true;

  // 尊重系统"减少动效"偏好
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reducedMotion ? 0 : 160;

  // 淡出当前视图
  if (currentView) {
    if (duration > 0) {
      currentView.style.transition = `opacity ${duration}ms ease, transform ${duration}ms ease`;
      currentView.style.opacity = "0";
      currentView.style.transform = "translateY(6px)";
    }
    const el = currentView;
    setTimeout(() => {
      el.classList.add("hidden");
      el.style.opacity = "";
      el.style.transform = "";
      el.style.transition = "";
    }, duration);
  }

  // 淡入新视图
  nextView.style.opacity = "0";
  if (duration > 0) nextView.style.transform = "translateY(6px)";
  nextView.classList.remove("hidden");
  if (duration > 0) {
    void nextView.offsetHeight;
    nextView.style.transition = `opacity ${duration}ms ease, transform ${duration}ms ease`;
  }
  nextView.style.opacity = "1";
  nextView.style.transform = "translateY(0)";
  setTimeout(() => {
    nextView.style.opacity = "";
    nextView.style.transform = "";
    nextView.style.transition = "";
    switchView._busy = false;
  }, duration);

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
  if (prefix === "history") renderHistory();
  else if (prefix === "adminMatch") renderAdmin();
  else renderLeaderboard();
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", login);
  $("#logoutBtn").addEventListener("click", async () => {
    const { error } = await state.supabase.auth.signOut();
    if (error) {
      // 远程登出失败（token 过期等），本地强制清除
      await state.supabase.auth.signOut({ scope: "local" }).catch(() => {});
      toast("已退出（离线模式）。");
    }
    clearSubscriptions();
    state.user = null;
    state.member = null;
    state.testDataEnabled = false;
    $("#app").classList.add("hidden");
    $("#authGate").classList.remove("hidden");
  });
  $$(".nav-btn").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#rollBtn").addEventListener("click", roll);
  $("#testFillBtn").addEventListener("click", fillTestPlayers);
  $("#adminReconcileBtn").addEventListener("click", reconcilePlayerStats);
  $("#adminPlayerSelectAll").addEventListener("change", (event) => selectVisibleAdminRows("player", event.target.checked));
  $("#adminMatchSelectAll").addEventListener("change", (event) => selectVisibleAdminRows("match", event.target.checked));
  $("#batchEnablePlayersBtn").addEventListener("click", () => batchUpdatePlayers({ active: true }, "启用"));
  $("#batchDisablePlayersBtn").addEventListener("click", () => batchUpdatePlayers({ active: false }, "停用"));
  $("#batchPlayerCostBtn").addEventListener("click", batchSetPlayerCost);
  $("#batchDeleteMatchesBtn").addEventListener("click", batchDeleteMatches);
  $("#clearPlayerSelectionBtn").addEventListener("click", () => {
    state.adminSelectedPlayers.clear();
    renderAdmin();
  });
  $("#clearMatchSelectionBtn").addEventListener("click", () => {
    state.adminSelectedMatches.clear();
    renderAdmin();
  });
  $("#testDataModeBtn").addEventListener("click", toggleTestDataMode);
  $("#clearGlobalBpBtn").addEventListener("click", clearGlobalBp);
  $("#globalBpDetailsBtn").addEventListener("click", openGlobalBpDetails);
  $("#revealBtn").addEventListener("click", revealAll);
  $("#backBtn").addEventListener("click", backToSetup);
  $("#againBtn").addEventListener("click", roll);
  $("#recordBtn").addEventListener("click", openRecordDialog);
  $("#collectMatchBtn").addEventListener("click", handleCollectMatchClick);
  $("#resetBtn").addEventListener("click", resetSetup);
  $("#recordForm").addEventListener("submit", submitMatch);
  $("#editMatchForm").addEventListener("submit", saveMatchEdit);
  $("#manualMatchBtn").addEventListener("click", openManualMatchDialog);
  $("#manualCollectBtn").addEventListener("click", handleManualCollectClick);
  $("#localMappingsBtn").addEventListener("click", openLocalMappings);
  $("#localMappingForm").addEventListener("submit", saveLocalMapping);
  $("#localMappingsList").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-local-mapping]");
    const remove = event.target.closest("[data-delete-local-mapping]");
    if (edit) {
      const playerId = edit.dataset.editLocalMapping;
      $("#localMappingPlayer").value = playerId;
      $("#localMappingGameId").value = findAccountByPlayer(playerId);
      $("#localMappingGameId").focus();
      return;
    }
    if (remove) {
      const playerId = remove.dataset.deleteLocalMapping;
      const playerName = playerById(playerId)?.displayName || "该玩家";
      removeBidirectionalMapping(playerId);
      renderLocalMappings();
      toast(`已删除 ${playerName} 的本地游戏 ID 映射。`);
    }
  });
  $("#playerLibrarySearch").addEventListener("input", renderPlayerLibrary);
  $("#clearPlayerCardBtn").addEventListener("click", clearPlayerCard);
  $("#playerLibraryCards").addEventListener("click", (event) => {
    const card = event.target.closest("[data-library-player]");
    if (card && !card.disabled) choosePlayerFromLibrary(card.dataset.libraryPlayer);
  });
  $("#playerLibraryDialog").addEventListener("close", () => {
    state.playerPickerInput = null;
  });
  $$("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  $("#playerForm").addEventListener("submit", addPlayer);
  $("#results").addEventListener("click", (event) => {
    const button = event.target.closest("[data-reroll]");
    if (button) rerollHero(Number(button.dataset.reroll));
  });
  document.addEventListener("click", (event) => {
    const costControl = event.target.closest("[data-temp-cost-step], [data-temp-cost-reset]");
    if (costControl) {
      event.preventDefault();
      event.stopPropagation();
      changeTemporaryRosterCost(costControl);
      return;
    }
    const collectedPlayerTrigger = event.target.closest("[data-open-collected-player-library]");
    if (collectedPlayerTrigger) {
      openPlayerLibrary(collectedPlayerTrigger.closest("tr"));
      return;
    }
    const trigger = event.target.closest("[data-open-player-library]");
    if (trigger && !$("#setupSection").classList.contains("roll-active")) openPlayerLibrary(trigger.closest(".player-row"));
  });
  document.addEventListener("input", (event) => {
    if (event.target.matches(".player-name")) {
      syncPlayerInput(event.target);
      renderPlayerSuggestions(event.target);
    }
    if (event.target.matches(".cost-input,.team-name") || event.target.closest(".draw-option")) {
      updateCostTotals();
      saveLocalSetup();
      renderDrawOptionsStatus();
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
    const input = option.closest(".player-search")?.querySelector(".player-name")
      || option.parentElement?.querySelector(".player-name");
    if (!input) return;
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
    $(container).addEventListener("click", async (event) => {
      const edit = event.target.closest("[data-edit-match]");
      const remove = event.target.closest("[data-delete-match]");
      const toggleBtn = event.target.closest(".match-toggle");
      if (edit) { openEditMatch(edit.dataset.editMatch); return; }
      if (remove) { deleteMatch(remove.dataset.deleteMatch); return; }
      if (toggleBtn) {
        const card = toggleBtn.parentElement;
        const detail = card.querySelector(`.match-detail[data-match-id="${toggleBtn.dataset.matchId}"]`);
        if (!detail) return;
        const hidden = detail.classList.toggle("hidden");
        // 首次展开时懒加载详情
        if (!hidden && !toggleBtn.dataset.loaded) {
          const loadingEl = detail.querySelector(".loading-detail");
          if (loadingEl) loadingEl.textContent = "加载中…";
          const participants = await fetchMatchDetail(toggleBtn.dataset.matchId);
          if (participants) {
            // 更新缓存
            const match = state.matches.find(m => m.id === toggleBtn.dataset.matchId);
            if (match) match.participants = participants;
            // 重新渲染该卡片（但保留展开状态）
            renderAllSharedData();
            // 重新找到新渲染的卡片并展开
            const newCard = document.querySelector(`.match-toggle[data-match-id="${toggleBtn.dataset.matchId}"]`);
            if (newCard) {
              newCard.dataset.loaded = "1";
              const newDetail = newCard.parentElement.querySelector(`.match-detail[data-match-id="${toggleBtn.dataset.matchId}"]`);
              if (newDetail) newDetail.classList.remove("hidden");
            }
            return;
          }
          toggleBtn.dataset.loaded = "1";
        }
      }
    });
  }
  $("#adminPlayerList").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-player]");
    const toggle = event.target.closest("[data-toggle-player]");
    if (edit) editPlayer(edit.dataset.editPlayer);
    if (toggle) togglePlayer(toggle.dataset.togglePlayer);
  });
  $("#adminPlayerList").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-select-player]");
    if (!checkbox) return;
    if (checkbox.checked) state.adminSelectedPlayers.add(checkbox.dataset.selectPlayer);
    else state.adminSelectedPlayers.delete(checkbox.dataset.selectPlayer);
    renderAdmin();
  });
  $("#adminMatchList").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-select-match]");
    if (!checkbox) return;
    if (checkbox.checked) state.adminSelectedMatches.add(checkbox.dataset.selectMatch);
    else state.adminSelectedMatches.delete(checkbox.dataset.selectMatch);
    renderAdmin();
  });
  $("#historyPrev").addEventListener("click", () => { state.historyPage -= 1; renderHistory(); });
  $("#historyNext").addEventListener("click", () => { state.historyPage += 1; renderHistory(); });
  $("#historyRange").addEventListener("change", () => toggleCustomRange("history"));
  $("#rankRange").addEventListener("change", () => toggleCustomRange("rank"));
  for (const id of ["historyFrom", "historyTo"]) $(`#${id}`).addEventListener("change", renderHistory);
  for (const id of ["rankFrom", "rankTo", "rankSearch", "minGames"]) $(`#${id}`).addEventListener("input", renderLeaderboard);
  // 管理页搜索和筛选
  $("#adminPlayerSearch")?.addEventListener("input", renderAdmin);
  $("#adminMatchRange")?.addEventListener("change", () => toggleCustomRange("adminMatch"));
  $("#adminMatchFrom")?.addEventListener("change", renderAdmin);
  $("#adminMatchTo")?.addEventListener("change", renderAdmin);
  $("#heroStatsBtn").addEventListener("click", () => { renderHeroStats(); $("#heroStatsDialog").showModal(); });
  $("#heroStatsClose").addEventListener("click", () => $("#heroStatsDialog").close());
  $("#heroSearch").addEventListener("input", renderHeroStats);
  $$('[data-hero-lane]').forEach((button) => {
    button.addEventListener("click", () => changeHeroLane(button.dataset.heroLane));
  });
  $$('[data-hero-sort]').forEach((button) => {
    button.addEventListener("click", () => changeHeroStatsSort(button.dataset.heroSort));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return;
    if ($("#setupSection").classList.contains("roll-active") && (event.code === "Space" || event.code === "Enter") && !event.target.closest("button,input,select,textarea,dialog")) {
      event.preventDefault();
      revealAll();
    }
  });
}

makePlayerInputs("blue");
makePlayerInputs("red");
loadGlobalBpState();
updateCostTotals();
renderDrawOptionsStatus();
bindEvents();
initializeSupabase();
