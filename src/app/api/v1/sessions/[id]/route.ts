import { route } from "@/server/http/route";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";
import { auditCtx } from "@/server/services/audit";

export const DELETE = route<{ id: string }>({ auth: "session" }, async (_req, { ctx, params }) => {
  const res = await prisma.session.deleteMany({ where: { id: params.id, userId: ctx.userId! } });
  if (!res.count) throw notFound("Session");
  await auditCtx(ctx, "auth.session_revoked", { type: "session", id: params.id });
  return { revoked: true };
});
