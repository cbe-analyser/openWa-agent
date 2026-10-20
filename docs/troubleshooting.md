# Troubleshooting

Start with **System health** in the dashboard and the logs:

```bash
docker compose ps
docker compose logs --since 30m app worker
```

Every API error includes a `requestId`; search the logs for it.

## The app does not start

| Symptom                                               | Fix                                                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid environment configuration: ENCRYPTION_KEY …` | Set a 32-byte base64 key: `openssl rand -base64 32`                                                                                       |
| `set POSTGRES_PASSWORD in .env` from Compose          | Add `POSTGRES_PASSWORD` to `.env`                                                                                                         |
| `migrate` exits with an error about `vector`          | The database lacks pgvector. Use the `pgvector/pgvector` image, or run `CREATE EXTENSION vector;` as a superuser on your managed database |
| `P1001: Can't reach database server`                  | Check `DATABASE_URL`, and that the `db` container is healthy (`docker compose ps`)                                                        |
| Sign-in fails with "Cross-origin request rejected"    | `APP_URL` must match the address in the browser exactly (scheme, host and port)                                                           |

## No messages arrive

1. **Check health** on the WhatsApp connection. An expired or revoked token shows the Graph API error. Use a permanent system-user token ([whatsapp-setup.md](whatsapp-setup.md#2-create-a-permanent-access-token)).
2. In Meta's webhook configuration, the callback URL must be the one shown on the connection card, and **messages** must be subscribed.
3. The URL must be public HTTPS with a valid certificate: `curl -I https://your-domain/api/health` from another network.
4. Look for webhook log lines:
   - `401` / "invalid signature": the app secret saved in OpenWa Agent does not match the Meta app. Update it with **Update credentials**.
   - No request at all: Meta is not calling you. Check the URL, firewall and DNS.
5. Messages from a test number only reach numbers added as test recipients in the Meta app.

## The AI does not reply

Open the conversation. The **Agent activity** card shows each run with its decision and reasons.

| Reason                                                                                                                              | Meaning                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `copilot_mode`, `intent_…_requires_approval`, `below_confidence_threshold`                                                          | A draft is waiting for approval. That is the configured autonomy at work                            |
| `customer_requested_human`, `refund_requires_authorization`, `legal_matter`, …                                                      | Escalated by a rule; filter the inbox by **Waiting for human**                                      |
| `conversation_ai_paused`, `org_ai_paused`, `global_kill_switch`, `conversation_control_human`, `conversation_control_pending_human` | AI is paused or a person has (or is about to take) control. Release or resume it                    |
| `no_ai_provider_configured`                                                                                                         | Add a provider under **AI agent → AI providers**                                                    |
| `superseded_by_newer_message`                                                                                                       | The customer sent several messages quickly; the run for the latest one answers all of them          |
| `ai_unavailable`                                                                                                                    | Every AI provider failed. Check **AI agent → AI providers → Test** and **Usage & costs** for errors |

If the customer sent an opt-out keyword, the conversation shows the opt-out confirmation and no AI run; an opt-in keyword re-subscribes them.

If no run appears at all, the worker is not running or is behind: check **System health → Worker** and `docker compose logs worker`.

## Replies are wrong or "I don't have that information"

- Use **Knowledge base → Test retrieval** with the customer's question. If the right passage is not in the top results, add a FAQ with the customer's wording, split long documents, or configure a semantic embedding model ([ai-providers.md](ai-providers.md#embeddings)).
- Documents stuck in `FAILED` show the reason (for example a scanned PDF without a text layer).
- Check the **Minimum relevance** setting; too high a value makes the agent say it lacks information.
- Answers about prices, dates and policies must be backed by knowledge or a tool result. Otherwise they become drafts on purpose.

## Messages show "failed"

The failed message shows Meta's error code and text. Common ones:

| Code            | Meaning                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| 131047          | Outside the 24-hour window; send a template                                 |
| 131026          | The recipient cannot receive the message (not on WhatsApp, old app version) |
| 131049 / 131048 | Meta limited delivery (spam rate or ecosystem limits)                       |
| 190             | Access token expired or invalid                                             |
| 132000–132015   | Template problem (parameters, paused or not approved)                       |

Transient errors are retried automatically; permanent ones are not.

## Dead-letter jobs

**System health** lists jobs that failed every retry with the last error. Fix the cause, then **Retry**.

## Locked out

After 8 wrong passwords in a row an account is locked for 15 minutes; wait for the lock to expire. Sign-in attempts are also rate-limited per address and email.

## Getting help

Open an issue with the version, deployment type, the steps to reproduce, and log lines with secrets removed. Do not post tokens, keys or customer data. Security problems: see [SECURITY.md](../SECURITY.md).
