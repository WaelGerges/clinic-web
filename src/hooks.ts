import { useEffect, useRef, useState } from 'react';
import { ClinicError, serviceError } from './api';
export function useResource<T>(load: () => Promise<T>, key: string) {
  const loader = useRef(load);
  loader.current = load;
  const [state, setState] = useState<{ data: T | undefined; error: string; loading: boolean }>({
    data: undefined,
    error: '',
    loading: true,
  });
  const [generation, reload] = useState(0);
  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, error: '', loading: true }));
    loader.current().then(
      (data) => {
        if (current) setState({ data, error: '', loading: false });
      },
      (e) => {
        if (current) setState((s) => ({ ...s, error: serviceError(e).message, loading: false }));
      },
    );
    return () => {
      current = false;
    };
  }, [key, generation]);
  return { ...state, reload: () => reload((x) => x + 1) };
}
export function useOperation(onSuccess?: () => void, retrySafe = true) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<ClinicError | null>(null);
  const pending = useRef<(() => Promise<void>) | null>(null),
    running = useRef(false);
  useUnsaved(busy || Boolean(error?.uncertain));
  const run = async (task?: () => Promise<void>) => {
    if (running.current) return;
    const next = pending.current || task;
    if (!next) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await next();
      pending.current = null;
      onSuccess?.();
    } catch (e) {
      const failure =
        e instanceof Error && !(e instanceof ClinicError)
          ? new ClinicError(e.message)
          : serviceError(e);
      if (failure.uncertain && !retrySafe) {
        setError(
          new ClinicError(
            'The result could not be confirmed. Check the refreshed list before submitting again.',
          ),
        );
        pending.current = null;
        onSuccess?.();
      } else {
        setError(failure);
        pending.current = failure.uncertain ? next : null;
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run, uncertain: Boolean(error?.uncertain), clear: () => setError(null) };
}
export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
