# Owner actions — Supabase dashboard checklist

**Status: three of four completed on 19 September 2026**, through the desktop app's browser pane using the already-signed-in dashboard session. Project: **clinic-chatgpt-dev** (`geikkygtnsgbtajyqdvc`). Each change below was verified against the API or the database afterwards, not just observed in the UI.

| #   | Item                               | Status                                                                    |
| --- | ---------------------------------- | ------------------------------------------------------------------------- |
| 1   | Secure password change             | **Done**, with an important limitation — read below                       |
| 2a  | Minimum password length 12         | **Done**, verified server-side                                            |
| 2b  | Leaked-password protection         | **Blocked** — requires a Pro plan; this org is on Free                    |
| 3   | Delete the orphaned storage object | **Done**                                                                  |
| 4   | Redirect allowlist                 | **Not applicable yet** — no hosting exists; current list is already clean |

---

## 1. Secure password change — done, but CW-01 is not fully closed

**Enabled.** Authentication → Sign In / Providers → Email → _Secure password change_ is on, confirmed persisted.

**Read this limitation.** The setting's own wording is: a user must be _recently logged in_ to change their password without reauthenticating, and recently means **the session was created within the last 24 hours**. In a clinic where staff sign in each morning, a session at an unlocked workstation is almost always under 24 hours old, so an attacker at that keyboard can still change the password. This setting raises the bar; it does not close CW-01 on its own.

**The control that would close it** is the adjacent toggle, _Require current password when updating_, which forces the user to supply their existing password. **I deliberately left it off**, because the only password-update path this web app has is the recovery screen, and a user completing a recovery link cannot supply their current password. If Supabase applies that requirement to recovery sessions too, enabling it would break password recovery entirely, and there is no other reset path.

**Recommended:** once hosting exists and the redirect allowlist is configured (item 4), run one real recovery end to end with the toggle **on**. If recovery still completes, leave it on and CW-01 is closed. If recovery fails, turn it off and rely on the client guard plus a short session lifetime instead.

---

## 2. Password strength — partly done

**Done.** Minimum password length was **6**, weaker even than the 8 the web client used to allow. It is now **12**, matching both mobile apps. Verified server-side: a sign-up with an 11-character password is rejected with `weak_password`, "Password should be at least 12 characters." No account was created by that probe.

**Blocked.** _Prevent use of leaked passwords_ is **only available on Pro plans and above**, and the `Homeversion` org is on **Free**. Enabling it caused the whole save to fail with:

> Failed to update auth configuration: Configuring leaked password protection via HaveIBeenPwned.org is available on Pro Plans and up.

The toggle was reverted so the other two settings could save. The `auth_leaked_password_protection` advisor warning therefore remains, and will until the project is upgraded. **This is a billing decision, not a technical one.** Until then, the 12-character minimum plus the client-side rule is the whole password defence, which is why MFA for doctor accounts (CW-12) matters more than it otherwise would.

---

## 3. Orphaned storage object — done

Deleted the 70-byte PNG at `fea6cab4-…/674c11d0-…/b6bf9e54-…`, then the now-empty `fea6cab4-…` folder along with the zero-byte `.emptyFolderPlaceholder` that Supabase leaves behind.

Verified in the database: `storage.objects` for `clinic-documents` now contains exactly one row, the real 4.4 MB attachment under `babaf4d2-…`, which has a live `attachments` record. No orphans remain.

---

## 4. Redirect allowlist — nothing to do yet

Current state, read on 19 September 2026:

- **Site URL:** not set.
- **Redirect URLs:** exactly two, both mobile custom schemes — `dev.homeversion.clinic.assistant://auth-callback/` and `dev.homeversion.clinic.doctor://auth-callback/`.

No wildcards, no stale localhost entries. The list is already tight, so there is nothing to clean up.

**When hosting exists**, set Site URL to the web origin and add `<origin>` and `<origin>/auth/recovery`. Note that **web password recovery cannot work until this is done**, because no web origin is currently allowlisted.

---

## Still outstanding

| Item                                                                                                           | Status                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Upgrade to Pro, then enable leaked-password protection                                                         | Billing decision (item 2b)                                                                                           |
| Test _Require current password when updating_ against a real recovery, then leave it on if recovery survives   | After hosting (item 1)                                                                                               |
| Deploy the site and verify its real headers                                                                    | Needs a hosting decision. Use `deploy/nginx.example.conf`; the meta-tag CSP does not cover `frame-ancestors` or HSTS |
| Add the web origin to Site URL and the redirect allowlist                                                      | After hosting (item 4)                                                                                               |
| Backups, restore drill, retention, monitoring                                                                  | Unverified in this assessment. Required before clinical use                                                          |
| Server-side document verification (CW-11), receipt gate (CW-13), audit retention (CW-03 residual), MFA (CW-12) | **Deferred by your decision on 19 September 2026.** Written proposals in `proposed-fixes/`, applied nowhere          |
