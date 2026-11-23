// Rehearses the remaining production release (Step D) on a throwaway Postgres built in production's CURRENT state:
// the first 45 migrations plus the two Step A security migrations, with made-up rows that mimic production's quirks.
// Not part of the app or CI. See scripts/release-rehearsal/README.md.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { splitSql } from './split.mjs';

const SP = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO = process.env.REPO || path.resolve(SP, '..', '..');
const DATA = path.join(os.tmpdir(), 'release-rehearsal-step-d-data');
const PORT = 54337;
try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { console.error('cannot clear data dir', e.message); process.exit(2); }
const server = new EmbeddedPostgres({ databaseDir: DATA, user: 'postgres', password: 'test', port: PORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
const strip = (s) => s.replace(/\r\n/g, '\n').split('\n').filter((l) => !/^\\/.test(l)).join('\n');
const conn = (db) => { const c = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'test', database: db }); c.on('error', () => {}); return c; };
const run = async (c, f, o = {}) => { const h = (m) => o.notices?.push(m.message); c.on('notice', h); try { for (const st of splitSql(strip(fs.readFileSync(f, 'utf8')))) { try { await c.query(st); } catch (e) { if (o.tolerant && e.code === '42710') continue; throw e; } } } finally { c.removeListener('notice', h); } };
let fails = 0;
const check = (label, ok, got) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '  got: ' + JSON.stringify(got).slice(0, 700))); if (!ok) fails++; };

const MIG = path.join(REPO, 'supabase/migrations');
const all = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const base = all.filter((f) => f.slice(0, 14) <= '20261015120000');
const stepA = all.filter((f) => /^(20261118120000|20261118140000)_/.test(f));
const stepD = all.filter((f) => f.slice(0, 14) > '20261015120000' && !stepA.includes(f));
const FP = fs.readFileSync(path.join(SP, '..', 'schema-fingerprint.sql'), 'utf8');

async function snapshot(c, withData) {
  const rows = (await c.query(FP)).rows.map((r) => `${r.k}|${r.n}|${r.h}`);
  const acl = (await c.query(`select 'acl|'||p.oid::regprocedure::text||'|'||coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a),'')||'|'||coalesce(array_to_string(p.proconfig,','),'') x from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and p.proname<>'rep' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')`)).rows.map((r) => r.x);
  const tabAcl = (await c.query(`select 'tableacl|'||c.relname||'|'||coalesce((select string_agg(a::text, ',' order by a::text) from unnest(c.relacl) a),'') x from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','v')`)).rows.map((r) => r.x);
  const sett = (await c.query(`select 'setting|'||key||'|'||value::text x from public.app_settings`)).rows.map((r) => r.x);
  let data = [];
  if (withData) {
    for (const [t, drop] of [['saved_venues', ['legacy_duplicate']], ['plans', ['end_time', 'end_date']], ['stops', []], ['profiles', []], ['plan_invites', []], ['collections', []], ['collection_venues', []], ['rsvps', []]]) {
      const ex = drop.map((d) => `- '${d}'`).join(' ');
      const r = (await c.query(`select count(*)::int n, coalesce(md5(string_agg((to_jsonb(t) ${ex})::text, '' order by (to_jsonb(t) ${ex})::text)), '') h from public.${t} t`)).rows[0];
      data.push(`data|${t}|${r.n}|${r.h}`);
    }
  }
  return [...rows, ...acl, ...tabAcl, ...sett, ...data].sort();
}
const diff = (a, b) => { const A = new Set(a), B = new Set(b); return { onlyBefore: a.filter((x) => !B.has(x)).map((x) => x.slice(0, 170)), onlyAfter: b.filter((x) => !A.has(x)).map((x) => x.slice(0, 170)) }; };
const same = (label, a, b) => { const d = diff(a, b); check(label, d.onlyBefore.length === 0 && d.onlyAfter.length === 0, d); };

// Production-like quirks (from the read-only counts): duplicate saved venues, many plans with no owner, shared collections with private notes.
async function seed(c) {
  const U = (n) => `a${n}000000-0000-4000-8000-00000000000${n}`;
  for (const n of [1, 2, 3]) await c.query(`insert into auth.users (id,email) values ($1,$2) on conflict do nothing`, [U(n), `u${n}@x.invalid`]);
  for (const n of [1, 2, 3]) await c.query(`insert into profiles (id, display_name) values ($1,$2) on conflict (id) do nothing`, [U(n), `U${n}`]);
  await c.query(`insert into saved_venues (user_id,name,address,type,personal_note,created_at) values
    ($1,'Dup Cafe','1 Dup St','food','first note', now() - interval '3 days'),($1,' dup CAFE','1 DUP st','food','second note', now() - interval '2 days'),($1,'Dup Cafe','1 Dup St','food',null, now() - interval '1 day'),
    ($1,'Solo Bar','2 Solo St','bar','private solo note', now()),
    ($2,'Dup Cafe','1 Dup St','food',null, now()),($2,'Pair','3 Pair St','food','n1', now() - interval '2 days'),($2,'Pair','3 Pair St','food','n2', now() - interval '1 day'),
    ($1,'Triple','4 T St','food',null, now() - interval '5 days'),($1,'triple','4 t st','food',null, now() - interval '4 days'),($1,'TRIPLE','4 T St','food',null, now() - interval '3 days')`, [U(1), U(2)]);
  for (let i = 0; i < 20; i++) await c.query(`insert into plans (title,date,host_name,user_id) values ($1, current_date, 'Host', $2)`, [`Device plan ${i}`, `device-${i}`]);
  await c.query(`insert into plans (title,date,host_name,user_id,owner_id) values ('Owned plan', current_date, 'Host', $1::text, $1::uuid)`, [U(1)]);
  const plan = (await c.query(`select id from plans where title='Owned plan'`)).rows[0].id;
  const cols = (await c.query(`select column_name, data_type, column_default is not null as hasdef from information_schema.columns where table_schema='public' and table_name='stops' and is_nullable='NO' order by ordinal_position`)).rows;
  for (let i = 0; i < 5; i++) {
    const names = [], vals = [];
    for (const col of cols) {
      if (col.hasdef && col.column_name !== 'plan_id') continue;
      names.push(col.column_name);
      vals.push(col.column_name === 'plan_id' ? `'${plan}'` : col.data_type === 'uuid' ? `'${U(1)}'` : /int|numeric/.test(col.data_type) ? String(i) : col.data_type === 'date' ? 'current_date' : /time/.test(col.data_type) ? `'19:00'` : col.data_type === 'boolean' ? 'false' : `'stop ${i}'`);
    }
    await c.query(`insert into stops (${names.join(',')}) values (${vals.join(',')})`);
  }
  await c.query(`insert into collections (name, user_id) values ('Shared col', $1)`, [U(1)]).catch(() => {});
  const col = (await c.query(`select id from collections where name='Shared col'`)).rows[0];
  const solo = (await c.query(`select id from saved_venues where name='Solo Bar'`)).rows[0];
  if (col && solo) {
    await c.query(`insert into collection_venues (collection_id, venue_id, added_by) values ($1,$2,$3)`, [col.id, solo.id, U(1)]).catch(() => {});
    await c.query(`insert into collection_members (collection_id, user_id, added_by) values ($1,$2,$3)`, [col.id, U(2), U(1)]).catch(() => {});
  }
}
const applyList = async (c, list) => { for (const m of list) await run(c, path.join(MIG, m)); };
const rollbackFile = (m) => path.join(REPO, 'supabase/rollback', m.replace(/\.sql$/, '.rollback.sql'));

async function makeDb(name, files, withSeed) {
  const root = conn('postgres'); await root.connect(); await root.query(`create database ${name}`); await root.end();
  const c = conn(name); await c.connect();
  await run(c, path.join(REPO, 'supabase/tests/00_platform_stub.sql'), { tolerant: true });
  await applyList(c, files);
  if (withSeed) await seed(c);
  return c;
}

try {
  await server.initialise(); await server.start();
  console.log(`production state = ${base.length} base migrations + Step A (${stepA.map((m) => m.slice(0, 14)).join(', ')}); Step D = ${stepD.length} migrations: ${stepD.map((m) => m.slice(0, 14)).join(', ')}`);
  check('Step D is exactly the nine remaining migrations', stepD.length === 9, stepD);

  const ref = await makeDb('ref', all, false);              // clean build of every migration
  const refSnap = await snapshot(ref, false);
  const prod = await makeDb('prod', [...base, ...stepA], true);   // production's current state plus quirks
  const S0 = await snapshot(prod, true);
  const owner = 'a1000000-0000-4000-8000-000000000001';
  const dupBefore = (await prod.query(`select count(*)::int n from (select user_id, lower(btrim(name)), lower(btrim(address)) from saved_venues group by 1,2,3 having count(*)>1) d`)).rows[0].n;
  check('seed reproduces production quirks (3 duplicate groups, owned and unowned plans, 5 stops, a shared collection)', dupBefore === 3, dupBefore);

  await applyList(prod, stepD);
  const S1 = await snapshot(prod, true);
  const stripData = (s) => s.filter((x) => !x.startsWith('data|'));
  same('RELEASE: production state + the nine migrations is identical to a clean build of all 56 (structure, access, settings)', stripData(refSnap), stripData(S1));
  const flagged = (await prod.query(`select count(*)::int n from saved_venues where legacy_duplicate`)).rows[0].n;
  check('RELEASE: older duplicates flagged, none deleted (5 flagged: 2 + 1 + 2 across the 3 groups)', flagged === 5, flagged);
  const counts = (s) => Object.fromEntries(s.filter((x) => x.startsWith('data|')).map((x) => [x.split('|')[1], x.split('|')[2]]));
  const c0 = counts(S0), c1 = counts(S1);
  check('RELEASE: every table keeps its rows (saved venues, plans, stops, profiles, invites, collections, rsvps)', JSON.stringify(c0) === JSON.stringify(c1), { before: c0, after: c1 });
  const hashes = (s) => Object.fromEntries(s.filter((x) => x.startsWith('data|')).map((x) => [x.split('|')[1], x.split('|')[3]]));
  check('RELEASE: the content of every existing row is unchanged (apart from the new columns)', JSON.stringify(hashes(S0)) === JSON.stringify(hashes(S1)));
  const six = (await prod.query(`select prosrc from pg_proc where proname='enforce_stop_cap' and pronamespace='public'::regnamespace`)).rows[0].prosrc;
  check('RELEASE: six stops for everyone, no subscription test in the stop limit', /v_count >= 6/.test(six) && !/subscription_tier/.test(six), six.slice(0, 100));
  const flags = (await prod.query(`select key from app_settings where key in ('planner_six_stops','planner_event_timing') order by key`)).rows.map((r) => r.key);
  check('RELEASE: the two planner flags are switched on', flags.join(',') === 'planner_event_timing,planner_six_stops', flags);


  // Private notes in shared collections stay private (the migration's purpose), on this data.
  const sv = (await prod.query(`select id from saved_venues where name='Solo Bar'`)).rows[0].id;
  const colId = (await prod.query(`select id from collections where name='Shared col'`)).rows[0]?.id;
  if (colId) {
    await prod.query('begin');
    await prod.query('set local role authenticated'); await prod.query(`select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true)`);
    const member = (await prod.query(`select public.get_collection_venues($1) as r`, [colId])).rows[0].r;
    await prod.query('rollback');
    const seen = JSON.stringify(member);
    check('RELEASE: another member of a shared collection does not see the owner\'s private note', member && !seen.includes('private solo note'), seen.slice(0, 200));
    await prod.query('begin');
    await prod.query('set local role authenticated'); await prod.query(`select set_config('request.jwt.claim.sub', $1, true)`, [owner]);
    const mine = JSON.stringify((await prod.query(`select public.get_collection_venues($1) as r`, [colId])).rows[0].r);
    await prod.query('rollback');
    check('RELEASE: the owner still sees their own note', mine.includes('private solo note'), mine.slice(0, 200));
  } else console.log('NOTE  shared-collection check skipped (could not seed a collection with this schema)');

  // The whole release can be undone, exactly, on this data.
  const S1b = await snapshot(prod, true);
  for (const m of [...stepD].reverse()) await run(prod, rollbackFile(m));
  same('ROLLBACK: undoing all nine puts production\'s state back exactly (structure, access, settings and data)', S0, await snapshot(prod, true));

  // Release again, then run the project's whole database test suite on the result.
  await applyList(prod, stepD);
  same('RE-RELEASE after rollback gives the same result as the first release', S1b, await snapshot(prod, true));
  const tests = fs.readdirSync(path.join(REPO, 'supabase/tests')).filter((f) => /^(0[1-9]|[1-9][0-9])_.*\.sql$/.test(f)).sort();
  let pass = 0, fail = 0;
  for (const t of tests) {
    const tc = conn('prod'); await tc.connect(); const n = [];
    try { await run(tc, path.join(REPO, 'supabase/tests', t), { notices: n }); } catch (e) { fail++; console.log(`  TEST ${t}: ERROR ${e.message}`); await tc.end(); continue; }
    await tc.end();
    const lines = n.filter((x) => /PASS|FAIL/.test(x)), bad = lines.filter((x) => /FAIL/.test(x));
    pass += lines.length - bad.length; fail += bad.length;
    if (bad.length) bad.forEach((b) => console.log(`  TEST ${t}: ${b}`));
  }
  check(`TESTS: the project's ${tests.length} database test files pass on the released state (${pass} checks pass, ${fail} fail)`, fail === 0 && pass > 250, { pass, fail });
  // After the suite (it sets up the table access the API roles need in this throwaway database):
  // A sixth stop can be added to a plan that already has five; a seventh is refused.
  const plan = (await prod.query(`select id from plans where title='Owned plan'`)).rows[0].id;
  const colsN = (await prod.query(`select column_name, data_type, column_default is not null as hasdef from information_schema.columns where table_schema='public' and table_name='stops' and is_nullable='NO' order by ordinal_position`)).rows;
  const addStop = async (i, asUser) => {
    const names = [], vals = [];
    for (const col of colsN) { if (col.hasdef && col.column_name !== 'plan_id') continue; names.push(col.column_name); vals.push(col.column_name === 'plan_id' ? `'${plan}'` : col.data_type === 'uuid' ? `'${asUser}'` : /int|numeric/.test(col.data_type) ? String(i) : col.data_type === 'date' ? 'current_date' : /time/.test(col.data_type) ? `'19:00'` : col.data_type === 'boolean' ? 'false' : `'stop ${i}'`); }
    await prod.query('begin');
    try {
      await prod.query('set local role authenticated'); await prod.query(`select set_config('request.jwt.claim.sub', $1, true)`, [asUser]); await prod.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
      await prod.query(`insert into stops (${names.join(',')}) values (${vals.join(',')})`);
      await prod.query('commit'); return 'added';
    } catch (e) { await prod.query('rollback'); return e.message; }
  };
  const sixth = await addStop(5, owner);
  check('RELEASE: a plan with five stops can take a sixth', sixth === 'added', sixth);
  const seventh = await addStop(6, owner);
  check('RELEASE: a seventh stop is refused with the six-stop message', /up to 6 stops/.test(seventh), seventh);
  await prod.query(`delete from stops where plan_id = $1 and name = 'stop 5'`, [plan]);   // restore the seed state before the rollback comparison
  await prod.end(); await ref.end();
} catch (e) { console.log('ERROR', e.message); fails++; }
await server.stop();
console.log(fails ? `FAILURES: ${fails}` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
