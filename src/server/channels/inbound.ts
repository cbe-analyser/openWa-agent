import type { Channel, Prisma } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { enqueue } from "../jobs/queue";
import { logger } from "../logger";
import { sha256Hex } from "../security/crypto";
import { maskPhone } from "../security/redact";
import { emitEvent } from "../services/events";
import type { DeliveryStatus, InboundMessage, StatusUpdate } from "./types";
import { parseWhatsAppWebhook } from "./whatsappCloud";

const AI_TRIGGER_TYPES = new Set([
  "text",
  "interactive",
  "button",
  "image",
  "document",
  "video",
  "audio",
  "location",
]);

export interface IngestResult {
  duplicate: boolean;
  messagesCreated: number;
  statusesApplied: number;
}

/**
 * Durably records a verified webhook delivery and turns it into conversation records and jobs —
 * all in one transaction. Duplicate deliveries (same body) and duplicate message ids are no-ops.
 */
export async function ingestWebhook(
  channel: Channel,
  rawBody: string,
  payload: unknown,
): Promise<IngestResult> {
  const parsed = parseWhatsAppWebhook(payload);
  const dedupeKey = `${channel.id}:${sha256Hex(rawBody)}`;
  return prisma.$transaction(async (tx) => {
    const created = await tx.webhookEvent.createMany({
      data: [
        { orgId: channel.orgId, channelId: channel.id, dedupeKey, payload: payload as Prisma.InputJsonValue },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) return { duplicate: true, messagesCreated: 0, statusesApplied: 0 };

    let messagesCreated = 0;
    for (const m of parsed.messages) {
      if (await recordInboundMessage(tx, channel, m)) messagesCreated++;
    }
    let statusesApplied = 0;
    for (const s of parsed.statuses) {
      if (await applyStatusUpdate(tx, channel.id, s)) statusesApplied++;
    }
    await tx.webhookEvent.update({
      where: { dedupeKey },
      data: {
        status: messagesCreated + statusesApplied > 0 ? "PROCESSED" : "IGNORED",
        processedAt: new Date(),
      },
    });
    await tx.channel.update({
      where: { id: channel.id },
      data: { lastWebhookAt: new Date(), status: "ACTIVE", lastError: null },
    });
    return { duplicate: false, messagesCreated, statusesApplied };
  });
}

async function recordInboundMessage(tx: Tx, channel: Channel, m: InboundMessage): Promise<boolean> {
  const exists = await tx.message.findUnique({
    where: { channelId_externalId: { channelId: channel.id, externalId: m.externalId } },
    select: { id: true },
  });
  if (exists) return false;

  const customer = await tx.customer.upsert({
    where: { orgId_waId: { orgId: channel.orgId, waId: m.from } },
    create: { orgId: channel.orgId, waId: m.from, profileName: m.profileName, lastInboundAt: m.timestamp },
    update: { profileName: m.profileName ?? undefined, lastInboundAt: m.timestamp },
  });

  let conversation = await tx.conversation.findUnique({
    where: { channelId_customerId: { channelId: channel.id, customerId: customer.id } },
  });
  if (!conversation) {
    conversation = await tx.conversation.create({
      data: {
        orgId: channel.orgId,
        channelId: channel.id,
        customerId: customer.id,
        lastInboundAt: m.timestamp,
        lastMessageAt: m.timestamp,
      },
    });
  } else if (conversation.status === "RESOLVED") {
    // A new message on a resolved conversation reopens it under AI control.
    conversation = await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        status: "OPEN",
        control: "AI",
        controlVersion: { increment: 1 },
        failedAttempts: 0,
        resolvedAt: null,
      },
    });
    await tx.auditLog.create({
      data: {
        orgId: channel.orgId,
        actorType: "SYSTEM",
        action: "conversation.reopened",
        targetType: "conversation",
        targetId: conversation.id,
      },
    });
  }

  const message = await tx.message.create({
    data: {
      orgId: channel.orgId,
      conversationId: conversation.id,
      channelId: channel.id,
      direction: "INBOUND",
      authorType: "CUSTOMER",
      type: m.type,
      body: m.text,
      media: (m.media ?? undefined) as Prisma.InputJsonValue | undefined,
      externalId: m.externalId,
      status: "RECEIVED",
      metadata: { interactive: m.interactive, contextMessageId: m.contextMessageId } as Prisma.InputJsonValue,
      createdAt: m.timestamp,
    },
  });
  await tx.conversation.update({
    where: { id: conversation.id },
    data: { unreadCount: { increment: 1 }, lastMessageAt: m.timestamp, lastInboundAt: m.timestamp },
  });

  if (AI_TRIGGER_TYPES.has(m.type)) {
    await enqueue(
      "process_inbound",
      { messageId: message.id },
      { orgId: channel.orgId, dedupeKey: `inbound:${message.id}`, maxAttempts: 6 },
      tx,
    );
  }
  await emitEvent(
    channel.orgId,
    "message.received",
    { conversation_id: conversation.id, message_id: message.id, type: m.type },
    tx,
  );
  logger.info(
    { orgId: channel.orgId, conversationId: conversation.id, from: maskPhone(m.from), type: m.type },
    "Inbound message recorded",
  );
  return true;
}

const STATUS_RANK: Record<string, number> = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4 };

/** Applies a delivery receipt. Statuses only move forward (receipts can arrive out of order). */
export async function applyStatusUpdate(tx: Tx, channelId: string, s: StatusUpdate): Promise<boolean> {
  const msg = await tx.message.findUnique({
    where: { channelId_externalId: { channelId, externalId: s.externalId } },
  });
  if (!msg) return false;
  const map: Record<DeliveryStatus, "SENT" | "DELIVERED" | "READ" | "FAILED"> = {
    sent: "SENT",
    delivered: "DELIVERED",
    read: "READ",
    failed: "FAILED",
  };
  const next = map[s.status];
  if (next === "FAILED") {
    if (msg.status === "FAILED") return false;
    await tx.message.update({
      where: { id: msg.id },
      data: {
        status: "FAILED",
        errorCode: s.errorCode ?? "DELIVERY_FAILED",
        error: s.errorMessage?.slice(0, 500) ?? "Delivery failed",
      },
    });
    await emitEvent(
      msg.orgId,
      "message.failed",
      { message_id: msg.id, conversation_id: msg.conversationId, error_code: s.errorCode ?? null },
      tx,
    );
    return true;
  }
  if ((STATUS_RANK[msg.status] ?? -1) >= STATUS_RANK[next]!) return false;
  await tx.message.update({
    where: { id: msg.id },
    data: {
      status: next,
      ...(next === "DELIVERED" ? { deliveredAt: s.timestamp } : {}),
      ...(next === "READ" ? { readAt: s.timestamp, deliveredAt: msg.deliveredAt ?? s.timestamp } : {}),
    },
  });
  return true;
}
