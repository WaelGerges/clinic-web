import { useEffect, useState } from 'react';
import { api, executeCommand, prepareCommand } from './api';
import { age, clinicToday, patientPayload, validatePatient, type Patient } from './domain';
import { useWorkspace } from './state';
import { useLanguage } from './i18n';
import { useOperation, useResource, useUnsaved } from './hooks';
import {
  Button,
  Empty,
  ErrorMessage,
  Field,
  Icon,
  Modal,
  OperationNotice,
  Pager,
  Tabs,
} from './ui';
import { AppointmentForm } from './Schedule';
import { Documents } from './Documents';
import { VisitHistory } from './Consultation';

export function PatientPicker({
  value,
  onChange,
}: {
  value: Patient | null;
  onChange: (p: Patient) => void;
}) {
  const { membership: m } = useWorkspace(),
    { t } = useLanguage(),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const rows = useResource(() => api.patients(m.clinic_id, query), m.clinic_id + query);
  return (
    <div className="patient-picker">
      <Field label="Find a patient">
        <input
          placeholder={t('Name, patient ID or phone')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Field>
      {value && (
        <div className="selected-patient">
          <strong>{value.full_name}</strong>
          <span>P-{value.patient_number}</span>
        </div>
      )}
      {rows.error && <ErrorMessage message={rows.error} />}
      <div className="picker-results" aria-label={t('Patients')}>
        {rows.data?.slice(0, 12).map((p) => (
          <button
            type="button"
            key={p.id}
            className={value?.id === p.id ? 'selected' : ''}
            onClick={() => onChange(p)}
          >
            <strong>{p.full_name}</strong>
            <small>
              P-{p.patient_number} · <bdi>{p.mobile}</bdi>
            </small>
          </button>
        ))}
      </div>
    </div>
  );
}
export function Patients({ documentsOnly = false }: { documentsOnly?: boolean }) {
  const { membership: m, revision, selectPatient, online } = useWorkspace(),
    { t } = useLanguage();
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [archived, setArchived] = useState(false),
    [creating, setCreating] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const rows = useResource(
    () => api.patients(m.clinic_id, query, page * 50, archived),
    [query, page, archived, revision].join(':'),
  );
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t('THE PATIENT REGISTER')}</span>
          <h2>{t(documentsOnly ? 'Patient documents' : 'Patients')}</h2>
        </div>
        <Button primary icon="plus" disabled={!online} onClick={() => setCreating(true)}>
          {t('Register patient')}
        </Button>
      </div>
      <div className="toolbar">
        <div className="search-input">
          <Icon name="search" />
          <input
            aria-label={t('Search patients')}
            placeholder={t('Search by name, patient ID or phone')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setPage(0);
            }}
          />
          {t('Archived patients')}
        </label>
      </div>
      {rows.error && <ErrorMessage message={rows.error} retry={rows.reload} />}
      <div className="table-scroll">
        <table className="ledger">
          <thead>
            <tr>
              <th>{t('Patient')}</th>
              <th>{t('Patient ID')}</th>
              <th>{t('Phone')}</th>
              <th>{t('Gender')}</th>
              <th>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.data?.map((p) => (
              <tr key={p.id}>
                <td>
                  <button className="text-link patient-name" onClick={() => selectPatient(p.id)}>
                    {p.full_name}
                  </button>
                  <small>{p.birth_date}</small>
                </td>
                <td className="mono">P-{p.patient_number}</td>
                <td>
                  <bdi>{p.mobile}</bdi>
                </td>
                <td>{t(p.gender)}</td>
                <td>
                  <Button onClick={() => selectPatient(p.id)}>
                    {t(documentsOnly ? 'Documents' : 'Open record')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.loading && <p role="status">{t('Loading…')}</p>}
      {rows.data?.length === 0 && (
        <Empty title="No patients found.">{t('Register a patient or try another search.')}</Empty>
      )}
      <Pager page={page} count={rows.data?.length || 0} onChange={setPage} />
      {creating && (
        <PatientForm
          onClose={() => setCreating(false)}
          onSaved={(p) => {
            setCreating(false);
            selectPatient(p.id);
          }}
        />
      )}
    </section>
  );
}
export function PatientForm({
  patient,
  onClose,
  onSaved,
}: {
  patient?: Patient;
  onClose: () => void;
  onSaved: (p: Patient) => void;
}) {
  const { membership: m, zone, refresh, online } = useWorkspace(),
    { t } = useLanguage();
  const [value, setValue] = useState<Patient>(
    () =>
      patient || {
        id: crypto.randomUUID(),
        clinic_id: m.clinic_id,
        patient_number: 0,
        full_name: '',
        gender: 'Not specified',
        birth_date: '',
        mobile: '',
        secondary_mobile: '',
        address: '',
        notes: '',
        alerts: '',
        archived: false,
        version: 0,
      },
  );
  const [dirty, setDirty] = useState(false),
    op = useOperation();
  useUnsaved(dirty);
  const update = (key: keyof Patient, text: string) => {
    setDirty(true);
    setValue((v) => ({ ...v, [key]: text }));
  };
  const close = () => {
    if (!dirty || confirm(t('Discard unsaved changes?'))) onClose();
  };
  return (
    <Modal
      title={patient ? 'Edit patient' : 'Register patient'}
      onClose={close}
      locked={op.busy || op.uncertain}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const command = prepareCommand(
            m.clinic_id,
            'patient',
            value.id,
            'save',
            patientPayload(value, m.role === 'doctor'),
            value.version,
          );
          void op.run(async () => {
            validatePatient(value, clinicToday(zone));
            const result = await executeCommand<Patient>(command);
            setDirty(false);
            refresh();
            onSaved(result.entity);
          });
        }}
      >
        <fieldset disabled={op.busy || op.uncertain || !online}>
          <div className="form-grid">
            <Field label="Full name">
              <input
                autoFocus
                required
                minLength={2}
                maxLength={300}
                value={value.full_name}
                onChange={(e) => update('full_name', e.target.value)}
              />
            </Field>
            <Field label="Gender">
              <select value={value.gender} onChange={(e) => update('gender', e.target.value)}>
                {['Not specified', 'Female', 'Male', 'Other'].map((x) => (
                  <option key={x} value={x}>
                    {t(x)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Birth date">
              <input
                type="date"
                required
                min="1800-01-01"
                max={clinicToday(zone)}
                value={value.birth_date}
                onChange={(e) => update('birth_date', e.target.value)}
              />
            </Field>
            <Field label="Mobile">
              <input
                required
                inputMode="tel"
                maxLength={40}
                value={value.mobile}
                onChange={(e) => update('mobile', e.target.value)}
              />
            </Field>
            <Field label="Secondary mobile">
              <input
                inputMode="tel"
                maxLength={40}
                value={value.secondary_mobile}
                onChange={(e) => update('secondary_mobile', e.target.value)}
              />
            </Field>
            <Field label="Address">
              <input
                maxLength={500}
                value={value.address}
                onChange={(e) => update('address', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Administrative notes">
            <textarea
              rows={3}
              maxLength={5000}
              value={value.notes}
              onChange={(e) => update('notes', e.target.value)}
            />
          </Field>
          {m.role === 'doctor' && (
            <Field label="Clinical alerts">
              <textarea
                rows={2}
                maxLength={2000}
                value={value.alerts}
                onChange={(e) => update('alerts', e.target.value)}
              />
            </Field>
          )}
          <div className="form-actions">
            <Button onClick={close}>{t('Cancel')}</Button>
            <Button primary type="submit">
              {t('Save patient')}
            </Button>
          </div>
        </fieldset>
        <OperationNotice op={op} />
      </form>
    </Modal>
  );
}
export function PatientRecord({
  id,
  onBack,
  initialTab = 'details',
}: {
  id: string;
  onBack: () => void;
  initialTab?: string;
}) {
  const { membership: m, zone, revision, refresh, online } = useWorkspace(),
    { t } = useLanguage(),
    [tab, setTab] = useState(initialTab),
    [editing, setEditing] = useState(false),
    [booking, setBooking] = useState(false);
  const data = useResource(() => api.patient(m.clinic_id, id), id + revision),
    op = useOperation(),
    p = data.data;
  if (data.error) return <ErrorMessage message={data.error} retry={data.reload} />;
  if (!p) return <p role="status">{t('Loading…')}</p>;
  const archive = () => {
    if (
      !confirm(
        t(
          p.archived
            ? 'Restore this patient?'
            : 'Archive this patient? The record will be retained.',
        ),
      )
    )
      return;
    const command = prepareCommand(
      m.clinic_id,
      'patient',
      p.id,
      'save',
      patientPayload({ ...p, archived: !p.archived }, m.role === 'doctor'),
      p.version,
    );
    void op.run(async () => {
      await executeCommand(command);
      refresh();
    });
  };
  return (
    <section>
      <Button onClick={onBack}>{t('Back to patients')}</Button>
      <div className="patient-banner">
        <div>
          <span className="eyebrow">P-{p.patient_number}</span>
          <h2>{p.full_name}</h2>
          <span>
            {age(p.birth_date, clinicToday(zone))} {t('years')} · {t(p.gender)}
            {p.archived ? ' · ' + t('Archived') : ''}
          </span>
        </div>
        <div className="inline-actions">
          <Button
            icon="plus"
            primary
            disabled={!online || p.archived}
            onClick={() => setBooking(true)}
          >
            {t('Book appointment')}
          </Button>
          <Button onClick={() => setEditing(true)} disabled={!online}>
            {t('Edit patient')}
          </Button>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'details', label: 'Patient information' },
          ...(m.role === 'doctor' || m.clinical_read ? [{ id: 'history', label: 'History' }] : []),
          { id: 'documents', label: 'Documents' },
        ]}
      />
      {tab === 'details' ? (
        <div className="patient-details">
          <dl>
            <dt>{t('Patient ID')}</dt>
            <dd>P-{p.patient_number}</dd>
            <dt>{t('Birth date')}</dt>
            <dd>{p.birth_date}</dd>
            <dt>{t('Mobile')}</dt>
            <dd>
              <bdi>{p.mobile}</bdi>
            </dd>
            <dt>{t('Secondary mobile')}</dt>
            <dd>{p.secondary_mobile || '—'}</dd>
            <dt>{t('Address')}</dt>
            <dd>{p.address || '—'}</dd>
          </dl>
          <div>
            <h3>{t('Clinical alerts')}</h3>
            <p className={p.alerts ? 'alert-text' : 'muted'}>{p.alerts || t('Not recorded')}</p>
            <h3>{t('Administrative notes')}</h3>
            <p className="pre-wrap">{p.notes || t('Not recorded')}</p>
            <Button disabled={!online || op.busy || op.uncertain} onClick={archive}>
              {t(p.archived ? 'Restore patient' : 'Archive patient')}
            </Button>
            <OperationNotice op={op} />
          </div>
        </div>
      ) : tab === 'history' ? (
        <VisitHistory patient={p} />
      ) : (
        <Documents patient={p} />
      )}
      {editing && (
        <PatientForm
          patient={p}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
      {booking && <AppointmentForm patient={p} onClose={() => setBooking(false)} />}
    </section>
  );
}
