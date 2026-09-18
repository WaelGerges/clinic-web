import type { Page } from '@playwright/test';
import { Temporal } from '@js-temporal/polyfill';
export const clinic = '00000000-0000-4000-8000-000000000001',
  doctor = '00000000-0000-4000-8000-000000000002',
  assistant = '00000000-0000-4000-8000-000000000003';
const pid = (i: number) => '00000000-0000-4000-9000-' + String(i).padStart(12, '0');
export async function clinicFixture(
  page: Page,
  role: 'assistant' | 'doctor' = 'assistant',
  options: { conflict?: boolean; uncertain?: boolean; clinical?: boolean } = {},
) {
  const today = Temporal.Now.zonedDateTimeISO('Africa/Cairo').toPlainDate().toString();
  const patients = [
    'Nour Hassan',
    'Omar Ali',
    'Mariam Adel',
    'Samir Nabil',
    'Layla Ahmed',
    'Tamer Youssef',
    'Rehab Khaled',
    'Yara Mostafa',
  ].map((name, i) => ({
    id: pid(i + 10),
    clinic_id: clinic,
    patient_number: 1042 + i,
    full_name: name,
    gender: i % 2 ? 'Male' : 'Female',
    birth_date: '1992-03-15',
    mobile: '01012345678',
    secondary_mobile: '',
    address: 'Cairo',
    notes: '',
    alerts: i === 0 ? 'Penicillin allergy' : '',
    archived: false,
    version: 1,
    created_at: today + 'T06:00:00Z',
    updated_at: today + 'T06:00:00Z',
  }));
  const appointments = patients.map((p, i) => ({
    id: pid(i + 100),
    clinic_id: clinic,
    patient_id: p.id,
    doctor_id: doctor,
    starts_at:
      today +
      'T' +
      String(6 + Math.floor(i / 2)).padStart(2, '0') +
      ':' +
      (i % 2 ? '30' : '00') +
      ':00Z',
    duration_minutes: 30,
    appointment_type: i % 3 === 2 ? 'Follow-up' : 'Consultation',
    notes: '',
    status:
      i === 0 ? (role === 'doctor' ? 'withDoctor' : 'arrived') : i === 1 ? 'waiting' : 'scheduled',
    version: 1,
  }));
  const commands: Record<string, unknown>[] = [];
  const receipts = new Map<string, unknown>();
  let dropped = false,
    ack = false,
    visits: Record<string, unknown>[] = [];
  let membershipActive = true;
  const documents: Record<string, unknown>[] = [];
  let uploaded: Buffer | null = null;
  let settings = { configured: false, periods: [] as unknown[] };
  const staff = [
    {
      user_id: doctor,
      email: 'doctor@example.test',
      role: 'doctor',
      active: true,
      clinical_read: true,
    },
    {
      user_id: assistant,
      email: 'assistant@example.test',
      role: 'assistant',
      active: true,
      clinical_read: false,
    },
  ];
  const member = {
    clinic_id: clinic,
    user_id: role === 'doctor' ? doctor : assistant,
    role,
    is_admin: role === 'doctor',
    clinical_read: options.clinical || role === 'doctor',
    active: true,
    clinics: { name: 'The Garden Clinic', time_zone: 'Africa/Cairo' },
  };
  const json = (obj: unknown) => JSON.stringify(obj);
  await page.routeWebSocket(/supabase\.co/, (ws) => ws.close());
  await page.route('https://*.supabase.co/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      body = route.request().headers()['content-type']?.includes('application/json')
        ? route.request().postDataJSON() || {}
        : {},
      headers = { 'content-type': 'application/json' };
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, headers, body: json(data) });
    const failure = (message: string, code = 'P0001') =>
      reply({ message, code, details: null, hint: null }, 400);
    if (path.includes('/auth/v1/logout')) return reply({});
    if (path.includes('/auth/v1/user'))
      return reply({
        id: member.user_id,
        email: 'test@example.test',
        aud: 'authenticated',
        role: 'authenticated',
      });
    if (path.includes('/auth/v1/token'))
      return reply({
        access_token: 'fixture',
        refresh_token: 'fixture',
        expires_in: 3600,
        user: { id: member.user_id },
      });
    if (path.includes('/rpc/')) {
      const fn = path.split('/').pop();
      if (fn === 'clinic_search_patients') {
        const search = (body.p_search || '').toLowerCase();
        return reply(
          patients.filter(
            (p) =>
              p.archived === body.p_archived &&
              (!search ||
                p.full_name.toLowerCase().includes(search) ||
                String(p.patient_number).includes(search) ||
                p.mobile.includes(search)),
          ),
        );
      }
      if (fn === 'clinic_doctor_heartbeat')
        return reply({
          server_now: new Date().toISOString(),
          doctor_online: true,
          presence_expires_at: new Date(Date.now() + 60000).toISOString(),
          acknowledged_at: null,
          appointment_version: null,
        });
      if (fn === 'clinic_doctor_delivery_state' || fn === 'clinic_acknowledge_appointment') {
        if (fn === 'clinic_acknowledge_appointment') ack = true;
        return reply({
          server_now: new Date().toISOString(),
          doctor_online: true,
          presence_expires_at: new Date(Date.now() + 60000).toISOString(),
          acknowledged_at: ack ? new Date().toISOString() : null,
          appointment_version: ack ? 1 : null,
        });
      }
      if (fn === 'clinic_schedule') {
        if (body.p_action === 'settings')
          settings = { configured: true, periods: body.p_payload.periods };
        if (body.p_action === 'settings_clear') settings = { configured: false, periods: [] };
        return reply({ settings, waitlist: [] });
      }
      if (fn === 'clinic_staff') return reply(staff);
      if (fn === 'clinic_set_staff_access') {
        const row = staff.find((x) => x.user_id === body.p_user_id);
        if (row) Object.assign(row, { active: body.p_active, clinical_read: body.p_clinical_read });
        return reply(null);
      }
      if (fn === 'clinic_begin_attachment') {
        let doc = documents.find((d) => d.id === body.p_id);
        if (!doc) {
          doc = {
            id: body.p_id,
            clinic_id: clinic,
            patient_id: body.p_patient_id,
            visit_id: body.p_visit_id,
            file_name: body.p_file_name,
            content_type: body.p_content_type,
            category: body.p_category,
            notes: body.p_notes,
            bytes: body.p_bytes,
            sha256_hex: body.p_sha256_hex,
            clinical: body.p_clinical,
            object_path: clinic + '/' + body.p_patient_id + '/' + body.p_id,
            state: 'pending',
            uploaded_by: member.user_id,
            created_at: new Date().toISOString(),
            version: 1,
          };
          documents.push(doc);
        }
        return reply(doc);
      }
      if (fn === 'clinic_finalize_attachment') {
        const doc = documents.find((d) => d.id === body.p_id)!;
        doc.state = 'ready';
        return reply(doc);
      }
      if (fn === 'clinic_authorize_attachment_access') {
        const doc = documents.find((d) => d.id === body.p_id)!;
        return reply({
          object_path: doc.object_path,
          bytes: doc.bytes,
          sha256_hex: doc.sha256_hex,
        });
      }
      if (fn === 'clinic_set_attachment_archived') {
        const doc = documents.find((d) => d.id === body.p_id)!;
        doc.state = body.p_archived ? 'archived' : 'ready';
        return reply(doc);
      }
      if (fn === 'clinic_apply_command') {
        commands.push(body);
        if (options.conflict) return failure('VERSION_CONFLICT');
        if (receipts.has(body.p_operation_id)) return reply(receipts.get(body.p_operation_id));
        const list =
          body.p_entity_type === 'patient'
            ? patients
            : body.p_entity_type === 'appointment'
              ? appointments
              : visits;
        let entity = list.find((x) => x.id === body.p_entity_id) as
          Record<string, unknown> | undefined;
        if (entity && entity.version !== body.p_expected_version)
          return failure('VERSION_CONFLICT');
        if (!entity) {
          entity = {
            id: body.p_entity_id,
            clinic_id: clinic,
            patient_number: 1050,
            status: 'scheduled',
            version: 0,
            created_at: new Date().toISOString(),
            current_revision: 0,
            completed: false,
          };
          list.push(entity as never);
        }
        if (body.p_action === 'status') entity.status = body.p_payload.status;
        else if (body.p_action === 'send') entity.status = 'withDoctor';
        else if (body.p_action === 'complete') {
          entity.completed = true;
          const ap = appointments.find((a) => a.id === entity?.appointment_id);
          if (ap) {
            ap.status = 'completed';
            ap.version++;
          }
        } else Object.assign(entity, body.p_payload);
        entity.version = Number(entity.version) + 1;
        if (body.p_entity_type === 'visit' && body.p_action !== 'complete')
          entity.current_revision = Number(entity.current_revision) + 1;
        const receipt = { entity: { ...entity }, version: entity.version };
        receipts.set(body.p_operation_id, receipt);
        if (options.uncertain && !dropped) {
          dropped = true;
          return route.abort('failed');
        }
        return reply(receipt);
      }
      return reply({});
    }
    if (path.endsWith('/clinic_memberships')) {
      if (url.searchParams.has('role')) return reply([{ user_id: doctor }]);
      if (url.searchParams.get('select') === 'active,role,is_admin,clinical_read')
        return reply({ ...member, active: membershipActive });
      return reply([member]);
    }
    if (path.endsWith('/patients')) {
      const filter = url.searchParams.get('id') || '';
      if (filter.startsWith('eq.')) return reply(patients.find((p) => p.id === filter.slice(3)));
      return reply(
        filter.startsWith('in.') ? patients.filter((p) => filter.includes(p.id)) : patients,
      );
    }
    if (path.endsWith('/appointments')) {
      if (url.searchParams.get('status') === 'eq.withDoctor')
        return reply(appointments.find((a) => a.status === 'withDoctor') || null);
      return reply(appointments);
    }
    if (path.endsWith('/visit_details')) {
      if (url.searchParams.has('appointment_id'))
        return reply(
          visits.find((v) => 'eq.' + v.appointment_id === url.searchParams.get('appointment_id')) ||
            null,
        );
      if (url.searchParams.has('id'))
        return reply(visits.find((v) => 'eq.' + v.id === url.searchParams.get('id')));
      return reply(
        visits.filter((v) => 'eq.' + v.patient_id === url.searchParams.get('patient_id')),
      );
    }
    if (path.includes('/storage/v1/object/')) {
      if (route.request().method() === 'POST') {
        uploaded = route.request().postDataBuffer();
        return reply({ Key: 'test' });
      }
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: uploaded! });
    }
    if (path.endsWith('/attachments')) return reply(documents);
    if (path.endsWith('/audit_events'))
      return reply([
        {
          id: 1,
          actor_id: doctor,
          actor_role: 'doctor',
          action: 'visit.save',
          object_type: 'visit',
          object_id: pid(400),
          occurred_at: new Date().toISOString(),
        },
      ]);
    return reply([]);
  });
  const token = (value: unknown) => Buffer.from(json(value)).toString('base64url');
  const access =
    token({ alg: 'HS256', typ: 'JWT' }) +
    '.' +
    token({
      sub: member.user_id,
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }) +
    '.fixture';
  await page.addInitScript(
    ({ access, userId }) => {
      sessionStorage.setItem(
        'clinic-web-auth',
        JSON.stringify({
          access_token: access,
          refresh_token: 'fixture',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user: {
            id: userId,
            email: 'test@example.test',
            aud: 'authenticated',
            role: 'authenticated',
          },
        }),
      );
    },
    { access, userId: member.user_id },
  );
  return {
    patients,
    appointments,
    commands,
    visits,
    documents,
    staff,
    revoke: () => {
      membershipActive = false;
    },
  };
}
export async function enterClinic(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /The Garden Clinic/ }).click();
}
