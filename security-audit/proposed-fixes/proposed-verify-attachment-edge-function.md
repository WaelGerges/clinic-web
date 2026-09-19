# Proposal (not applied): server-side verification of uploaded document bytes

**Problem (finding CW-11).** The SHA-256 stored in `attachments.sha256` is supplied by the uploading client. `finalize_attachment` verifies the stored object's size and, since migration `20260918234315`, the Storage-recorded mimetype, but never the bytes. A malicious member can therefore record a digest that does not match the object (other members' clients refuse to open it: an integrity-check denial) or upload bytes that only superficially match the declared type. Downloading clients (web: `detectMime` + size + SHA-256) are the only content check.

**Design.**

1. Edge Function `verify-attachment` (Deno), `verify_jwt = true`, CORS restricted to the web origin.
2. Input `{ attachment_id }`. Using the caller's JWT, call `clinic_authorize_attachment_access(attachment_id,'preview')` semantics is not applicable to pending objects; instead the function uses a service-role client **only** to read `attachments` (state `pending`, `uploaded_by` = caller `sub`) and to download `clinic-documents/<object_path>`.
3. Verify: byte length = `bytes`; SHA-256(bytes) = `sha256`; magic bytes match `content_type` (`%PDF-`, `\xFF\xD8\xFF`, PNG signature, `RIFF….WEBP`); for PDFs reject files containing `/JavaScript` or `/OpenAction` if the clinic policy requires.
4. On success call a new SECURITY DEFINER function `clinic_private.mark_attachment_verified(p_id)` (service-role only) that sets `state='ready'` and writes `attachment.finalized` with `verified_by='edge'`. On failure call `clinic_fail_attachment` semantics and audit `attachment.rejected`.
5. Keep `clinic_finalize_attachment` for the mobile apps until they migrate, but have it set a new column `verified=false`; the web client shows unverified documents with a warning and the storage SELECT policy may require `verified` once both clients use the function.

**Secrets.** The service-role key lives only in the Edge Function's environment. Never in `VITE_*`.

**Tests.** Unit test the verifier with the fixtures in `tests/workflows.spec.ts` (PDF, PNG); integration test with a mismatched digest expecting rejection.

**Rollout.** Deploy function → web calls it after upload → mobile update → enforce `verified` in policy. Rollback is removing the policy condition.
