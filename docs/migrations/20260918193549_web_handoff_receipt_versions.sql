-- A return-to-queue followed by another handoff needs a fresh receipt.
-- Keep historical acknowledgements immutable and preserve mobile RPC signatures.
alter table clinic_private.appointment_receipts drop constraint appointment_receipts_pkey;
alter table clinic_private.appointment_receipts
  add primary key (clinic_id,appointment_id,appointment_version);

create or replace function clinic_private.clinic_doctor_delivery_state(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_appointment_id uuid default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_expires timestamptz;
  v_receipt clinic_private.appointment_receipts%rowtype;
begin
  if auth.uid() is null or not clinic_private.allowed(p_clinic_id) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.clinic_memberships
    where clinic_id=p_clinic_id and user_id=p_doctor_id
      and active and role='doctor'
  ) then raise exception 'INVALID_DOCTOR'; end if;
  if p_appointment_id is not null and not exists(
    select 1 from public.appointments
    where clinic_id=p_clinic_id and id=p_appointment_id
      and doctor_id=p_doctor_id
  ) then raise exception 'NOT_FOUND'; end if;
  select max(expires_at) into v_expires
  from clinic_private.doctor_device_presence
  where clinic_id=p_clinic_id and doctor_id=p_doctor_id;
  if p_appointment_id is not null then
    select * into v_receipt
    from clinic_private.appointment_receipts
    where clinic_id=p_clinic_id and appointment_id=p_appointment_id
      and appointment_version=(select a.version from public.appointments a
        where a.clinic_id=p_clinic_id and a.id=p_appointment_id);
  end if;
  return jsonb_build_object(
    'server_now',v_now,
    'doctor_online',coalesce(v_expires>v_now,false),
    'presence_expires_at',v_expires,
    'acknowledged_at',v_receipt.acknowledged_at,
    'appointment_version',v_receipt.appointment_version
  );
end $$;

create or replace function clinic_private.clinic_acknowledge_appointment(
  p_clinic_id uuid,
  p_appointment_id uuid,
  p_device_id uuid,
  p_operation_id uuid,
  p_expected_version integer
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_appointment public.appointments%rowtype;
  v_receipt clinic_private.appointment_receipts%rowtype;
  v_expires timestamptz;
begin
  if auth.uid() is null or p_device_id is null or p_operation_id is null
     or p_expected_version is null or p_expected_version<1 or not exists(
    select 1 from public.clinic_memberships m
    join public.clinics c on c.id=m.clinic_id
    where m.clinic_id=p_clinic_id and m.user_id=auth.uid()
      and m.active and m.role='doctor' and not c.archived
  ) then raise exception 'FORBIDDEN' using errcode='42501'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_clinic_id::text||auth.uid()::text||p_operation_id::text,3)
  );
  select * into v_receipt
  from clinic_private.appointment_receipts
  where clinic_id=p_clinic_id and doctor_id=auth.uid()
    and operation_id=p_operation_id;
  if found then
    if v_receipt.appointment_id<>p_appointment_id then
      raise exception 'OPERATION_ID_REUSED';
    end if;
    select expires_at into v_expires
    from clinic_private.doctor_device_presence
    where (clinic_id,doctor_id,device_id)=(p_clinic_id,auth.uid(),v_receipt.device_id);
    return jsonb_build_object(
      'server_now',v_now,'doctor_online',coalesce(v_expires>v_now,false),
      'presence_expires_at',v_expires,
      'acknowledged_at',v_receipt.acknowledged_at,
      'appointment_version',v_receipt.appointment_version
    );
  end if;

  select * into v_appointment
  from public.appointments
  where clinic_id=p_clinic_id and id=p_appointment_id
  for update;
  if v_appointment.id is null or v_appointment.doctor_id<>auth.uid() then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  select * into v_receipt
  from clinic_private.appointment_receipts
  where clinic_id=p_clinic_id and appointment_id=p_appointment_id
    and appointment_version=v_appointment.version;
  if found then
    select expires_at into v_expires
    from clinic_private.doctor_device_presence
    where (clinic_id,doctor_id,device_id)=(p_clinic_id,auth.uid(),v_receipt.device_id);
    return jsonb_build_object(
      'server_now',v_now,'doctor_online',coalesce(v_expires>v_now,false),
      'presence_expires_at',v_expires,
      'acknowledged_at',v_receipt.acknowledged_at,
      'appointment_version',v_receipt.appointment_version
    );
  end if;
  if v_appointment.status<>'withDoctor' then raise exception 'ASSIGNMENT_CHANGED'; end if;
  if v_appointment.version<>p_expected_version then
    raise exception 'VERSION_CONFLICT' using detail=to_jsonb(v_appointment)::text;
  end if;
  select expires_at into v_expires
  from clinic_private.doctor_device_presence
  where (clinic_id,doctor_id,device_id)=(p_clinic_id,auth.uid(),p_device_id)
    and expires_at>v_now;
  if v_expires is null then raise exception 'DOCTOR_DEVICE_OFFLINE'; end if;

  insert into clinic_private.appointment_receipts(
    clinic_id,appointment_id,doctor_id,device_id,operation_id,
    appointment_version,acknowledged_at
  ) values(
    p_clinic_id,p_appointment_id,auth.uid(),p_device_id,p_operation_id,
    v_appointment.version,v_now
  ) returning * into v_receipt;
  insert into public.audit_events(
    clinic_id,actor_id,actor_role,action,object_type,object_id,new_value
  ) values(
    p_clinic_id,auth.uid(),'doctor','appointment.received','appointment',
    p_appointment_id,jsonb_build_object(
      'appointment_version',v_receipt.appointment_version,
      'acknowledged_at',v_receipt.acknowledged_at
    )
  );
  return jsonb_build_object(
    'server_now',v_now,'doctor_online',true,
    'presence_expires_at',v_expires,
    'acknowledged_at',v_receipt.acknowledged_at,
    'appointment_version',v_receipt.appointment_version
  );
end $$;
