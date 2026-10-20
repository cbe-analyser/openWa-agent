import { route } from "@/server/http/route";
import { prisma } from "@/server/db";

export const GET = route({ auth: "session" }, async (_req, { ctx }) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.userId! },
    select: {
      id: true,
      email: true,
      name: true,
      isInstanceAdmin: true,
      memberships: { select: { role: true, org: { select: { id: true, name: true } } } },
    },
  });
  return { user, activeOrgId: ctx.orgId, role: ctx.role, permissions: ctx.permissions };
});
