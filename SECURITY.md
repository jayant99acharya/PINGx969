# Security Policy

PINGx969 stores resumes, contact details and application answers — personal data — so security reports
are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through the repository's security advisory form
("Report a vulnerability" under the Security tab) or by email to the maintainer, with:

- what is affected (API endpoint, dashboard page, extension component) and the version or commit;
- steps to reproduce or a proof of concept;
- the impact you expect (data exposure, account takeover, code execution…).

You will get an acknowledgement within 3 working days and a plan or fix timeline within 10. Please give us a
reasonable time to release a fix before disclosing publicly.

## Scope

In scope: the API (`apps/api`), dashboard (`apps/web`), extension (`apps/extension`) and the packages they
use. Out of scope: third-party job sites, denial of service through volume, and findings that require a
compromised machine or browser profile.

## How data is protected

- Personal data at rest is encrypted with AES-256-GCM (`APP_ENCRYPTION_KEY`, required in production).
- Passwords use scrypt; sessions are HttpOnly SameSite cookies with CSRF tokens; extension tokens are
  revocable bearer tokens that expire.
- Uploads are size-limited and type-checked by content; job-URL import blocks private networks (SSRF).
- The extension never stores job-site passwords, never submits forms, and shows personal data only inside
  its own extension-origin iframe.
- Resume content sent to an optional external AI provider has direct identifiers removed and requires
  per-run consent.

Dependencies are monitored by Dependabot; `npm audit` runs in CI.
