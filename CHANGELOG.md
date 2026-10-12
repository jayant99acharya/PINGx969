# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- MIT license.
- Job sites: Teamtailor, Rippling, Recruitee, Breezy HR and Personio (adapters, replicas, unit and E2E tests);
  SAP SuccessFactors, Oracle Taleo, Indeed Apply, UKG, Paylocity, Darwinbox and Freshteam enabled with the
  generic detector.
- Install guide for non-developers (Windows, macOS, Linux), platform and browser support table, dashboard
  install page that adapts to the visitor's browser (Chrome, Edge, Brave, Opera, Vivaldi) and explains that
  phones can't run extensions.
- `npm run package:extension -- --api=…` works in every shell; releases publish ready-to-load zips.

### Fixed
- Work authorization for a country missing from the profile is now asked, not answered "No".
- Phone boxes pre-typed with just a country code ("+31") are treated as empty and get filled.
- Yes/No SMS or marketing opt-ins and "calling code" pickers are recognised (consent left to the user).
- Labels with a hidden "Required" suffix and dropdowns labelled only "Select" get their real captions.

## [0.1.0] - 2026-10-03

### Added
- Resume optimizer: parsing of PDF, DOCX, TXT, Markdown and JSON / JSON Resume; job analysis from text,
  file or URL; nine-dimension transparent match score with configurable weights; optimization with
  provenance, evidence and a fact guard; reviewable diff with accept/reject/edit; versions.
- "Skills only" optimization (default) that appends job skills to the original PDF in place.
- Exports: DOCX patched in place, generated DOCX, layout-matched PDF, TXT/MD patched line by line, JSON.
- Chrome MV3 extension: autofill with review panel, saved answers with question normalization, answer
  learning, application tracking and submission confirmation.
- Job-site support for Greenhouse, Lever, Workday, Ashby, Workable, SmartRecruiters, Jobvite, JazzHR,
  BambooHR, iCIMS, Zoho Recruit, Oracle Cloud, Kula, Keka, Google Forms and LinkedIn Easy Apply — shadow
  DOM, ARIA widgets, toggle buttons, listbox menus, react-select, select2 and same-origin iframes.
- Launcher states for "sign in to fill" and "server offline"; extension packaging (`npm run package:extension`).
- Optional Claude provider (server-side), with redaction and per-run consent.
- Test suites: unit/integration with coverage thresholds, Playwright E2E with the real extension and
  replicas of every supported job site; CI workflow.

### Security
- AES-256-GCM encryption of personal data, scrypt passwords, CSRF protection, SSRF-safe URL import,
  magic-byte upload validation, Helmet CSP.
- Autofill never ticks consent, never fills e-signatures and never submits.
- The extension's UI waits for page hydration so it never forces sites to re-render.
