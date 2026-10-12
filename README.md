# PINGx969

Tailor your resume to every job **without inventing anything**, then autofill job applications from one
profile with a browser extension that learns your answers.

- **Resume Optimizer** (web dashboard + API): upload PDF/DOCX/TXT/Markdown/JSON → structured resume →
  analyze a job description (paste, upload or URL) → transparent multi-dimension match score →
  evidence-backed optimization with a reviewable diff → export in the **same format as the original**.
- **Autofill extension** (Chrome, Edge, Brave, Opera, Vivaldi — Manifest V3): fills application forms on
  21 job sites (and any other site on request) from your profile and saved answers, maps differently-worded
  questions to the same saved answer, **never guesses** unknown answers, never overwrites what's already
  filled, never signs or ticks consent for you, **never submits** for you, and tracks each application.

Everything runs on your own computer by default — your resume and answers stay on it, encrypted.

## Contents

[Install](#install) · [Using the extension](#using-the-extension) · [Platforms and browsers](#platforms-and-browsers) ·
[Supported job sites](#supported-job-sites) · [Sharing with others](#sharing-with-others) · [Deploying](#deploying) ·
[Configuration](#configuration) · [Commands](#commands) · [Architecture](#architecture) · [How it works](#how-it-works) ·
[Security & privacy](#security--privacy) · [Testing](#testing) · [Known limitations](#known-limitations) ·
[Contributing](#contributing)

## Install

About 10 minutes, no coding needed. Works the same on **Windows, macOS and Linux**.

**1. Install Node.js 22 (LTS)** from [nodejs.org](https://nodejs.org) — the installer for Windows or macOS,
or your package manager on Linux. Check it in a terminal (Terminal on macOS/Linux, PowerShell on Windows):

```bash
node --version    # v22.12 or newer
```

**2. Get PINGx969.** On GitHub click **Code → Download ZIP** and unzip it, or `git clone` the repository.
Open a terminal in that folder.

**3. Install, build and start** (same commands in every terminal):

```bash
npm install
npm run build
npm start
```

Leave this window open — PINGx969 is running at **http://localhost:4000**. (Next time only `npm start`
is needed. To stop it, press `Ctrl+C`.)

**4. Set up your profile.** Open http://localhost:4000, **create an account**, upload your resume on
**Resumes**, click **Import into profile**, then check **Profile** (name, email, phone, address, links,
work authorization). Whatever is missing there is left for you to fill on applications — nothing is guessed.

**5. Add the extension to your browser** (developer mode, ~2 minutes):

1. Get the extension folder: download `pingx969-extension-<version>-localhost-4000.zip` from the
   repository's **Releases** page and unzip it — or use `apps/extension/dist`, which step 3 just built.
2. Open your browser's extensions page and switch on **Developer mode**:

   | Browser | Address | Developer mode toggle |
   |---|---|---|
   | Chrome | `chrome://extensions` | top right |
   | Microsoft Edge | `edge://extensions` | left sidebar |
   | Brave | `brave://extensions` | top right |
   | Opera | `opera://extensions` | top right |
   | Vivaldi | `vivaldi://extensions` | top right |

3. Click **Load unpacked** and choose the folder that contains `manifest.json`.
4. The extension's options page opens: keep the server `http://localhost:4000` and sign in with the
   account from step 4. Optionally pin it from the puzzle-piece menu.

The dashboard's **Browser extension** page shows the same steps for the browser you're using.

## Using the extension

Open a job application on a [supported site](#supported-job-sites): a **⚡ Autofill** button appears
bottom-right. Click it → review the list (✓ ready, ⚠ check, ? no saved answer) → **Fill**. Answer anything
left empty, attach files if asked, and submit the form yourself; the extension then offers to mark the
application **Applied** in your dashboard. On any other site: toolbar icon → **Scan this page**.

No real application handy? `npm run mock-site` serves replicas of every supported job site at
http://localhost:4100/ats/ — safe to fill and submit.

After updating or rebuilding the extension, click the reload icon on its card on the extensions page.

### What the ⚡ button tells you

| Button | Meaning | Fix |
|---|---|---|
| `Autofill · 12 fields` | Ready | Click it to review and fill |
| `Autofill · sign in to fill` | Not signed in, or the session expired | Panel → **Open sign-in** |
| `Autofill · server offline` | The PINGx969 server isn't reachable at the configured URL | Start the server, or panel → **Open settings (server URL)** |
| no button | No application form on the page yet (job description, login, consent or email step) | Continue to the form itself |

## Platforms and browsers

| | Windows | macOS (Intel & Apple Silicon) | Linux | ChromeOS | Android | iOS / iPadOS |
|---|---|---|---|---|---|---|
| **Server + dashboard** (`npm start`) | ✅ | ✅ | ✅ | ✅ (Linux environment) | – | – |
| **Dashboard in the browser** | ✅ | ✅ | ✅ | ✅ | ✅ phone & tablet layouts | ✅ phone & tablet layouts |
| **Autofill extension** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

- **Extension browsers:** Chrome, Microsoft Edge, Brave, Opera, Vivaldi and other Chromium browsers
  (version 116+). Firefox and Safari are not supported yet — their extension systems need a separate build.
- **Phones and tablets:** Android and iOS browsers don't run desktop extensions, so autofill needs a computer.
  The dashboard itself (resumes, optimizing, exports, tracking) works in mobile browsers when the server is
  reachable from the phone — a [deployed server](#deploying), or on your home network by putting
  `HOST=0.0.0.0` and `ALLOWED_ORIGINS=http://<your-computer's-IP>:4000` in `.env`.
- **Server:** pure JavaScript/WebAssembly (no database to install); the platform-specific build tools are in
  the lockfile for x64 and ARM on Windows, macOS and Linux and are picked by `npm install`. The full
  test suite has been run on Windows, and the CI workflow runs it on Linux (Ubuntu) for every push and pull
  request; macOS uses the same packages but hasn't been tried by the maintainers yet — reports welcome.
- **Extension:** verified in Chrome and Microsoft Edge; Brave, Opera and Vivaldi use the same Chromium
  extension system.

## Supported job sites

The button appears automatically on these sites; anywhere else use **Scan this page** (optionally grant
all-sites access in the options page). Every row has a replica page in `e2e/mock-site/ats/` and an
end-to-end test with the real extension.

| ATS | What is special about its forms | Replica based on |
|---|---|---|
| Greenhouse (job-boards) | react-select comboboxes for every choice; Remix app that hydrates the whole document | live form |
| Lever | `cards[…]` custom questions, consent radios | live form |
| Workday | multi-step wizard, `data-automation-id`, "Select One" listbox buttons | known markup (account required) |
| Ashby | Yes/No as `aria-pressed` buttons over a hidden checkbox | live form |
| Workable | `role="radio"` / `role="checkbox"` wrappers over hidden inputs | live form |
| SmartRecruiters | every field inside web-component shadow roots | live form |
| Jobvite | data-consent gate before the form | consent step live, form from known markup |
| JazzHR | numbered checkbox names per option, placeholder-only address parts | live form |
| BambooHR | `fab-SelectToggle` listbox buttons | known markup |
| iCIMS | form inside a same-origin iframe behind a candidate login (launcher shown in the top page) | known markup (account required) |
| Zoho Recruit | Lyte components, captions in `cx-prop-label`, menus portalled to `<body>` | live form |
| Oracle Cloud (Recruiting CE) | email + one-time-code step, Oracle JET read-only comboboxes, pill buttons, e-signature | email step live, form from known markup |
| Kula | Next.js + Chakra, form behind an "Application form" tab, labels whose `for` points nowhere | live form |
| Keka | select2 over hidden selects (phone country code, currency), consent checkbox | live form |
| Google Forms | `role=radio`/`checkbox`/`listbox` widgets, Trusted Types | live form |
| LinkedIn Easy Apply | multi-step modal, country code + national number | known markup (login required) |
| Teamtailor | labels with a hidden "Required" suffix, several consent checkboxes | live form |
| Rippling | custom questions as `role=combobox` labelled only "Select", SMS opt-in as true/false radios | live form |
| Recruitee | phone box pre-typed with the country code, "calling code" picker | live form |
| Breezy HR | salary split into currency / amount / period, SMS consent | live form |
| Personio | native selects; work authorization asked per country | live form |

Live forms were inspected read-only (nothing typed or submitted). Sites change their markup; when one
breaks, see [Adding or fixing a job site](CONTRIBUTING.md#adding-or-fixing-a-job-site).

**Also enabled (generic detection, not individually verified):** SAP SuccessFactors, Oracle Taleo,
Indeed Apply, UKG (UltiPro), Paylocity, Darwinbox and Freshteam. Their application forms sit behind a
candidate login, so they couldn't be inspected; the launcher appears there and the generic detector does
its best. Reports and fixes are welcome via the "Job site not filling correctly" issue template.

## Sharing with others

Other people can't reach `localhost` on your computer. Two options:

- **Everyone runs their own copy** (most private): they follow [Install](#install) on their computer.
- **One shared server**: [deploy it](#deploying) over HTTPS, then build an extension pointed at it — the
  same command works in every terminal:

  ```bash
  npm run package:extension -- --api=https://pingx969.example.com
  # → release/pingx969-extension-<version>-pingx969.example.com.zip   (apps/extension/dist is untouched)
  ```

  They unzip it, load it with **Load unpacked** (step 5 of [Install](#install)), create an account on your
  dashboard and sign in from the extension's options page. Tagged releases publish both zips on the GitHub
  Releases page automatically (set the repository variable `API_ORIGIN` for the hosted one). The same zip
  can be submitted to the Chrome Web Store for one-click installs (needs a developer account, a privacy
  policy and a justification for the site permissions).

## Deploying

The server is a regular long-running Node app (Express + embedded PostgreSQL + encrypted files on disk),
so the simplest home is one Node service on **Render, Railway, Fly.io** or a VM:

1. Build command `npm ci && npm run build`, start command `npm start`.
2. Set `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT` (as the host requires) and `APP_ENCRYPTION_KEY`
   (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). **Back the key up** —
   without it stored data cannot be decrypted.
3. Persist data: attach a disk for `DATA_DIR` (database + uploaded files), or set `DATABASE_URL` to a
   managed PostgreSQL and keep a disk for `STORAGE_DIR`.
4. Serve over HTTPS (the platform's TLS is fine); cookies are `Secure` in production.
5. Package the extension for that URL (see [Sharing with others](#sharing-with-others)).

**Vercel / serverless:** the dashboard alone fits, but the API as built needs a persistent filesystem
(PGlite, encrypted file store), per-process rate limiting and 5 MB uploads (above Vercel's 4.5 MB request
limit). Running it there needs a managed PostgreSQL via `DATABASE_URL`, an S3/Blob implementation of the
`ObjectStore` interface and direct-to-storage uploads.

## Configuration

Copy `.env.example` to `.env`. Everything is optional in development.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables secure cookies, HSTS and requires `APP_ENCRYPTION_KEY` |
| `PORT` / `HOST` | `4000` / `127.0.0.1` | Listen address (`0.0.0.0` on servers) |
| `APP_ENCRYPTION_KEY` | dev key generated in `DATA_DIR` | AES-256-GCM key for personal data (**required in production**) |
| `DATABASE_URL` | – (PGlite in `DATA_DIR`) | PostgreSQL connection string |
| `DATA_DIR` / `STORAGE_DIR` | `./data` / `./data/objects` | Embedded database and encrypted uploads |
| `ALLOWED_ORIGINS` | local dashboard origins | Origins allowed to make cookie-authenticated writes |
| `WEB_URL` | same origin (prod) / `http://localhost:5173` (dev) | Where the dashboard lives |
| `SESSION_TTL_DAYS` / `EXTENSION_TOKEN_TTL_DAYS` | `14` / `30` | Session and extension token lifetimes |
| `AI_PROVIDER` | `heuristic` | `anthropic` to use Claude (needs `ANTHROPIC_API_KEY`; optional `AI_MODEL`, `AI_TIMEOUT_MS`) |
| `ALLOW_PRIVATE_URL_FETCH` | `false` | Allow job-URL import from private networks (keep `false` in production) |
| `RATE_LIMIT_AUTH` / `_API` / `_HEAVY` | `20` / `600` / `60` | Requests per minute |

Extension build variables: `API_ORIGIN` (server the extension talks to, default `http://localhost:4000`)
and `INCLUDE_LOCALHOST` (run on localhost pages; `true` for development, `false` when packaging).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) + dashboard (Vite) with hot reload |
| `npm run build` | Production builds: `apps/web/dist`, `apps/api/dist`, `apps/extension/dist` |
| `npm start` | Run the built API (also serves the dashboard) |
| `npm test` | Unit + integration tests (Vitest) |
| `npm run test:coverage` | Same, with coverage report in `coverage/` and enforced thresholds |
| `npm run test:e2e` | Build, then Playwright E2E with the real extension (`npm run e2e:install` once); uses ports 4310 and 4100 |
| `npm run test:all` | typecheck + lint + coverage + E2E — what CI runs |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run db:migrate` / `npm run db:seed` | Apply migrations / create the demo account |
| `npm run fixtures` | Regenerate the test resumes (DOCX, PDF, TXT, MD, JSON) and job descriptions |
| `npm run mock-site` | Serve the mock job-application pages (incl. ATS replicas) on :4100 |
| `npm run package:extension -- --api=https://…` | Build the extension for a server and zip it into `release/` (`--localhost` for a build that also runs on localhost pages) |

## Architecture

```
apps/
  api/         Express 5 REST API (sessions, CSRF, rate limits, uploads) — also serves the dashboard
  web/         React 19 + Vite dashboard
  extension/   Chrome MV3: background service worker, content script, page-ready probe (MAIN world),
               review panel (extension iframe), popup, options
packages/
  shared/            zod schemas (resume, job, match, changes, profile), skills taxonomy, text & date utils
  resume-parser/     PDF (pdf.js), DOCX (OOXML), TXT/MD, JSON/JSON Resume → normalized resume + layout profile
  job-parser/        JD → title, company, seniority, required/preferred skills, responsibilities, years, education…
  resume-optimizer/  fact base, matching engine, heuristic optimizer, fact guard, AI provider abstraction
  resume-export/     DOCX patch-in-place, DOCX generator, in-place PDF skills append, PDF renderer, TXT/MD patcher
  profile/           question normalization, option matching, profile → field values, resume → profile import
  field-detector/    field detection (shadow DOM, ARIA widgets), site adapters, fill planning, filling, observers
  database/          Db adapter (PGlite | pg), SQL migrations, encrypted repositories, encrypted object store
e2e/                 Playwright specs + mock application site (ATS replicas in e2e/mock-site/ats/)
fixtures/            realistic resume in five formats, job descriptions, corrupted/unsupported files
scripts/             fixture generator, mock site, extension packager
```

TypeScript end to end, so the same packages run in the API, the dashboard and the extension (the field
detector is unit-tested in jsdom and runs unchanged in the content script). PGlite keeps a zero-dependency
local setup while remaining real PostgreSQL. Session cookies (HttpOnly, SameSite=Lax) with a per-session
CSRF token protect the dashboard; the extension uses revocable, expiring bearer tokens.

## How it works

### Matching (transparent and configurable)
Nine dimensions, each with a score, a plain-language summary and per-item details: Skills (required ×1,
preferred ×0.5; implied skills count, e.g. PostgreSQL ⇒ SQL; related skills earn partial credit),
Experience (months from dated roles, overlaps counted once), Responsibilities, Keywords (exact JD wording,
ATS-style), Education, Seniority, Technology, Domain and ATS structure. Overall = weighted mean of the
dimensions that apply; weights are editable in **Settings**.

### Optimization without fabrication
Every proposed change carries a provenance — **fact**, **inference** (shown as "verify"), **suggestion**
(needs your input, never auto-applied), **missing** (reported, never added) or **user-confirmed** — plus
evidence quoted from your resume. A **fact guard** re-checks every machine-made change and blocks any new
technology, metric, number, employer, degree, certification or years-of-experience claim not present in
your resume or confirmed in your profile. AI providers are untrusted: their output is schema-validated,
fact-guarded, and the local optimizer is used if they fail. Placeholders such as `[add measurable result]`
block export until replaced.

### Format preservation
**Skills only** (the default) changes nothing but the Skills section; for a **PDF** it edits your original
file in place (new skills typeset after the last skills line, content below shifts and flows across pages,
links stay clickable, no hidden duplicate text for ATS parsers). **Full tailoring** also reorders and rephrases.

| Source | DOCX export | PDF export | Other |
|---|---|---|---|
| DOCX | **your original file**, only changed text edited | layout-matched render | JSON |
| PDF | editable DOCX recreated from the PDF's layout | **your original file** (skills only) or re-rendered with its page size, margins, fonts and section order | JSON |
| TXT / MD | layout-matched | layout-matched | **original file, only changed lines rewritten** |
| JSON | generated | generated | JSON |

### Autofill
Fields are found via labels (`for`, wrapping, `aria-labelledby`, `aria-label`), legends, nearby text,
placeholders, `name`/`id`, `autocomplete` and `data-automation-id` — including inside open shadow roots and
same-origin iframes — and classified with weighted rules. A site adapter, chosen by the page's domain, adds
ATS-specific hints; the generic detector is always the fallback. Custom controls (react-select, ARIA
radios/checkboxes, toggle buttons, listbox menus, select2) are operated the way a user would. Screening
questions are normalized to stable keys ("Are you legally authorized to work in the US?" and "Do you
currently have authorization to work in the United States?" → `work_authorization:US`); custom questions
are matched by similarity. A MutationObserver handles multi-step forms and conditional questions. Fields
that already have a value are kept unless you choose "Replace"; consent boxes, consent radios and
e-signature fields are never filled. The launcher waits until the page's framework has hydrated, so it
never breaks sites that hydrate the whole document.

## Security & privacy

- Passwords hashed with scrypt; constant-time comparison; login timing equalized.
- HttpOnly SameSite cookies + per-session CSRF tokens + Origin checks; bearer tokens for the extension only.
- Personal data encrypted at rest with AES-256-GCM: profile, parsed resumes, versions, saved answers and
  uploaded files.
- Uploads: 5 MB limit, extension allowlist, magic-byte type detection, pdf.js ≥ 6 (no script evaluation);
  job-URL import blocks private networks and pins DNS (SSRF protection).
- zod validation on every request body; Helmet CSP and security headers; per-IP/user rate limits.
- AI keys live only on the server; resume content sent to an external AI is stripped of name, email,
  phone, address and links, and requires explicit per-run consent. Skills-only optimization sends nothing.
- Extension: minimal permissions, no remote code, messages accepted only from itself, the review panel is
  an extension-origin iframe the page can't read, never stores job-site passwords, never submits forms.
- Data controls: export everything as JSON, revoke sessions/devices, delete the account (cascades to every
  table and file).

Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Testing

| Suite | Count | Covers |
|---|---|---|
| Unit + integration (Vitest) | 200 tests | parsing in all five formats, job parsing, matching, fact guard, optimizer (heuristic and Claude provider with a fake client), exports (DOCX patch/generate, PDF append/render, TXT/MD), crypto, storage, migrations, field detection on every ATS replica (jsdom), and the API: upload → optimize → export, auth, CSRF, saved answers, mappings, settings, data export, account deletion, cross-user isolation, SSRF |
| End-to-end (Playwright, real extension) | 43 tests | the 16-step acceptance scenario, extension behaviour (dynamic forms, prefilled fields, consent, ad-blocker filters, popup, answer learning), autofill on all 21 job-site replicas plus a whole-document-hydration page, signed-out and server-offline states |

Coverage (`npm run test:coverage`, packages + API): **≈88% lines, ≈85% functions, ≈70% branches**, with
CI thresholds of 85 / 80 / 68. Browser-only code (filling custom widgets, the extension UI) is covered by
the Playwright suites rather than by these numbers.

## Known limitations

- In-place PDF skill appends use the closest standard font (Helvetica/Times/Courier), width-matched to your
  original line. Full-tailoring PDF exports re-render with standard fonts; multi-column designs become a
  single, more ATS-friendly column. DOCX sources are preserved exactly.
- Scanned (image-only) PDFs are rejected — no OCR. Legacy `.doc` is not supported.
- The built-in optimizer is deterministic and conservative. Richer rewrites need the optional Claude
  provider (`AI_PROVIDER=anthropic`), which is tested with a fake client but was not exercised against the
  live API here.
- Job-URL import needs pages that serve HTML; sites that require JavaScript or block bots need the
  description pasted.
- Sites change their markup, so custom widgets are best-effort. File attachment needs a reachable file
  input (on Zoho Recruit upload the resume yourself). Closed shadow roots and cross-origin iframes can't be
  reached. Other extensions that inject elements early can still break whole-document hydration on some sites.
- Rate limiting is in-memory (per process); the object store is the local filesystem (an `ObjectStore`
  interface is ready for S3-style storage).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow (branches, commits, checks, reviews, releases) and
how to add a job site. Changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 jayant99acharya
