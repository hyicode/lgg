// Explicit columns are also the API allowlist; never interpolate caller SQL.
export const columns = {
  players: ['id', 'display_name', 'normalized_name', 'default_cost', 'active', 'created_at', 'updated_at'],
  riot_accounts: ['id', 'account_name', 'normalized_name', 'created_at'],
  matches: ['id', 'played_at', 'created_at', 'updated_at', 'winner', 'duration_seconds', 'note', 'blue_team', 'red_team', 'participants', 'game_id'],
} as const;
export type Table = keyof typeof columns;
export type Row = Record<string, unknown>;
export function encodeRow(table: Table, row: Row) {
  return columns[table].map(key => {
    const value = row[key];
    if (key === 'participants') return JSON.stringify(value);
    if (key === 'active') return value ? 1 : 0;
    return value ?? null;
  });
}
export function decodeRow(row: Row): Row {
  const result = { ...row };
  if ('active' in result) result.active = Boolean(result.active);
  if ('participants' in result) result.participants = JSON.parse(String(result.participants));
  return result;
}
