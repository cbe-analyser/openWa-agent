import { z } from "zod";
import { parseQuery, route } from "@/server/http/route";
import { prisma } from "@/server/db";

export const GET = route({ auth: "any", permission: "integrations:read" }, async (req, { ctx }) => {
  const q = parseQuery(
    req,
    z.object({
      status: z
        .enum(["SUCCEEDED", "FAILED", "DENIED", "PENDING_APPROVAL", "APPROVED", "REJECTED"])
        .optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
  );
  const items = await prisma.toolExecution.findMany({
    where: { orgId: ctx.orgId, ...(q.status ? { status: q.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: q.limit,
  });
  return { items };
});
