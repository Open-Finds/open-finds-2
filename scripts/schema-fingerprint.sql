-- Read-only schema fingerprint of the public schema (tables, constraints, indexes, policies,
-- triggers, functions, views). One row per object with a short hash, so two databases can be
-- compared without reading data. It writes nothing.
--
-- Used for the production release plan (docs/PRODUCTION-RELEASE-PLAN.md): run it on a
-- throwaway database built from supabase/migrations up to a chosen version, and on the live
-- project, then compare the rows. Notes:
--  * PostgreSQL 18 stores NOT NULL as constraints; the filter below ignores them so a
--    PostgreSQL 18 scratch database compares equal to a PostgreSQL 17 project.
--  * The test helper function `rep` (from supabase/tests/00_platform_stub.sql) is excluded.
--  * Hashes ignore carriage returns and trailing newlines in function bodies.
with
cols as (select c.relname n, md5(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''), ',' order by a.attname)) h from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where c.relnamespace='public'::regnamespace and c.relkind='r' group by 1),
cons as (select c.relname n, md5(string_agg(k.conname||':'||pg_get_constraintdef(k.oid), ',' order by k.conname)) h from pg_constraint k join pg_class c on c.oid=k.conrelid where k.contype <> 'n' and c.relnamespace='public'::regnamespace and c.relkind='r' group by 1),
idx as (select tablename n, md5(string_agg(indexname||':'||indexdef, ',' order by indexname)) h from pg_indexes where schemaname='public' group by 1),
pol as (select c.relname n, md5(string_agg(p.polname||':'||p.polcmd::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')||':'||array_to_string(array(select case when r=0 then 'public' else (select rolname from pg_roles where oid=r) end from unnest(p.polroles) r order by 1),','), ',' order by p.polname)) h from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace='public'::regnamespace group by 1),
trg as (select c.relname n, md5(string_agg(pg_get_triggerdef(t.oid), ',' order by t.tgname)) h from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal group by 1)
select 'table' k, c.relname::text n, 'c:'||left(coalesce(cols.h,''),6)||'|k:'||left(coalesce(cons.h,''),6)||'|i:'||left(coalesce(idx.h,''),6)||'|p:'||left(coalesce(pol.h,''),6)||'|t:'||left(coalesce(trg.h,''),6)||'|r:'||c.relrowsecurity::text h
from pg_class c left join cols on cols.n=c.relname left join cons on cons.n=c.relname left join idx on idx.n=c.relname left join pol on pol.n=c.relname left join trg on trg.n=c.relname
where c.relnamespace='public'::regnamespace and c.relkind='r'
union all
select 'fn', p.oid::regprocedure::text, left(md5(rtrim(replace(pg_get_functiondef(p.oid),E'\r',''),E'\n')),8)
from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and p.proname<>'rep' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
union all
select 'view', c.relname::text, left(md5(pg_get_viewdef(c.oid)),8)||'|'||coalesce(array_to_string(c.reloptions,','),'')
from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='v'
order by 1,2
