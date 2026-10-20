import { prisma } from "../db";
import { requirePermission, type AuthContext } from "../auth/context";
import { isGlobalKillSwitchOn } from "./system";

/** Overview metrics computed from stored records only (no fabricated data). */
export async function overview(ctx: AuthContext, days = 30) {
  requirePermission(ctx, "conversations:read");
  const since = new Date(Date.now() - days * 86400_000);
  const orgId = ctx.orgId;
  const [
    totalConversations,
    activeConversations,
    inbound,
    failed,
    pendingTickets,
    escalated,
    resolved,
    byControl,
    decisions,
    cost,
    providers,
    channels,
    pendingApprovals,
    org,
  ] = await Promise.all([
    prisma.conversation.count({ where: { orgId } }),
    prisma.conversation.count({ where: { orgId, lastMessageAt: { gte: since } } }),
    prisma.message.count({ where: { orgId, direction: "INBOUND", createdAt: { gte: since } } }),
    prisma.message.count({
      where: { orgId, direction: "OUTBOUND", status: "FAILED", createdAt: { gte: since } },
    }),
    prisma.ticket.count({ where: { orgId, status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] } } }),
    prisma.conversation.count({ where: { orgId, status: "ESCALATED" } }),
    prisma.conversation.count({ where: { orgId, status: "RESOLVED", resolvedAt: { gte: since } } }),
    prisma.conversation.groupBy({
      by: ["control"],
      where: { orgId, lastMessageAt: { gte: since } },
      _count: true,
    }),
    prisma.agentRun.groupBy({ by: ["decision"], where: { orgId, createdAt: { gte: since } }, _count: true }),
    prisma.usageRecord.aggregate({
      where: { orgId, createdAt: { gte: since } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
    }),
    prisma.aIProviderConfig.findMany({
      where: { orgId },
      select: {
        id: true,
        name: true,
        kind: true,
        model: true,
        enabled: true,
        isPrimary: true,
        lastHealthStatus: true,
        lastHealthAt: true,
      },
    }),
    prisma.channel.findMany({
      where: { orgId },
      select: { id: true, name: true, kind: true, status: true, lastWebhookAt: true, lastError: true },
    }),
    prisma.message.count({ where: { orgId, status: "PENDING_APPROVAL" } }),
    prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { aiPaused: true, autonomyMode: true },
    }),
  ]);

  // Average first-response time: time from an inbound message to the next outbound message that was sent.
  const rt = await prisma.$queryRaw<Array<{ avg_seconds: number | null; samples: bigint }>>`
    SELECT AVG(EXTRACT(EPOCH FROM (o."sentAt" - i."createdAt")))::float AS avg_seconds, COUNT(*) AS samples
    FROM "Message" i
    JOIN LATERAL (
      SELECT m."sentAt" FROM "Message" m
      WHERE m."conversationId" = i."conversationId" AND m."direction" = 'OUTBOUND' AND m."sentAt" IS NOT NULL AND m."sentAt" >= i."createdAt"
      ORDER BY m."sentAt" ASC LIMIT 1
    ) o ON TRUE
    WHERE i."orgId" = ${orgId} AND i."direction" = 'INBOUND' AND i."createdAt" >= ${since}`;

  const decisionCounts = Object.fromEntries(decisions.map((d) => [d.decision ?? "NONE", d._count]));
  const handled = (decisionCounts.SEND ?? 0) + (decisionCounts.DRAFT ?? 0) + (decisionCounts.ESCALATE ?? 0);
  const controlCounts = Object.fromEntries(byControl.map((c) => [c.control, c._count]));
  return {
    periodDays: days,
    totalConversations,
    activeConversations,
    incomingMessages: inbound,
    aiHandledConversations: controlCounts.AI ?? 0,
    humanHandledConversations: (controlCounts.HUMAN ?? 0) + (controlCounts.PENDING_HUMAN ?? 0),
    escalatedOpen: escalated,
    escalationRate: handled ? (decisionCounts.ESCALATE ?? 0) / handled : null,
    resolvedConversations: resolved,
    resolutionRate: activeConversations ? resolved / activeConversations : null,
    avgFirstResponseSeconds: rt[0]?.avg_seconds ?? null,
    responseSamples: Number(rt[0]?.samples ?? 0),
    failedMessages: failed,
    pendingTickets,
    pendingApprovals,
    estimatedAiCostUsd: cost._sum.costUsd ?? 0,
    tokens: { input: cost._sum.inputTokens ?? 0, output: cost._sum.outputTokens ?? 0 },
    agentDecisions: decisionCounts,
    providers,
    channels,
    aiPaused: org.aiPaused,
    autonomyMode: org.autonomyMode,
    globalKillSwitch: await isGlobalKillSwitchOn(),
  };
}

export async function analytics(ctx: AuthContext, days = 30) {
  requirePermission(ctx, "conversations:read");
  const since = new Date(Date.now() - days * 86400_000);
  const [daily, intents, urgency, resolutionByIntent] = await Promise.all([
    prisma.$queryRaw<Array<{ day: Date; inbound: bigint; outbound: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*) FILTER (WHERE "direction" = 'INBOUND') AS inbound,
             COUNT(*) FILTER (WHERE "direction" = 'OUTBOUND' AND "status" IN ('SENT','DELIVERED','READ')) AS outbound
      FROM "Message" WHERE "orgId" = ${ctx.orgId} AND "createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1`,
    prisma.agentRun.groupBy({
      by: ["intent"],
      where: { orgId: ctx.orgId, createdAt: { gte: since }, intent: { not: null } },
      _count: true,
    }),
    prisma.conversation.groupBy({
      by: ["urgency"],
      where: { orgId: ctx.orgId, lastMessageAt: { gte: since } },
      _count: true,
    }),
    prisma.conversation.groupBy({
      by: ["intent", "status"],
      where: { orgId: ctx.orgId, lastMessageAt: { gte: since }, intent: { not: null } },
      _count: true,
    }),
  ]);
  return {
    daily: daily.map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      inbound: Number(d.inbound),
      outbound: Number(d.outbound),
    })),
    intents: intents.map((i) => ({ intent: i.intent, count: i._count })).sort((a, b) => b.count - a.count),
    urgency: urgency.map((u) => ({ urgency: u.urgency, count: u._count })),
    resolutionByIntent: resolutionByIntent.map((r) => ({
      intent: r.intent,
      status: r.status,
      count: r._count,
    })),
  };
}

export async function usage(ctx: AuthContext, days = 30) {
  requirePermission(ctx, "usage:read");
  const since = new Date(Date.now() - days * 86400_000);
  const [byProvider, daily, budgets] = await Promise.all([
    prisma.usageRecord.groupBy({
      by: ["provider", "model", "kind", "success"],
      where: { orgId: ctx.orgId, createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      _count: true,
      _avg: { latencyMs: true },
    }),
    prisma.$queryRaw<Array<{ day: Date; cost: number | null; tokens: bigint | null; calls: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, SUM("costUsd")::float AS cost, SUM("inputTokens" + "outputTokens") AS tokens, COUNT(*) AS calls
      FROM "UsageRecord" WHERE "orgId" = ${ctx.orgId} AND "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    prisma.aIProviderConfig.findMany({
      where: { orgId: ctx.orgId },
      select: { id: true, name: true, monthlyTokenBudget: true },
    }),
  ]);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthUsage = await prisma.usageRecord.groupBy({
    by: ["providerConfigId"],
    where: { orgId: ctx.orgId, createdAt: { gte: monthStart } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return {
    byProvider: byProvider.map((r) => ({
      provider: r.provider,
      model: r.model,
      kind: r.kind,
      success: r.success,
      calls: r._count,
      inputTokens: r._sum.inputTokens ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
      costUsd: r._sum.costUsd,
      avgLatencyMs: r._avg.latencyMs,
    })),
    daily: daily.map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      costUsd: d.cost ?? 0,
      tokens: Number(d.tokens ?? 0),
      calls: Number(d.calls),
    })),
    budgets: budgets.map((b) => {
      const m = monthUsage.find((u) => u.providerConfigId === b.id);
      return { ...b, usedThisMonth: (m?._sum.inputTokens ?? 0) + (m?._sum.outputTokens ?? 0) };
    }),
  };
}

export async function systemHealth(ctx: AuthContext | null) {
  const started = Date.now();
  let database = { ok: true, latencyMs: 0, error: undefined as string | undefined };
  try {
    await prisma.$queryRaw`SELECT 1`;
    database.latencyMs = Date.now() - started;
  } catch (err) {
    database = { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
  }
  if (!ctx) return { status: database.ok ? "ok" : "degraded", database: { ok: database.ok } };
  requirePermission(ctx, "health:read");
  const [pending, dead, running, lastCompleted, oldestPending] = await Promise.all([
    prisma.job.count({ where: { status: "PENDING", runAt: { lte: new Date() } } }),
    prisma.job.count({ where: { status: "DEAD", orgId: ctx.orgId } }),
    prisma.job.count({ where: { status: "RUNNING" } }),
    prisma.job.findFirst({
      where: { status: { in: ["SUCCEEDED", "DEAD"] } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
    prisma.job.findFirst({
      where: { status: "PENDING", runAt: { lte: new Date() } },
      orderBy: { runAt: "asc" },
      select: { runAt: true },
    }),
  ]);
  const queueLagSeconds = oldestPending ? Math.round((Date.now() - oldestPending.runAt.getTime()) / 1000) : 0;
  const workerHealthy = queueLagSeconds < 120;
  const deadJobs = await prisma.job.findMany({
    where: { status: "DEAD", orgId: ctx.orgId },
    orderBy: { completedAt: "desc" },
    take: 20,
    select: { id: true, type: true, lastError: true, attempts: true, completedAt: true },
  });
  return {
    status: database.ok && workerHealthy ? "ok" : "degraded",
    database,
    worker: {
      healthy: workerHealthy,
      pendingDue: pending,
      running,
      queueLagSeconds,
      lastJobCompletedAt: lastCompleted?.completedAt ?? null,
    },
    deadLetter: { count: dead, recent: deadJobs },
    providers: await prisma.aIProviderConfig.findMany({
      where: { orgId: ctx.orgId },
      select: {
        id: true,
        name: true,
        kind: true,
        model: true,
        enabled: true,
        lastHealthStatus: true,
        lastHealthAt: true,
        lastHealthError: true,
      },
    }),
    channels: await prisma.channel.findMany({
      where: { orgId: ctx.orgId },
      select: { id: true, name: true, kind: true, status: true, lastWebhookAt: true, lastError: true },
    }),
    globalKillSwitch: await isGlobalKillSwitchOn(),
  };
}

export async function auditLogs(
  ctx: AuthContext,
  f: { action?: string; targetId?: string; cursor?: string; limit?: number },
) {
  requirePermission(ctx, "audit:read");
  const limit = Math.min(f.limit ?? 100, 200);
  const rows = await prisma.auditLog.findMany({
    where: {
      orgId: ctx.orgId,
      ...(f.action ? { action: { startsWith: f.action } } : {}),
      ...(f.targetId ? { targetId: f.targetId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
  });
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
}
