# Owner actions — Supabase dashboard checklist

Four items from the 19 September 2026 assessment need the Supabase dashboard. I could not perform them: no browser session was connected, the Supabase CLI was not authenticated, and `supabase login` requires your credentials. Project: **clinic-chatgpt-dev** (`geikkygtnsgbtajyqdvc`).

Dashboard labels move between releases. The links below are stable; if a label sits under a different heading than I describe, search the page for the setting name.

---

## 1. Secure password change — closes the last part of CW-01

**Why.** Without this, a signed-in session can set a new password without supplying the current one. That turns a minute at an unlocked reception machine into permanent account takeover. My code fix stops the app from _showing_ that form, but it can still be driven from the browser console, so this setting is the real control.

**Where.** [Authentication → Sign In / Providers](https://supabase.com/dashboard/project/geikkygtnsgbtajyqdvc/auth/providers) → **Email** provider.

**Do.** Turn on **"Secure password change"** (it may read "Require current password to update password"). Save.

**Verify.** Sign in to the web app, open the browser console, and run `await supabase.auth.updateUser({ password: 'SomeNewPassword123!' })`. It should now fail with a re-authentication error instead of succeeding.

---

## 2. Password strength — closes CW-12 and completes CW-06

**Why.** Accounts are e-mail and password only, shared with both mobile apps, and a doctor account carries full clinical read/write plus staff administration. The 12-character minimum I added to the web client is advisory; only the project setting enforces it.

**Where.** [Authentication → Sign In / Providers](https://supabase.com/dashboard/project/geikkygtnsgbtajyqdvc/auth/providers) → **Password settings** section (sometimes under Authentication → Policies).

**Do.**

- Set **Minimum password length** to **12**.
- Turn on **"Prevent use of leaked passwords"** (HaveIBeenPwned check).

**Verify.** [Advisors → Security](https://supabase.com/dashboard/project/geikkygtnsgbtajyqdvc/advisors/security) — the `auth_leaked_password_protection` warning disappears. Tell me and I will re-run the advisor to confirm.

---

## 3. Delete one orphaned storage object — closes CW-17 for this audit

**Why.** My authorization tests left a single 70-byte PNG with no database row pointing at it. It is inert (no `attachments` row means no client can read it), but it should not linger.

**Where.** [Storage → clinic-documents](https://supabase.com/dashboard/project/geikkygtnsgbtajyqdvc/storage/buckets/clinic-documents).

**Do.** Open the folder `fea6cab4-7fca-4944-8917-3fa29722dd7e`, then `674c11d0-7bc5-4a6a-9ffe-673bd97c7acf`, and delete the object `b6bf9e54-009e-436b-8859-2900b4bdb76d`. Deleting the whole `fea6cab4-…` folder is equivalent — nothing else lives under it.

**Do not touch** the other folder, `babaf4d2-c20b-4c92-be56-6c57fdc3291f`. That is a real 4.4 MB attachment with a live database row.

**Verify.** The `fea6cab4-…` prefix is gone. I can confirm from the database on request.

---

## 4. Redirect allowlist — do this only once hosting exists

**Why.** Recovery uses PKCE and will not complete unless the exact origin is allowlisted. Leaving it wide open would also let a recovery code be redirected off-site.

**Where.** [Authentication → URL Configuration](https://supabase.com/dashboard/project/geikkygtnsgbtajyqdvc/auth/url-configuration).

**Do.** Set **Site URL** to the web origin, and list exactly two **Redirect URLs**: the origin, and `<origin>/auth/recovery`. Remove wildcards and any leftover localhost entries before going live.

**Verify.** Request a password reset and complete it in the browser that started it. PKCE binds the code to that browser, so it must be the same one.

---

## Not on this list, and why

| Item                                                                                                           | Status                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy the site and verify its real headers                                                                    | Needs a hosting decision and credentials. Use `deploy/nginx.example.conf`; the meta-tag CSP I added does not cover `frame-ancestors` or HSTS |
| Backups, restore drill, retention, monitoring                                                                  | Unverified in this assessment. Required before clinical use                                                                                  |
| Server-side document verification (CW-11), receipt gate (CW-13), audit retention (CW-03 residual), MFA (CW-12) | **Deferred by your decision on 19 September 2026.** They remain written proposals in `proposed-fixes/`, not applied anywhere                 |

Tell me when items 1 to 3 are done and I will re-run the advisor and the catalog checks to confirm.
