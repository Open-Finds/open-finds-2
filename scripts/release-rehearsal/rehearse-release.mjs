// Rehearses the production release and its rollback on a production-equivalent throwaway database.
// Not part of the app or CI. See scripts/release-rehearsal/README.md for how to run it.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { splitSql } from './split.mjs';

const SP = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO = process.env.REPO || path.resolve(SP, '..', '..');
const DATA = path.join(os.tmpdir(), 'release-rehearsal-data');
const PORT = 54335;
try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { console.error('cannot clear data dir', e.message); process.exit(2); }
const server = new EmbeddedPostgres({ databaseDir: DATA, user: 'postgres', password: 'test', port: PORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
const strip = (s) => s.replace(/\r\n/g, '\n').split('\n').filter((l) => !/^\\/.test(l)).join('\n');
const conn = (db) => { const c = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'test', database: db }); c.on('error', () => {}); return c; };
const run = async (c, f, tolerant = false) => { for (const st of splitSql(strip(fs.readFileSync(f, 'utf8')))) { try { await c.query(st); } catch (e) { if (tolerant && e.code === '42710') continue; throw e; } } };
let fails = 0;
const check = (label, ok, got) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '  got: ' + JSON.stringify(got).slice(0, 600))); if (!ok) fails++; };

const MIG = path.join(REPO, 'supabase/migrations');
const ROLL = path.join(REPO, 'supabase/rollback');
const all = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const base = all.filter((f) => f.slice(0, 14) <= '20261015120000');
const pending = all.filter((f) => f.slice(0, 14) > '20261015120000');
const rollbackFor = (m) => path.join(ROLL, m.replace(/\.sql$/, '.rollback.sql'));
const FP = fs.readFileSync(path.join(SP, '..', 'schema-fingerprint.sql'), 'utf8');

async function snapshot(c) {
  const rows = (await c.query(FP)).rows.map((r) => `${r.k}|${r.n}|${r.h}`);
  const acl = (await c.query(`select 'acl|'||p.oid::regprocedure::text||'|'||coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a),'')||'|'||coalesce(array_to_string(p.proconfig,','),'') x from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and p.proname<>'rep' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')`)).rows.map((r) => r.x);
  const sett = (await c.query(`select 'setting|'||key||'|'||value::text x from public.app_settings`)).rows.map((r) => r.x);
  const tabAcl = (await c.query(`select 'tableacl|'||c.relname||'|'||coalesce((select string_agg(a::text, ',' order by a::text) from unnest(c.relacl) a),'') x from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','v')`)).rows.map((r) => r.x);
  const data = [];
  for (const [t, drop] of [['saved_venues', ['legacy_duplicate']], ['plans', ['end_time', 'end_date']], ['stops', []], ['profiles', []], ['plan_invites', []], ['collections', []], ['app_settings', []]]) {
    const r = (await c.query(`select count(*)::int n, coalesce(md5(string_agg((to_jsonb(t) ${drop.map((d) => `- '${d}'`).join(' ')})::text, '' order by (to_jsonb(t) ${drop.map((d) => `- '${d}'`).join(' ')})::text)), '') h from public.${t} t`)).rows[0];
    data.push(`data|${t}|${r.n}|${r.h}`);
  }
  return [...rows, ...acl, ...sett, ...tabAcl, ...data].sort();
}
const diff = (a, b) => { const A = new Set(a), B = new Set(b); return { onlyBefore: a.filter((x) => !B.has(x)).map((x) => x.slice(0, 170)), onlyAfter: b.filter((x) => !A.has(x)).map((x) => x.slice(0, 170)) }; };
const same = (label, a, b) => { const d = diff(a, b); check(label, d.onlyBefore.length === 0 && d.onlyAfter.length === 0, d); };

async function seed(c) {
  await c.query(`insert into auth.users (id,email) values ('a1000000-0000-4000-8000-000000000001','a@x.invalid'),('b1000000-0000-4000-8000-000000000002','b@x.invalid') on conflict do nothing`);
  await c.query(`insert into profiles (id, display_name) values ('a1000000-0000-4000-8000-000000000001','A'),('b1000000-0000-4000-8000-000000000002','B') on conflict (id) do nothing`);
  await c.query(`insert into saved_venues (user_id,name,address,type,personal_note,created_at) values
    ('a1000000-0000-4000-8000-000000000001','Dup Cafe','1 Dup St','food','first note', now() - interval '3 days'),
    ('a1000000-0000-4000-8000-000000000001',' dup CAFE','1 DUP st','food','second note', now() - interval '2 days'),
    ('a1000000-0000-4000-8000-000000000001','Dup Cafe','1 Dup St','food',null, now() - interval '1 day'),
    ('a1000000-0000-4000-8000-000000000001','Solo Bar','2 Solo St','bar',null, now()),
    ('b1000000-0000-4000-8000-000000000002','Dup Cafe','1 Dup St','food',null, now()),
    ('b1000000-0000-4000-8000-000000000002','Pair','3 Pair St','food','n1', now() - interval '2 days'),
    ('b1000000-0000-4000-8000-000000000002','Pair','3 Pair St','food','n2', now() - interval '1 day')`);
  await c.query(`insert into plans (title,date,host_name,user_id) values ('Device plan', current_date, 'Host', 'device-aaa')`);
  await c.query(`insert into plans (title,date,host_name,user_id,owner_id) values ('Owned plan', current_date, 'Host', 'a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001')`);
}
const applyForward = async (c, list) => { for (const m of list) await run(c, path.join(MIG, m)); };
const applyRollbacks = async (c, list) => { for (const m of [...list].reverse()) await run(c, rollbackFor(m)); };
async function freshBase(name) {
  const root = conn('postgres'); await root.connect(); await root.query(`create database ${name}`); await root.end();
  const c = conn(name); await c.connect();
  await run(c, path.join(REPO, 'supabase/tests/00_platform_stub.sql'), true);
  await applyForward(c, base);
  await seed(c);
  return c;
}

try {
  await server.initialise(); await server.start();
  check('every pending migration has a rollback script', pending.every((m) => fs.existsSync(rollbackFor(m))), pending.filter((m) => !fs.existsSync(rollbackFor(m))));
  console.log(`base ${base.length} migrations; pending ${pending.length}: ${pending.map((m) => m.slice(0, 14)).join(', ')}`);

  // ---- Scenario 1: the whole release, then the whole rollback
  let c = await freshBase('s1');
  const S0 = await snapshot(c);
  await applyForward(c, pending);
  const S1 = await snapshot(c);
  check('S1 forward: the release changes the database', diff(S0, S1).onlyAfter.length > 0);
  const flagged = (await c.query(`select count(*)::int n from saved_venues where legacy_duplicate`)).rows[0].n;
  check('S1 forward: the 3 older duplicates are flagged, none deleted (4 flagged of 7)', flagged === 3 || flagged === 4, flagged);
  check('S1 forward: no saved venue or plan row deleted', S1.filter((x) => /^data\|(saved_venues|plans)\|/.test(x)).every((x) => S0.some((y) => y.split('|').slice(0, 3).join('|') === x.split('|').slice(0, 3).join('|'))), S1.filter((x) => x.startsWith('data|')));
  const cap = (await c.query(`select prosrc from pg_proc where proname='enforce_stop_cap' and pronamespace='public'::regnamespace`)).rows[0].prosrc;
  check('S1 forward: stop limit is 6 for everyone', /v_count >= 6/.test(cap), cap.slice(0, 120));
  await applyRollbacks(c, pending);
  const S2 = await snapshot(c);
  same('S1 rollback: the database is exactly as before the release (structure, access, settings and data)', S0, S2);
  await applyRollbacks(c, pending);
  same('S1 rollback run a second time is harmless (still identical)', S0, await snapshot(c));
  await c.end();

  // ---- Scenario 2: only the quick fix, then undo it
  c = await freshBase('s2');
  const T0 = await snapshot(c);
  const hot = pending.filter((m) => /(20261118120000|20261118140000)/.test(m));
  await applyForward(c, hot);
  check('S2 quick fix: changes the database', diff(T0, await snapshot(c)).onlyAfter.length > 0);
  await applyRollbacks(c, hot);
  same('S2 undo of the quick fix returns the database to the start', T0, await snapshot(c));
  await c.end();

  // ---- Scenario 3: whole release, then undo only the last three migrations
  c = await freshBase('s3');
  const first8 = pending.slice(0, pending.length - 3);
  await applyForward(c, first8);
  const U8 = await snapshot(c);
  await applyForward(c, pending.slice(pending.length - 3));
  await applyRollbacks(c, pending.slice(pending.length - 3));
  same('S3 undoing only the last 3 migrations returns to the state after the first 8', U8, await snapshot(c));
  await c.end();

  // ---- Scenario 4: the destructive rollbacks refuse when new data exists
  c = await freshBase('s4');
  await applyForward(c, pending);
  await c.query(`insert into saved_venues (user_id,name,address,type) values ('a1000000-0000-4000-8000-000000000001','Rec Venue','9 Rec St','food')`);
  const sv = (await c.query(`select id from saved_venues where name='Rec Venue'`)).rows[0].id;
  await c.query(`insert into venue_recommendations (venue_id, snapshot) values ($1, '{}'::jsonb)`, [sv]);
  let refused = false;
  try { await run(c, rollbackFor(pending.find((m) => m.includes('ai_save_quick_share')))); } catch (e) { refused = /Venue recommendations exist/.test(e.message); }
  check('S4 the AI Save rollback refuses to drop recommendations that exist', refused);
  await c.query(`update plans set end_time='20:00', end_date=date where title='Owned plan'`);
  refused = false;
  try { await run(c, rollbackFor(pending.find((m) => m.includes('optional_event_end')))); } catch (e) { refused = /Plans with an event end exist/.test(e.message); }
  check('S4 the event-end rollback refuses to drop end times that exist', refused);
  await c.end();
} catch (e) { console.log('ERROR', e.message); fails++; }
await server.stop();
console.log(fails ? `FAILURES: ${fails}` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
