# Hypothesis ledger

Every attack hypothesis formed during the engagement, with its outcome. Rejected hypotheses are kept deliberately: they are the part of an assessment that shows where the system is genuinely strong, and they stop the next reviewer from re-treading the same ground.

Outcome vocabulary: **Confirmed** (became a finding), **Rejected** (tested and did not hold), **Not reproduced** (a specific attempt failed; the hypothesis is not disproven in general), **Not tested** (blocked), **Not applicable** (the feature or exposure is absent).

## Access control and tenancy

| # | Hypothesis | Outcome | Basis |
|---|---|---|---|
| 1 | A doctor in clinic B can read clinic A patients by filtering on `clinic_id` or by id | Rejected | `XC-01`, `XC-02` — zero rows both ways |
| 2 | `clinic_search_patients` is `SECURITY INVOKER`, so perhaps it leaks across clinics | Rejected | `XC-05` — invoker means RLS *applies*; zero rows. My initial reading was backwards and the test corrected it |
| 3 | A signed-in user with no membership sees something | Rejected | `XC-03`, `XC-11` |
| 4 | Anonymous access reaches a table, RPC or object | Rejected | Probes 4–6; `42501` on tables and functions, empty storage listing |
| 5 | An assistant can grant themselves `clinical_read`, `is_admin` or `role='doctor'` | Rejected | `PRIV-02` (direct UPDATE denied); code review shows `set_staff_access` never writes `is_admin` or `role`, and `join_clinic` inserts assistants with defaults |
| 6 | An assistant can write clinical alerts through the demographics payload | Rejected | `PRIV-04` — `FORBIDDEN_ALERT_EDIT`; the server compares against the stored value rather than trusting the client's flag |
| 7 | A clinical-read assistant can write visits (read implies write somewhere) | Rejected | `PRIV-12` — `clinical_read` and `clinical_write` are distinct capabilities |
| 8 | Cross-clinic ids can be smuggled through foreign keys (book clinic A's patient inside clinic B) | Rejected | `XC-09` (`CROSS_CLINIC_ID`), `XC-10` (`INVALID_PATIENT`); composite foreign keys carry `clinic_id` |
| 9 | UI-hidden functions are reachable directly over HTTP | Confirmed as *reachable*, rejected as *exploitable* | Every admin-only RPC was called directly; all refused (`PRIV-05`…`PRIV-07`) |
| 10 | A removed member's unexpired token still works | Rejected | `REM-01`…`REM-05`; authorization is re-derived per statement, never from JWT claims |
| 11 | A member of two clinics can cross data between them | Not tested | No multi-membership fixture was created. Policies are per-`clinic_id` with no cross-clinic subquery, so the risk is low, but this is a genuine coverage gap |
| 12 | An anonymous Auth user could assume the `authenticated` role | Not applicable | `anonymous_users=false` at the project level |
| 13 | `clinic_private` is reachable through PostgREST's schema profile | Rejected | `PRIV-09` — `406 PGRST106`. This is what downgraded CW-05 from a bypass to a hardening finding |

## Privilege and configuration

| # | Hypothesis | Outcome | Basis |
|---|---|---|---|
| 14 | `SECURITY DEFINER` functions are exploitable simply because they bypass RLS | Rejected | Each of the 22 was read: `auth.uid()` check first, membership check second, `search_path=''`, no dynamic SQL. The keyword alone proves nothing and was not treated as a finding |
| 15 | The implementations' EXECUTE grants let a client skip wrapper-only logic | **Confirmed** (CW-05), with the caveat that it is not remotely reachable (#13) |
| 16 | Default privileges expose future objects | **Confirmed** (CW-02) |
| 17 | The publishable key is itself a vulnerability | Rejected | It maps to `anon`, which holds no privilege anywhere; demonstrated rather than assumed (probes 4–6). Reporting it would have been noise |
| 18 | A privileged key leaked into the build or git history | Rejected | Pattern scan of `dist/`, the repository and the single commit found none; `.env*` is ignored and absent |
| 19 | `postgres` owning the definer functions means they bypass RLS in a way that matters | Confirmed as *true*, rejected as *a defect* | `postgres` does hold `BYPASSRLS`, which is exactly why each function re-checks membership — verified in every body |

## Injection and browser

| # | Hypothesis | Outcome | Basis |
|---|---|---|---|
| 20 | A DOM XSS sink exists (`innerHTML`, `dangerouslySetInnerHTML`, `eval`, `srcdoc`) | Rejected | None in the codebase; the print view uses `createElement` + `textContent` exclusively |
| 21 | Stored markers execute somewhere in rendering, print or preview | Rejected | `POS-01`, `INJ-01`, `CLIN-03` — stored and returned verbatim, rendered as text |
| 22 | SQL injection via search or command payloads | Rejected | No dynamic SQL exists; `position()` not `LIKE`; parameters typed as `uuid`/`jsonb` |
| 23 | The document preview iframe can script against the app origin | Rejected, with a caveat | Blob URLs inherit the creating origin, so an HTML document *would* be same-origin — but the bucket allows only four MIME types, the client verifies magic bytes before creating the blob, and the preview renders only PDFs and images. I tested `sandbox=""` and `sandbox="allow-scripts"` in the browser pane: both **break PDF rendering entirely**, so sandboxing the iframe is not a usable hardening here. Recorded rather than recommended blindly |
| 24 | CSRF against the mutation endpoints | Not applicable | Bearer tokens, not cookies; no ambient credential travels with a cross-site request. The `*` CORS header is therefore not a finding |
| 25 | Open redirect via the recovery `redirectTo` | Rejected | `location.origin + '/auth/recovery'` is constructed, never taken from input; the project allowlist is the second control (owner action) |
| 26 | Sensitive data survives logout or clinic switching | Rejected | Workspace state is keyed on `clinic_id + role`, `sessionStorage` is cleared on sign-out and on tab close; `localStorage` holds only language, theme and a device id |
| 27 | Stale async responses render into a newer context | Rejected | `useResource` guards with a `current` flag on cleanup; the assignment-change path deliberately retains unsaved notes and disables saving (covered by a browser test) |
| 28 | Downloaded file names enable local trickery | **Confirmed** (CW-04) — the download name was attacker-controlled and unbound from the verified type |

## Workflow integrity

| # | Hypothesis | Outcome | Basis |
|---|---|---|---|
| 29 | A replayed command causes a second handoff | Rejected | `WF-04b` — identical command returns the identical receipt, version unchanged. (`WF-04` first "failed" because my test regenerated `_expires_at`, making it a *different* request; `OPERATION_ID_REUSED` was the correct answer. The test was wrong, not the server — recorded rather than reported as a finding) |
| 30 | An operation id can be reused for a different request | Rejected | `WF-05` — `OPERATION_ID_REUSED` |
| 31 | A stale version can overwrite newer data | Rejected | `WF-02` — `VERSION_CONFLICT` |
| 32 | An expired intent is still honoured | Rejected | `WF-03` — `COMMAND_EXPIRED` |
| 33 | The queue state machine can be skipped | Rejected | `WF-01` — `INVALID_TRANSITION` |
| 34 | A completed visit can be edited without an amendment | Rejected | `WF-07` — `COMPLETED_VISIT_IMMUTABLE` |
| 35 | Another clinic's doctor can amend a visit | Rejected | `XC-17`; only the recording doctor may amend |
| 36 | A receipt from an earlier handoff satisfies a later one | Rejected | Receipts are keyed on `(clinic, appointment, appointment_version)` since migration `20260918193549`; the client also compares versions |
| 37 | Clinical notes can be written without acknowledging receipt | **Confirmed** (CW-13) — the clients enforce it, the database does not |
| 38 | History can be rewritten or deleted | Rejected | Six `immutable_*` triggers raise `IMMUTABLE_HISTORY`; verified enabled before and after the engagement, including after the fixture cleanup transaction |
| 39 | Audit attribution can be forged by the client | Rejected | `actor_id`, `actor_role`, `clinic_id` are derived from `auth.uid()` and the membership row inside the same transaction as the operation |

## Documents and storage

| # | Hypothesis | Outcome | Basis |
|---|---|---|---|
| 40 | An upload can be aimed at another clinic's path | Rejected | `DOC-04`, `XC-18`; the path is server-generated with no user-controlled segment |
| 41 | A stored object can be overwritten after finalization | Rejected | `DOC-06` (`409`), and no UPDATE policy exists |
| 42 | An SVG or HTML payload can enter the bucket | Rejected | `DOC-05` — `415 invalid_mime_type` at the bucket |
| 43 | A download lease survives archival or membership removal | Rejected | `REM-01`, `REM-02`; a trigger deletes grants when the attachment leaves `ready` |
| 44 | Another clinic's object can be downloaded or listed | Rejected | `XC-20`, `XC-21` |
| 45 | The recorded SHA-256 proves the stored bytes | **Confirmed as false** (CW-11) — the uploader supplies both the file and the digest |

## Authentication

| # | Hypothesis | Outcome | Basis |
|---|---|---|---|
| 46 | `/auth/recovery` can be reached without a recovery token | **Confirmed** (CW-01) |
| 47 | The recovery flow enables account enumeration | Rejected | A constant message is shown regardless of whether the account exists |
| 48 | `sessionStorage` for tokens is itself a vulnerability | Rejected | It is a reasonable trade-off here: cleared on tab close, not sent automatically (so no CSRF), not readable cross-origin. XSS would defeat `localStorage` and cookies equally in this architecture. Evaluated rather than flagged reflexively |
| 49 | Invitation codes can be reused, guessed or redeemed by the wrong person | Rejected | `INV-01`, `INV-02`; 64 hex characters, SHA-256 stored, single use, 24-hour expiry, e-mail bound, revocation cutoff on access change |
| 50 | Sign-out revokes the session everywhere | **Confirmed as false** (CW-14), but accepted as a deliberate trade-off with the mobile apps |
| 51 | Rate limiting, captcha and token lifetimes are adequate | Not tested | Project settings, not observable with the available tooling |

## Availability and operations

| # | Hypothesis | Outcome | Basis |
|---|---|---|---|
| 52 | Unbounded resource creation is possible | **Confirmed** (CW-07) |
| 53 | Unbounded text can be stored | **Confirmed** (CW-08), narrow: one column remained after the earlier bounds migration |
| 54 | A single slow query can exhaust the database | Rejected (static) | Statement timeouts 3 s / 8 s; pagination bounded; 1 MiB payload cap. Not load-tested — prohibited |
| 55 | Backups, retention and monitoring are adequate | Not tested | No evidence obtainable; carried as an explicit gap |

## Unresolved questions for the owner

1. Should clinical writes require the handoff receipt server-side (CW-13)? It changes the mobile offline outbox's ordering.
2. Is the audit table intended as a permanent second copy of the clinical record, or should payloads be diffed and expired (CW-03 residual)?
3. Should sign-out remain local-scope to protect the mobile session (CW-14)?
4. Is a server-side component acceptable for document verification (CW-11), given it introduces the first service-role secret?
5. Does a multi-membership user exist in practice (hypothesis 11)? If so, that combination should be added to the matrix.

## Second-pass review

Every finding was re-challenged before being written: is the code reachable in the assessed build; does another control already prevent the impact; was the test run with a privileged credential that would invalidate it; could the result be an artefact of a mock, a stale fixture or a tool failure. Three candidate findings were dropped as a result — the publishable key (#17), `SECURITY DEFINER` as such (#14), and `sessionStorage` (#48) — and one apparent test failure was traced to my own test rather than to the server (#29). The live matrix was run with ordinary user credentials throughout; the privileged MCP connection was used only for catalog reads, the one migration, and fixture lifecycle, never to assert that a control worked. No parallel independent agents were used, so this report does not claim independent corroboration.
