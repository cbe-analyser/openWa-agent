import type { ConversationStatus, ControlMode, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { badRequest, conflict, notFound } from "../errors";
import { actorOf, requirePermission, type AuthContext } from "../auth/context";
import { queueOutbound, isWithinServiceWindow } from "../channels/outbound";
import { enqueue } from "../jobs/queue";
import { auditCtx } from "./audit";
import { emitEvent } from "./events";

export interface ConversationFilters {
  status?: ConversationStatus;
  control?: ControlMode;
  intent?: string;
  assignedToMe?: boolean;
  unread?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

export async function listConversations(ctx: AuthContext, f: ConversationFilters) {
  requirePermission(ctx, "conversations:read");
  const where: Prisma.ConversationWhereInput = { orgId: ctx.orgId };
  if (f.status) where.status = f.status;
  if (f.control) where.control = f.control;
  if (f.intent) where.intent = f.intent;
  if (f.assignedToMe && ctx.userId) where.assignedToId = ctx.userId;
  if (f.unread) where.unreadCount = { gt: 0 };
  if (f.q) {
    const q = f.q.slice(0, 100);
    where.OR = [
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { customer: { profileName: { contains: q, mode: "insensitive" } } },
      { customer: { waId: { contains: q.replace(/[^\d]/g, "") || q } } },
      { messages: { some: { body: { contains: q, mode: "insensitive" } } } },
    ];
  }
  const limit = Math.min(f.limit ?? 30, 100);
  const rows = await prisma.conversation.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: {
      customer: { select: { id: true, name: true, profileName: true, waId: true, optedOut: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, direction: true, status: true, createdAt: true, type: true },
      },
      channel: { select: { id: true, name: true, kind: true } },
    },
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function getConversationOrThrow(ctx: AuthContext, id: string) {
  const conv = await prisma.conversation.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!conv) throw notFound("Conversation");
  return conv;
}

export async function getConversationDetail(ctx: AuthContext, id: string) {
  requirePermission(ctx, "conversations:read");
  const conv = await prisma.conversation.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      customer: true,
      channel: { select: { id: true, name: true, kind: true, displayPhoneNumber: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 500 },
      notes: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
      tickets: { orderBy: { createdAt: "desc" } },
      followUps: { orderBy: { dueAt: "desc" }, take: 20 },
      agentRuns: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!conv) throw notFound("Conversation");
  const auditTrail = await prisma.auditLog.findMany({
    where: { orgId: ctx.orgId, targetType: "conversation", targetId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  const pendingTools = await prisma.toolExecution.findMany({
    where: { orgId: ctx.orgId, conversationId: id, status: "PENDING_APPROVAL" },
  });
  return {
    ...conv,
    auditTrail,
    pendingTools,
    withinServiceWindow: isWithinServiceWindow(conv.lastInboundAt),
  };
}

export async function markRead(ctx: AuthContext, id: string) {
  requirePermission(ctx, "conversations:read");
  await prisma.conversation.updateMany({ where: { id, orgId: ctx.orgId }, data: { unreadCount: 0 } });
}

/**
 * Human takeover: pauses AI for this conversation immediately. Bumping controlVersion makes any
 * in-flight AI run discard its reply, and pending AI drafts are superseded.
 */
export async function takeOver(ctx: AuthContext, id: string) {
  requirePermission(ctx, "conversations:write");
  if (!ctx.userId) throw badRequest("Takeover requires a signed-in team member");
  const conv = await getConversationOrThrow(ctx, id);
  if (conv.control === "HUMAN" && conv.assignedToId === ctx.userId) return conv;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Conversation" WHERE "id" = ${id} FOR UPDATE`;
    const u = await tx.conversation.update({
      where: { id },
      data: {
        control: "HUMAN",
        assignedToId: ctx.userId,
        controlVersion: { increment: 1 },
        status: conv.status === "RESOLVED" ? "OPEN" : conv.status,
      },
    });
    await tx.message.updateMany({
      where: { conversationId: id, status: "QUEUED", authorType: "AI" },
      data: { status: "SUPERSEDED", error: "Human took over the conversation" },
    });
    await auditCtx(ctx, "conversation.takeover", { type: "conversation", id }, { from: conv.control }, tx);
    return u;
  });
  await emitEvent(ctx.orgId, "conversation.control_changed", {
    conversation_id: id,
    control: "HUMAN",
    user_id: ctx.userId,
  });
  return updated;
}

/** Returns a conversation to AI control (authorized humans only). */
export async function releaseToAI(ctx: AuthContext, id: string) {
  requirePermission(ctx, "conversations:write");
  if (ctx.kind !== "session")
    throw badRequest("Only a signed-in team member can return a conversation to AI control");
  const conv = await getConversationOrThrow(ctx, id);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.conversation.update({
      where: { id },
      data: {
        control: "AI",
        controlVersion: { increment: 1 },
        failedAttempts: 0,
        status: conv.status === "ESCALATED" ? "OPEN" : conv.status,
      },
    });
    await auditCtx(
      ctx,
      "conversation.released_to_ai",
      { type: "conversation", id },
      { from: conv.control },
      tx,
    );
    return u;
  });
  await cancelEscalationReminders(ctx.orgId, id);
  await emitEvent(ctx.orgId, "conversation.control_changed", {
    conversation_id: id,
    control: "AI",
    user_id: ctx.userId,
  });
  return updated;
}

async function cancelEscalationReminders(orgId: string, conversationId: string) {
  await prisma.followUp.updateMany({
    where: { orgId, conversationId, kind: "ESCALATION_REMINDER", status: "SCHEDULED" },
    data: { status: "CANCELLED", reason: "Escalation handled", completedAt: new Date() },
  });
}

export async function setAiPaused(ctx: AuthContext, id: string, paused: boolean) {
  requirePermission(ctx, "conversations:write");
  await getConversationOrThrow(ctx, id);
  const u = await prisma.conversation.update({
    where: { id },
    data: { aiPaused: paused, controlVersion: { increment: 1 } },
  });
  await auditCtx(ctx, paused ? "conversation.ai_paused" : "conversation.ai_resumed", {
    type: "conversation",
    id,
  });
  return u;
}

export async function assign(ctx: AuthContext, id: string, userId: string | null) {
  requirePermission(ctx, "conversations:write");
  await getConversationOrThrow(ctx, id);
  if (userId) {
    const member = await prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId: ctx.orgId } },
    });
    if (!member) throw badRequest("Assignee is not a member of this organization");
  }
  const u = await prisma.conversation.update({ where: { id }, data: { assignedToId: userId } });
  await auditCtx(ctx, "conversation.assigned", { type: "conversation", id }, { userId });
  return u;
}

export async function setStatus(
  ctx: AuthContext,
  id: string,
  status: ConversationStatus,
  resolutionNote?: string,
) {
  requirePermission(ctx, "conversations:write");
  const conv = await getConversationOrThrow(ctx, id);
  const u = await prisma.conversation.update({
    where: { id },
    data: {
      status,
      ...(status === "RESOLVED"
        ? {
            resolvedAt: new Date(),
            resolutionNote: resolutionNote ?? conv.resolutionNote,
            unreadCount: 0,
            control: conv.control === "PENDING_HUMAN" ? "HUMAN" : conv.control,
          }
        : { resolvedAt: null }),
    },
  });
  if (status === "RESOLVED") {
    await cancelEscalationReminders(ctx.orgId, id);
    await prisma.followUp.updateMany({
      where: { orgId: ctx.orgId, conversationId: id, kind: "CHECK_IN", status: "SCHEDULED" },
      data: { status: "CANCELLED", reason: "Conversation resolved", completedAt: new Date() },
    });
    await emitEvent(ctx.orgId, "conversation.resolved", { conversation_id: id });
  }
  await auditCtx(
    ctx,
    "conversation.status_changed",
    { type: "conversation", id },
    { from: conv.status, to: status, resolutionNote },
  );
  return u;
}

/** A human reply. Automatically takes over the conversation so the AI cannot answer at the same time. */
export async function sendHumanMessage(ctx: AuthContext, id: string, text: string) {
  requirePermission(ctx, "messages:send");
  const conv = await prisma.conversation.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { customer: true },
  });
  if (!conv) throw notFound("Conversation");
  if (conv.customer.optedOut) throw badRequest("This customer has opted out of messages");
  if (!isWithinServiceWindow(conv.lastInboundAt)) {
    throw badRequest(
      "More than 24 hours have passed since the customer's last message. Use an approved template instead.",
    );
  }
  if (ctx.kind === "session" && conv.control !== "HUMAN") await takeOver(ctx, id);
  if (ctx.kind === "apiKey" && conv.control === "AI")
    throw conflict("Conversation is under AI control; take it over first");
  return prisma.$transaction((tx) =>
    queueOutbound(tx, {
      orgId: ctx.orgId,
      conversationId: id,
      channelId: conv.channelId,
      authorType: "HUMAN",
      authorUserId: ctx.userId,
      payload: { type: "text", text },
    }),
  );
}

export async function sendTemplateMessage(
  ctx: AuthContext,
  id: string,
  t: { name: string; language: string; bodyParams: string[] },
) {
  requirePermission(ctx, "messages:send");
  const conv = await prisma.conversation.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { customer: true },
  });
  if (!conv) throw notFound("Conversation");
  if (conv.customer.optedOut) throw badRequest("This customer has opted out of messages");
  const msg = await prisma.$transaction((tx) =>
    queueOutbound(tx, {
      orgId: ctx.orgId,
      conversationId: id,
      channelId: conv.channelId,
      authorType: "HUMAN",
      authorUserId: ctx.userId,
      payload: { type: "template", ...t },
    }),
  );
  await auditCtx(ctx, "message.template_sent", { type: "conversation", id }, { template: t.name });
  return msg;
}

/** Approve (optionally edited) or reject an AI draft awaiting approval. */
export async function decideDraft(
  ctx: AuthContext,
  messageId: string,
  approve: boolean,
  editedText?: string,
) {
  requirePermission(ctx, "messages:send");
  const msg = await prisma.message.findFirst({
    where: { id: messageId, orgId: ctx.orgId, status: "PENDING_APPROVAL" },
    include: { conversation: { include: { customer: true } } },
  });
  if (!msg) throw notFound("Draft");
  if (!approve) {
    await prisma.message.update({ where: { id: msg.id }, data: { status: "REJECTED" } });
    await auditCtx(ctx, "draft.rejected", { type: "message", id: msg.id });
    return { status: "REJECTED" };
  }
  if (msg.conversation.customer.optedOut && !(msg.metadata as Record<string, unknown>)?.optOutConfirmation)
    throw badRequest("Customer has opted out");
  const text = (editedText ?? msg.body ?? "").trim();
  if (!text) throw badRequest("Message text is empty");
  await prisma.$transaction(async (tx) => {
    const meta = (msg.metadata ?? {}) as Record<string, unknown>;
    // An approved draft is sent on behalf of the approving human.
    await tx.message.update({
      where: { id: msg.id },
      data: {
        status: "QUEUED",
        body: text,
        authorType: msg.authorType === "SYSTEM" ? "SYSTEM" : "HUMAN",
        authorUserId: ctx.userId,
        metadata: {
          ...meta,
          payload: { type: "text", text },
          approvedBy: ctx.userId,
          edited: editedText !== undefined && editedText !== msg.body,
        } as Prisma.InputJsonValue,
      },
    });
    await enqueue(
      "send_message",
      { messageId: msg.id },
      { orgId: ctx.orgId, dedupeKey: `send:${msg.id}`, maxAttempts: 6 },
      tx,
    );
    await auditCtx(
      ctx,
      "draft.approved",
      { type: "message", id: msg.id },
      { edited: editedText !== undefined },
      tx,
    );
  });
  return { status: "QUEUED" };
}

export async function addNote(ctx: AuthContext, conversationId: string, body: string) {
  requirePermission(ctx, "conversations:write");
  await getConversationOrThrow(ctx, conversationId);
  return prisma.internalNote.create({
    data: { orgId: ctx.orgId, conversationId, authorId: ctx.userId, body },
  });
}

export async function updateTags(ctx: AuthContext, id: string, tags: string[]) {
  requirePermission(ctx, "conversations:write");
  await getConversationOrThrow(ctx, id);
  return prisma.conversation.update({
    where: { id },
    data: { tags: [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20) },
  });
}

/** Export a conversation transcript (requires data:export). */
export async function exportConversation(ctx: AuthContext, id: string) {
  requirePermission(ctx, "data:export");
  const conv = await getConversationDetail(ctx, id);
  await auditCtx(ctx, "conversation.exported", { type: "conversation", id });
  const actor = actorOf(ctx);
  return {
    exportedAt: new Date().toISOString(),
    exportedBy: actor,
    conversation: {
      id: conv.id,
      status: conv.status,
      control: conv.control,
      intent: conv.intent,
      summary: conv.summary,
      customer: {
        id: conv.customer.id,
        waId: conv.customer.waId,
        name: conv.customer.name ?? conv.customer.profileName,
      },
      messages: conv.messages.map((m) => ({
        at: m.createdAt,
        direction: m.direction,
        author: m.authorType,
        type: m.type,
        body: m.body,
        status: m.status,
      })),
      notes: conv.notes.map((n) => ({ at: n.createdAt, author: n.author?.name ?? null, body: n.body })),
      tickets: conv.tickets.map((t) => ({ number: t.number, subject: t.subject, status: t.status })),
    },
  };
}
