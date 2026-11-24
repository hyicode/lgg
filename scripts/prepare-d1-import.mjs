import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateBackup } from '../src/data/localStore.ts';
import { columns, encodeRow } from '../cloudflare/data.ts';

const literal = value => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
export function backupToSql(input) {
  const backup = validateBackup(input);
  const sql = ['-- LGG business data only. Import into an empty D1 database.'];
  for (const table of ['players', 'riot_accounts', 'matches']) {
    for (const row of backup.tables[table]) {
      const values = encodeRow(table, row);
      sql.push(`INSERT INTO ${table} (${columns[table].join(',')}) VALUES (${values.map(literal).join(',')});`);
    }
  }
  return sql.join('\n') + '\n';
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node --experimental-strip-types scripts/prepare-d1-import.mjs input.json backups/d1-import.sql');
  const backup = JSON.parse(await readFile(input, 'utf8'));
  const sql = backupToSql(backup);
  await writeFile(output, sql, { flag: 'wx' });
  console.log(JSON.stringify({ output, rows: Object.fromEntries(Object.keys(columns).map(table => [table, backup.tables[table].length])) }));
}
