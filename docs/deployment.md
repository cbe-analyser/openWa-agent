# Deployment

The supported production setup is Docker Compose on one Linux server (a VPS or a machine on your premises). The stack is:

| Service                     | Image                    | Role                                                            |
| --------------------------- | ------------------------ | --------------------------------------------------------------- |
| `db`                        | `pgvector/pgvector:pg16` | PostgreSQL with pgvector. Data in the `db-data` volume          |
| `migrate`                   | built from this repo     | Runs `prisma migrate deploy` once, then exits                   |
| `app`                       | built from this repo     | Dashboard, API and webhook receiver on port 3000                |
| `worker`                    | built from this repo     | Background jobs (agent, sends, ingestion, follow-ups, webhooks) |
| `caddy` (profile `https`)   | `caddy:2.8`              | HTTPS reverse proxy with automatic Let's Encrypt certificates   |
| `ollama` (profile `ollama`) | `ollama/ollama`          | Optional self-hosted models                                     |

## Sizing

| Load                                                              | Server                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Evaluation, a few hundred conversations a day, hosted AI provider | 2 vCPU, 2–4 GB RAM, 20 GB disk                                                   |
| Several thousand conversations a day                              | 4 vCPU, 8 GB RAM; consider a managed PostgreSQL                                  |
| Self-hosted models with Ollama                                    | Add a GPU server; see [ai-providers.md](ai-providers.md#hardware-guidance-rough) |

Most of the work is waiting on the AI provider, so CPU needs are modest. Raise `WORKER_CONCURRENCY` (default 4) if replies queue up, or run more worker containers: jobs are claimed with `SKIP LOCKED`, so workers never process the same job twice.

## Managed hosting or self-hosting

|               | Self-hosted VPS (this guide)                                   | Managed platform (container host + managed PostgreSQL)                 |
| ------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Cost          | Lowest: one small VPS (roughly USD 5–20/month) runs everything | Higher: app, worker and database are billed separately                 |
| Effort        | You patch the OS, run backups and watch disk space             | Backups, failover and patching of the database are handled for you     |
| Data location | Exactly where you choose, including on your premises           | The provider's regions; check them against your data-protection duties |
| Scaling       | Vertical; add worker containers on the same host               | Easier horizontal scaling and zero-downtime deploys                    |

Whichever you choose, OpenWa Agent needs **two always-on processes** (app and worker) and a PostgreSQL database with pgvector. Pure serverless platforms that stop processes between requests are not suitable for the worker, which runs follow-ups, retries and scheduled jobs. Redis is not needed: the job queue, rate limits and idempotency keys live in PostgreSQL, which keeps the stack to a single stateful service.

AI provider costs are separate and usually larger than hosting. Watch **Usage & costs** and set monthly token budgets per provider.

## Step by step (Ubuntu or Debian VPS)

1. **Install Docker** with the Compose plugin: <https://docs.docker.com/engine/install/>.
2. **DNS.** Point an A/AAAA record (e.g. `support.example.com`) to the server.
3. **Firewall.** Allow 22, 80 and 443 only. For example with `ufw`: `ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable`.
4. **Get the code and configure:**

   ```bash
   git clone https://github.com/cbe-analyser/openwa-agent.git
   cd openwa-agent
   cp .env.example .env
   chmod 600 .env
   ```

   Set in `.env`:

   | Variable            | Value                                                                                                              |
   | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
   | `APP_URL`           | `https://support.example.com`                                                                                      |
   | `DOMAIN`            | `support.example.com`                                                                                              |
   | `ENCRYPTION_KEY`    | output of `openssl rand -base64 32`. **Back it up separately**; without it, stored credentials cannot be decrypted |
   | `POSTGRES_PASSWORD` | a long random password (`openssl rand -hex 24`)                                                                    |
   | `APP_PORT`          | `127.0.0.1:3000`, so the app is only reachable through Caddy                                                       |
   | `DEPLOYMENT_MODE`   | `single` for one business, `multi` for a hosted multi-tenant service                                               |

5. **Start:**

   ```bash
   docker compose --profile https up -d --build
   docker compose ps
   curl -fsS https://support.example.com/api/health
   ```

6. **Create the first account** at `https://support.example.com/signup`. The first user becomes the instance administrator. In `single` mode, sign-up closes after the first organization; invite colleagues from **Team**.
7. Follow **Setup & docs** in the dashboard: add an AI provider, upload knowledge, test in the simulator, then connect WhatsApp ([whatsapp-setup.md](whatsapp-setup.md)).

### Demo data

```bash
docker compose exec -e SEED_ADMIN_EMAIL=you@example.com app node dist/seed.cjs --force
```

`--force` is needed because the container runs with `NODE_ENV=production`. The seed creates a separate demo organization with a simulator and the mock provider and prints a one-time password if `SEED_ADMIN_PASSWORD` is not set.

## Using your own reverse proxy

If you already run nginx, Traefik or a load balancer, skip the `https` profile and proxy to the app port. Requirements:

- Terminate TLS; Meta only delivers webhooks over HTTPS.
- Pass `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`. Client IPs are used for rate limiting and audit logs.
- Allow request bodies up to `MAX_UPLOAD_MB` (default 10 MB) for knowledge uploads.
- `APP_URL` must be exactly the public origin; the CSRF check compares the browser's `Origin` with it.

Example nginx location:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 12m;
}
```

## External PostgreSQL

Any PostgreSQL 14+ with the `vector` extension works (most managed services offer it). Remove the `db` service, set `DATABASE_URL` in `.env` (with `?sslmode=require` where supported) and make sure the database user may run `CREATE EXTENSION vector` during the first migration, or create the extension beforehand.

## Without Docker

```bash
npm ci
npm run build                 # Next.js standalone build + worker bundle
npx prisma migrate deploy
cp -r .next/static .next/standalone/.next/static
node .next/standalone/server.js     # app (PORT, HOSTNAME env vars)
node dist/worker.cjs                # worker, as a separate service
```

Run both under systemd or another supervisor with `Restart=always`. Send `SIGTERM` to stop the worker gracefully.

## Hardening checklist

- [ ] HTTPS only; `APP_URL` starts with `https://`.
- [ ] `.env` readable only by root/the deploy user; `ENCRYPTION_KEY` backed up offline.
- [ ] PostgreSQL not exposed to the internet (the Compose file does not publish its port).
- [ ] `ALLOW_PRIVATE_NETWORK_FETCH=false`.
- [ ] Automated backups tested by a restore ([operations.md](operations.md#backups)).
- [ ] OS security updates enabled (`unattended-upgrades`).
- [ ] Every team member uses their own account with the lowest role that works.
