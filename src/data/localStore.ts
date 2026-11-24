export type Row = Record<string, unknown>;
export type TableName = "players" | "matches" | "riot_accounts";
export interface LocalBackup {
  format: "lgg-backup";
  version: 1;
  exportedAt: string;
  tables: Record<TableName, Row[]> & Record<string, unknown>;
}
export const LOCAL_DATA_KEY = "lgg.local-data.v1";
export const LOCAL_DATA_EVENT = "lgg-local-data-changed";
const tableNames: TableName[] = ["players", "matches", "riot_accounts"];

export function emptyBackup(): LocalBackup {
  return { format: "lgg-backup", version: 1, exportedAt: new Date().toISOString(),
    tables: { players: [], matches: [], riot_accounts: [] } };
}

export function validateBackup(value: unknown): LocalBackup {
  // Supabase SQL Editor exports result rows; unwrap its single backup column.
  if (Array.isArray(value) && value.length === 1 && value[0]?.backup) value = value[0].backup;
  if (typeof value === "string") value = JSON.parse(value);
  if (!value || typeof value !== "object") throw new Error("无效的数据备份文件。");
  const backup = value as LocalBackup;
  if (backup.format !== "lgg-backup" || backup.version !== 1 || !backup.tables) {
    throw new Error("请选择 LGG JSON 备份文件（版本 1）。");
  }
  for (const name of tableNames) {
    const rows = backup.tables[name];
    if (!Array.isArray(rows)) throw new Error(`备份缺少 ${name} 表。`);
    const ids = new Set();
    for (const row of rows) {
      if (!row || typeof row !== "object" || typeof row.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(row.id) || ids.has(row.id)) {
        throw new Error(`${name} 包含无效或重复 ID。`);
      }
      ids.add(row.id);
      if (name === "players" && (typeof row.display_name !== "string" || !row.display_name.trim() ||
          row.display_name.length > 24 || typeof row.normalized_name !== "string" ||
          typeof row.active !== "boolean" || !Number.isFinite(Number(row.default_cost)) || Number(row.default_cost) < 0)) {
        throw new Error("选手资料或费用无效。");
      }
      if (name === "riot_accounts" && (typeof row.account_name !== "string" || typeof row.normalized_name !== "string")) {
        throw new Error("游戏账号资料无效。");
      }
      if (name === "matches") {
        if (!["blue", "red"].includes(String(row.winner)) || !Number.isFinite(Date.parse(String(row.played_at))) ||
            !Array.isArray(row.participants)) throw new Error("对局时间、胜方或参赛者数据无效。");
        for (const p of row.participants) {
          if (!p || typeof p !== "object" || !["blue", "red"].includes(p.team) ||
              !p.champion || typeof p.champion.slug !== "string" || typeof p.champion.name !== "string") {
            throw new Error("对局参赛者或英雄资料无效。");
          }
        }
      }
    }
    if (name !== "matches" && new Set(rows.map(row => row.normalized_name)).size !== rows.length) {
      throw new Error(`${name} 包含重复名称。`);
    }
  }
  return structuredClone(backup);
}

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function readLocalBackup(storage: StorageLike = localStorage): LocalBackup {
  const text = storage.getItem(LOCAL_DATA_KEY);
  if (!text) return emptyBackup();
  try { return validateBackup(JSON.parse(text)); }
  catch { throw new Error("本地数据无法解析，已保留原始内容。请先导出原始备份，勿清理浏览器数据。"); }
}
export function saveLocalBackup(value: unknown, storage: StorageLike = localStorage): void {
  const backup = validateBackup(value);
  backup.exportedAt = new Date().toISOString();
  try { storage.setItem(LOCAL_DATA_KEY, JSON.stringify(backup)); }
  catch { throw new Error("浏览器存储不可用或空间不足，数据未保存。请导出备份后再处理。"); }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCAL_DATA_EVENT));
}

// A small local query adapter for the existing controller. No network or credentials.
export function createLocalClient(storage: StorageLike) {
  function from(table: TableName) {
    let operation: "select" | "insert" | "update" | "delete" = "select";
    let input: Row | Row[] = {};
    const filters: Array<(row: Row) => boolean> = [];
    let single: "required" | "optional" | undefined;
    let resultPromise: Promise<{ data: Row[] | Row | null; error: Error | null }> | undefined;
    const query = {
      select(_columns?: string) { return query; },
      insert(rows: Row | Row[]) { operation = "insert"; input = rows; return query; },
      update(row: Row) { operation = "update"; input = row; return query; },
      delete() { operation = "delete"; return query; },
      eq(column: string, value: unknown) { filters.push(row => row[column] === value); return query; },
      in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return query; },
      single() { single = "required"; return query; },
      maybeSingle() { single = "optional"; return query; },
      then(resolve: (value: { data: Row[] | Row | null; error: Error | null }) => unknown, reject?: (error: unknown) => unknown) {
        resultPromise ??= Promise.resolve().then(() => {
          try {
            const backup = readLocalBackup(storage);
            const rows = backup.tables[table];
            const matches = (row: Row) => filters.every(filter => filter(row));
            let result = rows.filter(matches);
            const now = new Date().toISOString();
            if (operation === "insert") {
              result = (Array.isArray(input) ? input : [input]).map(row => ({
                id: crypto.randomUUID(), created_at: now, updated_at: now, ...row,
              }));
              backup.tables[table] = [...rows, ...result];
            } else if (operation === "update") {
              result = result.map(row => ({ ...row, ...input, updated_at: now }));
              backup.tables[table] = rows.map(row => result.find(updated => updated.id === row.id) ?? row);
            } else if (operation === "delete") {
              backup.tables[table] = rows.filter(row => !matches(row));
            }
            if (single && (result.length > 1 || (single === "required" && !result.length))) {
              throw new Error("未找到唯一记录。");
            }
            if (operation !== "select") saveLocalBackup(backup, storage);
            return { data: single ? result[0] ?? null : result, error: null };
          } catch (error) { return { data: null, error: error instanceof Error ? error : new Error(String(error)) }; }
        });
        return resultPromise.then(resolve, reject);
      },
    };
    return query;
  }
  return { from };
}

export function getLocalClient() { return createLocalClient(localStorage); }
