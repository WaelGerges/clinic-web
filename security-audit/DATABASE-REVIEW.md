# Supabase and PostgreSQL review

Project `clinic-chatgpt-dev` (`geikkygtnsgbtajyqdvc`), PostgreSQL 17.6.1.166, eu-west-1. Raw catalog output is summarised in `evidence/db-catalog-snapshot.md`. Every statement below was read from the live catalog, not inferred from migrations; drift against the repository is called out in §9.

## 1. Exposure

PostgREST exposes `public` and `graphql_public` only. A direct attempt to reach the private schema through the `Content-Profile` header returned `406 PGRST106` (`evidence/http-probes.md` #3, live check `PRIV-09`), so `clinic_private` is not callable over the API regardless of grants. `anon` holds no table, sequence or function privilege in either schema; unauthenticated reads and RPCs return `42501` (probes #4, #5).

## 2. Privileges

`authenticated` holds `SELECT` on eleven tables and one view, and `EXECUTE` on the fifteen `public.clinic_*` wrappers plus `clinic_search_patients`. It holds no `INSERT`, `UPDATE` or `DELETE` anywhere in `public` — confirmed live (`PRIV-01`, `PRIV-02`, `PRIV-03` all `42501`). `postgres` and `service_role` carry `BYPASSRLS`; neither appears in any client code, and the publishable key maps to `anon`/`authenticated` only.

Two privilege defects were found and fixed:

- **Default privileges** (finding CW-02). `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public` granted **all** privileges on every future table and sequence, and `EXECUTE` on every future function, to `anon` and `authenticated`. Any table added by a later migration would have been readable and writable by every signed-in user until someone remembered to revoke it. Now `postgres` and `service_role` only.
- **Private implementations were client-callable** (finding CW-05). Twenty `clinic_private` functions had `EXECUTE` for `authenticated`, because the `public` wrappers were `SECURITY INVOKER`. That made the wrapper's own logic bypassable in principle: `public.clinic_apply_command` is where the `send` action's freshness check and `require_doctor_presence()` live, and calling `clinic_private.apply_command` directly skips both. It was not remotely reachable (§1), so this is a defence-in-depth gap rather than a demonstrated bypass. The wrappers are now `SECURITY DEFINER` with `search_path=''`, and only `allowed` and `attachment_object_allowed` (needed by RLS policies) remain executable.

## 3. Row-level security

RLS is enabled on all eleven `public` tables and all eight `clinic_private` tables. Every policy is `PERMISSIVE`, role `authenticated`, command `SELECT`; the only `INSERT` policy in the system is on `storage.objects`. There are no `UPDATE` or `DELETE` policies anywhere, so the missing-`WITH CHECK` class of bug cannot arise here — there is no policy whose `WITH CHECK` could be inherited or omitted. Row *writes* are impossible for clients by privilege, not by policy.

Every policy resolves through `clinic_private.allowed(clinic_id, capability)`: `STABLE SECURITY DEFINER`, `search_path=''`, returns false when `auth.uid()` is null, and requires an `active` membership row in an **unarchived** clinic. Capabilities are `read`, `clinical_read` (doctor or the flag), `clinical_write` (doctor) and `admin` (`is_admin`). Because authorization is re-derived from `clinic_memberships` on every statement rather than from JWT claims, a stale token cannot carry stale permissions — verified live: after `clinic_set_staff_access(active=false)`, the same unexpired token returned zero rows and `42501` on every surface (`REM-01` … `REM-05`).

Column-level secrecy is handled separately from row secrecy, which matters for `audit_events` (§4) and for `attachments`, whose policy additionally requires `clinical_read` when `clinical` is true.

`is_admin` is only ever set by `create_clinic` (for the founding doctor). `join_clinic` inserts assistants with `is_admin` defaulted false and `set_staff_access` never writes the column, so there is no path for an assistant to become an administrator. `anon` Auth sign-ins are disabled at the project level, so no anonymous user can hold the `authenticated` role.

Cross-tenant isolation was tested with real low-privilege identities over HTTP, not with a privileged SQL session: twenty-one cross-clinic checks (`XC-01` … `XC-21`) covering reads by filter and by id, search, memberships, inserts, id reuse, foreign-key smuggling, schedule, presence, handoff acknowledgement, visits, amendments, documents, storage paths and prefix listing. All returned zero rows or a denial.

## 4. `audit_events` column exposure (finding CW-03, fixed)

`previous_value` and `new_value` hold the complete before/after `visit_details` document for every clinical save. `SELECT` was granted at table level, so an administrator's JWT could retrieve full clinical text through `/rest/v1/audit_events?select=new_value` even though both clients request only the safe column list. The grant is now per column, limited to `id, clinic_id, actor_id, actor_role, action, object_type, object_id, occurred_at`. Live confirmation: metadata select returns rows (`AUD-01`), `select=new_value` and `select=*` return `42501` (`AUD-02`, `AUD-03`), assistants still see nothing (`AUD-04`).

The underlying retention question is not solved by the grant: an immutable, never-purged table still stores full clinical payloads. That is carried as an open item in `REMEDIATION-PLAN.md`.

## 5. Functions

All 22 `SECURITY DEFINER` functions are owned by `postgres`, set `search_path=''`, schema-qualify every reference, use no dynamic SQL and no `EXECUTE format()`, and check `auth.uid()` before anything else. Owner `postgres` does hold `BYPASSRLS`, so these functions genuinely bypass RLS — which is why each one re-checks membership itself; I verified that check exists in every function body rather than assuming it from the keyword. `clinic_search_patients` is deliberately `SECURITY INVOKER` so that RLS filters its `SETOF patients` result; a cross-clinic call returns zero rows (`XC-05`).

Concurrency and integrity controls present in `apply_command`: per-operation and per-clinic advisory locks, `SELECT … FOR UPDATE` on the target row, exact-request receipt replay (`OPERATION_ID_REUSED` when the same id carries a different request), `_expires_at` freshness for status/send/complete/amend, and a state-machine check for every transition. Replay of an identical committed command returns the identical receipt with no second handoff (`WF-04b`); a stale version yields `VERSION_CONFLICT` (`WF-02`); an expired intent yields `COMMAND_EXPIRED` (`WF-03`); queue-skipping yields `INVALID_TRANSITION` (`WF-01`).

Two functions were hardened for resource consumption (finding CW-07): `create_clinic` now caps a user at twenty administered clinics under a per-user advisory lock, and `clinic_doctor_heartbeat` keeps at most ten presence rows per doctor while never removing a row cited by an immutable receipt.

## 6. Documents and Storage

Bucket `clinic-documents` is private, capped at 20 MiB, and restricted to `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. The object path is generated server-side from `clinic/patient/attachment`, so no user-controlled path segment exists. Writes require a matching `pending` row owned by the caller; reads require an unexpired 90-second grant row that a trigger deletes as soon as the attachment leaves `ready`. There is no `UPDATE` or `DELETE` policy, and Supabase's `protect_objects_delete` blocks SQL deletion.

Live results: upload to another user's pending path, to an unstaged path, and of an `image/svg+xml` body were all refused (`DOC-03`, `DOC-04`, `DOC-05` — the last with `415 invalid_mime_type`); a second upload to the same path returned `409 Duplicate` (`DOC-06`); download without a lease, cross-clinic download, cross-clinic prefix listing and client deletion all failed (`DOC-08`, `XC-20`, `XC-21`, `DOC-09`); the rightful actor's staged upload, finalize, lease and download of exactly 70 bytes succeeded (`POS-11` … `POS-15`).

Finding CW-04 (fixed): a file name's extension was not bound to the verified content type, so a PDF could be recorded as `report.html`, and `finalize_attachment` compared only the stored size. `begin_attachment` now rejects a mismatched extension (`ATTACHMENT_EXTENSION`, live `DOC-02`) and `finalize_attachment` also compares the Storage-recorded mimetype (`ATTACHMENT_TYPE_MISMATCH`).

Finding CW-11 (**open**): the SHA-256 stored at staging is asserted by the client and the bytes are never inspected server-side. A member can therefore store an object whose digest does not match, which other members' clients will refuse to open. Both clients verify length, digest and magic bytes on download, so this is an integrity and denial concern rather than a path to executing content. A file hash recorded by the same party that supplies the file is not proof of authorship; the server-side proposal is in `proposed-fixes/`.

## 7. Advisors

Before: `WARN auth_leaked_password_protection`; `INFO rls_enabled_no_policy` ×8. After the migration, both persist and a third appears: `WARN authenticated_security_definer_function_executable` (lint 0029) for the fifteen wrappers. That warning is the intended consequence of the CW-05 fix — the wrappers *are* the API, and each implementation re-checks identity and membership. The eight `INFO` notices are the private tables' intentional default-deny posture. No advisor reports an `ERROR`. Advisors cannot prove tenant isolation or business-logic correctness, which is what §3 and the live matrix are for.

## 8. Auth configuration

Observable from `/auth/v1/settings`: e-mail provider only, sign-up open, e-mail confirmation required, anonymous users disabled, no phone, no SAML, no passkeys. The project enforces confirmation in SQL as well (`create_clinic` and `join_clinic` both require `email_confirmed_at`), verified indirectly by `INV-02`.

Not observable with the available tooling and therefore **not tested**: minimum password length, leaked-password protection state beyond the advisor, secure-password-change (re-authentication) setting, MFA enrolment, rate limits, captcha, JWT and refresh-token lifetimes, SMTP configuration, and the redirect allowlist. These are listed as owner actions.

## 9. Drift

The thirteen migrations recorded in `supabase_migrations.schema_migrations` match the thirteen files in `clinic-chatgpt/supabase/migrations`, and the live function bodies matched the expectations encoded in this audit's guarded patches — every patch would have raised `Unexpected … definition` otherwise, and none did. The new migration is recorded as version `20260918234315` (the server assigned its own timestamp; the local files were renamed to match). No drift was found. The `clinic-web` repository carries reference copies only and does not provision the database.

## 10. Limits of this review

Read-only catalog access was used throughout except for the one applied migration and the fixture lifecycle. Backups, restore drills, retention policy, log retention, monitoring and alerting could not be evidenced from the database or the repository and are unverified. Realtime authorization was reviewed from the publication and policy definitions rather than by subscribing as a removed member.
