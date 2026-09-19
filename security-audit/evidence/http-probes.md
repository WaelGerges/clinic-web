# Unauthenticated HTTP probes — development project (2026-09-18 23:28 UTC)

Bounded, read-only requests with the public publishable key against `https://geikkygtnsgbtajyqdvc.supabase.co`. The key is public by design and is not reproduced here.

| # | Request | Response | Meaning |
|---|---|---|---|
| 1 | `GET /auth/v1/settings` | `external.email=true`, all social providers false, `anonymous_users=false`, `disable_signup=false`, `mailer_autoconfirm=false`, `phone=false`, `saml_enabled=false`, `passkeys_enabled=false` | Open e-mail sign-up with mandatory confirmation; anonymous sign-ins disabled (so no anonymous `authenticated` JWTs exist) |
| 2 | `GET /rest/v1/` | OpenAPI with no paths for `anon` | anon sees no tables or functions |
| 3 | `POST /rest/v1/rpc/apply_command` with `Content-Profile: clinic_private` | `406` `PGRST106` "Only the following schemas are exposed: public, graphql_public" | private schema not reachable through PostgREST |
| 4 | `GET /rest/v1/patients?select=id&limit=1` | `401` `42501` permission denied | anon has no table privilege |
| 5 | `POST /rest/v1/rpc/clinic_create` | `401` `42501` permission denied for function | anon cannot execute RPCs |
| 6 | `POST /storage/v1/object/list/clinic-documents` | `200 []` | RLS returns nothing to anon |
| 7 | `POST /graphql/v1 {__typename}` | `200` `{"errors":[{"message":"pg_graphql extension is not enabled."}]}` | GraphQL surface absent |
| 8 | `OPTIONS /rest/v1/patients` from `Origin: https://evil.example` | `Access-Control-Allow-Origin: *`, HSTS preload present | Standard Supabase behaviour; credentials are bearer tokens, not cookies, so a foreign origin cannot ride an existing session (no CSRF); a page that already holds the token is the real boundary (XSS) |

Authenticated probes are recorded in `live-authz-matrix-results.json`.
