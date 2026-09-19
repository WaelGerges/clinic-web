# Clinic Web security assessment — 19 September 2026

Evidence-driven security assessment of **clinic-web** (React/TypeScript/Vite + `@supabase/supabase-js`) and the Supabase backend it shares with the Clinic Assistant / Clinic Doctor mobile apps. Per the owner's instruction on 19 September 2026, findings were **fixed directly** in this repository, in the backend repository (`C:\waelg\projects\clinic-chatgpt`, source of truth for migrations) and in the development database, rather than only proposed.

## Scope and environment

| Item                           | Value                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                     | `C:\waelg\projects\clinic-web`, branch `main`, commit `ffed83046b868c1b8f630d29d4246a48a8d2f766` (dirty: untracked `docs/clinic-web-security-audit-master-prompt.md`)                                                                                                                     |
| Backend repository             | `C:\waelg\projects\clinic-chatgpt` at `e11e7d4ebe8c54501fe5e0a255a290cf76d29ecc` (working tree carried unrelated uncommitted changes, preserved)                                                                                                                                          |
| Database assessed and modified | Supabase project `clinic-chatgpt-dev` (`geikkygtnsgbtajyqdvc`, eu-west-1, PostgreSQL 17.6). The owner confirmed this is the only permitted target and its data is development data. `clinicdb` (`zqzehmidtbqtxiudkbrg`) and the `clinic` folder were excluded on the owner's instruction. |
| Deployed website               | None exists (README statement confirmed; no hosting artefacts, no public URL). Deployment headers/TLS therefore **not tested**.                                                                                                                                                           |
| Execution window               | 2026-09-18 23:05 UTC to 2026-09-19 00:20 UTC (Cairo 2026-09-19 02:05–03:20)                                                                                                                                                                                                               |
| Tools                          | Node 24.14.1, npm 11.11.0, git 2.55.0, vitest 5.0.1, @playwright/test 1.63.0 (Microsoft Edge channel), @electric-sql/pglite 0.5.8, Supabase MCP (`execute_sql`, `apply_migration`, `get_advisors`, catalog listing), curl, the desktop app's Chromium pane (PDF sandbox check)            |
| Standards                      | OWASP Top 10:2025 (top10.owasp.org/2025, accessed 2026-09-19), OWASP API Security Top 10:2023, OWASP ASVS 5.0 (GitHub `master/5.0/en`, accessed 2026-09-19), OWASP WSTG v4.2 identifiers (checklist accessed 2026-09-19), CWE, CVSS v4.0                                                  |

## What was done

1. Full manual review of every first-party file (`src/**`, tests, scripts, configs, CI, nginx example, reference migration). See `ASSET-INVENTORY.md` and the coverage ledger in `REPORT.md`.
2. Read-only catalog inspection of the live database (roles, grants, RLS, policies, every function definition, triggers, bucket, publication, default privileges, advisors) — no patient rows were read. See `DATABASE-REVIEW.md` and `evidence/db-catalog-snapshot.md`.
3. Bounded unauthenticated HTTP probes (Auth settings, exposed schemas, anon table/RPC/storage access, CORS). See `evidence/http-probes.md`.
4. A hardening migration written, tested in PGlite against the full migration chain (49/49 backend tests), applied to the development project as version `20260918234315`, and verified live.
5. Web-side fixes applied and verified (17 unit tests, 14 mocked browser scenarios, type-check, production build with CSP meta, format check).
6. An end-to-end HTTP authorization matrix (88 checks, nine actor/tenant combinations) executed against the development project with synthetic accounts, then cleaned up. See `AUTHORIZATION-MATRIX.csv`, `TEST-RESULTS.md`, `evidence/live-authz-matrix-results.json`.

## Files

| File                       | Purpose                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REPORT.md`                | Executive summary, architecture/threat model, coverage, ranked findings, attack chains, remediation plan                                                     |
| `FINDINGS.json`            | Machine-readable findings (schema documented inside)                                                                                                         |
| `ASSET-INVENTORY.md`       | Routes, client operations, RPCs, database objects, storage/realtime, integrations, deployment assets                                                         |
| `AUTHORIZATION-MATRIX.csv` | Actor × tenant × operation with expected/observed results and evidence IDs                                                                                   |
| `OWASP-COVERAGE.md`        | Top 10:2025, API Top 10:2023, ASVS 5.0 and WSTG mapping with status                                                                                          |
| `DATABASE-REVIEW.md`       | Exposure, grants, RLS, functions, storage, auth, drift, advisors                                                                                             |
| `OWNER-ACTIONS.md`         | **Start here if you are the project owner.** The four Supabase dashboard steps that could not be performed from this session, with links and verification    |
| `REMEDIATION-PLAN.md`      | What was fixed, what remains, owners, verification                                                                                                           |
| `TEST-RESULTS.md`          | Commands, dates, results, fixture provenance, cleanup status                                                                                                 |
| `HYPOTHESIS-LEDGER.md`     | Every attack hypothesis with outcome, rejected claims, unresolved questions                                                                                  |
| `evidence/`                | Sanitized catalog snapshot, HTTP probe log, live matrix results (no tokens, no patient data)                                                                 |
| `tests/`                   | `live-authz-matrix.mjs` (repeatable live matrix), `security-hardening.test.mjs` (PGlite regression tests, canonical copy in `clinic-chatgpt/backend-tests/`) |
| `proposed-fixes/`          | The applied migration, the applied web source patch, and two **unapplied** proposals                                                                         |

## Reproduce

```powershell
# Web: unit, type-check, build (CSP meta), format, mocked browser suite
npm test; npm run check; npm run build; npm run format:check; npm run test:e2e

# Backend regression tests against the whole migration chain (PGlite, no network)
cd ..\clinic-chatgpt; npm test

# Live authorization matrix (requires five confirmed synthetic accounts; see TEST-RESULTS.md)
node security-audit/tests/live-authz-matrix.mjs
```

## Limitations

- No public deployment exists, so HTTPS, response headers, caching and SPA fallback were reviewed only in `deploy/nginx.example.conf` and the build output.
- Supabase Auth dashboard settings (password minimum, leaked-password protection, secure password change, redirect allowlist, rate limits, JWT/OTP lifetimes, SMTP) are not readable or writable through the tools available; only the public `/auth/v1/settings` endpoint and the security advisor were observable.
- Realtime authorization was verified by design review and RLS policy inspection, not by a live subscription test.
- Operational controls (backups, restore drills, retention, monitoring, alerting) could not be evidenced from the repository or the database.
- No assessment can guarantee the absence of vulnerabilities; every surface reviewed and its final status is listed in `REPORT.md` §5 and `HYPOTHESIS-LEDGER.md`.
