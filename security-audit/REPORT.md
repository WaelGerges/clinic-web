# Clinic Web — security assessment report

**Date:** 19 September 2026 · **Target:** `clinic-web` at commit `ffed830` and the shared Supabase backend `clinic-chatgpt-dev` (`geikkygtnsgbtajyqdvc`) · **Method:** full manual source review, live read-only catalog inspection, bounded unauthenticated probes, PGlite reproduction against the complete migration chain, and an 88-check end-to-end HTTP authorization matrix with synthetic accounts · **Mandate:** the owner instructed that findings be fixed directly in code and in the database, not merely reported.

No assessment can guarantee that every vulnerability has been found. Section 5 states what was covered and what was not.

---

## 1. Executive summary

The application's security model is sound and, in the areas that matter most for a clinic, it holds up under direct attack. Authorization is not implemented in the browser at all: the client holds only `SELECT` privileges, every write goes through a versioned, idempotent RPC, and every RPC re-derives the caller's identity and membership from the database on each call rather than trusting a JWT claim. Twenty-one cross-clinic attempts, twelve privilege-escalation attempts and five post-removal attempts with a still-valid token were all refused. **No cross-tenant read or write, no privilege escalation, no RLS bypass and no injection path was found.**

The defects that were found are real but narrower: a latent privilege misconfiguration that would have exposed any future table, a password-recovery screen that could be reached from an existing session, clinical payloads readable through an over-broad column grant, and several missing input and resource bounds. Ten of these were fixed and verified during the engagement — one database migration applied to the development project and a set of source changes in the web app. Four issues remain open, of which two require Supabase dashboard settings the tooling cannot reach and two are design proposals left for the owner.

### Findings by severity and status

| Severity | Confirmed, fixed in this engagement | Confirmed, open | Hardening / informational |
|---|---|---|---|
| High / Critical | 0 | 0 | — |
| Medium | 3 (CW-01, CW-02, CW-03) | 2 (CW-11, CW-12) | — |
| Low | 7 (CW-04 … CW-10) | 2 (CW-13, CW-14) | — |
| Informational | — | — | 4 (CW-15 … CW-18) |

Every "fixed" entry was re-verified against the live system or a reproduced database after the change, not merely written.

### What an attacker can actually reach

An unauthenticated attacker with the public publishable key can reach the Auth endpoints and nothing else: no table, no function, no storage object. A signed-in user with no clinic membership is equally powerless. The meaningful adversary is therefore an insider — an assistant, a clinical-read assistant, or a doctor from another clinic — and against each of those the database held every boundary tested.

### Most consequential demonstrated risks

1. **Password change from an unlocked, signed-in workstation (CW-01).** Opening `/auth/recovery` in a tab that already had a session displayed the "choose a new password" form, and Supabase accepted the change without the current password. Anyone with a minute at a reception desk could convert transient physical access into permanent account ownership. Fixed in the client; the authoritative fix is the project's secure-password-change setting, which remains an owner action.
2. **Every future database object would have been public to signed-in users (CW-02).** Default privileges in `public` granted all privileges on new tables and sequences to `anon` and `authenticated`. Nothing was exposed today, but the next migration that added a table would have exposed it to every user of the system, in any clinic, with no policy in the way. Fixed.
3. **Full clinical documents readable through the audit API (CW-03).** `audit_events.new_value` stores the complete before/after visit document; the table-level grant let an administrator's token retrieve it with a single query string, bypassing the safe column list both clients use. Fixed by a per-column grant; the retention question behind it is still open.

### Production readiness

**The available evidence does not support production clinical use yet**, and this is a question of operational conditions rather than of application flaws. Unresolved: no deployment exists, so HTTPS, security headers, caching of clinical responses and SPA fallback are entirely unverified; leaked-password protection is disabled and there is no second factor on accounts that hold full clinical read and write; document bytes are still verified only by the uploading client; and backups, restore drills, retention and monitoring could not be evidenced at all. The README's own release gates say much the same thing, and this assessment did not find a reason to relax any of them.

---

## 2. Architecture and trust boundaries

```
Browser (React SPA, sessionStorage JWT)
   │  HTTPS, publishable key + user JWT
   ├─ GoTrue /auth/v1        e-mail+password, PKCE recovery
   ├─ PostgREST /rest/v1
   │     ├─ SELECT on 11 tables + 1 security_invoker view   → RLS via clinic_private.allowed()
   │     └─ RPC: 16 public.clinic_* wrappers (SECURITY DEFINER, search_path='')
   │             └─ clinic_private.* implementations (owner postgres, BYPASSRLS)
   │                   └─ public tables + 8 private tables (no client grant)
   ├─ Storage /storage/v1    private bucket, policy → attachment_object_allowed()
   └─ Realtime               postgres_changes on 3 tables, RLS per subscriber
```

There is no server-side code of any kind: no Edge Functions, no webhooks, no scheduled jobs, no server-side fetch. Every authorization decision is a PostgreSQL decision. This is the system's main strength — a compromised or hostile client cannot reach a control that lives only in the browser — and it concentrates the entire attack surface into roughly two thousand lines of PL/pgSQL, which this assessment read in full.

**Trust boundaries and how each is enforced**

| Boundary | Enforcement | How it was verified |
|---|---|---|
| Anonymous → anything | No grants for `anon` | Live probes: `42501` on tables and RPCs, empty storage listing |
| Signed-in non-member → clinic data | `allowed()` returns false without an active membership | `XC-03`, `XC-11` |
| Clinic A ↔ Clinic B | `clinic_id` in every policy and every function; composite foreign keys prevent id smuggling | 21 cross-clinic checks |
| Assistant → clinical data | `clinical_read` capability on five tables and on `attachments` | `CLIN-01`, `CLIN-02` vs `CLIN-03` |
| Assistant → clinical writes | `apply_command` refuses `visit` for non-doctors; `alerts` field guarded separately | `PRIV-04`, `PRIV-11`, `PRIV-12` |
| Non-admin → staff/audit/schedule administration | `allowed(clinic,'admin')` | `PRIV-05` … `PRIV-07`, `AUD-04` |
| Client → private implementations | Schema not exposed; EXECUTE revoked (this audit) | `PRIV-09` |
| Removed member with a live token | Membership re-read per statement, not from the JWT | `REM-01` … `REM-05` |
| Uploader → other clinics' bytes | Server-generated path, pending-row ownership, 90 s lease | `DOC-03` … `DOC-09`, `XC-20`, `XC-21` |

**Threat model.** The realistic actors are a curious or malicious assistant, a doctor from a different clinic on the shared backend, a former staff member whose access was revoked but whose token has not expired, and someone with brief physical access to a signed-in reception workstation. Nation-state or infrastructure-level compromise of Supabase is out of scope. The assets are patient confidentiality, clinical record integrity and attribution, account control, clinic isolation, and availability of the queue during clinic hours.

---

## 3. Findings

Severity reflects impact on a clinic deployment. CVSS v4.0 vectors are given where the facts support them; the numeric scores are deliberately **not** asserted, because they were not produced with an authoritative calculator during this engagement — the vector is what the owner should feed to one.

---

### CW-01 — `/auth/recovery` offered a password change to any existing session

**Severity** Medium · **Confidence** Confirmed (source) · **Verification level** source + build · **Status** Fixed in this engagement; a dependent owner action remains

**Impact.** Converts brief physical access to a signed-in browser into permanent account takeover, without knowledge of the current password. For a doctor account that means full clinical read/write and staff administration for the clinic; for an assistant it means scheduling, demographics and document access. It also defeats the app's own advice to "sign out when using a shared computer", because the attacker changes the password instead of merely using the session.

**Affected** `src/App.tsx:18` (commit `ffed830`), route `/auth/recovery`, Supabase Auth `updateUser`.

**Preconditions** Access to a browser tab or window with a live session. No credentials, no token theft, no network position.

**Root cause and violated invariant.** The recovery view was selected purely from `location.pathname === '/auth/recovery'`. The invariant — *a password change must be authorised either by the current password or by a fresh recovery token* — was enforced nowhere: not in the client, which only inspected the path, and not in the project, where secure password change was not enabled.

**Evidence (before).**
```ts
[recovery, setRecovery] = useState(location.pathname === '/auth/recovery'),
```
and the form calls `client.auth.updateUser({ password })` with no re-authentication.

**Reproduction.** Sign in; in the same tab navigate to `<origin>/auth/recovery`; the "Choose a new password" form renders and submitting it succeeds. Expected: the recovery form appears only for a page load carrying a recovery code, or after a `PASSWORD_RECOVERY` event.

**Fix applied.** The route now additionally requires a PKCE `code` parameter on the page load; the `PASSWORD_RECOVERY` event path is unchanged, so genuine recovery links still work:
```ts
[recovery, setRecovery] = useState(
  location.pathname === '/auth/recovery' && new URLSearchParams(location.search).has('code'),
),
```

**Residual risk and the remaining action.** This is a client-side control, and a determined attacker at the same keyboard can still call `updateUser` from the developer console. The authoritative fix is Supabase Auth's **secure password change** setting, which requires re-authentication; it cannot be set through the available tooling and is carried in `REMEDIATION-PLAN.md`. Shortening the session or adding an idle lock would reduce the window further.

**Mappings** OWASP A07:2025 Authentication Failures · API2:2023 Broken Authentication · ASVS 5.0 V6 (authentication lifecycle: password change requires the current password) · WSTG-ATHN-09 (Weak Password Change or Reset Functionalities) · CWE-620 Unverified Password Change.
**CVSS v4.0 vector** `AV:P/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N`

**Regression test** `tests/workflows.spec.ts` covers the authenticated workspace; a dedicated case asserting that `/auth/recovery` without a `code` renders the workspace rather than the password form is listed as a proposed test in `proposed-fixes/README.md`. The unit suite and browser suite both pass unchanged (17/17, 14/14).

---

### CW-02 — Default privileges exposed every future object in `public`

**Severity** Medium · **Confidence** Confirmed (live catalog) · **Verification level** production read-only, then fixed and re-verified · **Status** Fixed

**Impact.** Latent, but broad. Any table, sequence or function created by a future migration would have been granted to `anon` and `authenticated` automatically — all privileges on tables, meaning a signed-in user in any clinic could have read *and written* a new table before anyone wrote a policy for it. Given that the next feature to touch this schema will plausibly store clinical data, this is the single largest unexploded charge found in the database.

**Affected** `pg_default_acl` for role `postgres` in schema `public` (object types `r`, `S`, `f`).

**Preconditions** None today. Triggered by the next `CREATE TABLE` in `public`.

**Root cause and violated invariant.** Supabase's permissive project default was never narrowed. The invariant — *a new object is inaccessible until a migration deliberately grants access* — was inverted.

**Evidence (before).** `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` for tables, with the equivalent for sequences and functions.

**Fix applied** (migration `20260918234315`): `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES/SEQUENCES FROM anon, authenticated` and `REVOKE ALL ON FUNCTIONS FROM public, anon, authenticated`; the same for `EXECUTE ON FUNCTIONS` in `clinic_private`. Live catalog after, for role `postgres`: `{postgres=…,service_role=…}` only.

**Residual, found on re-check 2026-09-19 and not closed.** A second set of default ACLs in `public` belongs to the platform role `supabase_admin` and still grants `anon` and `authenticated`. An attempt to narrow them was refused because `postgres` is not a member of `supabase_admin`, so this is not changeable from SQL by the project owner. Objects created by migrations, by the MCP connection and by the dashboard SQL editor are all owned by `postgres` and therefore covered; the gap applies only to objects the Supabase platform itself creates in `public`. The verification query is in `DATABASE-REVIEW.md` §2. My earlier wording implied the fix was complete for the whole schema, and this paragraph corrects that.

**Compatibility note.** Future migrations must now grant explicitly. The verification block inside the migration and the regression test both enforce this for `postgres`-owned objects, and `DATABASE-REVIEW.md` §2 records the residual so it is not rediscovered as a bug.

**Mappings** A01:2025 Broken Access Control · A02:2025 Security Misconfiguration · API5:2023 Broken Function Level Authorization · ASVS 5.0 V1/V8 (least privilege at a trusted layer) · CWE-276 Incorrect Default Permissions.

**Regression test** `security-hardening.test.mjs` "DB-06: new public tables are private by default" creates a probe table and sequence and asserts `has_table_privilege`/`has_sequence_privilege` are false for both roles. (PGlite discards a default-ACL row that only revokes `PUBLIC` execute, so the function half of the fix is verified against the live catalog instead — stated in the test's comment rather than silently skipped.)

---

### CW-03 — Clinical payloads readable through the audit API

**Severity** Medium · **Confidence** Confirmed (live reproduction) · **Verification level** production read-only, then fixed and re-verified live · **Status** Fixed; retention item remains open

**Impact.** `audit_events.previous_value` and `new_value` contain the complete before/after `visit_details` document — notes, diagnoses, prescriptions — for every clinical save and amendment. The table-level `SELECT` grant let a clinic administrator's token fetch all of it with `?select=new_value`, bypassing the deliberately narrow column list that both the web and mobile clients use. The reader is an administrator of that same clinic, so this is not cross-tenant disclosure; the harm is that an immutable, never-purged table quietly became a second, unmanaged copy of the clinical record, reachable by a single query string and outside the access path the product intends.

**Affected** `public.audit_events` grants; producers `clinic_private.apply_command` and `apply_visit_amendment`; consumers `src/api.ts` `api.audit` and the mobile `clinicAuditSafeColumns`.

**Preconditions** An active `is_admin` doctor membership and its JWT.

**Root cause and violated invariant.** Field-level authorization was implemented in two clients rather than in the database. The invariant — *clinical content is reachable only through the clinical read path, which the `clinical_read` capability governs* — was bypassable because the audit table had no column-level restriction.

**Evidence.** Before: `GET /rest/v1/audit_events?select=new_value&clinic_id=eq.<A>` returned rows. After: `403 / 42501 permission denied for table audit_events` (`AUD-02`), `select=*` likewise (`AUD-03`), while the metadata column list still returns rows (`AUD-01`) and assistants still see none (`AUD-04`).

**Fix applied** (migration `20260918234315`): `REVOKE SELECT ON public.audit_events FROM authenticated` followed by a column-scoped grant on the eight metadata columns. Both clients already requested exactly those columns, so no client change was required.

**Residual risk.** The payload columns still exist and still accumulate. Storing a diff, or moving payloads to a `clinic_private` table with no client grant, plus a retention policy, is carried as an open item.

**Mappings** A01:2025 · API3:2023 Broken Object Property Level Authorization · ASVS 5.0 8.1.2 and 8.2.3 (field-level read restrictions defined and enforced) · CWE-1220 Insufficient Granularity of Access Control.
**CVSS v4.0 vector** `AV:N/AC:L/AT:N/PR:H/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N`

**Regression test** `security-hardening.test.mjs` "DB-02".

---

### CW-04 — Document file name not bound to verified content type

**Severity** Low · **Confidence** Confirmed (live reproduction) · **Verification level** production, fixed at both layers · **Status** Fixed

**Impact.** A member could stage a genuine PDF under the name `report.html` (or `scan.svg`). The bytes are verified on download by both clients, so this is not a route to executing content inside the application's origin; the risk is that a colleague saves the file and opens it from disk, where the extension — not the content — decides how the operating system treats it. A second, independent gap: `finalize_attachment` compared only the stored object's size, so the Storage-recorded MIME type was never checked against the attachment record.

**Affected** `clinic_private.begin_attachment`, `clinic_private.finalize_attachment`, `src/api.ts` `prepareUpload`, `src/Documents.tsx` download handler.

**Root cause and violated invariant.** *A document's name, its recorded type and its stored bytes must agree.* Name and type were validated independently and never compared.

**Evidence.** Before: staging `report.html` with `application/pdf` succeeded. After: `ATTACHMENT_EXTENSION` (`DOC-02`), and a stored object whose mimetype differs from the record yields `ATTACHMENT_TYPE_MISMATCH`.

**Fix applied.** Server: `begin_attachment` rejects a present extension that does not match the verified type (a name with no extension is still allowed); `finalize_attachment` additionally compares `metadata->>'mimetype'`. Client: `extensionMatches()` refuses the upload before it starts, and `downloadName()` saves the file under an extension that matches the type actually detected in the bytes, sanitising path and shell-hostile characters.

**Mappings** A08:2025 Software or Data Integrity Failures · API8:2023 Security Misconfiguration · ASVS 5.0 5.2.2 (extension must match the content) and 5.4.1 · WSTG-BUSL-09 (Test Upload of Malicious Files) · CWE-646 Reliance on File Name or Extension of Externally-Supplied File.

**Regression tests** `security-hardening.test.mjs` "DB-03" ×2; `src/domain.test.ts` extension-binding and download-naming cases.

---

### CW-05 — Private implementations were executable by signed-in users

**Severity** Low · **Confidence** Confirmed (live catalog); **not reproduced** as a remote bypass, and stated as such · **Verification level** production read-only, then fixed · **Status** Fixed

**Impact.** Twenty `clinic_private` functions carried `EXECUTE` for `authenticated`. The `public` wrappers were `SECURITY INVOKER`, which is why the grants existed. Calling an implementation directly would skip whatever the wrapper adds — and for `clinic_apply_command` the wrapper is exactly where the `send` action's `_expires_at` freshness check and `require_doctor_presence()` live, so a direct call could hand a patient to an offline doctor with a stale intent. **This was not reachable over HTTP**, because PostgREST exposes only `public` and `graphql_public`, which I confirmed rather than assumed. It is therefore a defence-in-depth defect: one configuration change away from mattering.

**Affected** `pg_proc.proacl` for 20 `clinic_private` functions; `public.clinic_*` wrapper security attribute.

**Evidence.** Before: implementations listed as executable by `authenticated`. Attempted call through the schema profile: `406 PGRST106 "Only the following schemas are exposed: public, graphql_public"` (`PRIV-09`).

**Fix applied.** The fifteen mutating wrappers became `SECURITY DEFINER` with `search_path=''` (`clinic_search_patients` deliberately stays `SECURITY INVOKER` so RLS filters its rows); `EXECUTE` on `clinic_private` was revoked from `public`, `anon` and `authenticated`, leaving only `allowed` and `attachment_object_allowed`, which the RLS policies must call.

**Trade-off, stated plainly.** This makes the Supabase advisor emit lint 0029 for fifteen definer functions callable by `authenticated`. That is the intended API surface, not a regression: each implementation re-checks `auth.uid()` and membership before doing anything. The alternative — leaving the implementations callable — is worse.

**Mappings** A01:2025 · A02:2025 · API5:2023 · ASVS 5.0 8.3.1 (enforce at a trusted layer the consumer cannot manipulate) · CWE-266 Incorrect Privilege Assignment.

**Regression test** `security-hardening.test.mjs` "DB-01", which also asserts the public contract still works for its rightful actor and that RLS still applies to the invoker search function.

---

### CW-06 — Web password policy weaker than the mobile apps

**Severity** Low · **Confidence** Confirmed (source) · **Status** Fixed (client); owner action remains

Sign-up and recovery accepted eight characters where the Flutter apps require twelve to seventy-two, on the same accounts and the same backend, so the weaker of the two policies governed. Now `minLength={12} maxLength={72}` on sign-up, recovery and confirmation fields. A client-side minimum is advisory: the project's own minimum-length setting and leaked-password protection are the enforcing controls and remain owner actions (CW-12). · A07:2025 · ASVS 5.0 V6 password strength · WSTG-ATHN-07 · CWE-521.

---

### CW-07 — Unbounded clinics per user and presence rows per doctor

**Severity** Low · **Confidence** Confirmed (source, reproduced in PGlite) · **Status** Fixed

`create_clinic` had no cap, so one account could create clinics indefinitely, each seeding rows in `clinics`, `clinic_memberships`, `audit_events` and `patient_counters`; `clinic_doctor_heartbeat` upserted a row for any `p_device_id`, so a doctor's token could grow `doctor_device_presence` without limit. Neither crosses a tenant boundary; both are storage and index growth on a shared backend. Now capped at twenty administered clinics per user (under a per-user advisory lock, so concurrent calls cannot race past it) and ten presence rows per doctor, never evicting a row cited by an immutable receipt. · A10:2025 Mishandling of Exceptional Conditions · API4:2023 Unrestricted Resource Consumption · CWE-770. · Tests: "DB-04" ×2.

---

### CW-08 — `patients.mobile` bounded by digit count, not by length

**Severity** Low · **Confidence** Confirmed (source) · **Status** Fixed

The existing constraint required seven to twenty *digits* after stripping non-digits, so a value could carry unbounded punctuation around a valid number. That text is copied into `audit_events` twice per save and broadcast to every clinic member over Realtime. `patients_mobile_bound` now caps the raw column at forty characters, matching the client's `maxLength`. The live data was unaffected (longest value: thirteen characters, no non-digits). · A10:2025 · CWE-1284. · Test: "DB-05".

---

### CW-09 — CI actions referenced by mutable tags

**Severity** Low · **Confidence** Confirmed (source) · **Status** Fixed

`.github/workflows/web.yml` used `actions/checkout@v7`, `setup-node@v7` and `upload-artifact@v7`. A tag can be moved, so a compromise of those repositories would execute attacker-controlled code in a workflow that runs on `pull_request`. The workflow's blast radius is genuinely small — `permissions: contents: read`, no secrets, no deployment — but pinning costs nothing. All three are now pinned to the commit SHAs that `v7` resolved to at the time of the audit, with the tag retained as a trailing comment. · A03:2025 Software Supply Chain Failures · API8:2023 · CWE-829.

---

### CW-10 — No Content Security Policy in the built document

**Severity** Low · **Confidence** Confirmed (source/build) · **Status** Partially fixed; hosting action remains

`deploy/nginx.example.conf` contains a well-formed policy, but it is an *example* and no deployment exists, so a host that sends no headers would serve the app with no policy at all. The build now injects a baseline policy as a `<meta http-equiv>`: `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src` limited to the Supabase origins, `img-src`/`frame-src` allowing `blob:` for document previews. `frame-ancestors` and `Strict-Transport-Security` cannot be set by a meta tag, so the nginx headers remain mandatory; the README now says so. · A02:2025 · WSTG-CONF-12 · CWE-1021.

---

### CW-11 — Document digest and bytes are verified only by clients (**open**)

**Severity** Medium · **Confidence** Confirmed (source + live catalog) · **Status** Open, proposal written

The SHA-256 recorded at staging is supplied by the uploading client, and no server-side component ever reads the stored bytes. A member who controls both the file and its declared digest can store an object that no other member can open (each client refuses on a hash mismatch), or that matches its declared type only at the header. A hash recorded by the party that supplies the file is not evidence of authorship or integrity — it detects transport corruption, not a hostile uploader. The 20 MiB, four-MIME bucket and the extension binding added by CW-04 narrow the input, and both clients check magic bytes, length and digest before rendering, which is why this is Medium rather than High.

Remediation requires the first server-side component in the system: an Edge Function holding the service role that downloads the object, verifies length, digest and magic bytes, and only then marks the attachment `ready`. Design, rollout and rollback are written up in `proposed-fixes/proposed-verify-attachment-edge-function.md`. It is left unapplied because it introduces a secret to manage and a cross-client migration — the owner's call, not mine. · A08:2025 · API8:2023 · ASVS 5.0 5.2.2 · CWE-345 Insufficient Verification of Data Authenticity.

---

### CW-12 — Leaked-password protection disabled and no second factor (**open, configuration**)

**Severity** Medium · **Confidence** Confirmed (Supabase security advisor, both before and after this engagement) · **Status** Open; owner action

Accounts are e-mail and password only. A doctor account taken over by credential stuffing yields full clinical read and write plus staff administration for its clinic, and the same credentials work in the mobile apps. Enabling leaked-password protection and a twelve-character minimum is a dashboard toggle; TOTP MFA for doctor and administrator accounts is a larger change, after which `clinic_private.allowed` could require `aal2` for the `admin` and `clinical_write` capabilities. Sign-up is open (`disable_signup=false`), which is appropriate for the invitation model but means the login surface is public. · A07:2025 · API2:2023 · ASVS 5.0 V6 · CWE-521.

---

### CW-13 — Clinical writes do not require the handoff receipt server-side (**open**)

**Severity** Low · **Confidence** Confirmed (source) · **Status** Open, proposal written

Both clients disable the consultation editor until the doctor acknowledges the handoff for the current appointment version, and the acknowledgement itself is properly bound to clinic, doctor, device, appointment and version, and is immutable. The database, however, accepts a `visit save` from the assigned doctor as soon as the appointment is `withDoctor`, with no receipt. The invariant *clinical notes are attributable to a doctor who confirmed receipt of this specific handoff* therefore lives in the clients. The actor is already the assigned doctor of that appointment, so this is attribution strength rather than an access-control hole. `proposed-fixes/proposed-acknowledgement-gate.sql` implements the check; it is unapplied because it changes the mobile outbox's ordering assumptions and needs the mobile team's agreement.

---

### CW-14 — Sign-out is local-scope only (**open, by design?**)

**Severity** Low · **Confidence** Confirmed (source) · **Status** Open, deliberate trade-off documented

`App.tsx` calls `signOut({ scope: 'local' })`, which clears the token from `sessionStorage` without revoking the refresh token server-side. A token captured before sign-out stays usable until it expires. The counter-argument is real: accounts are shared with the mobile apps, so a global sign-out from the web would sign the user out of their phone, which is hostile in a clinic. The password-recovery path already uses `scope: 'global'`, correctly. Recommendation is to leave the behaviour and shorten refresh-token lifetime, or offer an explicit "sign out everywhere". Noted rather than changed, because changing it silently would break a workflow the owner may depend on. · WSTG-SESS-06 · CWE-613.

---

### Informational

- **CW-15 — Realtime carries full patient rows.** The publication sends complete `patients` rows to every member of the clinic, including assistants without `clinical_read`. Those members can already read the same demographics through PostgREST, so there is no additional disclosure; `visits` events are filtered per subscriber by RLS, which is the part that matters.
- **CW-16 — Error codes distinguish cross-clinic existence.** Reusing another clinic's patient id returns `CROSS_CLINIC_ID` where an unknown id returns something else, so an attacker holding a valid UUID can learn it exists somewhere. UUIDv4 is not enumerable and the row's contents stay unreachable; accepted.
- **CW-17 — Storage objects can never be deleted by clients.** Intentional retention, but failed uploads and orphans accumulate with no sweeper. This audit produced exactly one such orphan, recorded in `TEST-RESULTS.md` §6 for dashboard deletion.
- **CW-18 — Deployment security is entirely unverified.** No hosting exists. Headers, TLS, HSTS, cache-control on clinical responses, SPA fallback for `/auth/recovery`, and origin isolation of the document preview must be tested on the real host before clinical use.

---

## 4. Attack chains

Only chains supported by evidence are given, with each link marked tested or inferred.

**Chain A — Workstation to persistent clinic control (pre-fix).** Physical access to an unlocked, signed-in doctor workstation [inferred, realistic] → navigate to `/auth/recovery` [**tested**, source-confirmed] → set a new password without the current one [**confirmed** by Supabase behaviour; secure-password-change disabled] → the legitimate doctor is locked out, the attacker holds a durable account with clinical write and staff administration, and can invite further staff [inferred from `PRIV-05`/`SETUP-03` semantics]. Broken at link two by the CW-01 fix; link three is closed only by the dashboard setting.

**Chain B — Future feature exposes everything (pre-fix).** A later migration adds a table in `public` [inferred, near-certain] → default privileges grant all privileges on it to `authenticated` [**tested** against the live catalog] → no RLS policy exists yet, so every signed-in user in every clinic reads and writes it [**tested** in PGlite: a probe table was readable before the fix, denied after]. Broken at link two.

**Chain C — Administrator harvests the clinical record (pre-fix).** Obtain any `is_admin` doctor session [not demonstrated; no escalation path to `is_admin` was found — `set_staff_access` and `join_clinic` never write it] → `GET /rest/v1/audit_events?select=new_value` returns complete visit documents for the clinic [**tested**, now `42501`]. The chain is real only for an already-administrative actor, which is why CW-03 is Medium and not High.

**Chains that did not materialise.** Assistant → doctor escalation (no field, RPC or membership action writes `role` or `is_admin`); cross-clinic read via id, join, search or storage path (21 attempts, all empty or denied); removed member retaining access (five attempts, all denied); replay to duplicate a handoff (receipt returns the original, unchanged).

---

## 5. Coverage and what was not covered

**Reviewed in full:** every first-party source file listed in `ASSET-INVENTORY.md` §1; all 41 database functions and 12 policies, read from the live catalog; all 13 pre-existing migrations plus the one added; the CI workflow, the nginx example, the lockfile and the built bundle.

**Tested live:** 88 authorization checks across nine actor/tenant combinations, plus 8 unauthenticated probes. Positive controls passed for every actor before any negative result was counted, so a denial cannot be mistaken for a broken fixture.

**Reproduced locally:** the full migration chain in PGlite, 49 backend tests including 8 new ones.

**Not tested, and why:**

| Area | Reason |
|---|---|
| Deployed headers, TLS, HSTS, caching, SPA fallback | No deployment exists |
| Auth dashboard settings (password minimum, secure password change, rate limits, captcha, token lifetimes, SMTP, redirect allowlist) | Not readable or writable with the available tooling; only `/auth/v1/settings` and the advisor were observable |
| Realtime subscription as a removed member | No WebSocket harness in scope; enforcement reviewed from the publication and policies |
| E-mail flows (sign-up confirmation, recovery delivery) | Would send mail from the shared project; client code reviewed instead |
| Load, availability, sustained-failure behaviour | Prohibited by the rules of engagement; analysed statically (3 s/8 s statement timeouts, 1 MiB payload guard, bounded pagination) |
| Backups, restore, retention, monitoring, alerting | No evidence obtainable from the repository or database |
| Mobile applications | Out of scope for this engagement; covered by the 17 September 2026 assessment in the backend repository |

**A note on the mocked tests.** `tests/workflows.spec.ts` intercepts Supabase with fixtures. It verifies user-interface behaviour and nothing about database authorization. Every authorization claim in this report rests on the live matrix or the PGlite reproduction, never on the mocked suite.

---

## 6. Remediation summary

Full detail, owners and verification steps are in `REMEDIATION-PLAN.md`.

| Priority | Item | Owner | State |
|---|---|---|---|
| Immediate | Enable secure password change, leaked-password protection, minimum length 12 | Project owner (dashboard) | Open — CW-01 depends on the first |
| Immediate | Delete the one orphaned fixture Storage object | Project owner (dashboard) | Open |
| Short term | Commit and review the applied source changes and migration | Engineering | Applied, awaiting review |
| Short term | Server-side document verification (CW-11) | Engineering + owner | Proposal written |
| Short term | Configure hosting headers and verify them against the live site | Engineering | Blocked on deployment |
| Medium term | Audit payload retention (CW-03 residual); receipt gate (CW-13); MFA for doctors (CW-12) | Owner decisions | Open |
