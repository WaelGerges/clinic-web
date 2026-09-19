# Regression tests

| File | Runs where | Status |
|---|---|---|
| `security-hardening.test.mjs` | `clinic-chatgpt/backend-tests/` (canonical copy; this is a mirror). `npm test` there runs it with PGlite against the whole migration chain. | executed, 8/8 pass (49/49 for the full suite) |
| `live-authz-matrix.mjs` | any machine with Node 24 and five confirmed synthetic accounts on the authorized project (see header comment for the environment variables) | executed 2026-09-18 23:50 UTC, 87/88 + WF-04b; fixtures cleaned up |
| `../../src/domain.test.ts` (web unit tests) | `npm test` in clinic-web | executed, 17/17 pass; includes the extension-binding and download-naming tests |
| `../../tests/workflows.spec.ts` (mocked browser suite) | `npm run test:e2e` | executed, 14/14 pass |

`live-authz-matrix.mjs` creates data; run it only against a development project and follow the cleanup procedure in `../TEST-RESULTS.md` §6 afterwards. It never prints tokens or passwords.

Proposed but **not executed** tests are listed in `../proposed-fixes/README.md`.
