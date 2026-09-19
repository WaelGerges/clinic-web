-- Security hardening from the clinic-web audit of 19 September 2026.
-- Every change keeps the public RPC signatures the mobile apps call.
-- Deployed migrations stay immutable, so live functions are re-declared
-- through the same guarded string-patch pattern used by earlier migrations:
-- each patch fails closed if the live text is not the expected one.
--
-- DB-01  The public.clinic_* wrappers were SECURITY INVOKER, which forced
--        EXECUTE on 20 clinic_private implementations for `authenticated`.
--        Wrappers become SECURITY DEFINER (search_path already '') and the
--        implementation grants are revoked. Only the two RLS helper
--        functions stay callable by clients.
-- DB-02  audit_events.previous_value / new_value hold complete clinical
--        documents. Admin JWTs could read them through PostgREST with
--        select=new_value. SELECT is now granted per column; both clients
--        already request the safe column list.
-- DB-03  A document's file name extension was not bound to its content type
--        (a PDF could be stored as "report.html"), and finalize compared only
--        the stored size. begin_attachment now rejects a mismatched
--        extension; finalize also compares the Storage mimetype.
-- DB-04  Unbounded clinics per user and unbounded presence rows per doctor.
-- DB-05  patients.mobile bounded its digits but not its raw length.
-- DB-06  Default privileges gave every new table/sequence/function in
--        `public` to anon and authenticated. New objects are now private
--        until a migration grants access explicitly.

-- DB-01 -----------------------------------------------------------------------
do $body$
declare r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'clinic\_%'
      and p.proname<>'clinic_search_patients'   -- stays SECURITY INVOKER so RLS applies
  loop
    execute format('alter function %I.%I(%s) security definer set search_path=''''',
      r.nspname, r.proname, r.args);
  end loop;
end $body$;

revoke execute on all functions in schema clinic_private from public, anon, authenticated;
grant execute on function clinic_private.allowed(uuid,text) to authenticated;
grant execute on function clinic_private.attachment_object_allowed(text,boolean) to authenticated;
-- Future implementation functions are private by default.
alter default privileges for role postgres in schema clinic_private
  revoke execute on functions from public, anon, authenticated;

-- DB-02 -----------------------------------------------------------------------
revoke select on public.audit_events from authenticated;
grant select (id,clinic_id,actor_id,actor_role,action,object_type,object_id,occurred_at)
  on public.audit_events to authenticated;

-- DB-03 -----------------------------------------------------------------------
do $body$
declare source text; updated text;
begin
  source = pg_get_functiondef(
    'clinic_private.begin_attachment(uuid,uuid,uuid,uuid,text,text,text,text,bigint,boolean,text)'::regprocedure);
  if position('ATTACHMENT_EXTENSION' in source) > 0 then return; end if;
  updated = replace(source,
    $old$or p_sha256_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_ATTACHMENT';
  end if;$old$,
    $new$or p_sha256_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_ATTACHMENT';
  end if;
  -- A name may omit its extension, but a present extension must match the
  -- verified content type. Otherwise a PDF could be stored and later saved
  -- to disk as "report.html" or "scan.svg".
  if btrim(p_file_name) ~ '\.[A-Za-z][A-Za-z0-9]{0,9}$'
     and lower(substring(btrim(p_file_name) from '\.([A-Za-z][A-Za-z0-9]{0,9})$'))
     <> all (case p_content_type
       when 'image/jpeg' then array['jpg','jpeg']
       when 'image/png' then array['png']
       when 'image/webp' then array['webp']
       else array['pdf'] end) then
    raise exception 'ATTACHMENT_EXTENSION';
  end if;$new$);
  if updated = source or position('ATTACHMENT_EXTENSION' in updated) = 0 then
    raise exception 'Unexpected begin_attachment definition';
  end if;
  execute updated;
end $body$;

do $body$
declare source text; updated text;
begin
  source = pg_get_functiondef('clinic_private.finalize_attachment(uuid)'::regprocedure);
  if position('ATTACHMENT_TYPE_MISMATCH' in source) > 0 then return; end if;
  updated = replace(source,
    $old$v_stored_bytes bigint;$old$,
    $new$v_stored_bytes bigint;
  v_stored_type text;$new$);
  updated = replace(updated,
    $old$then (o.metadata->>'size')::bigint end into v_stored_bytes$old$,
    $new$then (o.metadata->>'size')::bigint end, o.metadata->>'mimetype'
    into v_stored_bytes, v_stored_type$new$);
  updated = replace(updated,
    $old$raise exception 'ATTACHMENT_SIZE_MISMATCH'; end if;$old$,
    $new$raise exception 'ATTACHMENT_SIZE_MISMATCH'; end if;
  if v_stored_type is not null and v_stored_type<>v_attachment.content_type then
    raise exception 'ATTACHMENT_TYPE_MISMATCH'; end if;$new$);
  if updated = source
     or position('v_stored_type text;' in updated) = 0
     or position('into v_stored_bytes, v_stored_type' in updated) = 0
     or position('ATTACHMENT_TYPE_MISMATCH' in updated) = 0 then
    raise exception 'Unexpected finalize_attachment definition';
  end if;
  execute updated;
end $body$;

-- DB-04 -----------------------------------------------------------------------
do $body$
declare source text; updated text;
begin
  source = pg_get_functiondef('clinic_private.create_clinic(text)'::regprocedure);
  if position('CLINIC_LIMIT' in source) > 0 then return; end if;
  updated = replace(source,
    $old$insert into public.clinics(name) values(btrim(p_name)) returning id into v_id;$old$,
    $new$perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,4));
  if (select count(*) from public.clinic_memberships
      where user_id=auth.uid() and role='doctor') >= 20 then
    raise exception 'CLINIC_LIMIT';
  end if;
  insert into public.clinics(name) values(btrim(p_name)) returning id into v_id;$new$);
  if updated = source or position('CLINIC_LIMIT' in updated) = 0 then
    raise exception 'Unexpected create_clinic definition';
  end if;
  execute updated;
end $body$;

do $body$
declare source text; updated text;
begin
  source = pg_get_functiondef('clinic_private.clinic_doctor_heartbeat(uuid,uuid)'::regprocedure);
  if position('device rows per doctor' in source) > 0 then return; end if;
  updated = replace(source,
    $old$v_expires=v_now+interval '60 seconds';$old$,
    $new$v_expires=v_now+interval '60 seconds';
  -- Keep at most ten device rows per doctor (this device plus the nine most
  -- recently seen). Rows cited by an immutable receipt are never removed.
  delete from clinic_private.doctor_device_presence p
  where p.clinic_id=p_clinic_id and p.doctor_id=auth.uid() and p.device_id<>p_device_id
    and not exists(select 1 from clinic_private.appointment_receipts r
      where (r.clinic_id,r.doctor_id,r.device_id)=(p.clinic_id,p.doctor_id,p.device_id))
    and p.device_id in (
      select q.device_id from clinic_private.doctor_device_presence q
      where q.clinic_id=p_clinic_id and q.doctor_id=auth.uid() and q.device_id<>p_device_id
      order by q.last_seen_at desc, q.device_id offset 9);$new$);
  if updated = source or position('device rows per doctor' in updated) = 0 then
    raise exception 'Unexpected clinic_doctor_heartbeat definition';
  end if;
  execute updated;
end $body$;

-- DB-05 -----------------------------------------------------------------------
alter table public.patients
  add constraint patients_mobile_bound check (length(mobile) <= 40);

-- DB-06 -----------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

-- Verification: fail the migration if any expectation does not hold ----------
do $body$
begin
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'clinic\_%'
        and p.proname<>'clinic_search_patients' and not p.prosecdef) then
    raise exception 'A public clinic wrapper is still SECURITY INVOKER';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='clinic_private'
        and p.proname not in ('allowed','attachment_object_allowed')
        and has_function_privilege('authenticated', p.oid, 'execute')) then
    raise exception 'A clinic_private implementation is still executable by authenticated';
  end if;
  if has_column_privilege('authenticated','public.audit_events','new_value','select')
     or has_column_privilege('authenticated','public.audit_events','previous_value','select') then
    raise exception 'audit_events payload columns are still readable';
  end if;
  if not has_column_privilege('authenticated','public.audit_events','action','select') then
    raise exception 'audit_events metadata columns lost their grant';
  end if;
end $body$;
