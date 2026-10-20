import { route } from "@/server/http/route";
import { getConversationDetail } from "@/server/services/conversations";

export const GET = route<{ id: string }>(
  { auth: "any", permission: "conversations:read" },
  async (_req, { ctx, params }) => getConversationDetail(ctx, params.id),
);
