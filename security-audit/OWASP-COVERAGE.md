# OWASP coverage

Standards were verified against official sources on 19 September 2026: OWASP Top 10:2025 category names from `top10.owasp.org/2025`; OWASP API Security Top 10:2023 from `api-security.owasp.org/editions/2023`; ASVS requirement identifiers and text from the `OWASP/ASVS` repository `5.0/en` directory (V5 File Handling, V8 Authorization quoted directly); WSTG identifiers from the `OWASP/wstg` checklist (the checklist file does not state its version, so identifiers are used as stable references and no version claim is made beyond that). No identifier in this document was invented; where I could not confirm an identifier's exact text, the mapping is given at chapter level rather than at requirement level and is marked as such.

ASVS Level 2 is the baseline. Level 3 requirements are selected explicitly where clinical data or privileged operations justify them, and applicability is explained. Nothing here implies certification.

## 1. OWASP Top 10:2025 — web

| Category | Status | Evidence and outcome |
|---|---|---|
| **A01:2025 Broken Access Control** | Tested, findings | The deepest-tested area. 21 cross-clinic, 12 privilege-escalation and 5 post-removal checks over HTTP with real low-privilege identities, plus full policy and grant review. No cross-tenant or vertical escalation found. Findings: CW-02 (default privileges), CW-03 (audit column exposure), CW-05 (private implementations callable). All fixed. |
| **A02:2025 Security Misconfiguration** | Tested, findings | Default privileges (CW-02), missing CSP in the built document (CW-10), schema exposure verified as `public` + `graphql_public` only. Deployment configuration **not tested** (CW-18) because no deployment exists. |
| **A03:2025 Software Supply Chain Failures** | Tested, finding | `npm audit` clean; 107/107 dependencies from the public registry; no git or file dependencies; one optional install script (`fsevents`, macOS). CI actions were tag-referenced (CW-09), now pinned to commit SHAs. Lockfile integrity intact. |
| **A04:2025 Cryptographic Failures** | Tested, no finding | No custom cryptography. SHA-256 via Web Crypto for document integrity (its trust limitation is CW-11, categorised under A08). Invitation codes are 64 hex characters from `gen_random_uuid()` pairs, stored as SHA-256 hashes, single-use, 24-hour expiry. Passwords are handled entirely by Supabase Auth (bcrypt). Transport is HTTPS to Supabase; local dev HTTPS uses a developer-supplied PFX outside the repository. |
| **A05:2025 Injection** | Tested, no finding | No dynamic SQL anywhere: every `clinic_private` function is fully schema-qualified with `search_path=''` and no `EXECUTE format()`. `clinic_search_patients` uses `position()`, not `LIKE`, and is parameterised. Client-side: no `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`; the print view builds nodes with `createElement`/`textContent`. Live markers (`<script>alert(1)</script>`, `' OR 1=1 --`, `<img src=x onerror=...>`) were stored and returned verbatim and rendered as text (`POS-01`, `INJ-01`, `CLIN-03`). CSV/formula injection not applicable: no export feature. |
| **A06:2025 Insecure Design** | Tested, finding | The command/receipt model (operation ids, expected versions, `_expires_at`, advisory locks, immutable history) is a strong design and held under replay and concurrency tests. Gap: clinical writes do not require the handoff receipt server-side (CW-13, open with a written proposal). |
| **A07:2025 Authentication Failures** | Tested, findings | CW-01 (password change from an existing session), CW-06 (weak client password minimum), CW-12 (leaked-password protection off, no MFA), CW-14 (local-scope sign-out). Account enumeration on the recovery path is avoided by a constant response message; sign-in errors are generic. Rate limiting **not tested** (project setting, not observable). |
| **A08:2025 Software or Data Integrity Failures** | Tested, findings | CW-04 (extension/type binding, fixed) and CW-11 (client-asserted digest, open). Clinical history is genuinely immutable: `immutable_*` triggers on revisions, diagnoses, prescriptions, items, audit events and receipts were verified enabled before and after the engagement, including after the fixture cleanup. |
| **A09:2025 Security Logging & Alerting Failures** | Partially tested | Audit events are written in the same transaction as the operation, with actor, role, clinic and object derived server-side from `auth.uid()` — not client-supplied — and the table is append-only. 14 distinct action types observed. **Not tested:** alerting, retention, log review, and whether anyone would notice an attack. No monitoring evidence was obtainable. |
| **A10:2025 Mishandling of Exceptional Conditions** | Tested, findings | Uncertain responses are retried with an identical operation id rather than duplicated (`WF-04b`); conflicts preserve unsaved work; `serviceError` maps SQLSTATE classes to retry-safe versus rejected without leaking raw database text (unit-tested). Findings: CW-07 and CW-08 (missing resource and input bounds), both fixed. Statement timeouts are 3 s for `anon` and 8 s for `authenticated`. |

## 2. OWASP API Security Top 10:2023

| Category | Status | Evidence and outcome |
|---|---|---|
| **API1 Broken Object Level Authorization** | Tested, no finding | Every object read is filtered by an RLS policy keyed on `clinic_id`; every write re-derives the tenant inside a definer function. Direct object access by id across clinics returns zero rows (`XC-02`, `XC-16`) and id reuse is rejected (`XC-09`). UUID unpredictability is never relied on as the control. |
| **API2 Broken Authentication** | Tested, findings | CW-01, CW-06, CW-12, CW-14. Tokens are bearer, not cookies; a stale token carries no stale authority because membership is re-read per statement (`REM-01`…`REM-05`). |
| **API3 Broken Object Property Level Authorization** | Tested, findings | CW-03 (audit payload columns, fixed). Mass assignment is structurally prevented: clients cannot write tables at all, and `apply_command` reads named fields from the payload rather than spreading it. The `alerts` field is separately guarded against assistants (`PRIV-04`), and `role`/`is_admin` are written by no client-reachable path. |
| **API4 Unrestricted Resource Consumption** | Tested, findings | CW-07, CW-08, both fixed. Pagination is bounded (limit clamped 1–100 in search, 50-row pages elsewhere), payloads capped at 1 MiB, uploads at 20 MiB, invitations at 20/hour/clinic. Load testing was prohibited by the rules of engagement. |
| **API5 Broken Function Level Authorization** | Tested, findings | CW-02, CW-05, both fixed. Every RPC re-checks capability; admin-only functions refused non-admins (`PRIV-05`…`PRIV-07`), doctor-only functions refused assistants (`PRIV-08`, `PRIV-10`…`PRIV-12`). Functions hidden in the UI were called directly over HTTP and still refused. |
| **API6 Unrestricted Access to Sensitive Business Flows** | Tested, finding | Handoff, completion and amendment all require fresh intent, correct state and correct actor. Replay is idempotent. Gap: CW-13 (receipt not required for clinical writes). Invitation abuse is bounded and revocation-aware (`INV-01`, `INV-02`). |
| **API7 Server-Side Request Forgery** | **Not applicable** | No server-side fetch exists anywhere: no Edge Functions, no `pg_net`, no `http` extension, no webhooks (all verified against the live extension list and function inventory, not assumed). |
| **API8 Security Misconfiguration** | Tested, findings | CW-02, CW-09, CW-10, CW-18. CORS is `*` at the Supabase gateway, which is correct for bearer-token APIs and does not create a CSRF path because no ambient credential is sent; the browser boundary is the token in `sessionStorage`. |
| **API9 Improper Inventory Management** | Tested, no finding | The complete surface is inventoried in `ASSET-INVENTORY.md`. One unused-by-web RPC (`clinic_fail_attachment`) belongs to the mobile client and is accounted for. No staging or legacy endpoints exist; there is one database and no deployment. |
| **API10 Unsafe Consumption of APIs** | **Not applicable** | The client consumes only the Supabase API of its own project; no third-party API is called from client or server. |

## 3. ASVS 5.0 — selected requirements

Quoted text is from the ASVS repository `5.0/en` chapters retrieved during the engagement.

### V8 Authorization (Level 2 baseline; 8.4.1 treated as essential for this product)

| Requirement | Status | Finding / evidence |
|---|---|---|
| **8.1.1** "authorization documentation defines rules for restricting function-level and data-specific access" | Partially met | The capability model is coherent and now documented in `DATABASE-REVIEW.md` §3, but the project had no authorization document of its own before this engagement. |
| **8.1.2** "rules for field-level access restrictions (both read and write)" | Failed, now met | CW-03: field-level read restriction for `audit_events` existed only in clients. Fixed by a column grant. |
| **8.1.3 / 8.1.4** environmental and contextual attributes in decisions | **Not applicable** | The application makes no decisions on time of day, location, IP or device posture. Device identity is used for presence, not authorization. |
| **8.2.1** "function-level access is restricted to consumers with explicit permissions" | Met | 12 privilege-escalation checks refused; CW-05 closed the one path that could have routed around a wrapper. |
| **8.2.2** "data-specific access ... to specific data items" | Met | 21 cross-clinic checks; RLS on every table. |
| **8.2.3** "field-level access ... to specific fields" | Failed, now met | CW-03 (read); write-side field control verified by `PRIV-04` (assistant cannot write `alerts`). |
| **8.2.4** adaptive controls from contextual attributes | **Not applicable** | See 8.1.3. |
| **8.3.1** "enforces authorization rules at a trusted service layer and doesn't rely on controls that an untrusted consumer could manipulate" | Met | All authorization is in PostgreSQL; the browser holds no control. CW-05 strengthened this. |
| **8.3.2** "changes to values on which authorization decisions are made are applied immediately" | Met | Membership is re-read per statement, not taken from JWT claims; `REM-01`…`REM-05` confirm immediate effect with an unexpired token. |
| **8.3.3** "access ... based on the originating subject's permissions, not ... any intermediary" | Met | Definer functions run as `postgres` but derive identity from `auth.uid()` and re-check membership; they never act on a caller-supplied identity. |
| **8.4.1** "multi-tenant applications use cross-tenant controls" | Met | The central property of this system; tested end to end. |
| **8.4.2** (Level 3) administrative interfaces with layered security, continuous identity verification, device posture, contextual risk | **Not met** | Clinic administration is reached with the same single-factor session as ordinary use. Relevant because administrators control clinical access; carried as CW-12 (MFA) and CW-01 (re-authentication). |

### V5 File Handling (Level 2)

| Requirement | Status | Finding / evidence |
|---|---|---|
| **5.1.1** documentation defines permitted types, expected extensions, maximum size | Met (after fix) | Four MIME types, 20 MiB, extensions now explicitly bound (CW-04); documented in `ASSET-INVENTORY.md` and the upload field hint. |
| **5.2.1** accepts only sizes it can process | Met | 20 MiB bucket limit plus a server-side `bytes` check and a client check. |
| **5.2.2** "checks if the file extension matches an expected file extension and validates that the contents correspond to the type represented by the extension" | Partially met | Extension↔type binding fixed (CW-04); contents are validated by magic bytes on the **client** only — server-side content validation is CW-11, open. |
| **5.2.3 / 5.2.5 / 5.2.6** archives, symlinks, pixel flood | **Not applicable** | No archive handling, no decompression, no server-side image processing. Client-side rendering is the browser's own decoder. |
| **5.2.4** per-user file quota and count limit | **Not met** | No quota beyond per-file size and the bucket limit. Low risk given the closed user population; noted for the owner. |
| **5.3.1** uploaded files not executed as server-side code | Met | Private bucket, no server-side execution anywhere in the architecture. |
| **5.3.2** "uses internally generated or trusted data" for file paths | Met | Path is `clinic/patient/attachment`, generated server-side; no user-controlled segment. |
| **5.3.3** ignore user path information in server-side processing | **Not applicable** | No server-side file processing. |
| **5.4.1** validates or ignores user-submitted filenames and specifies a filename in `Content-Disposition` | Partially met | The client now derives the saved name from the verified type (CW-04) and sanitises it; the response header is Supabase Storage's, not the application's. |
| **5.4.2** served file names encoded/sanitised (RFC 6266) | Partially met | Same as 5.4.1. |
| **5.4.3** antivirus scanning of untrusted files | **Not met** | No scanning. Would be addressed by the same server-side component proposed for CW-11. |

### Other chapters (chapter-level mapping; individual requirement text not re-verified line by line)

| Chapter | Status |
|---|---|
| V1 Encoding and Sanitization / V2 Validation | Reviewed; bounds now exist at the table for every client-supplied text column (CW-08 closed the last gap). No injection sink found. |
| V3 Web Frontend Security | Partially met: CSP baseline added (CW-10), `X-Frame-Options`/`frame-ancestors` and HSTS depend on hosting (CW-18). `referrer=no-referrer` and `noindex` are set. |
| V6 Authentication | CW-01, CW-06, CW-12 apply. |
| V7 Session Management | Bearer tokens in `sessionStorage` (cleared on tab close, not readable cross-origin); CW-14 applies to logout scope; session timeout is a project setting, not tested. |
| V10 Dependency / build integrity | Met after CW-09; `npm audit` clean, lockfile pinned. |
| V11 Business Logic | Strong; CW-13 is the one open gap. |
| V12 API and Web Service | Met; the API is PostgREST with per-statement authorization. |

## 4. WSTG references used

Identifiers below anchor the tests actually performed. Those marked "not tested" are recorded so the gap is explicit rather than silent.

| ID | Name | Status |
|---|---|---|
| WSTG-ATHZ-02 | Bypassing Authorization Schema | Tested — `PRIV-01`…`PRIV-12`, `AUTHZ-01`, `AUTHZ-02` |
| WSTG-ATHZ-03 | Testing for Privilege Escalation | Tested — no path to `role` or `is_admin` found |
| WSTG-ATHZ-04 | Insecure Direct Object References | Tested — `XC-02`, `XC-09`, `XC-16`, `XC-20` |
| WSTG-ATHN-07 | Testing for Weak Password Policy | Tested (client); server minimum not observable — CW-06, CW-12 |
| WSTG-ATHN-09 | Weak Password Change or Reset Functionalities | Tested — CW-01 |
| WSTG-IDNT-04 | Account Enumeration and Guessable User Account | Tested — recovery returns a constant message; sign-in errors generic |
| WSTG-SESS-06 | Testing for Logout Functionality | Tested — CW-14 |
| WSTG-SESS-07 | Testing for Session Timeout | **Not tested** — project setting, not observable |
| WSTG-INJT-05 | SQL Injection | Tested — markers stored verbatim; no dynamic SQL exists |
| WSTG-CLNT-01 | DOM-Based Cross Site Scripting | Tested — no raw HTML sink; markers render as text |
| WSTG-CLNT-09 | Clickjacking | Partially — `frame-ancestors`/`X-Frame-Options` require hosting (CW-18) |
| WSTG-CONF-12 | Content Security Policy | Tested — CW-10 |
| WSTG-BUSL-06 | Circumvention of Work Flows | Tested — `WF-01`…`WF-07`, CW-13 |
| WSTG-BUSL-08/09 | Upload of Unexpected File Types / Malicious Files | Tested — `DOC-02`, `DOC-05`; CW-04, CW-11 |
| WSTG-CONF-07 | Strict-Transport-Security | **Not tested** — no deployment |
