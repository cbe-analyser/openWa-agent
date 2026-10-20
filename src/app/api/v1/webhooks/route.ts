import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { createWebhookEndpoint, listWebhookEndpoints } from "@/server/services/settings";
import { WEBHOOK_EVENTS } from "@/server/services/events";

export const GET = route({ auth: "any", permission: "integrations:read" }, async (_req, { ctx }) => ({
  items: await listWebhookEndpoints(ctx),
  events: WEBHOOK_EVENTS,
}));

/** Registers an outbound webhook. The signing secret is returned exactly once. */
export const POST = route({ auth: "any", permission: "integrations:write" }, async (req, { ctx }) => {
  const b = await parseJson(
    req,
    z.object({
      url: z.string().url().max(2000),
      events: z.array(z.string()).min(1).max(20),
      description: z.string().max(200).optional(),
    }),
  );
  return NextResponse.json(await createWebhookEndpoint(ctx, b), { status: 201 });
});
