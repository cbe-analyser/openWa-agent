import { route } from "@/server/http/route";
import { systemHealth } from "@/server/services/analytics";

export const GET = route({ auth: "any", permission: "health:read" }, async (_req, { ctx }) =>
  systemHealth(ctx),
);
