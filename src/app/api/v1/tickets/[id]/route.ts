import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { getTicket, updateTicket } from "@/server/services/tickets";

type P = { id: string };

/** {id} may be the ticket id or its number. */
export const GET = route<P>({ auth: "any", permission: "tickets:read" }, async (_req, { ctx, params }) =>
  getTicket(ctx, params.id),
);

export const PATCH = route<P>({ auth: "any", permission: "tickets:write" }, async (req, { ctx, params }) => {
  const b = await parseJson(
    req,
    z.object({
      status: z.enum(["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"]).optional(),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
      assignedToId: z.string().max(40).nullable().optional(),
      resolutionNote: z.string().max(5000).optional(),
      subject: z.string().min(3).max(150).optional(),
      description: z.string().max(5000).optional(),
    }),
  );
  const t = await getTicket(ctx, params.id);
  return updateTicket(ctx, t.id, b);
});
