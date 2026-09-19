# Database catalog snapshot — `clinic-chatgpt-dev` (PostgreSQL 17.6.1.166), 2026-09-18 23:15–23:50 UTC

Read-only catalog queries via the Supabase MCP `execute_sql` (runs as `postgres`, BYPASSRLS; used only for metadata and counts). No patient rows were selected. "Before" = prior to migration `20260918234315`; "after" = verified after it.

## Roles

| Role | super | bypassrls | login | config |
|---|---|---|---|---|
| anon | no | no | no | `statement_timeout=3s` |
| authenticated | no | no | no | `statement_timeout=8s` |
| authenticator | no | no | yes | `statement_timeout=8s`, `lock_timeout=8s`, supautils/safeupdate preload |
| postgres | no | **yes** | yes | owner of all clinic objects; member of anon/authenticated/service_role |
| service_role | no | **yes** | no | never used by any client code |

## Schemas and exposure

- PostgREST exposed schemas: `public, graphql_public` (confirmed by PGRST106 probe). `clinic_private` has USAGE for `authenticated` (needed for RLS helper functions) and is not exposed.
- Extensions installed: `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`, `plpgsql`. Not installed: `pg_graphql`, `pg_cron`, `pg_net`, `http`, `pgjwt`.
- Edge Functions: none. Branches: none.

## Tables and grants (public) — before and after

| Table | RLS | anon | authenticated | service_role |
|---|---|---|---|---|
| clinics, clinic_memberships, patients, appointments, visits, visit_revisions, diagnoses, prescriptions, prescription_items, attachments | on | none | SELECT | ALL |
| audit_events | on | none | before: SELECT (all columns) → **after: SELECT on `id,clinic_id,actor_id,actor_role,action,object_type,object_id,occurred_at` only** | ALL |
| visit_details (view, `security_invoker=true`) | n/a | none | SELECT | ALL |
| clinic_private.* (8 tables) | on, no policies | none | none | (owner postgres) |

## RLS policies (all PERMISSIVE, role `authenticated`, SELECT only unless stated)

| Table | USING |
|---|---|
| clinics | `clinic_private.allowed(id)` |
| clinic_memberships | `allowed(clinic_id) and (user_id = auth.uid() or allowed(clinic_id,'admin') or role='doctor')` |
| patients, appointments | `allowed(clinic_id)` |
| visits, visit_revisions, diagnoses, prescriptions, prescription_items | `allowed(clinic_id,'clinical_read')` |
| attachments | `allowed(clinic_id) and (not clinical or allowed(clinic_id,'clinical_read'))` |
| audit_events | `allowed(clinic_id,'admin')` |
| storage.objects INSERT | WITH CHECK `bucket_id='clinic-documents' and attachment_object_allowed(name,true)` |
| storage.objects SELECT | `bucket_id='clinic-documents' and attachment_object_allowed(name,false)` |
| storage.objects UPDATE/DELETE | no policy → denied (`DOC-06`, `DOC-09`) |

`clinic_private.allowed(p_clinic, p_capability)`: STABLE SECURITY DEFINER, `search_path=''`; false when `auth.uid()` is null; requires an `active` membership in an unarchived clinic; capabilities `read`, `clinical_read` (doctor or flag), `clinical_write` (doctor), `admin` (`is_admin`).

## Functions

- `clinic_private`: 25 functions, all owner `postgres`, `search_path=''`, no dynamic SQL, fully schema-qualified; 22 SECURITY DEFINER. Before: 20 executable by `authenticated`. **After: only `allowed` and `attachment_object_allowed`.**
- `public.clinic_*`: 16 wrappers. Before: SECURITY INVOKER (except none), executable by `authenticated` and `service_role`. **After: 15 SECURITY DEFINER with `search_path=''`; `clinic_search_patients` stays INVOKER so RLS applies to its `SETOF patients` result.** `anon` can execute none.
- Definitions patched by the migration (guarded string patches, fail-closed): `begin_attachment` (extension check), `finalize_attachment` (Storage mimetype check), `create_clinic` (20-clinic cap + per-user advisory lock), `clinic_doctor_heartbeat` (10-device cap).

## Triggers

`immutable_*` (BEFORE UPDATE/DELETE → `IMMUTABLE_HISTORY` 42501) on audit_events, visit_revisions, diagnoses, prescriptions, prescription_items, clinic_private.appointment_receipts; `validate_booking` on appointments (overlap + working hours, clinic advisory lock); `revoke_attachment_grants_on_state` on attachments; Supabase's `protect_*_delete` on storage. All enabled before, during (except inside the fixture cleanup transaction) and after the audit.

## Storage

Bucket `clinic-documents`: private, 20 MiB limit, `allowed_mime_types = image/jpeg, image/png, image/webp, application/pdf`. Object path is server-generated `clinic/patient/attachment`. Read requires a 90-second lease row created by `authorize_attachment_access` (audited). Existing object: mimetype and size match its attachment row; eTag is MD5-shaped.

## Realtime

Publication `supabase_realtime`: `public.appointments`, `public.patients`, `public.visits` (insert/update/delete). No broadcast/presence use. RLS is evaluated per subscriber.

## Default privileges (role `postgres`)

Before: `public` tables/sequences/functions defaulted to `anon`, `authenticated`, `service_role`. **After: `postgres` and `service_role` only; `clinic_private` functions: `postgres` only.**

## Counts (metadata only)

users 3 (all e-mail, confirmed, none anonymous), clinics 1, memberships 3, patients 103, appointments 9, visits 1, attachments 1, storage objects 1 (+1 audit orphan after cleanup), audit_events 37, operation_receipts 25, presence rows 5 → 4.

## Advisors

- Security, before: WARN leaked-password protection disabled; INFO RLS-enabled-no-policy ×8 (clinic_private).
- Security, after: the same, plus WARN lint 0029 ×15 (definer wrappers callable by `authenticated`) — intended API surface.
- Performance: INFO unused indexes ×12 (no security relevance).
