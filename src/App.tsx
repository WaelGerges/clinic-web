import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { client, configured } from './client';
import { api, memberships, rpc, verifyMembership, serviceError } from './api';
import { clinicToday, type Membership } from './domain';
import { useLanguage } from './i18n';
import { useOperation, useResource, useUnsaved } from './hooks';
import { Button, Field, Icon, OperationNotice, ErrorMessage, Empty } from './ui';
import { WorkspaceProvider } from './state';
import { Schedule } from './Schedule';
import { Patients, PatientRecord } from './Patients';
import { Consultation } from './Consultation';
import { Settings } from './Settings';

export function App() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [recovery, setRecovery] = useState(location.pathname === '/auth/recovery'),
    [membership, setMembership] = useState<Membership | null>(null);
  const [authError, setAuthError] = useState('');
  const { locale, setLocale, t } = useLanguage();
  useEffect(() => {
    document.documentElement.dataset.theme = localStorage.getItem('clinic-theme') || 'light';
  }, []);
  useEffect(() => {
    let current = true;
    client.auth.getSession().then(({ data, error }) => {
      if (current) {
        setSession(data.session);
        setReady(true);
        if (error) setAuthError(t('Your session expired. Sign in again.'));
      }
    });
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setReady(true);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') {
        setMembership(null);
        setRecovery(false);
      }
    });
    return () => {
      current = false;
      subscription.unsubscribe();
    };
  }, []);
  if (!ready)
    return (
      <main className="auth-shell">
        <p role="status">{t('Connecting to your clinic…')}</p>
      </main>
    );
  const exit = async () => {
    setMembership(null);
    setSession(null);
    await client.auth.signOut({ scope: 'local' });
  };
  return (
    <>
      <a className="skip-link" href="#main">
        {t('Skip to content')}
      </a>
      <div className="language-switch">
        <button
          onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}
          lang={locale === 'en' ? 'ar' : 'en'}
        >
          {locale === 'en' ? 'العربية' : 'English'}
        </button>
      </div>
      {!configured ? (
        <main id="main" className="auth-shell">
          <div className="auth-panel">
            <span className="eyebrow">CLINIC / WEB</span>
            <h1>{t('Connect your clinic')}</h1>
            <p>{t('The database connection has not been configured.')}</p>
            <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local.</p>
          </div>
        </main>
      ) : recovery && session ? (
        <PasswordRecovery
          done={() => {
            setRecovery(false);
            history.replaceState({}, '', '/');
          }}
        />
      ) : !session ? (
        <Auth error={authError} />
      ) : !membership ? (
        <ClinicChooser userId={session.user.id} onChoose={setMembership} onExit={exit} />
      ) : (
        <Workspace
          key={membership.clinic_id + membership.role}
          membership={membership}
          onExit={exit}
        />
      )}
    </>
  );
}

function Auth({ error }: { error: string }) {
  const { t } = useLanguage(),
    [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin'),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [message, setMessage] = useState('');
  const op = useOperation();
  const submit = () =>
    op.run(async () => {
      setMessage('');
      if (mode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + '/auth/recovery',
        });
        if (error)
          throw new Error(t('Recovery could not be requested. Check the email and try again.'));
        setMessage(t('If an account exists, a recovery email has been sent.'));
        return;
      }
      const result =
        mode === 'signup'
          ? await client.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: location.origin },
            })
          : await client.auth.signInWithPassword({ email, password });
      if (result.error)
        throw new Error(
          t(
            mode === 'signin'
              ? 'Sign-in failed. Check your email and password.'
              : 'Account creation failed. Review your email and password.',
          ),
        );
      if (mode === 'signup' && !result.data.session)
        setMessage(t('Check your email to verify your account before signing in.'));
    });
  return (
    <main id="main" className="auth-shell">
      <aside className="auth-story">
        <span className="eyebrow">THE CLINIC LEDGER</span>
        <div className="folio">01 /</div>
        <h1>{t('A clear view of every visit.')}</h1>
        <p>{t('One clinic. A shared rhythm. From the first arrival to the final note.')}</p>
        <div className="auth-rule" />
        <span>
          {t('Clinic Assistant')} <i> / </i> {t('Clinic Doctor')}
        </span>
      </aside>
      <section className="auth-panel">
        <span className="eyebrow">{t('YOUR DAILY PRACTICE')}</span>
        <h2>
          {t(
            mode === 'reset'
              ? 'Reset your password'
              : mode === 'signup'
                ? 'Create your account'
                : 'Welcome back.',
          )}
        </h2>
        <p className="muted">{t('Use the same account as your mobile app.')}</p>
        {error && <ErrorMessage message={error} />}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={op.busy}>
            <Field label="Email">
              <input
                autoFocus
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            {mode !== 'reset' && (
              <Field label="Password">
                <input
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'signup' ? 8 : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            )}
            <Button primary type="submit" icon="arrow">
              {t(
                mode === 'reset'
                  ? 'Send recovery email'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Enter your clinic',
              )}
            </Button>
          </fieldset>
        </form>
        <OperationNotice op={op} />
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
        <div className="auth-links">
          <button
            onClick={() => {
              op.clear();
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setMessage('');
            }}
          >
            {t(mode === 'signin' ? 'Create an account' : 'Back to sign in')}
          </button>
          {mode === 'signin' && (
            <button
              onClick={() => {
                setMode('reset');
                setMessage('');
              }}
            >
              {t('Forgot password?')}
            </button>
          )}
        </div>
        <p className="fine-print">
          {t('A connection is required. Sign out when using a shared computer.')}
        </p>
      </section>
    </main>
  );
}
function PasswordRecovery({ done }: { done: () => void }) {
  const { t } = useLanguage(),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    op = useOperation();
  return (
    <main id="main" className="auth-shell">
      <section className="auth-panel">
        <h1>{t('Choose a new password')}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void op.run(async () => {
              if (password !== confirm) throw new Error(t('Passwords do not match.'));
              const { error } = await client.auth.updateUser({ password });
              if (error)
                throw new Error(
                  t('The password could not be updated. Request a new recovery email.'),
                );
              await client.auth.signOut({ scope: 'global' });
              done();
            });
          }}
        >
          <Field label="New password">
            <input
              required
              type="password"
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm password">
            <input
              required
              type="password"
              minLength={8}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Button primary type="submit" disabled={op.busy}>
            {t('Update password')}
          </Button>
        </form>
        <OperationNotice op={op} />
      </section>
    </main>
  );
}
function ClinicChooser({
  userId,
  onChoose,
  onExit,
}: {
  userId: string;
  onChoose: (m: Membership) => void;
  onExit: () => void;
}) {
  const { t } = useLanguage(),
    rows = useResource(() => memberships(userId), userId),
    [name, setName] = useState(''),
    [code, setCode] = useState(''),
    op = useOperation(rows.reload, false);
  return (
    <main id="main" className="chooser">
      <span className="eyebrow">{t('YOUR DAILY PRACTICE')}</span>
      <h1>{t('Choose your clinic')}</h1>
      {rows.error && <ErrorMessage message={rows.error} retry={rows.reload} />}
      <div className="clinic-list">
        {rows.data?.map((m) => (
          <button key={m.clinic_id} onClick={() => onChoose(m)}>
            <span>
              <strong>{m.clinics.name}</strong>
              <small>{t(m.role === 'doctor' ? 'Clinic Doctor' : 'Clinic Assistant')}</small>
            </span>
            <Icon name="arrow" />
          </button>
        ))}
      </div>
      {rows.loading && <p role="status">{t('Loading…')}</p>}
      <div className="chooser-grid">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void op.run(async () => {
              await rpc('clinic_create', { p_name: name.trim() });
              setName('');
            });
          }}
        >
          <h2>{t('Start a clinic')}</h2>
          <p>{t('Create a clinic as its doctor administrator.')}</p>
          <Field label="Clinic name">
            <input
              required
              minLength={2}
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={op.busy}>
            {t('Create clinic')}
          </Button>
        </form>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void op.run(async () => {
              await rpc('clinic_join', { p_code: code.trim() });
              setCode('');
            });
          }}
        >
          <h2>{t('Join your team')}</h2>
          <p>{t('Use the invitation code provided by your doctor.')}</p>
          <Field label="Invitation code">
            <input
              required
              maxLength={64}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Button type="submit" disabled={op.busy}>
            {t('Join clinic')}
          </Button>
        </form>
      </div>
      <OperationNotice op={op} />
      <Button onClick={onExit}>{t('Sign out')}</Button>
    </main>
  );
}

function Workspace({ membership: m, onExit }: { membership: Membership; onExit: () => void }) {
  const { t, locale } = useLanguage(),
    [view, setView] = useState(m.role === 'doctor' ? 'consult' : 'schedule'),
    [patientId, setPatientId] = useState(''),
    [revision, setRevision] = useState(0),
    [online, setOnline] = useState(navigator.onLine),
    [error, setError] = useState(''),
    [checked, setChecked] = useState(false),
    [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useUnsaved(dirty);
  const zone = m.clinics.time_zone || 'Africa/Cairo',
    refresh = useCallback(() => setRevision((x) => x + 1), []);
  const leave = () =>
    !dirtyRef.current || confirm(t('You have unsaved changes. Leave this screen?'));
  const navigate = (next: string) => {
    if (leave()) {
      setDirty(false);
      setPatientId('');
      setView(next);
    }
  };
  useEffect(() => {
    let mounted = true,
      running = false;
    const verify = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        await verifyMembership(m);
        if (!mounted) return;
        setChecked(true);
        setError('');
        if (m.role === 'doctor') await api.heartbeat(m);
        if (mounted) {
          setOnline(navigator.onLine);
          refresh();
        }
      } catch (e) {
        const failure = serviceError(e);
        if (mounted) {
          if (failure.access) {
            setChecked(false);
            setError(failure.message);
          } else {
            setOnline(false);
            setError(failure.message);
          }
        }
      } finally {
        running = false;
      }
    };
    const connectivity = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void verify();
    };
    void verify();
    const timer = window.setInterval(() => void verify(), 20000);
    const channel = client
      .channel('web:' + m.clinic_id)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: 'clinic_id=eq.' + m.clinic_id,
        },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'patients', filter: 'clinic_id=eq.' + m.clinic_id },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visits', filter: 'clinic_id=eq.' + m.clinic_id },
        refresh,
      )
      .subscribe();
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    document.addEventListener('visibilitychange', connectivity);
    return () => {
      mounted = false;
      clearInterval(timer);
      void client.removeChannel(channel);
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      document.removeEventListener('visibilitychange', connectivity);
    };
  }, [m, refresh]);
  const nav = [
    ...(m.role === 'doctor' ? [{ id: 'consult', label: 'Consultation', icon: 'consult' }] : []),
    { id: 'schedule', label: 'Schedule', icon: 'schedule' },
    { id: 'patients', label: 'Patients', icon: 'patients' },
    { id: 'queue', label: 'Queue', icon: 'queue' },
    { id: 'documents', label: 'Documents', icon: 'documents' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];
  const date = new Date(clinicToday(zone) + 'T12:00:00Z');
  return (
    <WorkspaceProvider
      value={{
        membership: m,
        zone,
        revision,
        refresh,
        online: online && checked,
        isDirty: dirty,
        setDirty,
        selectPatient: (id) => {
          if (leave()) {
            setDirty(false);
            setPatientId(id);
            setView(view === 'documents' ? 'documents' : 'patients');
          }
        },
        openConsult: () => navigate('consult'),
      }}
    >
      <div className="app-shell">
        <aside className="rail">
          <div className="rail-brand" aria-label="Clinic">
            c<span>.</span>
          </div>
          <div className={'connection ' + (online ? 'connected' : '')}>
            <i />
            <span>{t(online ? 'Online' : 'Offline')}</span>
          </div>
          <nav aria-label={t('Main navigation')}>
            {nav.map((item) => (
              <button
                key={item.id}
                className={view === item.id ? 'active' : ''}
                aria-current={view === item.id ? 'page' : undefined}
                onClick={() => navigate(item.id)}
              >
                <Icon name={item.icon} />
                <span>{t(item.label)}</span>
              </button>
            ))}
          </nav>
          <button
            className="rail-exit"
            onClick={() => {
              if (leave()) void onExit();
            }}
          >
            <Icon name="logout" />
            <span>{t('Sign out')}</span>
          </button>
          <span className="rail-edition">WEB / 01</span>
        </aside>
        <main id="main" className="workspace">
          <header className="masthead">
            <div>
              <span className="eyebrow">{m.clinics.name}</span>
              <h1>{t(m.role === 'doctor' ? 'Clinic Doctor' : 'Clinic Assistant')}</h1>
              <p>
                {t(
                  m.role === 'doctor'
                    ? 'Consult, document and complete patient visits.'
                    : 'Reception, appointments and patient flow.',
                )}
              </p>
            </div>
            <div className="date-lockup">
              <strong>
                {new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(date)}{' '}
                <span>/</span>{' '}
                {new Intl.DateTimeFormat(locale, { day: '2-digit', timeZone: 'UTC' }).format(date)}
              </strong>
              <span>
                {new Intl.DateTimeFormat(locale, {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                }).format(date)}
              </span>
              <small>{zone}</small>
            </div>
          </header>
          {error && <ErrorMessage message={error} retry={refresh} />}{' '}
          {!online && (
            <div className="notice error">
              {t('Connection required. Changes are disabled until the clinic reconnects.')}
            </div>
          )}
          {!checked ? (
            <Empty
              title={error ? 'Clinic access could not be verified.' : 'Connecting to your clinic…'}
            />
          ) : patientId ? (
            <PatientRecord
              key={patientId}
              id={patientId}
              initialTab={view === 'documents' ? 'documents' : 'details'}
              onBack={() => navigate('patients')}
            />
          ) : view === 'consult' ? (
            <Consultation />
          ) : view === 'schedule' || view === 'queue' ? (
            <Schedule key={view} queueOnly={view === 'queue'} />
          ) : view === 'patients' || view === 'documents' ? (
            <Patients key={view} documentsOnly={view === 'documents'} />
          ) : (
            <Settings />
          )}
          <footer className="workspace-footer">
            <span>{m.clinics.name}</span>
            <button
              className="text-link mobile-signout"
              onClick={() => {
                if (leave()) void onExit();
              }}
            >
              {t('Sign out')}
            </button>
            <span>{t('Shared records. Connected care.')}</span>
            <span>
              {t('Clinic local time')} · {zone}
            </span>
          </footer>
        </main>
      </div>
    </WorkspaceProvider>
  );
}
