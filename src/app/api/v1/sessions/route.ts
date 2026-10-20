import { route } from "@/server/http/route";
import { prisma } from "@/server/db";

export const GET = route({ auth: "session" }, async (_req, { ctx }) => ({
  items: (
    await prisma.session.findMany({
      where: { userId: ctx.userId!, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    })
  ).map((s) => ({ ...s, current: s.id === ctx.sessionId })),
}));
