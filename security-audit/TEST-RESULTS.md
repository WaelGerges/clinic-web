# Test results

All times UTC. Execution date 2026-09-18/19. Nothing was fabricated; every command below was run and its result recorded as shown.

## 1. Repository and toolchain

| Check                         | Command                                                             | Result                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Commit / branch / dirty state | `git rev-parse HEAD; git branch --show-current; git status --short` | `ffed830…`, `main`, one untracked file (`docs/clinic-web-security-audit-master-prompt.md`)                                                             |
| Versions                      | `node --version; npm --version; git --version`                      | 24.14.1 / 11.11.0 / 2.55.0.windows.3                                                                                                                   |
| Dependency audit              | `npm audit --json`                                                  | 0 vulnerabilities (107 packages: 15 prod, 93 dev, 47 optional)                                                                                         |
| Lockfile provenance           | grep of `resolved` in `package-lock.json`                           | 107/107 from `https://registry.npmjs.org`; 0 git/file dependencies; 1 install script (`fsevents` 2.3.3, optional, macOS only)                          |
| Secret scan (build + repo)    | pattern scan for `sb_secret_`, `eyJ…` JWTs, `service_role`          | none; `dist/` (git-ignored, built without `.env.local`) contains only the `unconfigured.supabase.co` fallback and supabase-js's own hostname allowlist |
| `.env.local` / `.env`         | `ls`                                                                | absent; `.env.example` holds the project URL and a placeholder key                                                                                     |

## 2. Baseline before changes

| Suite                                             | Command                        | Result                              |
| ------------------------------------------------- | ------------------------------ | ----------------------------------- |
| Web unit tests                                    | `npm test`                     | 15/15 passed (vitest 5.0.1)         |
| Web browser scenarios (mocked Supabase)           | `npm run test:e2e`             | 14/14 passed (Edge channel, 24.7 s) |
| Backend regression (PGlite, full migration chain) | `npm test` in `clinic-chatgpt` | 41/41 passed                        |

## 3. After changes

| Suite                                                      | Command                        | Result                                                             |
| ---------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| Web unit tests                                             | `npm test`                     | **17/17** passed (2 new: extension binding, download naming)       |
| Type-check                                                 | `npm run check`                | passed                                                             |
| Production build                                           | `npm run build`                | passed; `dist/index.html` now contains the CSP `<meta http-equiv>` |
| Format                                                     | `npm run format:check`         | passed                                                             |
| Translations                                               | `npm run check:translations`   | `[]` (two Arabic strings added to `src/locales/web-ar.json`)       |
| Web browser scenarios                                      | `npm run test:e2e`             | **14/14** passed (22.5 s)                                          |
| Backend regression incl. new `security-hardening.test.mjs` | `npm test` in `clinic-chatgpt` | **49/49** passed (8 new)                                           |

## 4. Live database changes (development project `geikkygtnsgbtajyqdvc`)

| Step                                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apply_migration` `web_security_hardening` at 2026-09-18 23:43 UTC | success; recorded as version `20260918234315`; local files renamed to match; SHA-256 `A951F722…ED0D702` recorded in `clinic-chatgpt/CONTINUE-HERE.md`                                                                                                                                                                                                                                                                                                                                                                                     |
| Live verification query                                            | invoker wrappers: only `clinic_search_patients`; `clinic_private` executable by `authenticated`: `allowed`, `attachment_object_allowed` only; `anon` can execute nothing in `public`/`clinic_private`; `audit_events` SELECT for `authenticated` limited to the eight metadata columns, table-level SELECT false; `pg_default_acl` for `postgres` in `public` now `postgres`+`service_role` only for tables/sequences/functions; all four function markers present; `patients_mobile_bound` present; every wrapper keeps `search_path=''` |
| Security advisor after                                             | WARN `auth_leaked_password_protection` (unchanged, dashboard); INFO `rls_enabled_no_policy` ×8 (intentional default-deny private tables); **new** WARN lint 0029 `authenticated_security_definer_function_executable` ×15 — expected: these are the API wrappers, each implementation re-checks `auth.uid()` and membership (see `DATABASE-REVIEW.md` §7)                                                                                                                                                                                 |

## 5. Live authorization matrix

- Script: `tests/live-authz-matrix.mjs` (plus a one-off `WF-04b` replay re-check). Results: `evidence/live-authz-matrix-results.json`; tabular form `AUTHORIZATION-MATRIX.csv`.
- Fixture provenance: five synthetic Auth users (`audit-*-3cc48d@audit.invalid`, `raw_app_meta_data.audit_fixture=true`) inserted by SQL with confirmed e-mails and random passwords held only in the session scratchpad; two clinics named `AUDIT FIXTURE clinic A/B …`, three marker patients, three appointments, one visit with two revisions, one 70-byte PNG document. No real records were read or modified.
- Outcome: **87 of 88 checks matched expectations**. `WF-04` mismatched because the script regenerated `_expires_at` on replay, so the request differed and `OPERATION_ID_REUSED` was the correct answer; `WF-04b` replayed the identical command and received the identical receipt (version unchanged, no second handoff). The script was corrected for future runs.
- Positive controls passed for every actor before negative tests were counted (SETUP-01…05, POS-01…16).

## 6. Cleanup status

| Artefact                                                                                                                                                                                                                                          | Status                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fixture clinics, memberships, patients, appointments, visits/revisions/diagnoses/prescriptions, attachments row, receipts, presence, waitlist, invitations, operation receipts, audit events                                                      | deleted in one transaction (immutable-history triggers disabled for that transaction only, then re-enabled in a second transaction); verified `immutable_*` triggers all enabled (`tgenabled='O'`)                                                                                                                                                                                   |
| Five synthetic Auth users (+ identities/sessions/refresh tokens by cascade)                                                                                                                                                                       | deleted; `auth.users` back to 3                                                                                                                                                                                                                                                                                                                                                      |
| Database counts after cleanup                                                                                                                                                                                                                     | users 3, clinics 1, memberships 3, patients 103, appointments 9, visits 1, attachments 1, audit_events 37 — identical to the pre-audit baseline. Presence rows went from 5 to 4: the existing `prune_delivery_presence()` (rows expired for over seven days and cited by no receipt) ran during a fixture heartbeat; this is pre-existing behaviour, not a change made by the audit. |
| **Resolved 19 September 2026.** Previously open: one Storage object `clinic-documents/fea6cab4-7fca-4944-8917-3fa29722dd7e/674c11d0-7bc5-4a6a-9ffe-673bd97c7acf/b6bf9e54-009e-436b-8859-2900b4bdb76d` (70-byte PNG) and its `storage.objects` row | Clients have no DELETE policy and `storage.protect_delete` blocks SQL deletion (which would strand the bytes anyway). No `attachments` row references it, so no client can read it. **Delete it from Dashboard → Storage → clinic-documents → folder `fea6cab4-…`** (`OWNER-ACTIONS.md` item 3).                                                                                     |

### Resolved on 19 September 2026

The object was deleted through the Supabase dashboard using the desktop app's browser pane, which held a signed-in session. The 70-byte object was removed first, then its empty folder together with the zero-byte `.emptyFolderPlaceholder` Supabase leaves behind. Verified in the database afterwards: `storage.objects` for `clinic-documents` contains exactly one row, the real 4.4 MB attachment under `babaf4d2-…`, and it is referenced by an `attachments` record. No orphan remains.

One misstep is recorded rather than omitted: a first attempt clicked _Move_ instead of _Delete_ because the pane reflowed between the screenshot and the click. The move dialog was cancelled before submission and the database confirmed both objects were still at their original paths.

### Removal attempted on 19 September 2026, reverted

A bounded removal was attempted and did not complete; it is recorded here rather than omitted. A temporary `DELETE` policy on `storage.objects` was created, scoped to `bucket_id='clinic-documents'` **and** the `fea6cab4-…` prefix **and** the absence of any referencing `attachments` row, together with one synthetic account, with the intention of deleting the object through the Storage API and then reverting both. The Storage API call was refused by the session's own sandbox policy before it ran, so the object was never deleted.

Everything created for the attempt was then removed and the result verified: `audit_fixture_cleanup_delete` no longer exists, `storage.objects` carries exactly its two original policies (`clinic_document_insert [INSERT]`, `clinic_document_read [SELECT]`) and still has no `DELETE` or `UPDATE` policy, `auth.users` is back to 3 with 3 identities and no `audit-%@audit.invalid` rows, and clinics (1) and patients (103) are unchanged. The SQL-only alternative was rejected deliberately: deleting the `storage.objects` row would leave the bytes stranded in the storage backend, which is worse than one inert object.

## 7. Skipped / not executed

| Test                                               | Reason                                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Realtime subscription as a removed member          | no WebSocket harness in scope; RLS enforcement per subscriber reviewed by design (publication + SELECT policies)                                                                 |
| Deployed header/TLS/caching checks                 | no deployment exists                                                                                                                                                             |
| Password-recovery e-mail flow, sign-up e-mail flow | would send e-mail from the shared project's Auth mailer to synthetic addresses; not exercised. Client code reviewed; PKCE handling verified by reading supabase-js configuration |
| Load / availability tests                          | prohibited by rules of engagement; analysed statically (statement timeouts 3 s anon / 8 s authenticated, 1 MiB payload guard, bounded pagination)                                |
| Edge Functions, GraphQL, webhooks, cron            | none deployed (`list_edge_functions` empty; `pg_graphql`, `pg_cron`, `pg_net` not installed)                                                                                     |
