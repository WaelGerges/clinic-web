-- PROPOSAL — NOT APPLIED ANYWHERE.
-- Requires the assigned doctor's receipt for the current appointment version
-- before clinical notes can be written for that handoff. Uses the project's
-- guarded string-patch pattern against the live clinic_private.apply_command.
-- Review with the mobile team first: the Doctor app must acknowledge before it
-- queues visit saves in its offline outbox.
do $body$
declare source text; updated text;
begin
  source = pg_get_functiondef(
    'clinic_private.apply_command(uuid,uuid,text,uuid,text,jsonb,integer)'::regprocedure);
  if position('RECEIPT_REQUIRED' in source) > 0 then return; end if;
  updated = replace(source,
    $old$if v_appointment.id is null or v_appointment.doctor_id<>auth.uid() or v_appointment.status<>'withDoctor' then
      raise exception 'ASSIGNMENT_CHANGED'; end if;$old$,
    $new$if v_appointment.id is null or v_appointment.doctor_id<>auth.uid() or v_appointment.status<>'withDoctor' then
      raise exception 'ASSIGNMENT_CHANGED'; end if;
    if not exists(select 1 from clinic_private.appointment_receipts r
        where r.clinic_id=p_clinic_id and r.appointment_id=v_appointment.id
          and r.doctor_id=auth.uid() and r.appointment_version=v_appointment.version) then
      raise exception 'RECEIPT_REQUIRED'; end if;$new$);
  if updated = source or position('RECEIPT_REQUIRED' in updated) = 0 then
    raise exception 'Unexpected apply_command definition';
  end if;
  execute updated;
end $body$;
