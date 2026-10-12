# Contributing to PINGx969

## Setup

```bash
nvm use                 # Node 22 (see .nvmrc)
npm install
npm run e2e:install     # Playwright's Chromium, once
npm run dev             # API :4000 + dashboard :5173 with hot reload
```

Build the extension with `npm run build -w @pingx969/extension` (or `node apps/extension/build.mjs --watch`) and
load `apps/extension/dist` unpacked in Chrome. `npm run mock-site` serves the job-site replicas on :4100.

## Workflow

1. **Issue first** for anything non-trivial: describe the problem or the job site, with a URL if public.
2. **Branch** from `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/…`, `test/…`, `chore/…`.
3. **Commits** follow [Conventional Commits](https://www.conventionalcommits.org): `feat(autofill): support Keka select2`,
   `fix(parser): keep letter-spaced names`. One logical change per commit.
4. **Tests with every change** — a bug fix comes with a test that fails without it; a feature with unit tests
   and, for anything the user sees in the browser, an E2E test.
5. **Before pushing:** `npm run test:all` (typecheck, lint, unit + integration with coverage thresholds, E2E).
   CI runs the same on every pull request and blocks merging on failure.
6. **Pull request** using the template: what changed, why, how it was tested, screenshots for UI changes,
   and an entry under `Unreleased` in `CHANGELOG.md`.
7. **Review:** at least one approval; the reviewer checks correctness, tests, privacy impact (personal data
   in logs, requests, storage) and that no fabrication path was added to the optimizer.
8. **Merge** with squash; delete the branch.

## Code guidelines

- TypeScript strict mode; no `any` in new code. Validate external input with zod.
- Keep packages framework-free where they are today (`field-detector` must run in jsdom and in the content script).
- Personal data never goes into logs, URLs or error messages. New stored personal fields are encrypted.
- The autofill rules are product guarantees — keep them true and tested: never guess unknown answers, never
  overwrite user input, never tick consent or fill e-signatures, never submit.
- The optimizer never adds facts that are not in the resume or confirmed by the user; every change keeps
  its provenance and evidence, and passes the fact guard.

## Adding or fixing a job site

1. Inspect the live application form read-only (no typing, no submitting): note the controls, how labels are
   attached, custom widgets, and anything gated (login, consent, one-time codes).
2. Add or update a replica in `e2e/mock-site/ats/<site>.html` that reproduces that markup and behaviour
   (with a comment saying what was inspected live and what is modelled).
3. Add an adapter in `packages/field-detector/src/adapters.ts` (domain match first, DOM fingerprint as
   fallback; identifier hints; job title/company) and the domain to `ATS_MATCHES` in `apps/extension/build.mjs`.
4. Add unit tests in `packages/field-detector/test/ats.test.ts` and an E2E test in `e2e/ats.spec.ts` that
   checks filled values, that unknown questions stay empty and that consent is untouched.
5. Update the table in the README.

## Releases

1. Move `Unreleased` entries in `CHANGELOG.md` under a new version; bump `version` in `package.json` and
   `apps/extension/package.json` (the extension manifest uses the latter).
2. Tag `vX.Y.Z` and push the tag. The release workflow runs all checks, then publishes a GitHub Release with
   `pingx969-extension-<v>-localhost-4000.zip` (for people running the server on their own computer) and,
   if the repository variable `API_ORIGIN` is set, a zip for that hosted server.
3. Deploy the server (see README → Deploying) before publishing the extension that points at it.

To build a zip locally: `npm run package:extension -- --api=https://your-server` (or `-- --localhost`).
