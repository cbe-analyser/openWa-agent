import { z } from "zod";
import { parseQuery, route } from "@/server/http/route";
import { listConversations } from "@/server/services/conversations";

const q = z.object({
  status: z.enum(["OPEN", "PENDING", "ESCALATED", "RESOLVED"]).optional(),
  control: z.enum(["AI", "PENDING_HUMAN", "HUMAN"]).optional(),
  intent: z.string().max(64).optional(),
  assignedToMe: z.enum(["true", "false"]).optional(),
  unread: z.enum(["true", "false"]).optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = route({ auth: "any", permission: "conversations:read" }, async (req, { ctx }) => {
  const f = parseQuery(req, q);
  return listConversations(ctx, {
    ...f,
    assignedToMe: f.assignedToMe === "true",
    unread: f.unread === "true",
  });
});
