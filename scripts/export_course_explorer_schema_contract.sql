\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset footer off
\pset null '<NULL>'

-- Produce a deterministic, reviewable signature for every schema/access
-- object needed by the five-table Course Explorer recovery boundary. The
-- verification workflow diffs this output byte-for-byte against the checked-
-- in contract generated from the reviewed production-equivalent migration
-- chain. This complements the semantic/data checks in the SQL verifier.
with
scoped_tables(table_name) as (
  values
    ('courses'),
    ('course_sections'),
    ('schedules'),
    ('live_catalogue_runs'),
    ('live_courses')
),
scoped_functions(function_name) as (
  values
    ('public.refresh_synced_at()'),
    ('public.keep_ats_hks_inactive_after_myharvard()'),
    ('public.sync_live_courses_atomically(jsonb)'),
    ('public.stage_myharvard_hks_offerings(uuid,jsonb)'),
    ('public.promote_myharvard_hks_run(uuid)'),
    ('public.rollback_myharvard_hks_run(uuid)')
),
browser_roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role')
),
table_privileges(privilege_name) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
         ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
),
function_privileges(privilege_name) as (
  values ('EXECUTE')
),
schema_privileges(privilege_name) as (
  values ('USAGE'), ('CREATE')
),
contract(section, sort_key, line) as (
  select '01-table', st.table_name,
    format('TABLE|%s|rls=%s|force_rls=%s', st.table_name, c.relrowsecurity, c.relforcerowsecurity)
  from scoped_tables st
  join pg_class c on c.oid = to_regclass('public.' || st.table_name)

  union all

  select '02-column', format('%s|%05s', st.table_name, a.attnum),
    format(
      'COLUMN|%s|%s|%s|%s|not_null=%s|default=%s',
      st.table_name,
      a.attnum,
      a.attname,
      format_type(a.atttypid, a.atttypmod),
      a.attnotnull,
      coalesce(pg_get_expr(d.adbin, d.adrelid), '<NULL>')
    )
  from scoped_tables st
  join pg_class c on c.oid = to_regclass('public.' || st.table_name)
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum

  union all

  select '03-index', format('%s|%s', st.table_name, i.relname),
    format('INDEX|%s|%s', st.table_name, pg_get_indexdef(i.oid))
  from scoped_tables st
  join pg_class t on t.oid = to_regclass('public.' || st.table_name)
  join pg_index x on x.indrelid = t.oid
  join pg_class i on i.oid = x.indexrelid

  union all

  select '04-constraint', format('%s|%s', st.table_name, con.conname),
    format(
      'CONSTRAINT|%s|%s|type=%s|validated=%s|%s',
      st.table_name,
      con.conname,
      con.contype,
      con.convalidated,
      pg_get_constraintdef(con.oid, true)
    )
  from scoped_tables st
  join pg_constraint con on con.conrelid = to_regclass('public.' || st.table_name)

  union all

  select '05-policy', format('%s|%s', st.table_name, pol.polname),
    format(
      'POLICY|%s|%s|permissive=%s|command=%s|roles=%s|using=%s|check=%s',
      st.table_name,
      pol.polname,
      pol.polpermissive,
      pol.polcmd,
      coalesce((
        select string_agg(coalesce(r.rolname, 'public'), ',' order by coalesce(r.rolname, 'public'))
        from unnest(pol.polroles) role_oid
        left join pg_roles r on r.oid = role_oid
      ), '<NULL>'),
      coalesce(pg_get_expr(pol.polqual, pol.polrelid), '<NULL>'),
      coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '<NULL>')
    )
  from scoped_tables st
  join pg_policy pol on pol.polrelid = to_regclass('public.' || st.table_name)

  union all

  select '06-table-privilege',
    format('%s|%s|%s', st.table_name, br.role_name, tp.privilege_name),
    format(
      'TABLE_PRIVILEGE|%s|%s|%s|%s',
      st.table_name,
      br.role_name,
      tp.privilege_name,
      has_table_privilege(br.role_name, 'public.' || st.table_name, tp.privilege_name)
    )
  from scoped_tables st
  cross join browser_roles br
  cross join table_privileges tp

  union all

  select '07-column-privilege',
    format('%s|%s|%05s|%s', cp.table_name, cp.grantee, col.ordinal_position, cp.privilege_type),
    format(
      'COLUMN_PRIVILEGE|%s|%s|%s|%s|grantable=%s',
      cp.table_name,
      cp.grantee,
      cp.column_name,
      cp.privilege_type,
      cp.is_grantable
    )
  from information_schema.column_privileges cp
  join information_schema.columns col
    on col.table_schema = cp.table_schema
   and col.table_name = cp.table_name
   and col.column_name = cp.column_name
  join scoped_tables st on st.table_name = cp.table_name
  join browser_roles br on br.role_name = cp.grantee
  where cp.table_schema = 'public'

  union all

  select '07b-table-grant-option',
    format('%s|%s|%s', st.table_name, br.role_name, tp.privilege_name),
    format(
      'TABLE_GRANT_OPTION|%s|%s|%s|%s',
      st.table_name,
      br.role_name,
      tp.privilege_name,
      has_table_privilege(
        br.role_name,
        'public.' || st.table_name,
        tp.privilege_name || ' WITH GRANT OPTION'
      )
    )
  from scoped_tables st
  cross join browser_roles br
  cross join table_privileges tp

  union all

  select '08-table-acl',
    format('%s|%s|%s', st.table_name,
      case when acl.grantee = 0 then 'public'
           when acl.grantee = c.relowner then '<owner>'
           else grantee.rolname end,
      acl.privilege_type),
    format(
      'TABLE_ACL|%s|%s|%s|grantable=%s',
      st.table_name,
      case when acl.grantee = 0 then 'public'
           when acl.grantee = c.relowner then '<owner>'
           else grantee.rolname end,
      acl.privilege_type,
      acl.is_grantable
    )
  from scoped_tables st
  join pg_class c on c.oid = to_regclass('public.' || st.table_name)
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
  left join pg_roles grantee on grantee.oid = acl.grantee

  union all

  select '09-column-acl',
    format('%s|%05s|%s|%s', st.table_name, a.attnum,
      case when acl.grantee = 0 then 'public'
           when acl.grantee = c.relowner then '<owner>'
           else grantee.rolname end,
      acl.privilege_type),
    format(
      'COLUMN_ACL|%s|%s|%s|%s|grantable=%s',
      st.table_name,
      a.attname,
      case when acl.grantee = 0 then 'public'
           when acl.grantee = c.relowner then '<owner>'
           else grantee.rolname end,
      acl.privilege_type,
      acl.is_grantable
    )
  from scoped_tables st
  join pg_class c on c.oid = to_regclass('public.' || st.table_name)
  join pg_attribute a
    on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
  cross join lateral aclexplode(a.attacl) acl
  left join pg_roles grantee on grantee.oid = acl.grantee

  union all

  select '10-function', sf.function_name,
    format(
      'FUNCTION|%s|security_definer=%s|volatility=%s|parallel=%s|config=%s|definition_sha256=%s',
      sf.function_name,
      p.prosecdef,
      p.provolatile,
      p.proparallel,
      coalesce(array_to_string(p.proconfig, ','), '<NULL>'),
      encode(extensions.digest(convert_to(pg_get_functiondef(p.oid), 'UTF8'), 'sha256'), 'hex')
    )
  from scoped_functions sf
  join pg_proc p on p.oid = to_regprocedure(sf.function_name)

  union all

  select '11-function-privilege',
    format('%s|%s|%s', sf.function_name, br.role_name, fp.privilege_name),
    format(
      'FUNCTION_PRIVILEGE|%s|%s|%s|%s',
      sf.function_name,
      br.role_name,
      fp.privilege_name,
      has_function_privilege(br.role_name, sf.function_name, fp.privilege_name)
    )
  from scoped_functions sf
  cross join browser_roles br
  cross join function_privileges fp

  union all

  select '11b-function-grant-option',
    format('%s|%s|%s', sf.function_name, br.role_name, fp.privilege_name),
    format(
      'FUNCTION_GRANT_OPTION|%s|%s|%s|%s',
      sf.function_name,
      br.role_name,
      fp.privilege_name,
      has_function_privilege(
        br.role_name,
        sf.function_name,
        fp.privilege_name || ' WITH GRANT OPTION'
      )
    )
  from scoped_functions sf
  cross join browser_roles br
  cross join function_privileges fp

  union all

  select '12-function-acl',
    format('%s|%s|%s', sf.function_name,
      case when acl.grantee = 0 then 'public'
           when acl.grantee = p.proowner then '<owner>'
           else grantee.rolname end,
      acl.privilege_type),
    format(
      'FUNCTION_ACL|%s|%s|%s|grantable=%s',
      sf.function_name,
      case when acl.grantee = 0 then 'public'
           when acl.grantee = p.proowner then '<owner>'
           else grantee.rolname end,
      acl.privilege_type,
      acl.is_grantable
    )
  from scoped_functions sf
  join pg_proc p on p.oid = to_regprocedure(sf.function_name)
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  left join pg_roles grantee on grantee.oid = acl.grantee

  union all

  select '13-trigger', format('%s|%s', st.table_name, trg.tgname),
    format('TRIGGER|%s|%s|%s', st.table_name, trg.tgname, pg_get_triggerdef(trg.oid, true))
  from scoped_tables st
  join pg_trigger trg
    on trg.tgrelid = to_regclass('public.' || st.table_name)
   and not trg.tgisinternal

  union all

  select '14-schema-privilege', format('%s|%s', br.role_name, sp.privilege_name),
    format(
      'SCHEMA_PRIVILEGE|public|%s|%s|%s',
      br.role_name,
      sp.privilege_name,
      has_schema_privilege(br.role_name, 'public', sp.privilege_name)
    )
  from browser_roles br
  cross join schema_privileges sp

  union all

  select '14b-schema-grant-option', format('%s|%s', br.role_name, sp.privilege_name),
    format(
      'SCHEMA_GRANT_OPTION|public|%s|%s|%s',
      br.role_name,
      sp.privilege_name,
      has_schema_privilege(
        br.role_name,
        'public',
        sp.privilege_name || ' WITH GRANT OPTION'
      )
    )
  from browser_roles br
  cross join schema_privileges sp

  union all

  select '15-extension', ext.extname,
    format('EXTENSION|%s|schema=%s', ext.extname, ns.nspname)
  from pg_extension ext
  join pg_namespace ns on ns.oid = ext.extnamespace
  where ext.extname = 'pgcrypto'
)
select line
from contract
order by section, sort_key, line;
