import { Temporal } from '@js-temporal/polyfill';
export type Role = 'assistant' | 'doctor';
export interface Membership {
  clinic_id: string;
  user_id: string;
  role: Role;
  is_admin: boolean;
  clinical_read: boolean;
  active: boolean;
  clinics: { name: string; time_zone: string };
  doctor_id: string;
}
export interface Patient {
  id: string;
  clinic_id: string;
  patient_number: number;
  full_name: string;
  gender: string;
  birth_date: string;
  mobile: string;
  secondary_mobile: string;
  address: string;
  notes: string;
  alerts: string;
  archived: boolean;
  version: number;
  created_at?: string;
  updated_at?: string;
}
export type Status =
  | 'scheduled'
  | 'confirmed'
  | 'arrived'
  | 'waiting'
  | 'withDoctor'
  | 'completed'
  | 'cancelled'
  | 'noShow';
export interface Appointment {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string;
  starts_at: string;
  duration_minutes: number;
  appointment_type: string;
  notes: string;
  status: Status;
  version: number;
}
export interface Medication {
  id: string;
  name: string;
  strength: string;
  dose: string;
  frequency: string;
  duration: string;
  instructions: string;
  notes: string;
}
export interface Visit {
  id: string;
  clinic_id: string;
  patient_id: string;
  appointment_id: string;
  doctor_id: string;
  notes: string;
  follow_up: string;
  diagnoses: string[];
  medications: Medication[];
  completed: boolean;
  version: number;
  current_revision: number;
  amendment_reason?: string;
  created_at: string;
  updated_at?: string;
}
export interface Delivery {
  server_now: string;
  doctor_online: boolean;
  presence_expires_at: string | null;
  acknowledged_at: string | null;
  appointment_version: number | null;
}
export interface Attachment {
  id: string;
  clinic_id: string;
  patient_id: string;
  visit_id: string | null;
  file_name: string;
  content_type: string;
  category: string;
  notes: string;
  object_path: string;
  bytes: number;
  sha256_hex?: string;
  clinical: boolean;
  state: 'pending' | 'ready' | 'failed' | 'archived';
  uploaded_by: string;
  created_at: string;
  version: number;
}
export interface Period {
  weekday: number;
  start: number;
  end: number;
}
export interface ScheduleData {
  settings: { configured: boolean; periods: Period[] };
  waitlist: { id: string; patient_id: string; notes: string; created_at: string }[];
}
export interface Staff {
  user_id: string;
  email: string;
  role: Role;
  active: boolean;
  clinical_read: boolean;
}
export interface Audit {
  id: number;
  actor_id: string;
  actor_role: string;
  action: string;
  object_type: string;
  object_id: string;
  occurred_at: string;
}
export const terminal = (status: Status) => ['completed', 'cancelled', 'noShow'].includes(status);
export const transitions: Record<Status, Status[]> = {
  scheduled: ['confirmed', 'arrived', 'cancelled', 'noShow'],
  confirmed: ['arrived', 'cancelled', 'noShow'],
  arrived: ['waiting', 'cancelled'],
  waiting: ['cancelled'],
  withDoctor: ['waiting', 'cancelled'],
  completed: [],
  cancelled: [],
  noShow: [],
};
export const statusLabels: Record<Status, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  arrived: 'Arrived',
  waiting: 'Waiting',
  withDoctor: 'With doctor',
  completed: 'Completed',
  cancelled: 'Cancelled',
  noShow: 'No show',
};
export const clinicToday = (zone: string, now = Temporal.Now.instant()) =>
  now.toZonedDateTimeISO(zone).toPlainDate().toString();
export const addDays = (date: string, days: number) =>
  Temporal.PlainDate.from(date).add({ days }).toString();
export function dayRange(date: string, zone: string) {
  const start = Temporal.PlainDate.from(date).toZonedDateTime(zone);
  return {
    from: start.toInstant().toString(),
    to: Temporal.PlainDate.from(date).add({ days: 1 }).toZonedDateTime(zone).toInstant().toString(),
  };
}
export function localToUtc(date: string, time: string, zone: string) {
  return Temporal.PlainDateTime.from(date + 'T' + time)
    .toZonedDateTime(zone, { disambiguation: 'reject' })
    .toInstant()
    .toString();
}
export function clinicTime(iso: string, zone: string, locale = 'en') {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
export const localDate = (iso: string, zone: string) =>
  Temporal.Instant.from(iso).toZonedDateTimeISO(zone).toPlainDate().toString();
export function age(birth: string, today: string) {
  return Temporal.PlainDate.from(birth).until(Temporal.PlainDate.from(today), {
    largestUnit: 'years',
  }).years;
}
export function normalizePhone(value: string) {
  return value
    .replace(/[٠-٩۰-۹]/g, (c) =>
      String('٠١٢٣٤٥٦٧٨٩'.includes(c) ? '٠١٢٣٤٥٦٧٨٩'.indexOf(c) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)),
    )
    .replace(/[^0-9]/g, '');
}
export function patientPayload(p: Patient, doctor: boolean) {
  const { full_name, gender, birth_date, mobile, secondary_mobile, address, notes, archived } = p;
  return {
    full_name: full_name.trim(),
    gender,
    birth_date,
    mobile: normalizePhone(mobile),
    secondary_mobile,
    address,
    notes,
    archived,
    alerts: doctor || p.version > 0 ? p.alerts : '',
  };
}
export function validatePatient(p: Patient, today: string) {
  if (p.full_name.trim().length < 2 || p.full_name.trim().length > 300)
    throw new Error('Enter the patient’s full name.');
  if (!p.birth_date || p.birth_date < '1800-01-01' || p.birth_date > today)
    throw new Error('Enter a valid birth date.');
  Temporal.PlainDate.from(p.birth_date);
  if (!/^[0-9]{7,20}$/.test(normalizePhone(p.mobile)))
    throw new Error('Enter a phone number with 7–20 digits.');
}
export function validateVisit(v: Visit) {
  if (
    v.notes.length > 20000 ||
    v.follow_up.length > 5000 ||
    v.diagnoses.length > 50 ||
    v.diagnoses.some((x) => !x.trim() || x.length > 1000) ||
    v.medications.length > 100
  )
    throw new Error('Review the clinical field limits.');
  for (const m of v.medications)
    if (
      !m.name.trim() ||
      m.name.length > 300 ||
      [m.strength, m.dose, m.frequency, m.duration].some((x) => x.length > 200) ||
      m.instructions.length > 5000 ||
      m.notes.length > 5000
    )
      throw new Error('Review each medication and its name.');
}
export function visitPayload(v: Visit) {
  return {
    patient_id: v.patient_id,
    appointment_id: v.appointment_id,
    doctor_id: v.doctor_id,
    notes: v.notes,
    follow_up: v.follow_up,
    diagnoses: v.diagnoses.map((x) => x.trim()),
    medications: v.medications,
    amendment_reason: v.amendment_reason ?? '',
  };
}
export function availableSlots(
  date: string,
  zone: string,
  duration: number,
  periods: Period[],
  configured: boolean,
  appointments: Appointment[],
  now = Date.now(),
) {
  const weekday = Temporal.PlainDate.from(date).dayOfWeek;
  const work = configured
    ? periods.filter((p) => p.weekday === weekday)
    : [{ start: 540, end: 1020 }];
  const slots: string[] = [];
  for (const p of work)
    for (let m = p.start; m + duration <= p.end; m += 15) {
      const time =
        String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      try {
        const start = Date.parse(localToUtc(date, time, zone)),
          end = start + duration * 60000;
        if (
          start <= now ||
          appointments.some(
            (a) =>
              !['cancelled', 'noShow', 'completed'].includes(a.status) &&
              start < Date.parse(a.starts_at) + a.duration_minutes * 60000 &&
              end > Date.parse(a.starts_at),
          )
        )
          continue;
        slots.push(time);
      } catch {
        /* Skip a nonexistent/ambiguous local time at a DST transition. */
      }
    }
  return [...new Set(slots)].sort();
}
export function detectMime(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return 'image/png';
  const text = new TextDecoder().decode(bytes.slice(0, 12));
  if (text.startsWith('%PDF-')) return 'application/pdf';
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp';
  throw new Error('Choose a PDF, JPEG, PNG or WebP file.');
}
export async function sha256(buffer: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export const emptyMedication = (): Medication => ({
  id: crypto.randomUUID(),
  name: '',
  strength: '',
  dose: '',
  frequency: '',
  duration: '',
  instructions: '',
  notes: '',
});
