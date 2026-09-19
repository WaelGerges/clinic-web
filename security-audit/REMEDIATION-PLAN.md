# Remediation plan

Ten findings were fixed and verified during the engagement. Four remain open. This plan lists what changed, what is left, who owns it, and how to prove each item.

## 1. Already applied and verified

### Database — migration `20260918234315_web_security_hardening`

Applied to `clinic-chatgpt-dev` on 2026-09-18 23:43 UTC. Canonical file: `clinic-chatgpt/supabase/migrations/`; reference copies in `clinic-web/docs/migrations/` and `proposed-fixes/`. SHA-256 `A951F7221E0335F62B8019534B86D0DB01F3DE29D839FA20C0B6B8374ED0D702`, recorded in `clinic-chatgpt/CONTINUE-HERE.md`.

| Finding | Change                                                                                                                                     | Verification                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| CW-05   | 15 `public.clinic_*` wrappers → `SECURITY DEFINER` with `search_path=''`; `EXECUTE` on `clinic_private` revoked except the two RLS helpers | Live catalog; test DB-01           |
| CW-03   | `audit_events` SELECT regranted per column (8 metadata columns)                                                                            | Live `AUD-01`…`AUD-04`; test DB-02 |
| CW-04   | `begin_attachment` extension binding; `finalize_attachment` MIME comparison                                                                | Live `DOC-02`; tests DB-03 ×2      |
| CW-07   | 20-clinic cap per user; 10 presence rows per doctor                                                                                        | Tests DB-04 ×2                     |
| CW-08   | `patients_mobile_bound` (≤40 chars)                                                                                                        | Test DB-05                         |
| CW-02   | Default privileges in `public` and `clinic_private` narrowed to `postgres`/`service_role`                                                  | Live catalog; test DB-06           |

The migration carries a verification block that raises if any expectation does not hold, and every function patch is guarded so it fails closed on an unexpected definition. Rollback is a new migration re-granting what was revoked; there is no data change to undo.

**Regression suite:** `clinic-chatgpt` `npm test` → 49/49 (8 new). Run this before any future backend change.

### Web application (working tree of `clinic-web`, awaiting your review and commit)

| Finding | Change                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| CW-01   | `/auth/recovery` requires a PKCE `code` on the page load                                                                           |
| CW-06   | Password fields 12–72 characters                                                                                                   |
| CW-04   | `extensionMatches()` refuses mismatched uploads; `downloadName()` saves under the verified type's extension and sanitises the name |
| CW-10   | Build injects a baseline CSP meta tag                                                                                              |
| CW-09   | CI actions pinned to commit SHAs                                                                                                   |
| —       | Two Arabic strings added; README security section; new server error codes mapped to user-facing messages                           |

**Verification:** 17 unit tests, 14 browser scenarios, type-check, production build, format check, translation check — all pass.

## 2. Immediate — owner actions (cannot be done from the repository)

**Step-by-step instructions with dashboard links are in [`OWNER-ACTIONS.md`](OWNER-ACTIONS.md).** On 19 September 2026 the owner elected to perform these directly; an attempt to reach them from this session failed because no browser session was connected, the Supabase CLI was unauthenticated, and `supabase login` requires the owner's credentials.

| #   | Action                                                                                                                    | Why                                                                                                                                                                | How to verify                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1   | **Enable "secure password change"** in Supabase Auth (require re-authentication before `updateUser({password})`)          | This is the authoritative fix for CW-01; the client-side route guard alone can be bypassed from the console                                                        | Attempt a password change from a live session without re-authenticating; expect rejection |
| 2   | **Enable leaked-password protection** and set the minimum password length to 12                                           | CW-12; the client minimum is advisory only                                                                                                                         | The `auth_leaked_password_protection` advisor WARN disappears                             |
| 3   | **Delete the orphaned fixture Storage object** under prefix `fea6cab4-7fca-4944-8917-3fa29722dd7e/` in `clinic-documents` | Left by this audit; clients cannot delete objects and SQL deletion would strand the bytes. A bounded removal was attempted and reverted — see `TEST-RESULTS.md` §6 | Dashboard → Storage shows the prefix empty                                                |
| 4   | **Review the commits** pushed on 19 September 2026 (`clinic-web` `4ba46a6`, `clinic` `90f8ed2`)                           | The fixes are committed and pushed; review is still owed                                                                                                           | `git log` on both remotes                                                                 |

## 3. Short term

> **Decision of 19 September 2026:** the owner deferred items 5, 6 and 10 to 11. They stay as written proposals and are applied nowhere. Nothing in the code or the database depends on them.

| #   | Action                                                                               | Owner               | Notes                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | Decide on server-side document verification (CW-11)                                  | Owner + engineering | **Deferred.** Design in `proposed-fixes/proposed-verify-attachment-edge-function.md`. Introduces the first server-side component and a service-role secret; rollout is function → web → mobile → policy enforcement                                                                                                              |
| 6   | Decide on the receipt gate for clinical writes (CW-13)                               | Owner + mobile team | **Deferred.** `proposed-fixes/proposed-acknowledgement-gate.sql`. Changes offline outbox ordering in the mobile Doctor app; do not apply unilaterally                                                                                                                                                                            |
| 7   | Configure hosting and verify headers against the live origin (CW-18)                 | Engineering         | Use `deploy/nginx.example.conf`; the meta-tag CSP does not cover `frame-ancestors` or HSTS. Verify: CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors`, HSTS after TLS is confirmed, `Cache-Control` on clinical responses, SPA fallback for `/auth/recovery`, and document-preview isolation |
| 8   | Add the exact web origin and `<origin>/auth/recovery` to the Auth redirect allowlist | Owner               | Only after the origin exists; verify recovery end to end in the initiating browser (PKCE)                                                                                                                                                                                                                                        |
| 9   | Decide the sign-out scope question (CW-14)                                           | Owner               | Either keep local scope and shorten refresh-token lifetime, or add an explicit "sign out everywhere"                                                                                                                                                                                                                             |

## 4. Medium term

| #   | Action                                                                       | Owner       | Notes                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | Audit payload retention (CW-03 residual)                                     | Owner       | Store a diff or field list instead of whole documents, or move payloads to `clinic_private` with no client grant; define a retention period. The table is immutable and append-only, so this needs a migration and a policy decision, not a delete |
| 11  | MFA for doctor and administrator accounts (CW-12, ASVS 8.4.2)                | Owner       | TOTP enrolment, then require `aal2` for the `admin` and `clinical_write` capabilities in `clinic_private.allowed`                                                                                                                                  |
| 12  | Per-user storage quota (ASVS 5.2.4) and a sweeper for failed uploads (CW-17) | Engineering | Low urgency with a closed user population                                                                                                                                                                                                          |
| 13  | Evidence backups, restore drills, retention and monitoring                   | Owner       | Entirely unverified today; required before clinical use                                                                                                                                                                                            |
| 14  | Add a lightweight authorization document (ASVS 8.1.1/8.1.2)                  | Engineering | `DATABASE-REVIEW.md` §3 is a usable starting point                                                                                                                                                                                                 |

## 5. Verification checklist before clinical use

1. All four immediate actions complete.
2. Hosting live, headers verified against the real origin, TLS and HSTS confirmed.
3. Owned-account acceptance test of sign-up, confirmation, recovery and password change in the initiating browser.
4. Two-device mobile/web acceptance for the handoff and consultation flow.
5. `npm test` in both repositories green; the live authorization matrix re-run against staging with fresh synthetic accounts and cleaned up.
6. Backup and restore demonstrated, retention and monitoring documented.
7. Privacy and regulatory obligations confirmed with counsel. **This assessment makes no compliance claim** for HIPAA, GDPR or Egyptian law; no such scope was in evidence.
