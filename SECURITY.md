# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue. Report privately through [GitHub Security Advisories](https://github.com/cbe-analyser/openwa-agent/security/advisories/new). Include the affected version, steps to reproduce and the impact. Do not include real customer data or live credentials.

We aim to acknowledge reports within 3 business days and to ship a fix or mitigation for confirmed high-severity issues within 30 days. We will credit you unless you prefer otherwise.

## Supported versions

Security fixes are released for the latest minor version. Self-hosters should keep up with releases (see [docs/operations.md](docs/operations.md#upgrades)).

## Security design summary

- **Secrets:** AI provider keys, WhatsApp tokens, app secrets, tool secrets and webhook signing secrets are encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`, rotation supported) and never returned to the browser. API keys and session tokens are stored only as SHA-256 hashes.
- **Authentication:** scrypt password hashing, account lockout, rate-limited login, `HttpOnly`/`SameSite=Lax` session cookies (`__Host-` prefixed and `Secure` over HTTPS), CSRF protection on every cookie-authenticated mutation.
- **Authorization:** role-based access (owner, admin, agent, viewer), scoped and expiring API keys, every query scoped to the caller's organization. Cross-tenant access is covered by automated tests.
- **Webhooks:** WhatsApp signatures (`X-Hub-Signature-256`) are verified on the raw body before parsing; events are deduplicated. Outbound webhooks are HMAC-signed.
- **AI safety:** customer text and retrieved documents are passed as untrusted, delimited data; a canary detects instruction leaks; deterministic rules escalate risky topics, block replies that ask for passwords/PINs/OTPs and block claims of actions that did not happen. The AI cannot change its own permissions or settings.
- **Network:** server-side fetches (URL import, HTTP tools, outbound webhooks) block private, loopback and link-local addresses (SSRF), limit redirects and response size.
- **Headers:** strict Content-Security-Policy with per-request nonces, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, HSTS over HTTPS.
- **Logs:** structured logs redact keys, tokens, card numbers and credentials; phone numbers are masked.

The full analysis is in [docs/threat-model.md](docs/threat-model.md).

## Known dependency advisories

As of the latest release, `npm audit --omit=dev` reports 3 **moderate** advisories, all through `sprintf-js` → `argparse` → `mammoth`. `argparse` is only used by mammoth's command-line tool, which OpenWa Agent never calls, so the vulnerable code is not reachable. Development-only tooling (`@next/eslint-plugin-next` → `braces`) has a high advisory with no released fix; it never runs in production. The dependency-audit workflow fails the build on any high or critical advisory in production dependencies.
