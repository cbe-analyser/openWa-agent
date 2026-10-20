import { route } from "@/server/http/route";
import { channelHealth } from "@/server/services/settings";

export const POST = route<{ id: string }>(
  { auth: "session", permission: "settings:read", rateLimit: { limit: 20, windowSec: 60 } },
  async (_req, { ctx, params }) => channelHealth(ctx, params.id),
);
