import { z } from "zod";
import { parseQuery, route } from "@/server/http/route";
import { overview } from "@/server/services/analytics";

export const GET = route({ auth: "any", permission: "conversations:read" }, async (req, { ctx }) => {
  const { days } = parseQuery(req, z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }));
  return overview(ctx, days);
});
