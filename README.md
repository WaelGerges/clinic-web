# Clinic Web

A responsive website for **Clinic Assistant** and **Clinic Doctor**, using the existing clinic Supabase database and mobile-app accounts.

Editorial Ledger design: ivory surfaces, dark navigation rail, serif headings, rust accents, and folder-shaped date and consultation tabs. English and Arabic, RTL, responsive layouts, and light/dark/system appearance.

## Run

Requires Node 24.

```powershell
npm ci
Copy-Item .env.example .env.local
# Set VITE_SUPABASE_PUBLISHABLE_KEY in .env.local to your existing PUBLIC key.
npm run dev
```

Open http://127.0.0.1:5173 and sign in with your existing clinic account. The workspace role comes from active database membership.

Never put service-role keys, database passwords, or Supabase secret keys in VITE variables. These variables are embedded in the browser build. Local environment files and preview certificates are excluded from Git.

## Verify and build

```powershell
npm test
npm run build
npm run format:check
npm run check:translations
npm run test:e2e
```

Browser tests use installed Microsoft Edge locally and Playwright Chromium in CI. They intercept Supabase requests with fictional fixtures and do not create hosted patient records.

Current implementation verification: 15 unit tests, 14 browser scenarios, strict TypeScript compilation and production build passed. The source mobile/backend project also passed 41 database regression tests.

## Included workflows

- Email/password access, registration, recovery, clinic creation/selection and invitation-code join.
- Patient search, registration, editing, archive/restore and role-controlled clinical alerts.
- Cairo-local appointments, duration-aware suggestions, working periods/breaks, rescheduling and booking waitlist.
- Check-in, queue, doctor presence, versioned handoff acknowledgement.
- Consultation drafts, diagnoses, prescriptions, follow-up, completion and completed-visit amendments.
- Private document upload, signature/SHA-256 verification, preview/download and archive/restore.
- Bilingual printable prescriptions, visit summaries and referrals.
- Staff invitations/access and paginated audit metadata.

## Existing backend

This repository is the standalone frontend extracted from [the clinic project](https://github.com/WaelGerges/clinic). It does not provision a second database.

The approved development target is `clinic-chatgpt-dev`, project `geikkygtnsgbtajyqdvc`. Authorization and clinic isolation remain enforced by the existing database RLS policies and checked RPCs.

[The receipt migration](docs/migrations/20260918193549_web_handoff_receipt_versions.sql) is included for reference and is **already applied** to that development project. It requires the existing clinic schema; it is not a complete database bootstrap. It preserves immutable receipt history and requires a fresh acknowledgement for each handoff version. Public mobile RPC signatures remain unchanged.

The Arabic dictionaries are committed in `src/locales`; this standalone repository does not require the Flutter translation source.

## Local mobile preview

Mobile browsers need HTTPS for Web Crypto. With a development PFX certificate containing your computer's LAN IP, set:

```powershell
$env:CLINIC_HTTPS_PFX='C:\path\to\local-preview.pfx'
$env:CLINIC_HTTPS_PASSWORD='your-local-certificate-password'
npm run dev -- --host 0.0.0.0
```

Connect the phone to the same Wi-Fi and open `https://YOUR_COMPUTER_LAN_IP:5173`. Trust only the certificate you generated for that local preview. Certificates and passwords are not included in this repository.

## Connectivity and data handling

Connectivity is required. There is no offline patient cache or service worker. Unsaved forms and pending commands remain in memory; save before closing the tab. An uncertain versioned command retries the same operation ID, payload, expiry and expected version. Unsaved consultation notes are retained if the active assignment changes.

Auth uses sessionStorage. Only language/theme preferences and a device identifier are stored locally. Membership is revalidated on entry and every 20 seconds while the tab is visible. The database remains authoritative for every operation.

Foreground doctor tabs renew presence every 20 seconds; the server lease expires approximately 60 seconds after renewals stop.

## Hosting and release gates

`npm run build` produces `dist/` for an HTTPS static server. Configure SPA fallback for all routes, including `/auth/recovery`. Adapt [the nginx configuration](deploy/nginx.example.conf) to the chosen server.

Add the exact web origin and `<origin>/auth/recovery` to the Supabase Auth redirect allowlist. Verify email confirmation and recovery in the initiating browser session because the flow uses PKCE.

This is a tested development implementation, not a certified clinical production release. Before daily clinic use:

- Configure HTTPS hosting and validate its exact security headers, document previews and printing.
- Complete owned-account Auth/email/recovery and two-device mobile/web acceptance.
- Verify backup/restore, retention, operational monitoring, load/failure behavior and required privacy controls.
- Resolve the existing hosted Auth warning for disabled leaked-password protection.

No public deployment is included.
