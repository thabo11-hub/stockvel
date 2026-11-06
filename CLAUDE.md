# Working on Stokvel

Plain Node on Vercel: `api/index.js` handles every `/api` route, `lib/` holds auth, database and
guard code, and `public/` is the static app. The database is Postgres on Neon. This repo is public.

## Security rules (keep them in every change)
- SQL only through `q()`/`one()` with `$1` placeholders. Never build SQL from input.
- Validate every input on the server (`text()`, `whole()`, `uuidOf()`, `monthOf()`, `passwordOf()`).
  Check access with `access()` plus `needManage()`/`needConfirm()`.
- State-changing routes go through `handler()`, so they keep the `X-Stokvel` + same-origin CSRF check.
- Passwords only via `hashPassword()`/`passwordProblem()`. Never log passwords, tokens, invite links or codes.
- In `public/app.js`, user data goes into HTML only through `esc()`. No inline scripts (the CSP blocks them).
- Uploads keep magic-byte sniffing and the 3 MB limit (`readProof()`).
- Guessable things get a limit in `LIMITS`; suspicious events go to `security()`.
- No secrets in the repo. Env vars: `DATABASE_URL`, `SETUP_CODE`, `ALERT_WEBHOOK_URL` (optional).
- Ask before adding or upgrading any package. There is one dependency; keep it that way.
- Run `npm test` before opening a PR (needs a local Postgres; see the test file's header).
