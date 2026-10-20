import { route } from "@/server/http/route";
import { reindexDocument } from "@/server/services/knowledge";

export const POST = route<{ id: string }>(
  { auth: "any", permission: "knowledge:write" },
  async (_req, { ctx, params }) => {
    await reindexDocument(ctx, params.id);
    return { queued: true };
  },
);
