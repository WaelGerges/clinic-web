import { useEffect, useRef, useState } from 'react';
import { api, executeCommand, prepareCommand } from './api';
import {
  age,
  clinicToday,
  emptyMedication,
  validateVisit,
  visitPayload,
  type Appointment,
  type Patient,
  type Visit,
} from './domain';
import { useWorkspace } from './state';
import { useLanguage } from './i18n';
import { useOperation, useResource, useUnsaved } from './hooks';
import { Button, Empty, ErrorMessage, Field, Modal, OperationNotice, Pager, Tabs } from './ui';
import { Documents } from './Documents';
import { PrintVisit } from './PrintVisit';

export function Consultation() {
  const { membership: m, revision, refresh, online, isDirty, setDirty } = useWorkspace(),
    { t } = useLanguage(),
    [tab, setTab] = useState('consultation');
  const data = useResource(async () => {
    const appointment = await api.active(m.clinic_id, m.doctor_id);
    if (!appointment) return null;
    const [patient, visit, delivery] = await Promise.all([
      api.patient(m.clinic_id, appointment.patient_id),
      api.visitForAppointment(m.clinic_id, appointment.id),
      api.delivery(m, appointment.id),
    ]);
    return { appointment, patient, visit, delivery };
  }, String(revision));
  const op = useOperation(),
    ackId = useRef<{ key: string; id: string } | null>(null);
  const retained = useRef<typeof data.data>(undefined);
  const assignmentChanged = Boolean(
    isDirty &&
    retained.current &&
    data.data !== undefined &&
    retained.current.appointment.id !== data.data?.appointment.id,
  );
  if (!assignmentChanged && data.data !== undefined) retained.current = data.data;
  const current = assignmentChanged ? retained.current : data.data;
  if (data.error && !current) return <ErrorMessage message={data.error} retry={data.reload} />;
  if (data.loading && !current) return <p role="status">{t('Loading…')}</p>;
  if (!current)
    return (
      <Empty title="Ready for the next patient.">
        {t(
          'A patient sent from reception will appear here. Keep this page open to remain available.',
        )}
      </Empty>
    );
  const received = Boolean(
    current.delivery.acknowledged_at &&
    current.delivery.appointment_version === current.appointment.version,
  );
  return (
    <section>
      {data.error && <ErrorMessage message={data.error} retry={data.reload} />}
      {assignmentChanged && (
        <div role="alert" className="notice error">
          <span>
            {t(
              'The assignment changed. Your unsaved notes are retained below. Copy them before leaving this record.',
            )}
          </span>
          <Button
            onClick={() => {
              if (confirm(t('Discard unsaved changes?'))) setDirty(false);
            }}
          >
            {t('Discard draft and refresh')}
          </Button>
        </div>
      )}
      <div className="patient-banner">
        <div>
          <h2>{current.patient.full_name}</h2>
          <span>
            P-{current.patient.patient_number} · {current.patient.birth_date} ·{' '}
            {t(current.patient.gender)}
          </span>
        </div>
        <div className="receipt">
          <span className={'status ' + (received ? 'completed' : 'arrived')}>
            <i />
            {t(received ? 'Receipt acknowledged' : 'Awaiting receipt')}
          </span>
          {!received && (
            <Button
              primary
              disabled={op.busy || !online || op.uncertain || assignmentChanged}
              onClick={() =>
                void op.run(async () => {
                  await api.heartbeat(m);
                  const key = current.appointment.id + ':' + current.appointment.version;
                  if (ackId.current?.key !== key) ackId.current = { key, id: crypto.randomUUID() };
                  const receipt = await api.acknowledge(m, current.appointment, ackId.current.id);
                  if (receipt.appointment_version !== current.appointment.version)
                    throw new Error(
                      t(
                        'The receipt is from an earlier handoff. Refresh and acknowledge this assignment again.',
                      ),
                    );
                  refresh();
                })
              }
            >
              {t('Acknowledge receipt')}
            </Button>
          )}
        </div>
      </div>
      <OperationNotice op={op} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'consultation', label: 'Consultation' },
          { id: 'history', label: 'History' },
          { id: 'documents', label: 'Documents' },
        ]}
      />
      <div hidden={tab !== 'consultation'}>
        <VisitEditor
          key={current.appointment.id}
          patient={current.patient}
          appointment={current.appointment}
          original={current.visit}
          enabled={received && online && !assignmentChanged && !data.error}
        />
      </div>
      {tab === 'history' && <VisitHistory patient={current.patient} />}
      {tab === 'documents' && <Documents patient={current.patient} visitId={current.visit?.id} />}
    </section>
  );
}
function blankVisit(
  m: ReturnType<typeof useWorkspace>['membership'],
  p: Patient,
  a: Appointment,
): Visit {
  return {
    id: crypto.randomUUID(),
    clinic_id: m.clinic_id,
    patient_id: p.id,
    appointment_id: a.id,
    doctor_id: m.user_id,
    notes: '',
    follow_up: '',
    diagnoses: [],
    medications: [],
    completed: false,
    version: 0,
    current_revision: 0,
    created_at: new Date().toISOString(),
  };
}

export function VisitEditor({
  patient,
  appointment,
  original,
  enabled = true,
  onDone,
}: {
  patient: Patient;
  appointment?: Appointment;
  original: Visit | null;
  enabled?: boolean;
  onDone?: () => void;
}) {
  const { membership: m, zone, refresh, setDirty: workspaceDirty, online } = useWorkspace(),
    { t } = useLanguage();
  const [visit, setVisit] = useState<Visit>(() => original || blankVisit(m, patient, appointment!)),
    [dirty, setDirty] = useState(false),
    [saved, setSaved] = useState(false),
    [reason, setReason] = useState(''),
    op = useOperation();
  const amendment = Boolean(original?.completed),
    changed = Boolean(original && original.version !== visit.version);
  useUnsaved(dirty || op.uncertain);
  useEffect(() => {
    workspaceDirty(dirty || op.uncertain);
    return () => workspaceDirty(false);
  }, [dirty, op.uncertain, workspaceDirty]);
  useEffect(() => {
    if (original && !dirty && !op.busy && !op.uncertain) setVisit(original);
  }, [original, dirty, op.busy, op.uncertain]);
  const update = (changes: Partial<Visit>) => {
    setVisit((v) => ({ ...v, ...changes }));
    setDirty(true);
    setSaved(false);
  };
  const save = (complete = false) => {
    if (complete && !confirm(t('Complete this visit? Later changes will require an amendment.')))
      return;
    let saveCommand: ReturnType<typeof prepareCommand> | undefined,
      completeCommand: ReturnType<typeof prepareCommand> | undefined,
      savedVisit: Visit | undefined;
    void op.run(async () => {
      const cleanVisit = {
        ...visit,
        diagnoses: visit.diagnoses.map((x) => x.trim()).filter(Boolean),
      };
      validateVisit(cleanVisit);
      if (complete && !cleanVisit.diagnoses.length)
        throw new Error(t('Add a diagnosis before completing the visit.'));
      if (amendment && reason.trim().length < 10)
        throw new Error(t('Explain the amendment in 10 to 1000 characters.'));
      saveCommand ??= prepareCommand(
        m.clinic_id,
        'visit',
        visit.id,
        amendment ? 'amend' : 'save',
        visitPayload({ ...cleanVisit, amendment_reason: reason }),
        visit.version,
      );
      if (!savedVisit) {
        const receipt = await executeCommand<Visit>(saveCommand);
        savedVisit = { ...receipt.entity, version: receipt.version };
      }
      if (complete) {
        completeCommand ??= prepareCommand(
          m.clinic_id,
          'visit',
          visit.id,
          'complete',
          {},
          savedVisit.version,
        );
        await executeCommand<Visit>(completeCommand);
      }
      setVisit(savedVisit);
      setDirty(false);
      setSaved(true);
      refresh();
      if (complete || amendment) onDone?.();
    });
  };
  return (
    <div className="visit-editor">
      {changed && dirty && (
        <div role="alert" className="notice error">
          {t(
            'This visit changed on another device. Review the latest record before saving your edits.',
          )}
          <Button
            onClick={() => {
              if (confirm(t('Discard unsaved changes?')) && original) {
                setVisit(original);
                setDirty(false);
              }
            }}
          >
            {t('Load latest record')}
          </Button>
        </div>
      )}
      {!enabled && (
        <p className="notice">
          {t('Acknowledge patient receipt before editing the consultation.')}
        </p>
      )}
      <fieldset disabled={!enabled || !online || op.busy || op.uncertain || (changed && dirty)}>
        <div className="consultation-grid">
          <aside className="patient-summary">
            <h3>{t('Patient information')}</h3>
            <dl>
              <dt>{t('Full name')}</dt>
              <dd>{patient.full_name}</dd>
              <dt>{t('Patient ID')}</dt>
              <dd>P-{patient.patient_number}</dd>
              <dt>{t('Age / Gender')}</dt>
              <dd>
                {age(patient.birth_date, clinicToday(zone))} {t('years')} / {t(patient.gender)}
              </dd>
              <dt>{t('Phone')}</dt>
              <dd>
                <bdi>{patient.mobile}</bdi>
              </dd>
              <dt>{t('Clinical alerts')}</dt>
              <dd className={patient.alerts ? 'alert-text' : ''}>
                {patient.alerts || t('Not recorded')}
              </dd>
            </dl>
            <div className="margin-note">
              {t('Each saved version becomes part of the clinical record.')}
            </div>
          </aside>
          <div className="clinical-notes">
            <div className="section-heading compact">
              <h3>{t('Clinical notes')}</h3>
              <small>{clinicToday(zone)}</small>
            </div>
            <Field label="Clinical notes">
              <textarea
                className="notes-input"
                aria-label={t('Clinical notes')}
                maxLength={20000}
                placeholder={t('Enter clinical notes…')}
                value={visit.notes}
                onChange={(e) => update({ notes: e.target.value })}
              />
            </Field>
            <Field label="Diagnosis" hint="One diagnosis per line">
              <textarea
                rows={3}
                maxLength={50049}
                placeholder={t('Enter diagnosis…')}
                value={visit.diagnoses.join('\n')}
                onChange={(e) => update({ diagnoses: e.target.value.split('\n') })}
              />
            </Field>
            <Field label="Follow-up">
              <textarea
                rows={4}
                maxLength={5000}
                placeholder={t('Follow-up plan…')}
                value={visit.follow_up}
                onChange={(e) => update({ follow_up: e.target.value })}
              />
            </Field>
            {amendment && (
              <Field label="Amendment reason">
                <textarea
                  minLength={10}
                  maxLength={1000}
                  required
                  rows={3}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
            )}
          </div>
          <section className="prescription">
            <h3>{t('Prescription')}</h3>
            <Button
              icon="plus"
              disabled={visit.medications.length >= 100}
              onClick={() => update({ medications: [...visit.medications, emptyMedication()] })}
            >
              {t('Add medication')}
            </Button>
            {!visit.medications.length && (
              <div className="prescription-empty">
                <span className="rx">℞</span>
                <p>{t('No medications added yet.')}</p>
                <small>{t('Add medication to this visit using the button above.')}</small>
              </div>
            )}
            {visit.medications.map((med, index) => (
              <article className="medication" key={med.id}>
                <div className="section-heading compact">
                  <span className="eyebrow">
                    {t('Medication')} {index + 1}
                  </span>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      update({ medications: visit.medications.filter((x) => x.id !== med.id) })
                    }
                  >
                    {t('Remove')}
                  </button>
                </div>
                {(
                  [
                    'name',
                    'strength',
                    'dose',
                    'frequency',
                    'duration',
                    'instructions',
                    'notes',
                  ] as const
                ).map((key) => (
                  <Field
                    key={key}
                    label={
                      {
                        name: 'Medication name',
                        strength: 'Strength',
                        dose: 'Dose',
                        frequency: 'Frequency',
                        duration: 'Duration',
                        instructions: 'Instructions',
                        notes: 'Medication notes',
                      }[key]
                    }
                  >
                    <input
                      required={key === 'name'}
                      maxLength={
                        key === 'name' ? 300 : ['instructions', 'notes'].includes(key) ? 5000 : 200
                      }
                      value={med[key]}
                      onChange={(e) =>
                        update({
                          medications: visit.medications.map((x) =>
                            x.id === med.id ? { ...x, [key]: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                ))}
              </article>
            ))}
          </section>
        </div>
        <div className="visit-actions">
          <span className="save-state">
            {t(dirty ? 'Unsaved changes' : saved ? 'Saved to the clinic' : 'Visit in progress')}
            {visit.current_revision > 0 && (
              <>
                {' '}
                · {t('Revision')} {visit.current_revision}
              </>
            )}
          </span>
          <div className="inline-actions">
            {onDone && (
              <Button
                onClick={() => {
                  if (!dirty || confirm(t('Discard unsaved changes?'))) onDone();
                }}
              >
                {t('Cancel')}
              </Button>
            )}
            <Button onClick={() => save(false)} disabled={!dirty && visit.version > 0}>
              {t(amendment ? 'Save amendment' : 'Save draft')}
            </Button>
            {!amendment && (
              <Button primary onClick={() => save(true)}>
                {t('Complete visit')}
              </Button>
            )}
          </div>
        </div>
      </fieldset>
      <OperationNotice op={op} />
    </div>
  );
}
export function VisitHistory({ patient }: { patient: Patient }) {
  const { membership: m, revision } = useWorkspace(),
    { t, locale } = useLanguage(),
    [page, setPage] = useState(0),
    [amending, setAmending] = useState<Visit | null>(null),
    [printing, setPrinting] = useState<Visit | null>(null);
  const data = useResource(
    () => api.visits(m.clinic_id, patient.id, page * 50),
    [patient.id, revision, page].join(':'),
  );
  return (
    <section className="history">
      <div className="section-heading">
        <h2>{t('Visit history')}</h2>
        <span>{t('Latest records first')}</span>
      </div>
      {data.error && <ErrorMessage message={data.error} retry={data.reload} />}{' '}
      {data.data?.map((v) => (
        <details key={v.id} className="visit-record">
          <summary>
            <span>
              <strong>
                {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                  new Date(v.created_at),
                )}
              </strong>
              <small>{v.diagnoses.join(' · ') || t('No diagnosis recorded')}</small>
            </span>
            <span>
              {t(v.completed ? 'Completed' : 'Draft')} · {t('Revision')} {v.current_revision}
            </span>
          </summary>
          <div className="record-body">
            <h3>{t('Clinical notes')}</h3>
            <p className="pre-wrap">{v.notes || '—'}</p>
            <h3>{t('Diagnosis')}</h3>
            <ul>
              {v.diagnoses.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
            <h3>{t('Prescription')}</h3>
            {v.medications.map((x) => (
              <p key={x.id}>
                <strong>
                  {x.name} {x.strength}
                </strong>{' '}
                — {x.dose} · {x.frequency} · {x.duration}
                <br />
                {x.instructions}
                <br />
                {x.notes}
              </p>
            ))}
            <h3>{t('Follow-up')}</h3>
            <p className="pre-wrap">{v.follow_up || '—'}</p>
            {v.amendment_reason && (
              <p>
                <strong>{t('Amendment reason')}: </strong>
                {v.amendment_reason}
              </p>
            )}
            <div className="inline-actions">
              {v.completed && <Button onClick={() => setPrinting(v)}>{t('Print / export')}</Button>}
              {v.completed && m.role === 'doctor' && v.doctor_id === m.user_id && (
                <Button onClick={() => setAmending(v)}>{t('Amend visit')}</Button>
              )}
            </div>
          </div>
        </details>
      ))}
      {data.data?.length === 0 && <Empty title="No visit history yet." />}
      <Pager page={page} count={data.data?.length || 0} onChange={setPage} />
      {amending && (
        <Modal
          title="Amend completed visit"
          wide
          onClose={() => {
            if (confirm(t('Discard unsaved changes?'))) setAmending(null);
          }}
        >
          <VisitEditor patient={patient} original={amending} onDone={() => setAmending(null)} />
        </Modal>
      )}
      {printing && (
        <PrintVisit patient={patient} visit={printing} onClose={() => setPrinting(null)} />
      )}
    </section>
  );
}
