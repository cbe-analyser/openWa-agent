import { z } from "zod";
import { parseQuery, route } from "@/server/http/route";
import { auditLogs } from "@/server/services/analytics";

export const GET = route({ auth: "session", permission: "audit:read" }, async (req, { ctx }) =>
  auditLogs(
    ctx,
    parseQuery(
      req,
      z.object({
        action: z.string().max(60).optional(),
        targetId: z.string().max(40).optional(),
        cursor: z.string().max(40).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
    ),
  ),
);
