import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { rotateApiKey } from "@/server/services/settings";

/** Issues a replacement key with the same scopes; the old key is revoked now or after an optional grace period. */
export const POST = route<{ id: string }>(
  { auth: "session", permission: "apikeys:manage" },
  async (req, { ctx, params }) => {
    const b = await parseJson(req, z.object({ graceDays: z.number().int().min(0).max(30).default(0) }));
    return rotateApiKey(ctx, params.id, b.graceDays);
  },
);
