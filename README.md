# Stokvel

A shared contributions book for stokvels. One login, many stokvels: each stokvel you belong to gets its own dashboard.

- **The treasurer confirms payments.** In each stokvel one member is the treasurer. Only they can confirm who paid (in full, late or in part), take the meeting register, stamp payouts, and add or remove members.
- **Every confirmation records the amount and the date it was paid.** The treasurer can also attach a proof of payment: a photo of the slip or a PDF of up to 3 MB. Photos are shrunk on the phone before they upload. Proofs are stored privately in the database, and only the treasurer and the member who paid can open them.
- **Members see their own record.** Everyone else sees what they have paid, the group's total, the meeting attendance (for stokvels that hold meetings), and their turn for the pot (for rotating stokvels). They don't see other members' individual payments.
- **The server enforces this.** Roles are checked by the API on every request, not just hidden in the page.
- **People join with an invite link.** The treasurer creates a one-time link for each member and sends it on WhatsApp. The member sets a password, and from then on logs in with their phone number.
- **Meetings are optional per stokvel.** Switch them off for a stokvel that doesn't meet.
- **Two kinds of stokvel:** a *group fund* (everyone pays in to save or invest together) or a *rotating payout* (one member takes the pot each month, with a fair "draw lots" for the order).

## Setting it up on Vercel

1. **Database.** In the Vercel project, open **Storage → Create Database → Neon** (the free plan is enough) and connect it to the project. This adds `DATABASE_URL`. The app creates its tables on first use.
2. **Setup code.** Add an environment variable `SETUP_CODE` with a long code you choose (at least 12 random characters). It is needed once, to create the first account, and stops working as soon as one account exists. Delete it afterwards.
3. **Alerts (optional).** Add `ALERT_WEBHOOK_URL` with a Slack, Discord or Teams incoming-webhook URL to be told when one address makes 15 suspicious requests in 10 minutes.
4. **Redeploy**, open the site, and create your account with the setup code.

After that, start a stokvel, pick its treasurer, and send invite links from **Members**.

If you start a stokvel and make someone else the treasurer, you can set it up and send their invite until they join. From then on the treasurer runs it.

## Running it locally

```bash
npm install
DATABASE_URL="postgres://…" SETUP_CODE="TEST-1234" npm run dev
```

Or, with a local Postgres and no Neon account:

```bash
LOCAL_PG_SOCKET=/var/run/postgresql LOCAL_PG_DB=stokvel SETUP_CODE="TEST-1234" npm run dev
```

The app runs on http://localhost:3000.

## Security

| Protection | How |
| --- | --- |
| Passwords | scrypt (N=32768) with a random salt; at least 8 characters, common ones refused; older hashes upgraded at the next login |
| Sessions | random 256-bit token in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie; only its SHA-256 is stored; logout and password changes end sessions on the server |
| Guessing | a phone number locks for 15 minutes after 8 wrong passwords; each address gets 20 failed logins per 15 minutes, 10 setup-code tries and 20 sign-ups per hour (kept in Postgres, shared by every instance) |
| CSRF | changes need the `X-Stokvel` header and a same-origin `Origin` |
| Access | members see only their own payments; only the treasurer confirms payments or changes the stokvel; other stokvels are invisible |
| SQL | only `$1` placeholders |
| XSS | every name is escaped; the CSP allows scripts from this site only |
| Uploads | proof of payment must really be a JPG, PNG, WebP or PDF (checked from its bytes), at most 3 MB |
| Headers | CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP; API answers carry `default-src 'none'` |
| Logging | failed logins, lock-outs, rate limits, blocked requests and wrong setup codes go to the `security_log` table and the Vercel logs, with phone numbers masked; optional alerts via `ALERT_WEBHOOK_URL` |

`npm test` starts the app on a throwaway local Postgres and attacks it: CSRF, brute force, IDOR, SQL injection, file-upload tricks, session replay and XSS in a real browser (when Playwright is installed). The same tests, a secret scan of every commit and `npm audit` run on every pull request (`.github/workflows/security.yml`).

## How it's built

- `public/` holds the web app: plain HTML, CSS and JavaScript, with no build step.
  - `public/app.js` renders every screen and handles taps, forms and saving.
  - `public/logic.js` contains the month and money rules, shared by the browser and the API.
  - `public/css/` holds the styles (see below).
- `api/index.js` is a single Vercel function that serves every `/api/*` route.
- `lib/db.js` holds the Neon connection and the schema. `lib/auth.js` handles phone numbers, password hashing (scrypt) and session cookies. `lib/guard.js` keeps the per-address limits and the security log.
- `scripts/dev.mjs` is the local server. It sends the same security headers as production. `scripts/pg-local.mjs` is a tiny Postgres client for local testing.

### Styles

`index.html` loads the stylesheets in this order:

| File | What's in it |
| --- | --- |
| `tokens.css` | Design tokens: colours (light and dark), type sizes, a 4px spacing scale, radii, shadows, layers and motion. |
| `base.css` | A small reset, the page column, text roles shared by many components (`.label`, `.name`, `.sub`), and reduced-motion support. |
| `components.css` | Building blocks: buttons, chips, cards, notes, the masking-tape title, amounts, lists, the segmented control and forms. |
| `ledger.css` | The book itself: ledger rows with the red margin, rubber stamps, tallies and the record grid. |
| `views.css` | Layout for single screens: the stokvel header, month navigation, home, sign-in and the loading cover. |
| `overlays.css` | Bottom sheets, the treasurer's tab bar and toasts. |
| `utilities.css` | Single-purpose helpers such as `.text-bad`. Loaded last so they always win. |

Conventions:
- Every colour, size and timing comes from a token in `tokens.css`. Dark mode only changes the colour tokens.
- Class names follow one pattern: a block (`.btn`), its variants (`.btn--primary`), and its states (`.is-selected`). Payment and attendance states use the words from the data (`paid`, `late`, `part`, `present`, `absent`).
- Each section in a stylesheet starts with the HTML it expects, so the templates in `app.js` and the CSS read together.
- Hover effects only apply on devices that can hover. Text colours meet WCAG AA contrast in both themes.

Security notes:
- Passwords are hashed with scrypt.
- Sessions are random tokens. The database stores only a SHA-256 hash, and the cookie is HttpOnly, Secure and SameSite=Lax.
- Changes need a same-origin request with an app header.
- Repeated wrong passwords lock a phone number for 15 minutes.
- Invite links are single-use and expire after 14 days.
- Proof-of-payment files are checked by their contents (JPEG, PNG, WebP or PDF only) and are only served to the treasurer and the member they belong to.
- Pages are served with a Content Security Policy that only allows the app's own scripts, so injected script can't run.
