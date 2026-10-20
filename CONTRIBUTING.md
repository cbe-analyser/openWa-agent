# Contributing to OpenWa Agent

Thanks for helping. This project handles real customer conversations, so correctness, security and privacy come before features.

## Getting started

1. Fork and clone the repository, then follow **Local development** in the [README](README.md).
2. Create the test databases once (PostgreSQL with pgvector):
   ```bash
   createdb openwa_test && createdb openwa_e2e
   ```
3. Run the checks before opening a pull request:
   ```bash
   npm run lint && npm run typecheck && npm run format:check
   npm test
   npm run build && npm run test:e2e
   npm run secrets:check
   ```

> npm 10 can crash with `Cannot read properties of null (reading 'edgesOut')` when **adding or upgrading** packages, because of optional peer dependencies in vitest. `npm ci` is unaffected. If you hit it while changing dependencies, run `npm install --legacy-peer-deps` once to update the lockfile, then confirm `npm ci` still works.

## Ground rules

- **No credentials, customer data or WhatsApp exports** in code, tests, fixtures, screenshots or issues. Use obviously fake values (`test-…`, `example.com`, `2547000000xx`).
- **Official APIs only.** Do not add browser automation, QR-session libraries or unofficial WhatsApp clients.
- **Never fabricate.** Dashboard numbers must come from stored records; the agent must not claim actions that a tool did not perform.
- **Tenant isolation.** Every query is scoped by `orgId` from the authenticated context, never from user or model input. Add a test when you add an endpoint.
- **Safety rules live in code.** Escalation and output checks (`src/server/agent/safety.ts`, `policy.ts`) must not depend on the model following instructions.
- Keep dependencies few and pinned. Explain why a new dependency is needed in the PR.

## Code style

TypeScript strict mode, Prettier (110 columns) and ESLint. Match the surrounding code; comment the _why_, not the _what_. Database changes need a Prisma migration (`npm run db:migrate:dev -- --name <change>`); never edit an applied migration.

## Pull requests

Keep PRs focused and fill in the template. Security-sensitive changes (auth, crypto, webhooks, tools, prompts) need a note on the threat-model impact. By contributing you agree that your contribution is licensed under the Apache License 2.0.
