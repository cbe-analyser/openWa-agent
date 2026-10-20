import { route } from "@/server/http/route";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";
import { auditCtx } from "@/server/services/audit";

export const DELETE = route<{ id: string }>(
  { auth: "session", permission: "team:manage" },
  async (_req, { ctx, params }) => {
    const res = await prisma.invitation.deleteMany({
      where: { id: params.id, orgId: ctx.orgId, acceptedAt: null },
    });
    if (!res.count) throw notFound("Invitation");
    await auditCtx(ctx, "team.invitation_revoked", { type: "invitation", id: params.id });
    return { revoked: true };
  },
);
