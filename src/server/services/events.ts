import { prisma, type Tx } from "../db";
import { enqueue } from "../jobs/queue";
import { decryptSecret, hmacSha256Hex } from "../security/crypto";
import { safeFetch } from "../security/ssrf";

export const WEBHOOK_EVENTS = [
  "message.received",
  "message.sent",
  "message.failed",
  "conversation.escalated",
  "conversation.resolved",
  "conversation.control_changed",
  "ticket.created",
  "ticket.updated",
  "followup.sent",
  "tool.approval_requested",
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

/** Fans an event out to subscribed outbound webhook endpoints via durable delivery jobs. */
export async function emitEvent(
  orgId: string,
  event: WebhookEventName,
  data: Record<string, unknown>,
  tx: Tx = prisma,
) {
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { orgId, enabled: true, events: { has: event } },
    select: { id: true },
  });
  const eventId = `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  for (const ep of endpoints) {
    await enqueue(
      "deliver_webhook",
      { endpointId: ep.id, eventId, event, data, createdAt: new Date().toISOString() },
      { orgId, dedupeKey: `wh:${ep.id}:${eventId}`, maxAttempts: 8 },
      tx,
    );
  }
}

/**
 * Signature scheme for outbound webhooks (documented in docs/api.md):
 *   X-OpenWa-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${body}`)>
 */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

export async function deliverWebhook(payload: {
  endpointId: string;
  eventId: string;
  event: string;
  data: unknown;
  createdAt: string;
}) {
  const ep = await prisma.webhookEndpoint.findUnique({ where: { id: payload.endpointId } });
  if (!ep || !ep.enabled) return;
  const body = JSON.stringify({
    id: payload.eventId,
    type: payload.event,
    created_at: payload.createdAt,
    data: payload.data,
  });
  const ts = Math.floor(Date.now() / 1000);
  const res = await safeFetch(ep.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "OpenWa-Agent-Webhooks/1.0",
      "x-openwa-event": payload.event,
      "x-openwa-delivery": payload.eventId,
      "x-openwa-signature": signWebhook(decryptSecret(ep.encryptedSecret), body, ts),
    },
    body,
    timeoutMs: 10_000,
    maxBytes: 64 * 1024,
  });
  if (res.status < 200 || res.status >= 300) {
    await prisma.webhookEndpoint.update({ where: { id: ep.id }, data: { failureCount: { increment: 1 } } });
    throw new Error(`Webhook endpoint responded with HTTP ${res.status}`);
  }
  await prisma.webhookEndpoint.update({
    where: { id: ep.id },
    data: { lastDeliveryAt: new Date(), failureCount: 0 },
  });
}
