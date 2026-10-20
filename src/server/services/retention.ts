import { prisma } from "../db";
import { logger } from "../logger";
import { purgeRateLimitBuckets } from "../security/ratelimit";

/**
 * Applies each organization's retention policy (message content older than `retentionDays` is
 * deleted together with webhook payloads), and housekeeps expired sessions, idempotency keys,
 * rate-limit buckets and finished jobs.
 */
export async function runRetentionSweep(now = new Date()) {
  const orgs = await prisma.organization.findMany({
    where: { retentionDays: { not: null } },
    select: { id: true, retentionDays: true },
  });
  let messages = 0;
  for (const org of orgs) {
    const cutoff = new Date(now.getTime() - org.retentionDays! * 86400_000);
    messages += (await prisma.message.deleteMany({ where: { orgId: org.id, createdAt: { lt: cutoff } } }))
      .count;
    await prisma.webhookEvent.deleteMany({ where: { orgId: org.id, receivedAt: { lt: cutoff } } });
    await prisma.agentRun.deleteMany({ where: { orgId: org.id, createdAt: { lt: cutoff } } });
    await prisma.toolExecution.deleteMany({ where: { orgId: org.id, createdAt: { lt: cutoff } } });
  }
  // Raw webhook payloads are only needed for short-term debugging.
  await prisma.webhookEvent.deleteMany({
    where: { receivedAt: { lt: new Date(now.getTime() - 30 * 86400_000) } },
  });
  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - 2 * 86400_000) } },
  });
  await purgeRateLimitBuckets(new Date(now.getTime() - 3600_000));
  await prisma.job.deleteMany({
    where: {
      status: { in: ["SUCCEEDED", "CANCELLED"] },
      completedAt: { lt: new Date(now.getTime() - 14 * 86400_000) },
    },
  });
  logger.info({ orgs: orgs.length, messagesDeleted: messages }, "Retention sweep completed");
  return { messagesDeleted: messages };
}
