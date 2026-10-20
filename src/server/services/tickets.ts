import type { Prisma, TicketStatus, Urgency } from "@prisma/client";
import { prisma } from "../db";
import { badRequest, notFound } from "../errors";
import { requirePermission, type AuthContext } from "../auth/context";
import { auditCtx } from "./audit";
import { emitEvent } from "./events";

export async function listTickets(
  ctx: AuthContext,
  f: { status?: TicketStatus; q?: string; limit?: number; cursor?: string },
) {
  requirePermission(ctx, "tickets:read");
  const where: Prisma.TicketWhereInput = { orgId: ctx.orgId };
  if (f.status) where.status = f.status;
  if (f.q)
    where.OR = [
      { subject: { contains: f.q, mode: "insensitive" } },
      { description: { contains: f.q, mode: "insensitive" } },
    ];
  const limit = Math.min(f.limit ?? 50, 100);
  const rows = await prisma.ticket.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: {
      customer: { select: { id: true, name: true, profileName: true, waId: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
}

export async function getTicket(ctx: AuthContext, idOrNumber: string) {
  requirePermission(ctx, "tickets:read");
  const n = /^\d+$/.test(idOrNumber) ? Number(idOrNumber) : null;
  const t = await prisma.ticket.findFirst({
    where: { orgId: ctx.orgId, ...(n ? { number: n } : { id: idOrNumber }) },
    include: {
      customer: true,
      conversation: { select: { id: true, status: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });
  if (!t) throw notFound("Ticket");
  return t;
}

export async function createTicket(
  ctx: AuthContext,
  input: {
    subject: string;
    description?: string;
    category?: string;
    priority?: Urgency;
    conversationId?: string;
    customerId?: string;
  },
) {
  requirePermission(ctx, "tickets:write");
  let customerId = input.customerId ?? null;
  if (input.conversationId) {
    const conv = await prisma.conversation.findFirst({
      where: { id: input.conversationId, orgId: ctx.orgId },
    });
    if (!conv) throw badRequest("Conversation not found in this organization");
    customerId = customerId ?? conv.customerId;
  }
  if (
    customerId &&
    !(await prisma.customer.findFirst({ where: { id: customerId, orgId: ctx.orgId }, select: { id: true } }))
  ) {
    throw badRequest("Customer not found in this organization");
  }
  const t = await prisma.ticket.create({
    data: {
      orgId: ctx.orgId,
      subject: input.subject,
      description: input.description ?? "",
      category: input.category ?? "general",
      priority: input.priority ?? "NORMAL",
      conversationId: input.conversationId ?? null,
      customerId,
      source: ctx.kind === "apiKey" ? "API" : "HUMAN",
    },
  });
  await auditCtx(ctx, "ticket.created", { type: "ticket", id: t.id });
  await emitEvent(ctx.orgId, "ticket.created", { ticket_id: t.id, number: t.number, source: t.source });
  return t;
}

export async function updateTicket(
  ctx: AuthContext,
  id: string,
  input: {
    status?: TicketStatus;
    priority?: Urgency;
    assignedToId?: string | null;
    resolutionNote?: string;
    subject?: string;
    description?: string;
  },
) {
  requirePermission(ctx, "tickets:write");
  const t = await prisma.ticket.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!t) throw notFound("Ticket");
  if (
    input.assignedToId &&
    !(await prisma.membership.findUnique({
      where: { userId_orgId: { userId: input.assignedToId, orgId: ctx.orgId } },
    }))
  ) {
    throw badRequest("Assignee is not a member of this organization");
  }
  const resolved = input.status === "RESOLVED" || input.status === "CLOSED";
  const u = await prisma.ticket.update({
    where: { id },
    data: { ...input, ...(input.status ? { resolvedAt: resolved ? new Date() : null } : {}) },
  });
  await auditCtx(ctx, "ticket.updated", { type: "ticket", id }, { changes: Object.keys(input) });
  await emitEvent(ctx.orgId, "ticket.updated", { ticket_id: id, number: u.number, status: u.status });
  return u;
}
