// Live authorization matrix for the clinic backend (HTTP, end to end).
//
// Runs only against an explicitly authorized project with synthetic accounts.
// It creates two fixture clinics, a handful of marker patients/appointments,
// one 70-byte PNG document, and exercises every client-reachable surface
// (PostgREST tables, RPC wrappers, Storage) as each actor. It never prints
// tokens or passwords. Results are written as JSON to the path in
// AUDIT_RESULTS (default: ./live-authz-matrix-results.json).
//
// Required environment:
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
//   AUDIT_DOCTOR_A_EMAIL / AUDIT_DOCTOR_A_PASSWORD      confirmed synthetic user
//   AUDIT_DOCTOR_B_EMAIL / AUDIT_DOCTOR_B_PASSWORD      confirmed synthetic user
//   AUDIT_ASSISTANT_EMAIL / AUDIT_ASSISTANT_PASSWORD    confirmed synthetic user
//   AUDIT_CLINICAL_EMAIL / AUDIT_CLINICAL_PASSWORD      confirmed synthetic user
//   AUDIT_NOBODY_EMAIL / AUDIT_NOBODY_PASSWORD          confirmed synthetic user, never joins
//
// Fixture rows stay in the database for the cleanup step documented in
// TEST-RESULTS.md; this script records every identifier it created.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required');
const users = {
  docA: ['AUDIT_DOCTOR_A_EMAIL', 'AUDIT_DOCTOR_A_PASSWORD'],
  docB: ['AUDIT_DOCTOR_B_EMAIL', 'AUDIT_DOCTOR_B_PASSWORD'],
  asst: ['AUDIT_ASSISTANT_EMAIL', 'AUDIT_ASSISTANT_PASSWORD'],
  clin: ['AUDIT_CLINICAL_EMAIL', 'AUDIT_CLINICAL_PASSWORD'],
  nobody: ['AUDIT_NOBODY_EMAIL', 'AUDIT_NOBODY_PASSWORD'],
};
const results = [],
  created = {
    clinics: [],
    patients: [],
    appointments: [],
    visits: [],
    attachments: [],
    objectPaths: [],
    users: {},
  };
const token = {},
  uid = {};

function record(id, actor, operation, expected, actual, evidence, ok) {
  results.push({ id, actor, operation, expected, actual, ok, evidence });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${id} ${actor} ${operation} -> ${actual}\n`);
}
async function signIn(name) {
  const [e, p] = users[name];
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env[e], password: process.env[p] }),
  });
  const body = await r.json();
  if (!r.ok)
    throw new Error(
      `sign-in failed for ${name}: ${body.error_description || body.msg || r.status}`,
    );
  token[name] = body.access_token;
  uid[name] = body.user.id;
  created.users[name] = body.user.id;
}
const headers = (actor, extra = {}) => ({
  apikey: key,
  ...(actor === 'anon' ? {} : { authorization: `Bearer ${token[actor]}` }),
  ...extra,
});
async function rest(actor, path, init = {}) {
  const r = await fetch(`${url}${path}`, {
    ...init,
    headers: headers(actor, { 'content-type': 'application/json', ...(init.headers || {}) }),
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}
const rpc = (actor, fn, params) =>
  rest(actor, `/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(params) });
const summary = (res) =>
  res.status +
  ' ' +
  (Array.isArray(res.body)
    ? `${res.body.length} rows`
    : (res.body && res.body.message) ||
      (res.body && typeof res.body === 'object' ? 'object' : String(res.body).slice(0, 40)));
const denied = (res) =>
  res.status === 401 || res.status === 403 || (res.body && res.body.code === '42501');
const isError = (res, needle) =>
  res.status >= 400 &&
  res.body &&
  typeof res.body.message === 'string' &&
  res.body.message.includes(needle);
const empty = (res) => res.status === 200 && Array.isArray(res.body) && res.body.length === 0;

function command(clinic, type, id, action, payload, version, op = randomUUID(), expires = 60000) {
  const critical =
    (type === 'appointment' && ['status', 'send'].includes(action)) ||
    (type === 'visit' && ['complete', 'amend'].includes(action));
  return {
    p_clinic_id: clinic,
    p_operation_id: op,
    p_entity_type: type,
    p_entity_id: id,
    p_action: action,
    p_payload: critical
      ? { _expires_at: new Date(Date.now() + expires).toISOString(), ...payload }
      : payload,
    p_expected_version: version,
  };
}
const patientInput = (name) => ({
  full_name: name,
  gender: 'Female',
  birth_date: '1990-04-12',
  mobile: '01000000000',
  secondary_mobile: '',
  address: 'Audit fixture',
  notes: 'AUDIT FIXTURE - synthetic',
  alerts: '',
  archived: false,
});
function todaySlot(i) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  // 23:00 Cairo plus i minutes keeps the slot in "today" (Cairo) and in the future for most of the day.
  const base = Date.parse(`${day}T23:00:00+03:00`);
  return new Date(Math.max(base, Date.now() + 5 * 60000) + i * 5 * 60000).toISOString();
}
// 1x1 transparent PNG (70 bytes)
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const sha256 = async (buf) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', buf)).toString('hex');

async function main() {
  for (const name of Object.keys(users)) await signIn(name);
  const A = 'AUDIT FIXTURE clinic A ' + randomUUID().slice(0, 8),
    B = 'AUDIT FIXTURE clinic B ' + randomUUID().slice(0, 8);

  // ---- Positive setup through the real contract -------------------------------
  let r = await rpc('docA', 'clinic_create', { p_name: A });
  record('SETUP-01', 'docA', 'clinic_create A', 'uuid', summary(r), r.body, r.status === 200);
  const clinicA = r.body;
  created.clinics.push(clinicA);
  r = await rpc('docB', 'clinic_create', { p_name: B });
  record('SETUP-02', 'docB', 'clinic_create B', 'uuid', summary(r), r.body, r.status === 200);
  const clinicB = r.body;
  created.clinics.push(clinicB);

  r = await rpc('docA', 'clinic_invite_assistant', {
    p_clinic_id: clinicA,
    p_email: process.env.AUDIT_ASSISTANT_EMAIL,
    p_clinical_read: false,
  });
  record(
    'SETUP-03',
    'docA',
    'invite assistant (no clinical)',
    'code',
    r.status + ' ' + (r.body.code ? 'code issued' : summary(r)),
    { id: r.body.id },
    r.status === 200,
  );
  let j = await rpc('asst', 'clinic_join', { p_code: r.body.code });
  record('SETUP-04', 'asst', 'clinic_join', 'clinic A id', summary(j), j.body, j.body === clinicA);
  j = await rpc('asst', 'clinic_join', { p_code: r.body.code });
  record(
    'INV-01',
    'asst',
    'reuse consumed invitation code',
    'INVITATION_INVALID',
    summary(j),
    j.body,
    isError(j, 'INVITATION_INVALID'),
  );
  j = await rpc('nobody', 'clinic_join', { p_code: r.body.code });
  record(
    'INV-02',
    'nobody',
    "consume another user's code",
    'INVITATION_INVALID',
    summary(j),
    j.body,
    isError(j, 'INVITATION_INVALID'),
  );

  r = await rpc('docA', 'clinic_invite_assistant', {
    p_clinic_id: clinicA,
    p_email: process.env.AUDIT_CLINICAL_EMAIL,
    p_clinical_read: true,
  });
  j = await rpc('clin', 'clinic_join', { p_code: r.body.code });
  record(
    'SETUP-05',
    'clin',
    'clinic_join with clinical_read',
    'clinic A id',
    summary(j),
    j.body,
    j.body === clinicA,
  );
  r = await rpc('docB', 'clinic_invite_assistant', {
    p_clinic_id: clinicA,
    p_email: 'x@example.test',
    p_clinical_read: false,
  });
  record('AUTHZ-01', 'docB', 'invite into clinic A', 'FORBIDDEN', summary(r), r.body, denied(r));
  r = await rpc('asst', 'clinic_invite_assistant', {
    p_clinic_id: clinicA,
    p_email: 'x@example.test',
    p_clinical_read: true,
  });
  record('AUTHZ-02', 'asst', 'invite (not admin)', 'FORBIDDEN', summary(r), r.body, denied(r));

  const pA = randomUUID();
  r = await rpc(
    'asst',
    'clinic_apply_command',
    command(
      clinicA,
      'patient',
      pA,
      'save',
      patientInput("AUDIT Marker <script>alert(1)</script> ' OR 1=1 --"),
      0,
    ),
  );
  record(
    'POS-01',
    'asst',
    'create patient (with injection markers)',
    'receipt, verbatim text',
    summary(r),
    { name: r.body.entity && r.body.entity.full_name },
    r.status === 200 && r.body.entity.full_name.includes('<script>'),
  );
  created.patients.push(pA);
  const patientA = r.body.entity;

  // ---- Cross-clinic reads -------------------------------------------------------
  r = await rest('docB', `/rest/v1/patients?select=id,full_name&clinic_id=eq.${clinicA}`);
  record(
    'XC-01',
    'docB',
    'read clinic A patients by clinic filter',
    '0 rows',
    summary(r),
    null,
    empty(r),
  );
  r = await rest('docB', `/rest/v1/patients?select=id&id=eq.${pA}`);
  record('XC-02', 'docB', 'read clinic A patient by id', '0 rows', summary(r), null, empty(r));
  r = await rest('nobody', `/rest/v1/patients?select=id`);
  record('XC-03', 'nobody', 'read any patients', '0 rows', summary(r), null, empty(r));
  r = await rest('anon', `/rest/v1/patients?select=id`);
  record('XC-04', 'anon', 'read any patients', '401/42501', summary(r), null, denied(r));
  r = await rpc('docB', 'clinic_search_patients', { p_clinic_id: clinicA, p_search: 'AUDIT' });
  record(
    'XC-05',
    'docB',
    'search clinic A patients (invoker RPC)',
    '0 rows or denied',
    summary(r),
    null,
    empty(r) || denied(r),
  );
  r = await rpc('asst', 'clinic_search_patients', {
    p_clinic_id: clinicA,
    p_search: "' OR 1=1 --",
  });
  record(
    'INJ-01',
    'asst',
    'search with SQL marker',
    'no error, only clinic A rows',
    summary(r),
    null,
    r.status === 200 && Array.isArray(r.body) && r.body.every((p) => p.clinic_id === clinicA),
  );
  r = await rest('docB', `/rest/v1/clinic_memberships?select=user_id,role&clinic_id=eq.${clinicA}`);
  record('XC-06', 'docB', 'read clinic A memberships', '0 rows', summary(r), null, empty(r));
  r = await rest('asst', `/rest/v1/clinic_memberships?select=user_id,role,is_admin`);
  record(
    'XC-07',
    'asst',
    'read memberships visible to an assistant',
    'own + doctor rows only',
    summary(r),
    r.body,
    r.status === 200 && r.body.every((m) => m.user_id === uid.asst || m.role === 'doctor'),
  );

  // ---- Cross-clinic and privilege writes ---------------------------------------
  r = await rpc(
    'docB',
    'clinic_apply_command',
    command(clinicA, 'patient', randomUUID(), 'save', patientInput('AUDIT intruder'), 0),
  );
  record('XC-08', 'docB', 'create patient in clinic A', 'FORBIDDEN', summary(r), r.body, denied(r));
  r = await rpc(
    'docB',
    'clinic_apply_command',
    command(clinicB, 'patient', pA, 'save', patientInput('AUDIT hijack'), 0),
  );
  record(
    'XC-09',
    'docB',
    'reuse clinic A patient id inside clinic B',
    'CROSS_CLINIC_ID',
    summary(r),
    r.body,
    isError(r, 'CROSS_CLINIC_ID'),
  );
  r = await rpc(
    'docB',
    'clinic_apply_command',
    command(
      clinicB,
      'appointment',
      randomUUID(),
      'save',
      {
        patient_id: pA,
        doctor_id: uid.docB,
        starts_at: todaySlot(1),
        duration_minutes: 30,
        appointment_type: 'Consultation',
        notes: '',
      },
      0,
    ),
  );
  record(
    'XC-10',
    'docB',
    'book clinic A patient in clinic B',
    'INVALID_PATIENT',
    summary(r),
    r.body,
    isError(r, 'INVALID_PATIENT'),
  );
  r = await rpc(
    'nobody',
    'clinic_apply_command',
    command(clinicA, 'patient', randomUUID(), 'save', patientInput('AUDIT nobody'), 0),
  );
  record(
    'XC-11',
    'nobody',
    'create patient in clinic A',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rest('asst', `/rest/v1/patients`, {
    method: 'POST',
    body: JSON.stringify({
      ...patientInput('AUDIT direct insert'),
      id: randomUUID(),
      clinic_id: clinicA,
      patient_number: 1,
    }),
  });
  record('PRIV-01', 'asst', 'direct INSERT into patients', '42501', summary(r), r.body, denied(r));
  r = await rest('asst', `/rest/v1/clinic_memberships?user_id=eq.${uid.asst}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_admin: true, role: 'doctor', clinical_read: true }),
  });
  record('PRIV-02', 'asst', 'direct UPDATE own membership', '42501', summary(r), r.body, denied(r));
  r = await rest('asst', `/rest/v1/patients?id=eq.${pA}`, { method: 'DELETE' });
  record('PRIV-03', 'asst', 'direct DELETE patient', '42501', summary(r), r.body, denied(r));
  r = await rpc(
    'asst',
    'clinic_apply_command',
    command(
      clinicA,
      'patient',
      pA,
      'save',
      { ...patientInput(patientA.full_name), alerts: 'Assistant wrote an allergy' },
      patientA.version,
    ),
  );
  record(
    'PRIV-04',
    'asst',
    'assistant edits clinical alerts',
    'FORBIDDEN_ALERT_EDIT',
    summary(r),
    r.body,
    isError(r, 'FORBIDDEN_ALERT_EDIT') || denied(r),
  );
  r = await rpc('asst', 'clinic_set_staff_access', {
    p_clinic_id: clinicA,
    p_user_id: uid.clin,
    p_active: false,
    p_clinical_read: false,
  });
  record(
    'PRIV-05',
    'asst',
    'assistant changes staff access',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rpc('asst', 'clinic_staff', { p_clinic_id: clinicA });
  record(
    'PRIV-06',
    'asst',
    'assistant lists staff emails',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rpc('asst', 'clinic_schedule', {
    p_clinic_id: clinicA,
    p_doctor_id: uid.docA,
    p_action: 'settings',
    p_payload: { periods: [{ weekday: 1, start: 540, end: 1020 }] },
  });
  record(
    'PRIV-07',
    'asst',
    'assistant sets working hours',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rpc('asst', 'clinic_schedule', {
    p_clinic_id: clinicA,
    p_doctor_id: uid.docA,
    p_action: 'waitlist_add',
    p_payload: { patient_id: pA, notes: 'AUDIT waitlist' },
  });
  record(
    'POS-02',
    'asst',
    'assistant adds waitlist entry',
    'settings+waitlist',
    summary(r),
    null,
    r.status === 200 && r.body.waitlist && r.body.waitlist.length === 1,
  );
  r = await rpc('docB', 'clinic_schedule', {
    p_clinic_id: clinicA,
    p_doctor_id: uid.docA,
    p_action: 'read',
    p_payload: {},
  });
  record('XC-12', 'docB', 'read clinic A schedule', 'FORBIDDEN', summary(r), r.body, denied(r));
  r = await rpc('asst', 'clinic_doctor_heartbeat', {
    p_clinic_id: clinicA,
    p_device_id: randomUUID(),
  });
  record(
    'PRIV-08',
    'asst',
    'assistant registers doctor presence',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rpc('docB', 'clinic_doctor_heartbeat', {
    p_clinic_id: clinicA,
    p_device_id: randomUUID(),
  });
  record(
    'XC-13',
    'docB',
    'doctor B presence in clinic A',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rest('asst', `/rest/v1/rpc/apply_command`, {
    method: 'POST',
    headers: { 'content-profile': 'clinic_private' },
    body: JSON.stringify(
      command(clinicA, 'patient', randomUUID(), 'save', patientInput('AUDIT private'), 0),
    ),
  });
  record(
    'PRIV-09',
    'asst',
    'call clinic_private implementation via schema profile',
    'PGRST106 invalid schema',
    summary(r),
    r.body,
    r.status === 406 || (r.body && r.body.code === 'PGRST106'),
  );

  // ---- Clinical read boundary -----------------------------------------------------
  const deviceA = randomUUID();
  r = await rpc('docA', 'clinic_doctor_heartbeat', { p_clinic_id: clinicA, p_device_id: deviceA });
  record(
    'POS-03',
    'docA',
    'doctor presence',
    'doctor_online true',
    summary(r),
    null,
    r.status === 200 && r.body.doctor_online === true,
  );
  const apptId = randomUUID();
  r = await rpc(
    'asst',
    'clinic_apply_command',
    command(
      clinicA,
      'appointment',
      apptId,
      'save',
      {
        patient_id: pA,
        doctor_id: uid.docA,
        starts_at: todaySlot(2),
        duration_minutes: 30,
        appointment_type: 'Consultation',
        notes: 'AUDIT',
      },
      0,
    ),
  );
  record('POS-04', 'asst', 'book appointment', 'receipt', summary(r), null, r.status === 200);
  created.appointments.push(apptId);
  let appt = r.body.entity;
  r = await rpc(
    'asst',
    'clinic_apply_command',
    command(clinicA, 'appointment', apptId, 'status', { status: 'withDoctor' }, appt.version),
  );
  record(
    'WF-01',
    'asst',
    'skip queue: scheduled -> withDoctor via status',
    'INVALID_TRANSITION',
    summary(r),
    r.body,
    isError(r, 'INVALID_TRANSITION'),
  );
  r = await rpc(
    'asst',
    'clinic_apply_command',
    command(clinicA, 'appointment', apptId, 'status', { status: 'arrived' }, appt.version),
  );
  appt = r.body.entity;
  r = await rpc(
    'asst',
    'clinic_apply_command',
    command(clinicA, 'appointment', apptId, 'status', { status: 'waiting' }, appt.version),
  );
  record('POS-05', 'asst', 'arrived -> waiting', 'receipt', summary(r), null, r.status === 200);
  appt = r.body.entity;
  r = await rpc(
    'asst',
    'clinic_apply_command',
    command(clinicA, 'appointment', apptId, 'send', {}, appt.version - 1),
  );
  record(
    'WF-02',
    'asst',
    'send with stale version',
    'VERSION_CONFLICT',
    summary(r),
    { code: r.body.message },
    isError(r, 'VERSION_CONFLICT'),
  );
  r = await rpc(
    'asst',
    'clinic_apply_command',
    command(clinicA, 'appointment', apptId, 'send', {}, appt.version, randomUUID(), -1000),
  );
  record(
    'WF-03',
    'asst',
    'send with expired intent',
    'COMMAND_EXPIRED',
    summary(r),
    r.body,
    isError(r, 'COMMAND_EXPIRED'),
  );
  const sendOp = randomUUID();
  // A client retry re-sends the identical command (same operation id, payload,
  // expiry and expected version), exactly as the web client's prepareCommand does.
  const sendCommand = command(clinicA, 'appointment', apptId, 'send', {}, appt.version, sendOp);
  r = await rpc('asst', 'clinic_apply_command', sendCommand);
  record(
    'POS-06',
    'asst',
    'send to doctor',
    'withDoctor',
    summary(r),
    null,
    r.status === 200 && r.body.entity.status === 'withDoctor',
  );
  appt = r.body.entity;
  const replay = await rpc('asst', 'clinic_apply_command', sendCommand);
  record(
    'WF-04',
    'asst',
    'replay same operation id after commit',
    'identical receipt, no second handoff',
    summary(replay),
    null,
    replay.status === 200 && replay.body.entity.version === appt.version,
  );
  r = await rpc(
    'asst',
    'clinic_apply_command',
    command(
      clinicA,
      'appointment',
      apptId,
      'status',
      { status: 'cancelled' },
      appt.version,
      sendOp,
    ),
  );
  record(
    'WF-05',
    'asst',
    'reuse operation id with a different request',
    'OPERATION_ID_REUSED',
    summary(r),
    r.body,
    isError(r, 'OPERATION_ID_REUSED'),
  );

  const ackOp = randomUUID();
  r = await rpc('docB', 'clinic_acknowledge_appointment', {
    p_clinic_id: clinicA,
    p_appointment_id: apptId,
    p_device_id: deviceA,
    p_operation_id: ackOp,
    p_expected_version: appt.version,
  });
  record(
    'XC-14',
    'docB',
    'acknowledge clinic A handoff',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rpc('asst', 'clinic_acknowledge_appointment', {
    p_clinic_id: clinicA,
    p_appointment_id: apptId,
    p_device_id: deviceA,
    p_operation_id: ackOp,
    p_expected_version: appt.version,
  });
  record(
    'PRIV-10',
    'asst',
    'assistant acknowledges handoff',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rpc('docA', 'clinic_acknowledge_appointment', {
    p_clinic_id: clinicA,
    p_appointment_id: apptId,
    p_device_id: randomUUID(),
    p_operation_id: ackOp,
    p_expected_version: appt.version,
  });
  record(
    'WF-06',
    'docA',
    'acknowledge from an unregistered device',
    'DOCTOR_DEVICE_OFFLINE',
    summary(r),
    r.body,
    isError(r, 'DOCTOR_DEVICE_OFFLINE'),
  );
  r = await rpc('docA', 'clinic_acknowledge_appointment', {
    p_clinic_id: clinicA,
    p_appointment_id: apptId,
    p_device_id: deviceA,
    p_operation_id: ackOp,
    p_expected_version: appt.version,
  });
  record(
    'POS-07',
    'docA',
    'acknowledge handoff',
    'acknowledged_at set',
    summary(r),
    null,
    r.status === 200 && r.body.acknowledged_at && r.body.appointment_version === appt.version,
  );

  const visitId = randomUUID();
  const visitPayload = {
    patient_id: pA,
    appointment_id: apptId,
    doctor_id: uid.docA,
    notes: 'AUDIT clinical note <img src=x onerror=alert(1)>',
    follow_up: '',
    diagnoses: ['AUDIT diagnosis'],
    medications: [
      {
        id: randomUUID(),
        name: 'Fictional drug',
        strength: '',
        dose: '',
        frequency: '',
        duration: '',
        instructions: '',
        notes: '',
      },
    ],
    amendment_reason: '',
  };
  r = await rpc(
    'asst',
    'clinic_apply_command',
    command(clinicA, 'visit', visitId, 'save', visitPayload, 0),
  );
  record('PRIV-11', 'asst', 'assistant writes a visit', 'FORBIDDEN', summary(r), r.body, denied(r));
  r = await rpc(
    'clin',
    'clinic_apply_command',
    command(clinicA, 'visit', visitId, 'save', visitPayload, 0),
  );
  record(
    'PRIV-12',
    'clin',
    'clinical-read assistant writes a visit',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rpc(
    'docB',
    'clinic_apply_command',
    command(clinicA, 'visit', visitId, 'save', visitPayload, 0),
  );
  record(
    'XC-15',
    'docB',
    'doctor B writes a clinic A visit',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rpc(
    'docA',
    'clinic_apply_command',
    command(clinicA, 'visit', visitId, 'save', visitPayload, 0),
  );
  record('POS-08', 'docA', 'save visit draft', 'receipt', summary(r), null, r.status === 200);
  created.visits.push(visitId);
  let visit = r.body.entity;
  r = await rest('asst', `/rest/v1/visit_details?select=id,notes&patient_id=eq.${pA}`);
  record(
    'CLIN-01',
    'asst',
    'read visit_details without clinical_read',
    '0 rows',
    summary(r),
    null,
    empty(r),
  );
  r = await rest('asst', `/rest/v1/diagnoses?select=description&visit_id=eq.${visitId}`);
  record(
    'CLIN-02',
    'asst',
    'read diagnoses without clinical_read',
    '0 rows',
    summary(r),
    null,
    empty(r),
  );
  r = await rest('clin', `/rest/v1/visit_details?select=id,notes&patient_id=eq.${pA}`);
  record(
    'CLIN-03',
    'clin',
    'read visit_details with clinical_read',
    '1 row, verbatim note',
    summary(r),
    null,
    r.status === 200 && r.body.length === 1 && r.body[0].notes.includes('<img'),
  );
  r = await rest('docB', `/rest/v1/visit_details?select=id&id=eq.${visitId}`);
  record('XC-16', 'docB', 'read clinic A visit by id', '0 rows', summary(r), null, empty(r));
  r = await rpc(
    'docA',
    'clinic_apply_command',
    command(clinicA, 'visit', visitId, 'complete', {}, visit.version),
  );
  record(
    'POS-09',
    'docA',
    'complete visit',
    'completed',
    summary(r),
    null,
    r.status === 200 && r.body.entity.completed === true,
  );
  visit = r.body.entity;
  r = await rpc(
    'docA',
    'clinic_apply_command',
    command(clinicA, 'visit', visitId, 'save', visitPayload, visit.version),
  );
  record(
    'WF-07',
    'docA',
    'edit completed visit without amendment',
    'COMPLETED_VISIT_IMMUTABLE',
    summary(r),
    r.body,
    isError(r, 'COMPLETED_VISIT_IMMUTABLE'),
  );
  r = await rpc(
    'docB',
    'clinic_apply_command',
    command(
      clinicA,
      'visit',
      visitId,
      'amend',
      { ...visitPayload, amendment_reason: 'Doctor B tries to amend' },
      visit.version,
    ),
  );
  record('XC-17', 'docB', 'amend clinic A visit', 'FORBIDDEN', summary(r), r.body, denied(r));
  r = await rpc(
    'docA',
    'clinic_apply_command',
    command(
      clinicA,
      'visit',
      visitId,
      'amend',
      { ...visitPayload, amendment_reason: 'Audit amendment reason text' },
      visit.version,
    ),
  );
  record(
    'POS-10',
    'docA',
    'amend own completed visit',
    'revision 2',
    summary(r),
    null,
    r.status === 200 && r.body.entity.current_revision === 2,
  );

  // ---- Audit exposure (DB-02) -------------------------------------------------------
  r = await rest(
    'docA',
    `/rest/v1/audit_events?select=id,action,actor_role&clinic_id=eq.${clinicA}&limit=3`,
  );
  record(
    'AUD-01',
    'docA',
    'admin reads audit metadata columns',
    'rows',
    summary(r),
    null,
    r.status === 200 && r.body.length > 0,
  );
  r = await rest('docA', `/rest/v1/audit_events?select=new_value&clinic_id=eq.${clinicA}&limit=1`);
  record(
    'AUD-02',
    'docA',
    'admin reads audit payload column',
    '42501 (column not granted)',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rest('docA', `/rest/v1/audit_events?select=*&clinic_id=eq.${clinicA}&limit=1`);
  record(
    'AUD-03',
    'docA',
    'admin selects * on audit_events',
    '42501',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rest('asst', `/rest/v1/audit_events?select=id,action&clinic_id=eq.${clinicA}`);
  record('AUD-04', 'asst', 'assistant reads audit', '0 rows', summary(r), null, empty(r));

  // ---- Documents and Storage --------------------------------------------------------
  const docId = randomUUID(),
    hash = await sha256(png);
  const stage = (actor, extra = {}) =>
    rpc(actor, 'clinic_begin_attachment', {
      p_id: docId,
      p_clinic_id: clinicA,
      p_patient_id: pA,
      p_visit_id: null,
      p_file_name: 'audit-fixture.png',
      p_content_type: 'image/png',
      p_category: 'Other',
      p_notes: 'AUDIT FIXTURE',
      p_bytes: png.length,
      p_clinical: true,
      p_sha256_hex: hash,
      ...extra,
    });
  r = await stage('asst');
  record(
    'DOC-01',
    'asst',
    'stage clinical document without clinical_read',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await stage('asst', { p_file_name: 'audit-fixture.html', p_clinical: false });
  record(
    'DOC-02',
    'asst',
    'stage PNG named .html',
    'ATTACHMENT_EXTENSION',
    summary(r),
    r.body,
    isError(r, 'ATTACHMENT_EXTENSION'),
  );
  r = await stage('docB');
  record(
    'XC-18',
    'docB',
    'stage document for clinic A patient',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await stage('clin', { p_clinical: false });
  record(
    'POS-11',
    'clin',
    'stage non-clinical document',
    'pending',
    summary(r),
    null,
    r.status === 200 && r.body.state === 'pending',
  );
  const objectPath = r.body.object_path;
  created.attachments.push(docId);
  created.objectPaths.push(objectPath);
  const upload = (actor, path, body = png, type = 'image/png') =>
    fetch(`${url}/storage/v1/object/clinic-documents/${path}`, {
      method: 'POST',
      headers: headers(actor, { 'content-type': type, 'x-upsert': 'false' }),
      body,
    }).then(async (x) => ({ status: x.status, body: await x.text() }));
  r = await upload('asst', objectPath);
  record(
    'DOC-03',
    'asst',
    "upload bytes to another user's pending path",
    'denied',
    r.status + ' ' + r.body.slice(0, 60),
    null,
    r.status === 400 || r.status === 403,
  );
  r = await upload('clin', `${clinicA}/${pA}/${randomUUID()}`);
  record(
    'DOC-04',
    'clin',
    'upload to an unstaged path',
    'denied',
    r.status + ' ' + r.body.slice(0, 60),
    null,
    r.status === 400 || r.status === 403,
  );
  r = await upload('clin', objectPath, Buffer.from('<svg onload=alert(1)></svg>'), 'image/svg+xml');
  record(
    'DOC-05',
    'clin',
    'upload SVG content type to staged path',
    'denied by bucket MIME allowlist',
    r.status + ' ' + r.body.slice(0, 80),
    null,
    r.status === 400 || r.status === 403 || r.status === 415,
  );
  r = await upload('clin', objectPath);
  record(
    'POS-12',
    'clin',
    'upload staged bytes',
    '200',
    r.status + ' ' + r.body.slice(0, 60),
    null,
    r.status === 200,
  );
  r = await upload('clin', objectPath);
  record(
    'DOC-06',
    'clin',
    'second upload to the same path (overwrite)',
    'denied (no UPDATE policy)',
    r.status + ' ' + r.body.slice(0, 60),
    null,
    r.status === 400 || r.status === 403 || r.status === 409,
  );
  r = await rpc('asst', 'clinic_finalize_attachment', { p_id: docId });
  record(
    'DOC-07',
    'asst',
    "finalize another user's upload (not admin)",
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rpc('clin', 'clinic_finalize_attachment', { p_id: docId });
  record(
    'POS-13',
    'clin',
    'finalize upload',
    'ready',
    summary(r),
    null,
    r.status === 200 && r.body.state === 'ready',
  );
  const download = (actor, path) =>
    fetch(`${url}/storage/v1/object/clinic-documents/${path}`, { headers: headers(actor) }).then(
      async (x) => ({ status: x.status, len: (await x.arrayBuffer()).byteLength }),
    );
  r = await download('asst', objectPath);
  record(
    'DOC-08',
    'asst',
    'download without a lease',
    'denied',
    r.status + ' ' + r.len + ' bytes',
    null,
    r.status !== 200,
  );
  r = await rpc('docB', 'clinic_authorize_attachment_access', {
    p_id: docId,
    p_purpose: 'preview',
  });
  record(
    'XC-19',
    'docB',
    'authorize access to clinic A document',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rpc('asst', 'clinic_authorize_attachment_access', {
    p_id: docId,
    p_purpose: 'preview',
  });
  record(
    'POS-14',
    'asst',
    'authorize non-clinical document access',
    'lease',
    summary(r),
    null,
    r.status === 200 && r.body.object_path === objectPath,
  );
  r = await download('asst', objectPath);
  record(
    'POS-15',
    'asst',
    'download with lease',
    '200, exact bytes',
    r.status + ' ' + r.len + ' bytes',
    null,
    r.status === 200 && r.len === png.length,
  );
  r = await download('docB', objectPath);
  record(
    'XC-20',
    'docB',
    'download clinic A object path',
    'denied',
    r.status + ' ' + r.len + ' bytes',
    null,
    r.status !== 200,
  );
  r = await fetch(`${url}/storage/v1/object/list/clinic-documents`, {
    method: 'POST',
    headers: headers('docB', { 'content-type': 'application/json' }),
    body: JSON.stringify({ prefix: clinicA, limit: 10 }),
  }).then(async (x) => ({ status: x.status, body: await x.json() }));
  record('XC-21', 'docB', 'list clinic A storage prefix', '0 objects', summary(r), null, empty(r));
  r = await fetch(`${url}/storage/v1/object/clinic-documents/${objectPath}`, {
    method: 'DELETE',
    headers: headers('clin'),
  }).then(async (x) => ({ status: x.status, body: await x.text() }));
  record(
    'DOC-09',
    'clin',
    'uploader deletes stored object',
    'denied (no DELETE policy)',
    r.status + ' ' + r.body.slice(0, 60),
    null,
    r.status !== 200,
  );

  // ---- Removal and stale tokens ---------------------------------------------------------
  r = await rpc('docA', 'clinic_set_staff_access', {
    p_clinic_id: clinicA,
    p_user_id: uid.asst,
    p_active: false,
    p_clinical_read: false,
  });
  record(
    'POS-16',
    'docA',
    'deactivate assistant',
    'ok',
    summary(r),
    null,
    r.status === 200 || r.status === 204,
  );
  r = await rpc('asst', 'clinic_authorize_attachment_access', {
    p_id: docId,
    p_purpose: 'preview',
  });
  record(
    'REM-01',
    'asst(removed)',
    'authorize document after removal (old token)',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await download('asst', objectPath);
  record(
    'REM-02',
    'asst(removed)',
    'download with the lease issued before removal',
    'denied',
    r.status + ' ' + r.len + ' bytes',
    null,
    r.status !== 200,
  );
  r = await rest('asst', `/rest/v1/patients?select=id&clinic_id=eq.${clinicA}`);
  record(
    'REM-03',
    'asst(removed)',
    'read patients after removal',
    '0 rows',
    summary(r),
    null,
    empty(r),
  );
  r = await rpc(
    'asst',
    'clinic_apply_command',
    command(clinicA, 'patient', randomUUID(), 'save', patientInput('AUDIT after removal'), 0),
  );
  record(
    'REM-04',
    'asst(removed)',
    'create patient after removal',
    'FORBIDDEN',
    summary(r),
    r.body,
    denied(r),
  );
  r = await rest(
    'asst',
    `/rest/v1/clinic_memberships?select=active,role,is_admin,clinical_read&clinic_id=eq.${clinicA}&user_id=eq.${uid.asst}`,
  );
  record(
    'REM-05',
    'asst(removed)',
    'web membership re-check sees inactive row',
    'active=false or 0 rows',
    summary(r),
    r.body,
    r.status === 200 && (r.body.length === 0 || r.body[0].active === false),
  );

  await writeFile(
    process.env.AUDIT_RESULTS || './live-authz-matrix-results.json',
    JSON.stringify(
      { executed_at: new Date().toISOString(), project_host: new URL(url).host, created, results },
      null,
      2,
    ),
  );
  const failed = results.filter((x) => !x.ok);
  process.stdout.write(
    `\n${results.length - failed.length}/${results.length} checks matched expectations\n`,
  );
  if (failed.length) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 2;
});
