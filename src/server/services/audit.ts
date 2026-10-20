import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "../db";
import { redact } from "../security/redact";
import { actorOf, type AuthContext } from "../auth/context";

export interface AuditEntry {
  orgId: string | null;
  actorType: "USER" | "API_KEY" | "AI" | "SYSTEM";
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function audit(entry: AuditEntry, tx: Tx = prisma) {
  await tx.auditLog.create({
    data: {
      orgId: entry.orgId,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: redact(entry.metadata ?? {}) as Prisma.InputJsonValue,
      ip: entry.ip ?? null,
    },
  });
}

/** Audit helper for actions performed by an authenticated user or API key. */
export async function auditCtx(
  ctx: AuthContext,
  action: string,
  target?: { type: string; id: string },
  metadata?: Record<string, unknown>,
  tx: Tx = prisma,
) {
  const actor = actorOf(ctx);
  await audit(
    {
      orgId: ctx.orgId,
      actorType: actor.actorType as AuditEntry["actorType"],
      actorId: actor.actorId,
      action,
      targetType: target?.type,
      targetId: target?.id,
      metadata,
      ip: ctx.ip,
    },
    tx,
  );
}
