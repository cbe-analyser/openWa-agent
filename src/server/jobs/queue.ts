import type { Job, Prisma } from "@prisma/client";
import { prisma, type Tx } from "../db";

export interface EnqueueOptions {
  orgId?: string | null;
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
}

/** Signals a failure that retrying cannot fix; the job goes straight to the dead-letter state. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

/**
 * Durable job queue stored in PostgreSQL. Enqueue inside the same transaction as the data it
 * refers to, so a job exists if and only if its triggering record was committed.
 * Returns false when a job with the same dedupeKey already exists.
 */
export async function enqueue(
  type: string,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
  tx: Tx = prisma,
): Promise<boolean> {
  const res = await tx.job.createMany({
    data: [
      {
        type,
        payload: payload as Prisma.InputJsonValue,
        orgId: opts.orgId ?? null,
        runAt: opts.runAt ?? new Date(),
        dedupeKey: opts.dedupeKey ?? null,
        maxAttempts: opts.maxAttempts ?? 5,
      },
    ],
    skipDuplicates: true,
  });
  return res.count === 1;
}

/** Atomically claims due jobs using FOR UPDATE SKIP LOCKED so multiple workers never share a job. */
export async function claimJobs(workerId: string, limit: number): Promise<Job[]> {
  if (limit <= 0) return [];
  return prisma.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "Job"
      WHERE "status" = 'PENDING' AND "runAt" <= now()
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

export async function completeJob(id: string) {
  await prisma.job.update({
    where: { id },
    data: { status: "SUCCEEDED", completedAt: new Date(), lockedAt: null, lastError: null },
  });
}

export function backoffMs(attempt: number): number {
  const base = Math.min(60 * 60 * 1000, 5000 * 2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * 1000);
}

/** Records a failure; schedules a retry with exponential backoff or moves the job to DEAD. Returns the new status. */
export async function failJob(
  job: Pick<Job, "id" | "attempts" | "maxAttempts">,
  error: string,
  permanent = false,
): Promise<"PENDING" | "DEAD"> {
  const dead = permanent || job.attempts >= job.maxAttempts;
  await prisma.job.update({
    where: { id: job.id },
    data: dead
      ? { status: "DEAD", lastError: error.slice(0, 2000), lockedAt: null, completedAt: new Date() }
      : {
          status: "PENDING",
          lastError: error.slice(0, 2000),
          lockedAt: null,
          runAt: new Date(Date.now() + backoffMs(job.attempts)),
        },
  });
  return dead ? "DEAD" : "PENDING";
}

/** Returns jobs stuck in RUNNING (e.g. the worker crashed) to the queue. */
export async function recoverStaleJobs(olderThanMs = 10 * 60 * 1000): Promise<number> {
  const res = await prisma.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - olderThanMs) } },
    data: { status: "PENDING", lockedAt: null, lockedBy: null },
  });
  return res.count;
}

export async function cancelJobs(where: { dedupeKey: string }) {
  await prisma.job.updateMany({
    where: { ...where, status: "PENDING" },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
}

/** Re-queues a dead-lettered job (admin action). */
export async function retryDeadJob(orgId: string, id: string) {
  const res = await prisma.job.updateMany({
    where: { id, orgId, status: "DEAD" },
    data: { status: "PENDING", attempts: 0, runAt: new Date(), lastError: null, completedAt: null },
  });
  return res.count === 1;
}
