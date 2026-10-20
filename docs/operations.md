# Operations

Commands below assume the Docker Compose deployment from [deployment.md](deployment.md), run from the repository directory.

## Backups

Everything that matters is in PostgreSQL, plus `.env` (above all `ENCRYPTION_KEY`). Uploaded knowledge files are stored as extracted text in the database; original files are not kept.

Daily logical backup:

```bash
mkdir -p /var/backups/openwa
docker compose exec -T db pg_dump -U openwa -d openwa --format=custom \
  > /var/backups/openwa/openwa-$(date +%F).dump
find /var/backups/openwa -name '*.dump' -mtime +14 -delete
```

Put this in a root cron job (for example `15 2 * * *`), copy the files off the server (encrypted, e.g. with `restic` or `age`), and keep `ENCRYPTION_KEY` in a separate, secure place such as a password manager. A database backup without the key still restores, but stored AI keys, WhatsApp tokens and webhook secrets cannot be decrypted and must be re-entered.

Backups contain customer messages and personal data. Protect and expire them according to your retention policy ([data-protection.md](data-protection.md)).

## Restore

```bash
docker compose stop app worker
docker compose exec -T db dropdb -U openwa --if-exists openwa_restore
docker compose exec -T db createdb -U openwa openwa_restore
docker compose exec -T db pg_restore -U openwa -d openwa_restore --no-owner < /var/backups/openwa/openwa-2026-10-20.dump
```

Check the restored data (`docker compose exec db psql -U openwa -d openwa_restore -c 'select count(*) from "Message"'`). To switch over, rename the databases while the app is stopped:

```bash
docker compose exec -T db psql -U openwa -d postgres \
  -c 'ALTER DATABASE openwa RENAME TO openwa_old' \
  -c 'ALTER DATABASE openwa_restore RENAME TO openwa'
docker compose up -d
```

Use the same `ENCRYPTION_KEY` as when the backup was taken. Test a restore at least once before you rely on your backups.

## Upgrades

```bash
docker compose exec -T db pg_dump -U openwa -d openwa --format=custom > pre-upgrade.dump
git fetch --tags && git checkout vX.Y.Z      # or: git pull
docker compose up -d --build
```

The `migrate` service applies new database migrations before `app` and `worker` start. Migrations are forward-only; to roll back, restore the pre-upgrade dump and check out the previous version. Read `CHANGELOG.md` for breaking changes before upgrading.

## Credential rotation

| Credential                                      | How                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| AI provider key                                 | **AI agent → AI providers → Edit**, paste the new key, **Test**. Then revoke the old key at the provider           |
| WhatsApp access token, app secret, verify token | **WhatsApp connections → Update credentials**. A new verify token must also be entered in Meta's webhook settings  |
| API keys                                        | **Developer API → Rotate**, with an optional grace period for the old key                                          |
| Outbound webhook signing secret                 | Delete and recreate the endpoint, then update the receiver                                                         |
| User passwords and sessions                     | **Security**: change password (signs out other sessions); revoke individual sessions                               |
| `POSTGRES_PASSWORD`                             | `docker compose exec db psql -U openwa -c "ALTER USER openwa PASSWORD '…'"`, update `.env`, `docker compose up -d` |

### Rotating `ENCRYPTION_KEY`

1. Generate a new key: `openssl rand -base64 32`.
2. In `.env`, set `ENCRYPTION_KEY_PREVIOUS` to the current key and `ENCRYPTION_KEY` to the new one.
3. `docker compose up -d` (both keys can now decrypt; new secrets use the new key).
4. Re-encrypt stored secrets: `docker compose exec app node dist/reencrypt-secrets.cjs` (from a source checkout: `npm run secrets:reencrypt`). It prints counts only.
5. Remove `ENCRYPTION_KEY_PREVIOUS` from `.env` and run `docker compose up -d` again.
6. Back up the new key.

## Monitoring

- **`GET /api/health`** (no authentication) returns `200 {"status":"ok"}` when the database is reachable, otherwise `503`. Use it for uptime checks and load balancers. The Docker image has a `HEALTHCHECK` using it.
- **System health** in the dashboard (or `GET /api/v1/health` with `health:read`) adds worker queue lag, running and pending jobs, dead-letter jobs with their errors, AI provider status and WhatsApp connection status. Queue lag above 2 minutes marks the worker as unhealthy; check `docker compose logs worker`.
- **Logs** are JSON lines on stdout (pino), with `requestId`, `orgId` and job IDs. API keys, Meta tokens, bearer credentials, private keys, long digit sequences (card-like numbers) and `password=`/`token=`-style values are redacted. Set `LOG_LEVEL=debug` temporarily for more detail.
  ```bash
  docker compose logs -f --since 10m app worker
  ```
- **Usage & costs** shows failed AI calls; **Analytics** shows escalation rate and handling times.

Worth alerting on: `/api/health` failing, dead-letter count increasing, a WhatsApp connection turning unhealthy (expired token), and AI failure rate.

## Dead-letter jobs

Jobs that fail all retries are marked dead and listed on **System health** with the last error. Fix the cause (for example an expired WhatsApp token) and click **Retry**. Messages are not lost: the outbound message stays `FAILED` with the error until it is retried.

## Data retention

Set **AI agent → Data retention (days)** per organization (empty keeps data until deleted). An hourly job deletes message content older than that, as well as raw webhook payloads. Sessions, idempotency keys, rate-limit buckets and finished jobs are cleaned up automatically. To delete a single customer's data on request, open the customer and use **Export data** or **Delete all data** ([data-protection.md](data-protection.md)).

## Emergency stop

- **One conversation:** take over or pause it.
- **One organization:** the **AI replies active** switch on the AI agent page.
- **Whole instance:** an instance administrator can switch on the kill switch in **Security**, or set `AI_KILL_SWITCH=true` and restart. No AI-generated message is sent while it is on; inbound messages are still received and stored for people to answer.
