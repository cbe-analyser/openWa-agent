import type { AuthorType, Prisma } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { enqueue, PermanentJobError } from "../jobs/queue";
import { logger } from "../logger";
import { emitEvent } from "../services/events";
import { aiSendBlockedReason } from "../services/system";
import { adapterFor } from "./registry";
import { ChannelSendError, type OutboundPayload } from "./types";

/** WhatsApp customer-service window: free-form replies are allowed for 24h after the customer's last message. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinServiceWindow(lastInboundAt: Date | null, now = new Date()): boolean {
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}

export interface QueueOutboundInput {
  orgId: string;
  conversationId: string;
  channelId: string;
  authorType: AuthorType;
  authorUserId?: string | null;
  payload: OutboundPayload;
  agentRunId?: string | null;
  status?: "QUEUED" | "PENDING_APPROVAL";
  metadata?: Record<string, unknown>;
}

function payloadBody(p: OutboundPayload): string {
  switch (p.type) {
    case "text":
      return p.text;
    case "buttons":
      return p.text;
    case "template":
      return `[Template ${p.name}${p.bodyParams?.length ? `: ${p.bodyParams.join(" | ")}` : ""}]`;
    case "media":
      return p.caption ?? `[${p.mediaType}]`;
  }
}

/** Creates an outbound message record and (unless it awaits approval) its durable send job. */
export async function queueOutbound(tx: Tx, input: QueueOutboundInput) {
  const status = input.status ?? "QUEUED";
  const message = await tx.message.create({
    data: {
      orgId: input.orgId,
      conversationId: input.conversationId,
      channelId: input.channelId,
      direction: "OUTBOUND",
      authorType: input.authorType,
      authorUserId: input.authorUserId ?? null,
      type: input.payload.type,
      body: payloadBody(input.payload),
      template:
        input.payload.type === "template" ? (input.payload as unknown as Prisma.InputJsonValue) : undefined,
      status,
      agentRunId: input.agentRunId ?? null,
      metadata: { payload: input.payload, ...(input.metadata ?? {}) } as Prisma.InputJsonValue,
    },
  });
  if (status === "QUEUED") {
    await enqueue(
      "send_message",
      { messageId: message.id },
      { orgId: input.orgId, dedupeKey: `send:${message.id}`, maxAttempts: 6 },
      tx,
    );
  }
  await tx.conversation.update({ where: { id: input.conversationId }, data: { lastMessageAt: new Date() } });
  return message;
}

/** Job handler: delivers one queued outbound message, enforcing policy checks at send time. */
export async function sendQueuedMessage(messageId: string): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { conversation: { include: { customer: true, channel: true } } },
  });
  if (!message || !["QUEUED", "SENDING"].includes(message.status)) return; // already handled (idempotent)
  const { conversation } = message;
  const { customer, channel } = conversation;
  const meta = (message.metadata ?? {}) as { payload?: OutboundPayload; optOutConfirmation?: boolean };
  const payload = meta.payload ?? { type: "text", text: message.body ?? "" };

  const fail = async (code: string, error: string) => {
    await prisma.message.update({
      where: { id: message.id },
      data: { status: "FAILED", errorCode: code, error },
    });
    await emitEvent(message.orgId, "message.failed", {
      message_id: message.id,
      conversation_id: conversation.id,
      error_code: code,
    });
  };

  if (channel.status === "DISABLED") return fail("CHANNEL_DISABLED", "The channel is disabled");
  if (customer.optedOut && !meta.optOutConfirmation)
    return fail("OPTED_OUT", "Customer has opted out of messages");

  if (message.authorType === "AI") {
    const blocked = await aiSendBlockedReason(message.orgId, conversation.id);
    if (blocked) {
      await prisma.message.update({
        where: { id: message.id },
        data: { status: "SUPERSEDED", error: `AI send blocked: ${blocked}` },
      });
      return;
    }
  }
  if (payload.type !== "template" && !isWithinServiceWindow(conversation.lastInboundAt)) {
    return fail(
      "WINDOW_CLOSED",
      "More than 24 hours since the customer's last message; an approved template is required",
    );
  }

  await prisma.message.update({ where: { id: message.id }, data: { status: "SENDING" } });
  try {
    const { externalId } = await adapterFor(channel.kind).send(channel, customer.waId, payload);
    await prisma.message.update({
      where: { id: message.id },
      data: { status: "SENT", externalId, sentAt: new Date(), error: null, errorCode: null },
    });
    await emitEvent(message.orgId, "message.sent", {
      message_id: message.id,
      conversation_id: conversation.id,
    });
    if (channel.kind === "SIMULATOR") {
      // The simulator reports delivery immediately, like a real handset would via a status webhook.
      await prisma.message.update({
        where: { id: message.id },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      });
    }
  } catch (err) {
    if (err instanceof ChannelSendError && !err.retryable) {
      await fail(err.code ?? "SEND_FAILED", err.message);
      if (err.code === "TOKEN_INVALID") {
        await prisma.channel.update({
          where: { id: channel.id },
          data: { status: "ERROR", lastError: err.message },
        });
      }
      throw new PermanentJobError(err.message);
    }
    await prisma.message.update({
      where: { id: message.id },
      data: { status: "QUEUED", error: (err as Error).message.slice(0, 500) },
    });
    logger.warn({ messageId, err: (err as Error).message }, "Outbound send failed; will retry");
    throw err;
  }
}

/** Called when a send job is dead-lettered: makes the failure visible on the message. */
export async function markSendDead(messageId: string, error: string) {
  await prisma.message.updateMany({
    where: { id: messageId, status: { in: ["QUEUED", "SENDING"] } },
    data: { status: "FAILED", errorCode: "RETRIES_EXHAUSTED", error: error.slice(0, 500) },
  });
}
