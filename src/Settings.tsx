import { useEffect, useState } from 'react';
import { api } from './api';
import type { Patient, Period, Staff } from './domain';
import { useWorkspace } from './state';
import { useLanguage } from './i18n';
import { useOperation, useResource } from './hooks';
import { Button, Empty, ErrorMessage, Field, OperationNotice, Pager, Tabs } from './ui';
import { PatientPicker } from './Patients';
import { AppointmentForm } from './Schedule';
export function Settings() {
  const { membership: m } = useWorkspace(),
    { t, locale, setLocale } = useLanguage(),
    [tab, setTab] = useState('practice');
  const [theme, setTheme] = useState(localStorage.getItem('clinic-theme') || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('clinic-theme', theme);
  }, [theme]);
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t('THE PRACTICE')}</span>
          <h2>{t('Settings')}</h2>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'practice', label: 'Preferences' },
          { id: 'hours', label: 'Working hours' },
          { id: 'waitlist', label: 'Booking waitlist' },
          ...(m.role === 'doctor' && m.is_admin
            ? [
                { id: 'staff', label: 'Staff access' },
                { id: 'audit', label: 'Audit history' },
              ]
            : []),
        ]}
      />
      {tab === 'practice' ? (
        <div className="settings-section">
          <h3>{m.clinics.name}</h3>
          <p>{t(m.role === 'doctor' ? 'Clinic Doctor' : 'Clinic Assistant')}</p>
          <div className="form-grid">
            <Field label="Language">
              <select value={locale} onChange={(e) => setLocale(e.target.value as 'en' | 'ar')}>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </Field>
            <Field label="Appearance">
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <option value="light">{t('Light')}</option>
                <option value="dark">{t('Dark')}</option>
                <option value="system">{t('System')}</option>
              </select>
            </Field>
          </div>
          <p className="muted">
            {t(
              'The first visit follows your browser language. Your preference is saved on this device.',
            )}
          </p>
          <dl className="details-list">
            <dt>{t('Clinic time zone')}</dt>
            <dd>{m.clinics.time_zone}</dd>
            <dt>{t('Clinical records')}</dt>
            <dd>{t(m.role === 'doctor' || m.clinical_read ? 'Access enabled' : 'Restricted')}</dd>
            <dt>{t('Connection')}</dt>
            <dd>{t('Online access required')}</dd>
          </dl>
        </div>
      ) : tab === 'hours' ? (
        <WorkingHours />
      ) : tab === 'waitlist' ? (
        <Waitlist />
      ) : tab === 'staff' ? (
        <StaffAccess />
      ) : (
        <AuditHistory />
      )}
    </section>
  );
}
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const formatMinute = (v: number) =>
  String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
const minute = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
};
function WorkingHours() {
  const { membership: m, refresh, online } = useWorkspace(),
    { t } = useLanguage(),
    data = useResource(() => api.schedule(m), m.clinic_id),
    [periods, setPeriods] = useState<Period[]>([]),
    [loaded, setLoaded] = useState(false),
    op = useOperation();
  useEffect(() => {
    if (data.data && !loaded) {
      setPeriods(data.data.settings.periods);
      setLoaded(true);
    }
  }, [data.data, loaded]);
  const canEdit = m.role === 'doctor' && m.is_admin;
  const update = (index: number, changes: Partial<Period>) =>
    setPeriods((rows) => rows.map((p, i) => (i === index ? { ...p, ...changes } : p)));
  const save = (clear = false) =>
    void op.run(async () => {
      if (clear && !confirm(t('Clear working hours and allow appointments at any time?'))) return;
      if (!clear && !periods.length)
        throw new Error(t('Add a working period or clear working hours.'));
      const result = await api.schedule(
        m,
        clear ? 'settings_clear' : 'settings',
        clear ? {} : { periods },
      );
      setPeriods(result.settings.periods);
      setLoaded(true);
      data.reload();
      refresh();
    });
  return (
    <div className="settings-section">
      <h3>{t('Working hours')}</h3>
      <p>{t('Add separate periods for breaks. Appointment suggestions use clinic local time.')}</p>
      {data.error && <ErrorMessage message={data.error} retry={data.reload} />}
      <fieldset disabled={!loaded || !canEdit || !online || op.busy || op.uncertain}>
        {periods.map((p, index) => (
          <div className="period-row" key={index}>
            <Field label="Day">
              <select
                value={p.weekday}
                onChange={(e) => update(index, { weekday: Number(e.target.value) })}
              >
                {weekdays.map((day, i) => (
                  <option key={day} value={i + 1}>
                    {t(day)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="From">
              <input
                type="time"
                required
                value={formatMinute(p.start)}
                onChange={(e) => update(index, { start: minute(e.target.value) })}
              />
            </Field>
            <Field label="To">
              <input
                type="time"
                required
                value={p.end === 1440 ? '00:00' : formatMinute(p.end)}
                onChange={(e) =>
                  update(index, { end: e.target.value === '00:00' ? 1440 : minute(e.target.value) })
                }
              />
            </Field>
            <Button onClick={() => setPeriods((rows) => rows.filter((_, i) => index !== i))}>
              {t('Remove')}
            </Button>
          </div>
        ))}
        {!periods.length && (
          <Empty title="No working hours configured.">
            {t('Appointments may be booked at any time. Suggestions default to 09:00–17:00.')}
          </Empty>
        )}
        {canEdit && (
          <div className="inline-actions">
            <Button
              disabled={periods.length >= 28}
              icon="plus"
              onClick={() => setPeriods((rows) => [...rows, { weekday: 1, start: 540, end: 1020 }])}
            >
              {t('Add period')}
            </Button>
            <Button primary onClick={() => save()}>
              {t('Save working hours')}
            </Button>
            <Button onClick={() => save(true)}>{t('Clear working hours')}</Button>
          </div>
        )}
      </fieldset>
      <OperationNotice op={op} />
    </div>
  );
}
function Waitlist() {
  const { membership: m, revision, refresh, online } = useWorkspace(),
    { t } = useLanguage(),
    [patient, setPatient] = useState<Patient | null>(null),
    [notes, setNotes] = useState(''),
    [booking, setBooking] = useState<Patient | null>(null),
    op = useOperation();
  const data = useResource(async () => {
    const schedule = await api.schedule(m),
      patients = await api.patientIds(
        m.clinic_id,
        schedule.waitlist.map((x) => x.patient_id),
      );
    return { schedule, patients };
  }, String(revision));
  return (
    <div className="settings-section">
      <h3>{t('Booking waitlist')}</h3>
      <p>{t('Keep patients here until an appointment becomes available.')}</p>
      {data.error && <ErrorMessage message={data.error} retry={data.reload} />}
      <div className="waitlist-grid">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void op.run(async () => {
              if (!patient) throw new Error(t('Choose a patient.'));
              await api.schedule(m, 'waitlist_add', { patient_id: patient.id, notes });
              setPatient(null);
              setNotes('');
              refresh();
            });
          }}
        >
          <fieldset disabled={!online || op.busy || op.uncertain}>
            <PatientPicker value={patient} onChange={setPatient} />
            <Field label="Notes">
              <textarea
                rows={2}
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <Button primary type="submit">
              {t('Add to waitlist')}
            </Button>
          </fieldset>
        </form>
        <div>
          {data.data?.schedule.waitlist.map((row) => {
            const p = data.data?.patients.find((x) => x.id === row.patient_id);
            return (
              <article className="waitlist-row" key={row.id}>
                <h3>{p?.full_name || t('Patient')}</h3>
                <p>{row.notes}</p>
                <div className="inline-actions">
                  <Button disabled={!p || !online} onClick={() => setBooking(p || null)}>
                    {t('Book appointment')}
                  </Button>
                  <Button
                    disabled={!online || op.busy || op.uncertain}
                    onClick={() =>
                      void op.run(async () => {
                        await api.schedule(m, 'waitlist_remove', { id: row.id });
                        refresh();
                      })
                    }
                  >
                    {t('Remove')}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <OperationNotice op={op} />
      {booking && <AppointmentForm patient={booking} onClose={() => setBooking(null)} />}
    </div>
  );
}
function StaffAccess() {
  const { membership: m, online } = useWorkspace(),
    { t } = useLanguage(),
    data = useResource(() => api.staff(m.clinic_id), m.clinic_id),
    [email, setEmail] = useState(''),
    [clinical, setClinical] = useState(false),
    [invitation, setInvitation] = useState<{ code: string; expires_at: string } | null>(null),
    op = useOperation(data.reload, false);
  const change = (staff: Staff, changes: Partial<Staff>) => {
    if (confirm(t('Apply this change to staff access?')))
      void op.run(async () => {
        await api.staffAccess(m.clinic_id, { ...staff, ...changes });
      });
  };
  return (
    <div className="settings-section">
      <h3>{t('Staff access')}</h3>
      {data.error && <ErrorMessage message={data.error} retry={data.reload} />}
      <div className="table-scroll">
        <table className="ledger">
          <thead>
            <tr>
              <th>{t('Email')}</th>
              <th>{t('Role')}</th>
              <th>{t('Clinical records')}</th>
              <th>{t('Access')}</th>
            </tr>
          </thead>
          <tbody>
            {data.data?.map((s) => (
              <tr key={s.user_id}>
                <td>{s.email}</td>
                <td>{t(s.role === 'doctor' ? 'Doctor' : 'Assistant')}</td>
                <td>
                  <label className="checkbox">
                    <input
                      aria-label={t('Clinical access') + ' ' + s.email}
                      type="checkbox"
                      checked={s.clinical_read || s.role === 'doctor'}
                      disabled={s.role === 'doctor' || !online || op.busy || op.uncertain}
                      onChange={(e) => change(s, { clinical_read: e.target.checked })}
                    />
                    {t(s.clinical_read || s.role === 'doctor' ? 'Enabled' : 'Restricted')}
                  </label>
                </td>
                <td>
                  <Button
                    disabled={s.role === 'doctor' || !online || op.busy || op.uncertain}
                    onClick={() => change(s, { active: !s.active })}
                  >
                    {t(s.active ? 'Deactivate' : 'Reactivate')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="invite-form"
        onSubmit={(e) => {
          e.preventDefault();
          void op.run(async () => {
            const result = await api.invite(m.clinic_id, email, clinical);
            setInvitation(result);
          });
        }}
      >
        <h3>{t('Invite an assistant')}</h3>
        <fieldset disabled={!online || op.busy || op.uncertain}>
          <Field label="Assistant email">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={clinical}
              onChange={(e) => setClinical(e.target.checked)}
            />
            {t('Allow reading clinical records')}
          </label>
          <Button primary type="submit">
            {t('Create invitation')}
          </Button>
        </fieldset>
      </form>
      {invitation && (
        <div className="notice invitation">
          <p>
            {t('Share this one-time code with the assistant. It is not emailed automatically.')}
          </p>
          <code>{invitation.code}</code>
          <small>
            {t('Expires')}: {new Date(invitation.expires_at).toLocaleString()}
          </small>
          <Button
            onClick={() => void op.run(async () => navigator.clipboard.writeText(invitation.code))}
          >
            {t('Copy code')}
          </Button>
        </div>
      )}
      <OperationNotice op={op} />
    </div>
  );
}
function AuditHistory() {
  const { membership: m, revision } = useWorkspace(),
    { t, locale } = useLanguage(),
    [page, setPage] = useState(0),
    data = useResource(() => api.audit(m.clinic_id, page * 50), page + ':' + revision);
  return (
    <div className="settings-section">
      <h3>{t('Audit history')}</h3>
      <p>{t('Activity metadata only. Clinical content is not displayed in the audit ledger.')}</p>
      {data.error && <ErrorMessage message={data.error} retry={data.reload} />}
      <div className="table-scroll">
        <table className="ledger">
          <thead>
            <tr>
              <th>{t('Time')}</th>
              <th>{t('Action')}</th>
              <th>{t('Role')}</th>
              <th>{t('Record')}</th>
            </tr>
          </thead>
          <tbody>
            {data.data?.map((row) => (
              <tr key={row.id}>
                <td>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: m.clinics.time_zone,
                  }).format(new Date(row.occurred_at))}
                </td>
                <td>{row.action}</td>
                <td>{t(row.actor_role)}</td>
                <td>
                  {row.object_type}
                  <small className="mono" title={row.object_id}>
                    {row.object_id.slice(0, 8)}…{row.object_id.slice(-4)}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} count={data.data?.length || 0} onChange={setPage} />
    </div>
  );
}
