import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { notFound } from "../errors";
import { requirePermission, type AuthContext } from "../auth/context";
import { auditCtx } from "./audit";
import { cancelCustomerFollowUps } from "./followups";

export async function listCustomers(
  ctx: AuthContext,
  f: { q?: string; tag?: string; limit?: number; cursor?: string },
) {
  requirePermission(ctx, "customers:read");
  const where: Prisma.CustomerWhereInput = { orgId: ctx.orgId };
  if (f.tag) where.tags = { has: f.tag };
  if (f.q) {
    where.OR = [
      { name: { contains: f.q, mode: "insensitive" } },
      { profileName: { contains: f.q, mode: "insensitive" } },
      { waId: { contains: f.q } },
      { email: { contains: f.q, mode: "insensitive" } },
    ];
  }
  const limit = Math.min(f.limit ?? 50, 100);
  const rows = await prisma.customer.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: { _count: { select: { conversations: true, tickets: true } } },
  });
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
}

export async function getCustomer(ctx: AuthContext, id: string) {
  requirePermission(ctx, "customers:read");
  const c = await prisma.customer.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      conversations: { orderBy: { lastMessageAt: "desc" }, include: { channel: { select: { name: true } } } },
      tickets: { orderBy: { createdAt: "desc" } },
      followUps: { orderBy: { dueAt: "desc" }, take: 20 },
    },
  });
  if (!c) throw notFound("Customer");
  const timeline = await prisma.message.findMany({
    where: { orgId: ctx.orgId, conversation: { customerId: id } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      direction: true,
      authorType: true,
      body: true,
      type: true,
      status: true,
      createdAt: true,
      conversationId: true,
    },
  });
  return { ...c, timeline };
}

export async function updateCustomer(
  ctx: AuthContext,
  id: string,
  input: {
    name?: string | null;
    email?: string | null;
    tags?: string[];
    externalRef?: string | null;
    timezone?: string | null;
    optedOut?: boolean;
  },
) {
  requirePermission(ctx, "customers:write");
  const c = await prisma.customer.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!c) throw notFound("Customer");
  const data: Prisma.CustomerUpdateInput = { ...input };
  if (input.tags)
    data.tags = [...new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 30);
  if (input.optedOut !== undefined && input.optedOut !== c.optedOut) {
    data.optedOutAt = input.optedOut ? new Date() : null;
    if (!input.optedOut) data.optedInAt = new Date();
  }
  const u = await prisma.customer.update({ where: { id }, data });
  if (input.optedOut === true) await cancelCustomerFollowUps(ctx.orgId, id, "Opted out by staff");
  await auditCtx(ctx, "customer.updated", { type: "customer", id }, { fields: Object.keys(input) });
  return u;
}

/** Data-subject access: everything stored about one customer. */
export async function exportCustomerData(ctx: AuthContext, id: string) {
  requirePermission(ctx, "data:export");
  const c = await prisma.customer.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { conversations: { include: { messages: true, notes: true } }, tickets: true, followUps: true },
  });
  if (!c) throw notFound("Customer");
  await auditCtx(ctx, "customer.exported", { type: "customer", id });
  return { exportedAt: new Date().toISOString(), customer: c };
}

/** Right to erasure: deletes the customer and all their conversations, messages, tickets and follow-ups. */
export async function deleteCustomerData(ctx: AuthContext, id: string) {
  requirePermission(ctx, "data:delete");
  const c = await prisma.customer.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!c) throw notFound("Customer");
  await prisma.$transaction(async (tx) => {
    await tx.ticket.deleteMany({ where: { orgId: ctx.orgId, customerId: id } });
    await tx.customer.delete({ where: { id } }); // cascades to conversations, messages, notes, follow-ups
  });
  await auditCtx(ctx, "customer.deleted", { type: "customer", id }, { waIdSuffix: c.waId.slice(-3) });
}
