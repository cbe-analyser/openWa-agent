import { z } from "zod";
import { parseJson, route } from "@/server/http/route";
import { deleteWebhookEndpoint, updateWebhookEndpoint } from "@/server/services/settings";

type P = { id: string };

export const PATCH = route<P>(
  { auth: "any", permission: "integrations:write" },
  async (req, { ctx, params }) => {
    await updateWebhookEndpoint(
      ctx,
      params.id,
      await parseJson(
        req,
        z.object({ enabled: z.boolean().optional(), events: z.array(z.string()).max(20).optional() }),
      ),
    );
    return { ok: true };
  },
);

export const DELETE = route<P>(
  { auth: "any", permission: "integrations:write" },
  async (_req, { ctx, params }) => {
    await deleteWebhookEndpoint(ctx, params.id);
    return { deleted: true };
  },
);
