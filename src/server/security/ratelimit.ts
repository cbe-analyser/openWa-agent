import { prisma } from "../db";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Fixed-window rate limiter backed by PostgreSQL so limits hold across multiple app
 * instances. Each call is a single upsert.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  const count = rows[0]?.count ?? 1;
  const retryAfterSec = Math.ceil((windowStart.getTime() + windowMs - now) / 1000);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSec };
}

export async function purgeRateLimitBuckets(olderThan: Date) {
  await prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: olderThan } } });
}
