import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key && key !== 'sb_publishable_REPLACE_ME');
if (key?.startsWith('sb_secret_')) throw new Error('A public publishable key is required.');
if (key?.startsWith('eyJ')) {
  try {
    if (JSON.parse(atob(key.split('.')[1])).role !== 'anon')
      throw new Error('Privileged API keys must never be used in a browser.');
  } catch {
    throw new Error('Use a publishable API key.');
  }
}
export const client = createClient(
  url || 'https://unconfigured.supabase.co',
  key || 'unconfigured',
  {
    auth: {
      storage: window.sessionStorage,
      storageKey: 'clinic-web-auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
    global: { headers: { 'X-Client-Info': 'clinic-web/0.1' } },
  },
);
export const deviceId = sessionStorage.getItem('clinic-web-device') || crypto.randomUUID();
sessionStorage.setItem('clinic-web-device', deviceId);
