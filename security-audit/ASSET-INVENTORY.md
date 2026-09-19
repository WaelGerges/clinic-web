# Asset inventory

Commit `ffed830`, database `geikkygtnsgbtajyqdvc`. "Reviewed" means the file or object was read in full during this assessment.

## 1. First-party source (all reviewed)

| File | Lines | Security-relevant role |
|---|---|---|
| `src/client.ts` | 30 | Supabase client construction; publishable-key guards; sessionStorage auth; device id |
| `src/api.ts` | 396 | Every network call: 8 table reads, 14 RPCs, Storage upload/download, error mapping, command envelope |
| `src/domain.ts` | 320 | Validation, Cairo time, phone normalisation, magic-byte MIME detection, SHA-256, extension/download-name binding |
| `src/App.tsx` | 618 | Auth, recovery route, clinic chooser, membership revalidation loop, realtime subscription, navigation |
| `src/Patients.tsx` | 452 | Patient search/registration/edit/archive; alerts field gating |
| `src/Schedule.tsx` | 548 | Booking, slots, status transitions, queue, handoff send |
| `src/Consultation.tsx` | 543 | Receipt acknowledgement, visit editor, completion, amendments, history |
| `src/Documents.tsx` | 232 | Upload/preview/download/archive; blob URLs; iframe preview |
| `src/Settings.tsx` | 426 | Preferences, working hours, waitlist, staff access, invitations, audit history |
| `src/PrintVisit.tsx` | 173 | Print iframe built with `createElement`/`textContent` only |
| `src/ui.tsx` | 297 | Presentational primitives; no raw HTML sink |
| `src/state.tsx`, `src/hooks.ts`, `src/i18n.tsx`, `src/main.tsx` | 143 | Workspace context, retry/idempotency hook, locale, error boundary |
| `src/locales/ar.json`, `web-ar.json` | — | Translation data only |
| `src/styles.css` | — | No `expression()`, no remote `url()` |
| `tests/fixture.ts`, `tests/workflows.spec.ts`, `src/domain.test.ts` | 738 | Mocked Supabase fixtures; **passing these proves nothing about database authorization** |
| `scripts/check-translations.mjs` | 57 | Build-time only |
| `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json` | — | Build/test configuration; dev-server HTTPS from PFX env vars |
| `.github/workflows/web.yml` | 27 | CI: `contents: read`, no secrets, runs on `pull_request` |
| `deploy/nginx.example.conf` | 29 | Example headers/CSP — **not proof of any deployed configuration** |
| `docs/migrations/2026…_web_handoff_receipt_versions.sql` | 155 | Reference copy of a previously applied migration |
| `index.html` | 1 | `referrer=no-referrer`, `robots=noindex,nofollow` |

Excluded: `node_modules/` (third party), `dist/` (generated, git-ignored, scanned for secrets), `public/fonts` and `test-artifacts/` (binary assets, no code).

## 2. Client-reachable API surface

### PostgREST table reads (SELECT only; no INSERT/UPDATE/DELETE grant exists)

`clinic_memberships`, `clinics` (via embed), `patients`, `appointments`, `visit_details` (view), `attachments`, `audit_events` (metadata columns only after this audit).

### RPCs called by the web client

| RPC | Caller role in UI | Server gate |
|---|---|---|
| `clinic_create` | any signed-in | confirmed e-mail; ≤20 clinics per user |
| `clinic_join` | any signed-in | confirmed e-mail, 64-char code, hash lookup, expiry, single use, membership cutoff |
| `clinic_search_patients` | member | SECURITY INVOKER → RLS; limit clamped 1–100 |
| `clinic_apply_command` | member (visit: doctor) | version + operation-id receipt, `_expires_at` for critical actions, per-clinic advisory lock |
| `clinic_doctor_heartbeat` | doctor | active doctor membership; ≤10 device rows |
| `clinic_doctor_delivery_state` | member | membership + doctor/appointment identity |
| `clinic_acknowledge_appointment` | doctor | assigned doctor, registered device, exact version, immutable receipt |
| `clinic_schedule` | member (settings: admin) | period schema/overlap validation |
| `clinic_begin_attachment` / `_finalize_` / `_fail_` / `_authorize_attachment_access` / `_set_attachment_archived` | member (+clinical) | server-generated path, MIME allowlist, extension binding, size/mimetype re-check, 90 s audited lease |
| `clinic_staff`, `clinic_invite_assistant`, `clinic_set_staff_access` | admin doctor | `allowed(clinic,'admin')`, 20 invitations/hour |

Not called by the web client but reachable: `clinic_fail_attachment` (used by the mobile app).

### Storage

Bucket `clinic-documents` (private, 20 MiB, 4 MIME types). Upload path is server-generated `clinic/patient/attachment`; read needs an unexpired lease row; no UPDATE or DELETE policy.

### Realtime

Channel `web:{clinic_id}`, `postgres_changes` on `appointments`, `patients`, `visits`, filtered by `clinic_id`; RLS evaluated per subscriber. Used only as a refresh signal.

### Absent surfaces (verified, not assumed)

Edge Functions (none deployed, none in repo), GraphQL (`pg_graphql` not installed), webhooks, `pg_cron`, `pg_net`, `http`, server-side fetch of any kind, WebViews, `postMessage` listeners, service worker, offline cache.

## 3. Database objects

11 RLS tables + 1 `security_invoker` view in `public`; 8 RLS tables in `clinic_private` with no policies and no client grants; 25 `clinic_private` functions (22 definer); 16 `public.clinic_*` wrappers; 6 `immutable_*` triggers; `validate_booking`; `revoke_attachment_grants_on_state`. Full detail in `DATABASE-REVIEW.md`.

## 4. Data classification

| Class | Where |
|---|---|
| Clinical (highest) | `visits`, `visit_revisions`, `diagnoses`, `prescriptions`, `prescription_items`, `patients.alerts`, clinical `attachments` + their bytes, `audit_events` payload columns |
| Patient PII | `patients` (name, birth date, mobiles, address, notes), realtime payloads, print output, downloaded files |
| Account | `auth.users` e-mails (exposed only to clinic admins via `clinic_staff`), JWTs in `sessionStorage` |
| Operational | `audit_events` metadata, `operation_receipts` (request/response JSON, no client grant), presence, invitations (hashed) |

Sensitive data leaves the browser only to the Supabase project. It reaches: browser memory, `sessionStorage` (token), blob URLs, the print iframe, and files the user saves. It is never placed in URLs, `localStorage` (language/theme/device id only), or any analytics or error-reporting service (there is none).

## 5. Deployment assets

`dist/` (static bundle, no source maps, CSP meta after this audit), `deploy/nginx.example.conf`, GitHub Actions workflow. No hosting, no CDN, no domain, no TLS material in the repository (`*.pfx`/`*.pem`/`*.key` are git-ignored and absent).
