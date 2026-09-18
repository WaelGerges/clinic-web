import { useState } from 'react';
import { api, executeCommand, prepareCommand } from './api';
import {
  addDays,
  availableSlots,
  clinicTime,
  clinicToday,
  localDate,
  localToUtc,
  statusLabels,
  transitions,
  type Appointment,
  type Patient,
  type Status,
} from './domain';
import { useWorkspace } from './state';
import { useLanguage } from './i18n';
import { useOperation, useResource } from './hooks';
import {
  Button,
  Empty,
  ErrorMessage,
  Field,
  Icon,
  Modal,
  OperationNotice,
  StatusBadge,
  Tabs,
} from './ui';
import { PatientPicker } from './Patients';
export function Schedule({ queueOnly = false }: { queueOnly?: boolean }) {
  const { membership: m, zone, revision, selectPatient, openConsult, online } = useWorkspace(),
    { t, locale } = useLanguage();
  const today = clinicToday(zone),
    [date, setDate] = useState(today),
    [dateTab, setDateTab] = useState('today'),
    [search, setSearch] = useState(''),
    [booking, setBooking] = useState(false),
    [selected, setSelected] = useState<Appointment | null>(null);
  const data = useResource(async () => {
    const [appointments, active] = await Promise.all([
      api.appointments(m.clinic_id, m.doctor_id, queueOnly ? today : date, zone),
      api.active(m.clinic_id, m.doctor_id),
    ]);
    const patients = await api.patientIds(m.clinic_id, [
      ...appointments.map((a) => a.patient_id),
      ...(active ? [active.patient_id] : []),
    ]);
    const delivery = await api.delivery(m, active?.id);
    return { appointments, active, patients, delivery };
  }, [date, revision, queueOnly].join(':'));
  const patient = (id: string) => data.data?.patients.find((p) => p.id === id),
    appointments = data.data?.appointments || [];
  const queue = appointments.filter((a) => a.status === 'waiting'),
    rows = appointments.filter((a) => {
      const p = patient(a.patient_id);
      return (
        !search ||
        [p?.full_name, p?.mobile, String(p?.patient_number)].some((x) =>
          x?.toLowerCase().includes(search.toLowerCase()),
        )
      );
    });
  const queuePanel = (
    <section className="queue-panel">
      <div className="section-heading compact">
        <h2>{t('Waiting Queue')}</h2>
        <span>
          {queue.length} {t('waiting')}
        </span>
      </div>
      {queue.map((a, i) => {
        const p = patient(a.patient_id);
        return (
          <article className="queue-row" key={a.id}>
            <span className="queue-number">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <button
                className="text-link patient-name"
                onClick={() => selectPatient(a.patient_id)}
              >
                {p?.full_name || t('Patient')}
              </button>
              <small>P-{p?.patient_number || '—'}</small>
              <StatusBadge status={a.status} />
            </div>
            <div className="queue-end">
              <strong>{clinicTime(a.starts_at, zone, locale)}</strong>
              <button className="text-link" onClick={() => setSelected(a)}>
                {t('Send to doctor')} <span aria-hidden="true">↗</span>
              </button>
            </div>
          </article>
        );
      })}
      {!queue.length && (
        <Empty title="The queue is clear.">
          {t('Patients will appear here after they are added to the queue.')}
        </Empty>
      )}
    </section>
  );
  return (
    <section>
      {!m.doctor_id && <ErrorMessage message="No active doctor is assigned to this clinic." />}
      {!queueOnly && (
        <>
          <div className="date-tabs-row">
            <Tabs
              label="Schedule date"
              value={dateTab}
              onChange={(id) => {
                setDateTab(id);
                if (id === 'today') setDate(today);
                if (id === 'tomorrow') setDate(addDays(today, 1));
              }}
              items={[
                { id: 'today', label: 'Today' },
                { id: 'tomorrow', label: 'Tomorrow' },
                { id: 'date', label: 'Select date' },
              ]}
            />
            <Button
              primary
              icon="plus"
              onClick={() => setBooking(true)}
              disabled={!online || !m.doctor_id}
            >
              {t('Book appointment')}
            </Button>
          </div>
          {dateTab === 'date' && (
            <div className="date-picker">
              <Field label="Schedule date">
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => {
                    if (e.target.value) setDate(e.target.value);
                  }}
                />
              </Field>
            </div>
          )}
        </>
      )}
      {data.error && <ErrorMessage message={data.error} retry={data.reload} />}
      {queueOnly ? (
        queuePanel
      ) : (
        <div className="schedule-columns">
          <section className="appointment-panel">
            <div className="section-heading compact">
              <h2>{t(date === today ? 'Today’s Schedule' : 'Appointments')}</h2>
              <span>
                {rows.length} {t('appointments')}
              </span>
            </div>
            <div className="search-input subtle">
              <Icon name="search" />
              <input
                aria-label={t('Search schedule')}
                placeholder={t('Find a patient in the schedule')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="table-scroll">
              <table className="ledger schedule-table">
                <thead>
                  <tr>
                    <th>{t('Time')}</th>
                    <th>{t('Patient')}</th>
                    <th>{t('Type')}</th>
                    <th>{t('Status')}</th>
                    <th>{t('Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const p = patient(a.patient_id);
                    return (
                      <tr key={a.id}>
                        <td className="appointment-time">
                          {clinicTime(a.starts_at, zone, locale)}
                          <small>
                            {a.duration_minutes} {t('min')}
                          </small>
                        </td>
                        <td>
                          <button
                            className="text-link patient-name"
                            onClick={() => selectPatient(a.patient_id)}
                          >
                            {p?.full_name || t('Patient')}
                          </button>
                          <small>P-{p?.patient_number || '—'}</small>
                        </td>
                        <td>{t(a.appointment_type)}</td>
                        <td>
                          <StatusBadge status={a.status} />
                        </td>
                        <td>
                          <Button onClick={() => setSelected(a)}>
                            {t(['scheduled', 'confirmed'].includes(a.status) ? 'Check in' : 'View')}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data.loading && !data.data && <p role="status">{t('Loading…')}</p>}
            {data.data && !rows.length && (
              <Empty title="No appointments on this page.">
                {t('Book a visit to start the day’s ledger.')}
              </Empty>
            )}
          </section>
          {queuePanel}
        </div>
      )}
      <div className="handoff-strip">
        <section>
          <span className="eyebrow">{t('Doctor availability')}</span>
          <strong>
            <i
              className={
                'presence-dot ' + (online && data.data?.delivery.doctor_online ? 'present' : '')
              }
            />
            {t(online && data.data?.delivery.doctor_online ? 'Doctor online' : 'Doctor offline')}
          </strong>
          <p>{t('Availability is confirmed by the doctor’s connected device.')}</p>
        </section>
        <section>
          <span className="eyebrow">{t('Current handoff')}</span>
          {data.data?.active ? (
            <>
              <strong>{patient(data.data.active.patient_id)?.full_name || t('Patient')}</strong>
              <p>
                {t(
                  data.data.delivery.acknowledged_at &&
                    data.data.delivery.appointment_version === data.data.active.version
                    ? 'Receipt acknowledged'
                    : 'Awaiting receipt',
                )}
              </p>
              {m.role === 'doctor' && (
                <button className="text-link" onClick={openConsult}>
                  {t('Open consultation')} →
                </button>
              )}
            </>
          ) : (
            <>
              <strong>{t('No patient with the doctor')}</strong>
              <p>{t('Keep the queue updated and confirm patient receipt with the doctor.')}</p>
            </>
          )}
        </section>
        <span className="folio-small">
          {queueOnly ? '03' : '01'} <span>/</span>
        </span>
      </div>
      {booking && <AppointmentForm initialDate={date} onClose={() => setBooking(false)} />}
      {selected && (
        <AppointmentDetails
          appointment={selected}
          patient={patient(selected.patient_id)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

export function AppointmentForm({
  patient: initialPatient,
  appointment,
  initialDate,
  onClose,
}: {
  patient?: Patient;
  appointment?: Appointment;
  initialDate?: string;
  onClose: () => void;
}) {
  const { membership: m, zone, revision, refresh, online } = useWorkspace(),
    { t } = useLanguage(),
    op = useOperation();
  const [patient, setPatient] = useState<Patient | null>(initialPatient || null),
    [id] = useState(appointment?.id || crypto.randomUUID()),
    [date, setDate] = useState(
      appointment ? localDate(appointment.starts_at, zone) : initialDate || clinicToday(zone),
    ),
    [time, setTime] = useState(appointment ? clinicTime(appointment.starts_at, zone) : ''),
    [duration, setDuration] = useState(appointment?.duration_minutes || 30),
    [type, setType] = useState(appointment?.appointment_type || 'Consultation'),
    [notes, setNotes] = useState(appointment?.notes || '');
  const data = useResource(async () => {
    const [schedule, appointments] = await Promise.all([
      api.schedule(m),
      api.appointments(m.clinic_id, m.doctor_id, date, zone),
    ]);
    return { schedule, appointments };
  }, date + revision);
  const slots = data.data
    ? availableSlots(
        date,
        zone,
        duration,
        data.data.schedule.settings.periods,
        data.data.schedule.settings.configured,
        data.data.appointments.filter((a) => a.id !== appointment?.id),
      )
    : [];
  return (
    <Modal
      title={appointment ? 'Reschedule appointment' : 'Book appointment'}
      onClose={onClose}
      locked={op.busy || op.uncertain}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          let command: ReturnType<typeof prepareCommand> | undefined;
          void op.run(async () => {
            if (!patient) throw new Error(t('Choose a patient.'));
            if (!time) throw new Error(t('Choose an appointment time.'));
            const starts = localToUtc(date, time, zone);
            if (Date.parse(starts) <= Date.now())
              throw new Error(t('Choose a future appointment time.'));
            command ??= prepareCommand(
              m.clinic_id,
              'appointment',
              id,
              'save',
              {
                patient_id: patient.id,
                doctor_id: m.doctor_id,
                starts_at: starts,
                duration_minutes: duration,
                appointment_type: type.trim(),
                notes,
              },
              appointment?.version || 0,
            );
            await executeCommand(command);
            refresh();
            onClose();
          });
        }}
      >
        <fieldset disabled={op.busy || op.uncertain || !online}>
          {!appointment ? (
            <PatientPicker value={patient} onChange={setPatient} />
          ) : (
            <p className="patient-name">{patient?.full_name}</p>
          )}
          <div className="form-grid">
            <Field label="Date">
              <input
                type="date"
                required
                min={clinicToday(zone)}
                value={date}
                onChange={(e) => {
                  if (e.target.value) {
                    setDate(e.target.value);
                    setTime('');
                  }
                }}
              />
            </Field>
            <Field label="Time">
              <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Field label="Duration (minutes)">
              <input
                type="number"
                min={5}
                max={240}
                required
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </Field>
            <Field label="Appointment type">
              <input
                required
                maxLength={80}
                list="appointment-types"
                value={type}
                onChange={(e) => setType(e.target.value)}
              />
              <datalist id="appointment-types">
                <option>Consultation</option>
                <option>Follow-up</option>
              </datalist>
            </Field>
          </div>
          <div className="slot-heading">
            <span className="eyebrow">{t('Available times')}</span>
            <small>{zone}</small>
          </div>
          {data.error && <ErrorMessage message={data.error} retry={data.reload} />}
          <div className="time-slots">
            {slots.slice(0, 40).map((slot) => (
              <button
                type="button"
                className={time === slot ? 'selected' : ''}
                key={slot}
                onClick={() => setTime(slot)}
              >
                {slot}
              </button>
            ))}
          </div>
          {!slots.length && (
            <p className="muted">
              {t('No suggested times. Choose another date or review working hours.')}
            </p>
          )}
          <Field label="Appointment notes">
            <textarea
              maxLength={2000}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <div className="form-actions">
            <Button onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" primary disabled={!patient || !m.doctor_id}>
              {t(appointment ? 'Save appointment' : 'Book appointment')}
            </Button>
          </div>
        </fieldset>
        <OperationNotice op={op} />
      </form>
    </Modal>
  );
}
function AppointmentDetails({
  appointment: initial,
  patient,
  onClose,
}: {
  appointment: Appointment;
  patient?: Patient;
  onClose: () => void;
}) {
  const { membership: m, zone, refresh, online } = useWorkspace(),
    { t, locale } = useLanguage(),
    [appointment, setAppointment] = useState(initial),
    [editing, setEditing] = useState(false),
    op = useOperation();
  const today = localDate(appointment.starts_at, zone) === clinicToday(zone);
  const change = (status: Status | 'send') => {
    if (
      ['cancelled', 'noShow', 'send'].includes(status) &&
      !confirm(
        t(
          status === 'send'
            ? 'Send this patient to the doctor now?'
            : 'Confirm this appointment status change?',
        ),
      )
    )
      return;
    const command = prepareCommand(
      m.clinic_id,
      'appointment',
      appointment.id,
      status === 'send' ? 'send' : 'status',
      status === 'send' ? {} : { status },
      appointment.version,
    );
    void op.run(async () => {
      const result = await executeCommand<Appointment>(command);
      setAppointment(result.entity);
      refresh();
    });
  };
  if (editing)
    return <AppointmentForm patient={patient} appointment={appointment} onClose={onClose} />;
  return (
    <Modal title="Appointment" onClose={onClose} locked={op.busy || op.uncertain}>
      <div className="record-heading">
        <h3>{patient?.full_name || t('Patient')}</h3>
        <span>P-{patient?.patient_number || '—'}</span>
        <StatusBadge status={appointment.status} />
      </div>
      <dl className="details-list">
        <dt>{t('Date')}</dt>
        <dd>{localDate(appointment.starts_at, zone)}</dd>
        <dt>{t('Time')}</dt>
        <dd>
          {clinicTime(appointment.starts_at, zone, locale)} · {appointment.duration_minutes}{' '}
          {t('min')}
        </dd>
        <dt>{t('Type')}</dt>
        <dd>{t(appointment.appointment_type)}</dd>
        <dt>{t('Appointment notes')}</dt>
        <dd>{appointment.notes || '—'}</dd>
      </dl>
      <fieldset disabled={!online || op.busy || op.uncertain}>
        <div className="action-stack">
          {transitions[appointment.status].map((status) => (
            <Button
              key={status}
              primary={['arrived', 'waiting'].includes(status)}
              disabled={status === 'waiting' && !today}
              onClick={() => change(status)}
            >
              {t(
                status === 'arrived'
                  ? 'Mark arrived'
                  : status === 'waiting'
                    ? appointment.status === 'withDoctor'
                      ? 'Return to queue'
                      : 'Add to queue'
                    : status === 'confirmed'
                      ? 'Confirm appointment'
                      : status === 'cancelled'
                        ? 'Cancel appointment'
                        : statusLabels[status],
              )}
            </Button>
          ))}
          {appointment.status === 'waiting' && (
            <Button primary disabled={!today} onClick={() => change('send')}>
              {t('Send to doctor')}
            </Button>
          )}
          {['scheduled', 'confirmed', 'arrived'].includes(appointment.status) && (
            <Button onClick={() => setEditing(true)}>{t('Reschedule appointment')}</Button>
          )}
        </div>
      </fieldset>
      <OperationNotice op={op} />
    </Modal>
  );
}
