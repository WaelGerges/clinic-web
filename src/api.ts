import { client, deviceId } from './client';
import {
  dayRange,
  detectMime,
  sha256,
  type Membership,
  type Patient,
  type Appointment,
  type Visit,
  type Delivery,
  type Attachment,
  type ScheduleData,
  type Staff,
  type Audit,
} from './domain';
export class ClinicError extends Error {
  constructor(
    message: string,
    public uncertain = false,
    public conflict = false,
    public access = false,
  ) {
    super(message);
  }
}
const messages: Record<string, string> = {
  VERSION_CONFLICT:
    'This record changed on another device. Your edits are still here. Close and reopen the record to review the latest version before saving again.',
  DOCTOR_BUSY: 'Another patient is with the doctor. Complete that visit first.',
  DOCTOR_OFFLINE: 'The doctor is offline. Wait for confirmed availability.',
  DOCTOR_DEVICE_OFFLINE: 'This device has not registered as online. Reconnect and retry.',
  ASSIGNMENT_CHANGED: 'The patient assignment changed. Refresh before continuing.',
  PATIENT_ACTIVE: 'This patient is still waiting or with the doctor.',
  PATIENT_ARCHIVED: 'This patient is archived. Restore the record first.',
  INVALID_TRANSITION: 'The appointment status changed. Refresh before continuing.',
  NOT_TODAYS_APPOINTMENT: 'Only today’s appointments can enter the queue.',
  DIAGNOSIS_REQUIRED: 'Add a diagnosis before completing the visit.',
  COMMAND_EXPIRED: 'This action expired. Refresh and confirm it again.',
  SLOT_UNAVAILABLE: 'This time overlaps another appointment.',
  OUTSIDE_WORKING_HOURS: 'Choose a time within working hours and outside breaks.',
  INVALID_DURATION: 'Choose a duration between 5 and 240 minutes.',
  PAST_APPOINTMENT: 'Choose a future appointment time.',
  EMPTY_SCHEDULE: 'Add a working period or clear working hours.',
  INVALID_SCHEDULE: 'Check working periods for overlaps and invalid times.',
  AMENDMENT_REASON_REQUIRED: 'Explain the amendment in 10 to 1000 characters.',
  COMPLETED_VISIT_IMMUTABLE: 'Completed visits require an amendment.',
  AMENDMENT_NOT_ASSIGNED_DOCTOR: 'Only the doctor who recorded this visit can amend it.',
  ATTACHMENT_SIZE_MISMATCH: 'The document failed its integrity check.',
  ATTACHMENT_OBJECT_MISSING: 'The document upload is not complete.',
  INVALID_ATTACHMENT_STATE: 'This document changed. Refresh before continuing.',
  INVALID_INVITE: 'This invitation is invalid or expired.',
  EMAIL_NOT_VERIFIED: 'Verify your email before creating or joining a clinic.',
};
export function serviceError(error: unknown): ClinicError {
  if (error instanceof ClinicError) return error;
  const e = error as { message?: string; code?: string; status?: number };
  if (e.code === '42501' || e.status === 401 || e.status === 403)
    return new ClinicError(
      'Your session or clinic access changed. Sign in again.',
      false,
      false,
      true,
    );
  if (e.message && messages[e.message])
    return new ClinicError(messages[e.message], false, e.message === 'VERSION_CONFLICT');
  const uncertain =
    !e.code ||
    /^(08|40|53|57P)/.test(e.code) ||
    ['55P03', '57014', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'].includes(e.code);
  return new ClinicError(
    uncertain
      ? 'The server response could not be confirmed. Retry the same action before making another change.'
      : 'The server rejected this change. Review the fields and your permissions.',
    uncertain,
  );
}
async function unwrap<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  try {
    const { data, error } = await query;
    if (error) throw error;
    return data as T;
  } catch (e) {
    throw serviceError(e);
  }
}
export const rpc = <T>(name: string, params: Record<string, unknown>) =>
  unwrap<T>(client.rpc(name, params));
export async function memberships(userId: string): Promise<Membership[]> {
  const rows = await unwrap<Membership[]>(
    client
      .from('clinic_memberships')
      .select('clinic_id,user_id,role,is_admin,clinical_read,active,clinics(name,time_zone)')
      .eq('user_id', userId)
      .eq('active', true),
  );
  return Promise.all(
    rows.map(async (row) => {
      const doctors = await unwrap<{ user_id: string }[]>(
        client
          .from('clinic_memberships')
          .select('user_id')
          .eq('clinic_id', row.clinic_id)
          .eq('role', 'doctor')
          .eq('active', true)
          .order('created_at')
          .order('user_id')
          .limit(1),
      );
      return { ...row, doctor_id: row.role === 'doctor' ? row.user_id : doctors[0]?.user_id || '' };
    }),
  );
}
export async function verifyMembership(m: Membership) {
  const row = await unwrap<Membership | null>(
    client
      .from('clinic_memberships')
      .select('active,role,is_admin,clinical_read')
      .eq('clinic_id', m.clinic_id)
      .eq('user_id', m.user_id)
      .maybeSingle(),
  );
  if (
    !row?.active ||
    row.role !== m.role ||
    row.is_admin !== m.is_admin ||
    row.clinical_read !== m.clinical_read
  )
    throw new ClinicError('Your clinic permissions changed. Sign in again.', false, false, true);
}
export interface Command {
  p_clinic_id: string;
  p_operation_id: string;
  p_entity_type: 'patient' | 'appointment' | 'visit';
  p_entity_id: string;
  p_action: string;
  p_payload: Record<string, unknown>;
  p_expected_version: number;
}
export interface Receipt<T> {
  entity: T;
  version: number;
  appointment?: Appointment;
}
export function prepareCommand(
  clinic: string,
  type: Command['p_entity_type'],
  id: string,
  action: string,
  payload: Record<string, unknown>,
  version: number,
): Command {
  return {
    p_clinic_id: clinic,
    p_operation_id: crypto.randomUUID(),
    p_entity_type: type,
    p_entity_id: id,
    p_action: action,
    p_payload: structuredClone({
      ...payload,
      ...(['status', 'send', 'complete', 'amend'].includes(action)
        ? { _expires_at: new Date(Date.now() + 60000).toISOString() }
        : {}),
    }),
    p_expected_version: version,
  };
}
export const executeCommand = <T>(command: Command) =>
  rpc<Receipt<T>>('clinic_apply_command', { ...command });
export const api = {
  patients: (clinic: string, search = '', offset = 0, archived = false) =>
    rpc<Patient[]>('clinic_search_patients', {
      p_clinic_id: clinic,
      p_search: search,
      p_offset: offset,
      p_limit: 50,
      p_archived: archived,
    }),
  patient: (clinic: string, id: string) =>
    unwrap<Patient>(client.from('patients').select().eq('clinic_id', clinic).eq('id', id).single()),
  patientIds: (clinic: string, ids: string[]) =>
    ids.length
      ? unwrap<Patient[]>(
          client
            .from('patients')
            .select()
            .eq('clinic_id', clinic)
            .in('id', [...new Set(ids)]),
        )
      : Promise.resolve([]),
  async appointments(clinic: string, doctor: string, date: string, zone: string) {
    const { from, to } = dayRange(date, zone);
    const rows: Appointment[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await unwrap<Appointment[]>(
        client
          .from('appointments')
          .select()
          .eq('clinic_id', clinic)
          .eq('doctor_id', doctor)
          .gte('starts_at', from)
          .lt('starts_at', to)
          .order('starts_at')
          .order('id')
          .range(offset, offset + 499),
      );
      rows.push(...page);
      if (page.length < 500) break;
    }
    return rows;
  },
  active: (clinic: string, doctor: string) =>
    unwrap<Appointment | null>(
      client
        .from('appointments')
        .select()
        .eq('clinic_id', clinic)
        .eq('doctor_id', doctor)
        .eq('status', 'withDoctor')
        .maybeSingle(),
    ),
  visits: (clinic: string, patient: string, offset = 0) =>
    unwrap<Visit[]>(
      client
        .from('visit_details')
        .select()
        .eq('clinic_id', clinic)
        .eq('patient_id', patient)
        .order('created_at', { ascending: false })
        .order('id')
        .range(offset, offset + 49),
    ),
  visitForAppointment: (clinic: string, appointment: string) =>
    unwrap<Visit | null>(
      client
        .from('visit_details')
        .select()
        .eq('clinic_id', clinic)
        .eq('appointment_id', appointment)
        .maybeSingle(),
    ),
  printable: (clinic: string, patient: string, id: string) =>
    unwrap<Visit>(
      client
        .from('visit_details')
        .select()
        .eq('clinic_id', clinic)
        .eq('patient_id', patient)
        .eq('id', id)
        .single(),
    ),
  delivery: (m: Membership, id?: string) =>
    rpc<Delivery>('clinic_doctor_delivery_state', {
      p_clinic_id: m.clinic_id,
      p_doctor_id: m.doctor_id,
      p_appointment_id: id ?? null,
    }),
  heartbeat: (m: Membership) =>
    rpc<Delivery>('clinic_doctor_heartbeat', { p_clinic_id: m.clinic_id, p_device_id: deviceId }),
  acknowledge: (m: Membership, a: Appointment, operation: string) =>
    rpc<Delivery>('clinic_acknowledge_appointment', {
      p_clinic_id: m.clinic_id,
      p_appointment_id: a.id,
      p_device_id: deviceId,
      p_operation_id: operation,
      p_expected_version: a.version,
    }),
  schedule: (m: Membership, action = 'read', payload: Record<string, unknown> = {}) =>
    rpc<ScheduleData>('clinic_schedule', {
      p_clinic_id: m.clinic_id,
      p_doctor_id: m.doctor_id,
      p_action: action,
      p_payload: payload,
    }),
  documents: (clinic: string, patient: string, offset = 0) =>
    unwrap<Attachment[]>(
      client
        .from('attachments')
        .select()
        .eq('clinic_id', clinic)
        .eq('patient_id', patient)
        .order('created_at', { ascending: false })
        .order('id')
        .range(offset, offset + 49),
    ),
  archiveDocument: (id: string, archived: boolean) =>
    rpc<Attachment>('clinic_set_attachment_archived', { p_id: id, p_archived: archived }),
  staff: (clinic: string) => rpc<Staff[]>('clinic_staff', { p_clinic_id: clinic }),
  invite: (clinic: string, email: string, clinical: boolean) =>
    rpc<{ id: string; code: string; email: string; expires_at: string }>(
      'clinic_invite_assistant',
      { p_clinic_id: clinic, p_email: email, p_clinical_read: clinical },
    ),
  staffAccess: (clinic: string, s: Staff) =>
    rpc('clinic_set_staff_access', {
      p_clinic_id: clinic,
      p_user_id: s.user_id,
      p_active: s.active,
      p_clinical_read: s.clinical_read,
    }),
  audit: (clinic: string, offset = 0) =>
    unwrap<Audit[]>(
      client
        .from('audit_events')
        .select('id,clinic_id,actor_id,actor_role,action,object_type,object_id,occurred_at')
        .eq('clinic_id', clinic)
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + 49),
    ),
};
export interface UploadIntent {
  id: string;
  file: File;
  buffer: ArrayBuffer;
  params: Record<string, unknown>;
  uploaded: boolean;
}
export async function prepareUpload(
  m: Membership,
  patient: Patient,
  file: File,
  category: string,
  notes: string,
  clinical: boolean,
  visitId: string | null,
): Promise<UploadIntent> {
  if (file.size < 1 || file.size > 20 * 1024 * 1024)
    throw new ClinicError('Choose a file no larger than 20 MB.');
  if (file.name.length > 180 || /[\\/\x00-\x1f]/.test(file.name))
    throw new ClinicError('Use a file name under 180 characters without slashes.');
  const buffer = await file.arrayBuffer(),
    mime = detectMime(new Uint8Array(buffer)),
    id = crypto.randomUUID();
  return {
    id,
    file,
    buffer,
    uploaded: false,
    params: {
      p_id: id,
      p_clinic_id: m.clinic_id,
      p_patient_id: patient.id,
      p_visit_id: visitId,
      p_file_name: file.name,
      p_content_type: mime,
      p_category: category,
      p_notes: notes,
      p_bytes: file.size,
      p_clinical: clinical,
      p_sha256_hex: await sha256(buffer),
    },
  };
}
export async function uploadDocument(intent: UploadIntent) {
  const row = await rpc<Attachment>('clinic_begin_attachment', intent.params);
  if (row.state === 'ready') return row;
  if (!intent.uploaded) {
    try {
      const { error } = await client.storage
        .from('clinic-documents')
        .upload(row.object_path, intent.buffer, {
          contentType: String(intent.params.p_content_type),
          upsert: false,
        });
      if (error && !/already exists|duplicate/i.test(error.message)) throw serviceError(error);
      intent.uploaded = true;
    } catch (error) {
      throw serviceError(error);
    }
  }
  return rpc<Attachment>('clinic_finalize_attachment', { p_id: intent.id });
}
export async function downloadDocument(doc: Attachment, purpose: 'preview' | 'download') {
  const grant = await rpc<{ object_path: string; bytes: number; sha256_hex: string }>(
    'clinic_authorize_attachment_access',
    { p_id: doc.id, p_purpose: purpose },
  );
  const blob = await unwrap<Blob>(
    client.storage.from('clinic-documents').download(grant.object_path),
  );
  const buffer = await blob.arrayBuffer();
  if (buffer.byteLength !== grant.bytes || (await sha256(buffer)) !== grant.sha256_hex)
    throw new ClinicError('The document failed its integrity check.');
  const mime = detectMime(new Uint8Array(buffer));
  if (mime !== doc.content_type)
    throw new ClinicError('The document type does not match its record.');
  return new Blob([buffer], { type: mime });
}
