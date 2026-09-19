# Fixes

## Applied (already in the repositories and the development database)

| Artefact                                    | Where it is applied                                                                                                                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260918234315_web_security_hardening.sql` | `clinic-chatgpt/supabase/migrations/` (canonical), `clinic-web/docs/migrations/`, and the hosted project `geikkygtnsgbtajyqdvc` (version `20260918234315`). SHA-256 `A951F7221E0335F62B8019534B86D0DB01F3DE29D839FA20C0B6B8374ED0D702`. |
| `clinic-web-source-changes.patch`           | Committed to `clinic-web` as `4ba46a6` and pushed. Kept here as a standalone record of the source changes for review.                                                                                                                   |

## Not applied — deferred by the owner on 19 September 2026

Each item below was offered for implementation and explicitly deferred. They are designs only; no code, migration or configuration anywhere depends on them.

### A. Server-side receipt gate for consultation writes (`proposed-acknowledgement-gate.sql`)

Today the web and mobile clients only enable the consultation editor after the doctor acknowledges the handoff, but the database accepts a `visit save` from the assigned doctor as soon as the appointment is `withDoctor`, without a receipt. The proposal makes `clinic_private.apply_command` require an `appointment_receipts` row for the current appointment version before the first `visit save`/`complete`. It is a workflow-integrity strengthening, not a vulnerability fix, and it changes cross-app behaviour (the mobile doctor app's offline outbox must acknowledge before queuing notes), so it is left for the owner.

Test to add (PGlite): after `send`, a `visit save` by the assigned doctor without `clinic_acknowledge_appointment` → `RECEIPT_REQUIRED`; after acknowledgement → receipt.

### B. Server-side content verification for documents (`proposed-verify-attachment-edge-function.md`)

`finalize_attachment` verifies stored size and (since this audit) the declared Storage mimetype, but the SHA-256 recorded at staging is client-asserted and the bytes are never inspected server-side. An Edge Function running with the service role could download the object, verify magic bytes and SHA-256, and only then mark the attachment `ready`. Both clients would need to call it instead of `clinic_finalize_attachment`. Deferred because it introduces the first server-side component and a secret to manage.

### C. Dashboard-only changes (no code)

The owner is performing these directly. Step-by-step instructions with links are in [`../OWNER-ACTIONS.md`](../OWNER-ACTIONS.md): secure password change, leaked-password protection plus a 12-character minimum, deletion of the audit's one orphaned Storage object, and the redirect allowlist once hosting exists. TOTP MFA for doctor and administrator accounts, after which `admin` and `clinical_write` could be gated on `aal2` in `clinic_private.allowed`, is also deferred.
