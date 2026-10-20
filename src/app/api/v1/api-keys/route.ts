import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { createApiKey, listApiKeys } from "@/server/services/settings";

export const GET = route({ auth: "session", permission: "apikeys:manage" }, async (_req, { ctx }) => ({
  items: await listApiKeys(ctx),
}));

/** Response includes the full key exactly once. */
export const POST = route(
  { auth: "session", permission: "apikeys:manage", rateLimit: { limit: 20, windowSec: 3600 } },
  async (req, { ctx }) => {
    const b = await parseJson(
      req,
      z.object({
        name: z.string().min(1).max(60),
        scopes: z.array(z.string()).min(1).max(30),
        expiresInDays: z.number().int().min(1).max(730).nullable().optional(),
      }),
    );
    return NextResponse.json(await createApiKey(ctx, b), { status: 201 });
  },
);
