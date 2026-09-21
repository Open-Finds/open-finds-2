#!/usr/bin/env node
// Applies pending migrations through the Supabase Management API.
//
// `supabase db push` needs the database password. When all you have is a
// personal access token (org member, no password), this does the same job
// through the API: reads supabase_migrations.schema_migrations, applies each
// pending file in version order as one statement batch, and records it so a
// later `db push` sees a consistent history.
//
//   node supabase/migrate-via-api.mjs <project-ref>            # dry run: list pending
//   node supabase/migrate-via-api.mjs <project-ref> --apply    # apply them
//   node supabase/migrate-via-api.mjs <project-ref> --sql "INSERT …"   # run one statement
//
// Token: SUPABASE_ACCESS_TOKEN, or ~/.supabase/access-token (what `supabase login` writes).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [ref, ...flags] = process.argv.slice(2);
if (!ref) {
  console.error('usage: migrate-via-api.mjs <project-ref> [--apply] [--sql "<statement>"]');
  process.exit(2);
}
const tokenFile = join(homedir(), '.supabase', 'access-token');
const token = process.env.SUPABASE_ACCESS_TOKEN ?? (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '');
if (!token) {
  console.error('no token: set SUPABASE_ACCESS_TOKEN or run `supabase login`');
  process.exit(2);
}

async function query(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : [];
}

// --sql: one statement, print rows, done.
const sqlIdx = flags.indexOf('--sql');
if (sqlIdx !== -1) {
  try {
    console.log(JSON.stringify(await query(flags[sqlIdx + 1]), null, 2));
  } catch (e) {
    console.error(String(e.message));
    process.exit(1);
  }
  process.exit(0);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const local = readdirSync(dir).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
const applied = new Set((await query('select version from supabase_migrations.schema_migrations')).map((r) => r.version));
const pending = local.filter((f) => !applied.has(f.slice(0, 14)));

console.log(`project ${ref}: ${applied.size} versions recorded, ${local.length} local files, ${pending.length} pending`);
for (const f of pending) console.log(`  • ${f}`);

// A local file whose version is recorded remotely but whose name differs is
// not a problem; a remote version with no local file is worth knowing about.
const unknown = [...applied].filter((v) => !local.some((f) => f.startsWith(v))).sort();
if (unknown.length) console.log(`  (remote has ${unknown.length} version(s) with no local file: ${unknown.join(', ')})`);

if (!flags.includes('--apply')) {
  console.log(pending.length ? '\ndry run — re-run with --apply to apply them' : '\nup to date');
  process.exit(0);
}

for (const f of pending) {
  const version = f.slice(0, 14);
  const name = f.slice(15, -4);
  const sql = readFileSync(join(dir, f), 'utf8');
  // One request = one implicit transaction: a failing statement rolls back
  // the whole file *and* the history row, so a half-applied file is not recorded.
  const tag = '$mig$';
  const record = `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
    VALUES ('${version}', '${name.replace(/'/g, "''")}', ARRAY[${tag}${sql}${tag}]);`;
  process.stdout.write(`→ applying ${f} … `);
  try {
    await query(`${sql}\n${record}`);
    console.log('ok');
  } catch (e) {
    console.log('FAILED');
    console.error(String(e.message));
    console.error('Nothing from this file was kept. Fix the cause and re-run; earlier files stay applied.');
    process.exit(1);
  }
}
console.log('done');
