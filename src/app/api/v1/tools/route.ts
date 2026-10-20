import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { listTools, upsertHttpTool } from "@/server/services/settings";

const httpToolBody = z.object({
  name: z.string().min(3).max(41),
  description: z.string().min(10).max(500),
  permission: z.enum(["READ", "WRITE", "HIGH_IMPACT"]),
  requiresApproval: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(30000).optional(),
  enabled: z.boolean().optional(),
  config: z.unknown(),
  secret: z.string().max(2000).nullable().optional(),
});

export const GET = route({ auth: "any", permission: "integrations:read" }, async (_req, { ctx }) => ({
  items: await listTools(ctx),
}));

/** Registers an HTTP integration tool (REST API lookup or webhook trigger). */
export const POST = route({ auth: "any", permission: "integrations:write" }, async (req, { ctx }) =>
  NextResponse.json(await upsertHttpTool(ctx, await parseJson(req, httpToolBody)), { status: 201 }),
);
