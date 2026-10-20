import { prisma } from "../db";
import { badRequest, notFound } from "../errors";
import { cancelJobs, enqueue } from "../jobs/queue";
import { isWithinServiceWindow, queueOutbound } from "../channels/outbound";
import { audit } from "./audit";
import { emitEvent } from "./events";
import { aiSendBlockedReason } from "./system";

export const FOLLOW_UP_KINDS = ["CHECK_IN", "REMINDER", "ESCALATION_REMINDER", "CASE_REVIEW"] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];
const CUSTOMER_FACING = new Set<FollowUpKind>(["CHECK_IN", "REMINDER"]);

export interface ScheduleInput {
  orgId: string;
  conversationId: string;
  kind: FollowUpKind;
  dueAt: Date;
  reason?: string;
  message?: string;
  templateName?: string;
  templateLang?: string;
  timezone?: string;
  createdBy: "AI" | "USER" | "SYSTEM" | "API";
}

/** Creates a persistent follow-up and its scheduled job. Duplicate requests within the same hour are merged. */
export async function scheduleFollowUp(input: ScheduleInput) {
  if (input.dueAt.getTime() < Date.now() - 60_000) throw badRequest("Follow-up time is in the past");
  if (input.dueAt.getTime() > Date.now() + 90 * 24 * 3600_000)
    throw badRequest("Follow-ups can be scheduled at most 90 days ahead");
  const conv = await prisma.conversation.findFirst({
    where: { id: input.conversationId, orgId: input.orgId },
    include: { customer: true },
  });
  if (!conv) throw notFound("Conversation");
  if (CUSTOMER_FACING.has(input.kind) && conv.customer.optedOut)
    throw badRequest("Customer has opted out of messages");

  const hourBucket = Math.floor(input.dueAt.getTime() / 3600_000);
  const dedupeKey = `${conv.id}:${input.kind}:${hourBucket}`;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.followUp.findUnique({ where: { dedupeKey } });
    if (existing) return existing;
    const f = await tx.followUp.create({
      data: {
        orgId: input.orgId,
        conversationId: conv.id,
        customerId: conv.customerId,
        kind: input.kind,
        dueAt: input.dueAt,
        reason: input.reason,
        message: input.message,
        templateName: input.templateName,
        templateLang: input.templateLang,
        timezone: input.timezone ?? "UTC",
        createdBy: input.createdBy,
        dedupeKey,
      },
    });
    await enqueue(
      "followup_due",
      { followUpId: f.id },
      { orgId: input.orgId, runAt: input.dueAt, dedupeKey: `followup:${f.id}`, maxAttempts: 5 },
      tx,
    );
    await tx.auditLog.create({
      data: {
        orgId: input.orgId,
        actorType: input.createdBy === "USER" ? "USER" : input.createdBy,
        action: "followup.scheduled",
        targetType: "followup",
        targetId: f.id,
        metadata: { kind: f.kind, dueAt: f.dueAt.toISOString() },
      },
    });
    return f;
  });
}

export async function cancelFollowUp(
  orgId: string,
  id: string,
  actor: { type: "USER" | "API_KEY" | "SYSTEM"; id: string | null },
  reason = "cancelled",
) {
  const res = await prisma.followUp.updateMany({
    where: { id, orgId, status: "SCHEDULED" },
    data: { status: "CANCELLED", reason, completedAt: new Date() },
  });
  if (res.count === 0) throw notFound("Scheduled follow-up");
  await cancelJobs({ dedupeKey: `followup:${id}` });
  await audit({
    orgId,
    actorType: actor.type,
    actorId: actor.id,
    action: "followup.cancelled",
    targetType: "followup",
    targetId: id,
  });
}

/** Cancels all pending customer-facing follow-ups for a customer (e.g. after opt-out). */
export async function cancelCustomerFollowUps(orgId: string, customerId: string, reason: string) {
  const pending = await prisma.followUp.findMany({
    where: { orgId, customerId, status: "SCHEDULED", kind: { in: [...CUSTOMER_FACING] } },
  });
  for (const f of pending) {
    await prisma.followUp.update({
      where: { id: f.id },
      data: { status: "CANCELLED", reason, completedAt: new Date() },
    });
    await cancelJobs({ dedupeKey: `followup:${f.id}` });
  }
  return pending.length;
}

/** Job handler: executes a due follow-up after re-checking consent, control and messaging-window rules. */
export async function runFollowUp(followUpId: string) {
  const f = await prisma.followUp.findUnique({
    where: { id: followUpId },
    include: { conversation: true, customer: true },
  });
  if (!f || f.status !== "SCHEDULED") return;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: f.orgId } });
  const finish = async (status: "SENT" | "SKIPPED" | "FAILED", reason?: string) => {
    await prisma.followUp.update({
      where: { id: f.id },
      data: { status, reason: reason ?? f.reason, completedAt: new Date(), attempts: { increment: 1 } },
    });
    await audit({
      orgId: f.orgId,
      actorType: "SYSTEM",
      action: `followup.${status.toLowerCase()}`,
      targetType: "followup",
      targetId: f.id,
      metadata: { reason },
    });
  };

  const kind = f.kind as FollowUpKind;
  if (!CUSTOMER_FACING.has(kind)) {
    if (kind === "ESCALATION_REMINDER") {
      if (f.conversation.control !== "PENDING_HUMAN")
        return finish("SKIPPED", "Escalation already picked up");
      await emitEvent(f.orgId, "conversation.escalated", {
        conversation_id: f.conversationId,
        reminder: true,
      });
      await prisma.internalNote.create({
        data: {
          orgId: f.orgId,
          conversationId: f.conversationId,
          body: `Reminder: this escalated conversation is still waiting for a human. ${f.reason ?? ""}`.trim(),
        },
      });
      return finish("SENT", "Team reminder recorded");
    }
    // CASE_REVIEW: put the case back in front of the team.
    await prisma.conversation.update({
      where: { id: f.conversationId },
      data: {
        status: f.conversation.status === "RESOLVED" ? "RESOLVED" : "PENDING",
        unreadCount: { increment: 1 },
      },
    });
    await prisma.internalNote.create({
      data: {
        orgId: f.orgId,
        conversationId: f.conversationId,
        body: `Case review due: ${f.reason ?? "scheduled review"}`,
      },
    });
    return finish("SENT", "Case flagged for review");
  }

  if (f.customer.optedOut) return finish("SKIPPED", "Customer opted out");
  if (kind === "CHECK_IN") {
    const replied = await prisma.message.count({
      where: { conversationId: f.conversationId, direction: "INBOUND", createdAt: { gt: f.createdAt } },
    });
    if (replied > 0) return finish("SKIPPED", "Customer already replied");
    if (f.conversation.status === "RESOLVED") return finish("SKIPPED", "Conversation already resolved");
  }
  const authorType = f.createdBy === "AI" ? "AI" : "SYSTEM";
  if (authorType === "AI") {
    const blocked = await aiSendBlockedReason(f.orgId, f.conversationId);
    if (blocked) return finish("SKIPPED", `AI messaging blocked: ${blocked}`);
  }

  const name = f.customer.name ?? f.customer.profileName ?? "there";
  let payload;
  if (isWithinServiceWindow(f.conversation.lastInboundAt) && !f.templateName) {
    payload = {
      type: "text" as const,
      text:
        f.message ??
        `Hi ${name}, just checking in on your recent request. Is everything working now, or do you still need help? Reply here any time.`,
    };
  } else {
    const template = f.templateName ?? org.followUpTemplateName;
    if (!template)
      return finish("SKIPPED", "Outside the 24-hour window and no approved follow-up template is configured");
    payload = {
      type: "template" as const,
      name: template,
      language: f.templateLang ?? org.followUpTemplateLang,
      bodyParams: [name],
    };
  }
  const msg = await prisma.$transaction((tx) =>
    queueOutbound(tx, {
      orgId: f.orgId,
      conversationId: f.conversationId,
      channelId: f.conversation.channelId,
      authorType,
      payload,
      metadata: { followUpId: f.id },
    }),
  );
  await finish("SENT", `Queued message ${msg.id}`);
  await emitEvent(f.orgId, "followup.sent", {
    follow_up_id: f.id,
    message_id: msg.id,
    conversation_id: f.conversationId,
  });
}
