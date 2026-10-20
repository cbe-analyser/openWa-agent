import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { testSearch } from "@/server/services/knowledge";

export const POST = route(
  { auth: "any", permission: "knowledge:read", rateLimit: { limit: 60, windowSec: 60 } },
  async (req, { ctx }) => {
    const { query } = await parseJson(req, z.object({ query: z.string().trim().min(2).max(500) }));
    return testSearch(ctx, query);
  },
);
