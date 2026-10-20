import { route } from "@/server/http/route";
import { revokeApiKey } from "@/server/services/settings";

export const DELETE = route<{ id: string }>(
  { auth: "session", permission: "apikeys:manage" },
  async (_req, { ctx, params }) => {
    await revokeApiKey(ctx, params.id);
    return { revoked: true };
  },
);
